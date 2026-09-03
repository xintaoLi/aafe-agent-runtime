/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import { TaskStore } from './TaskStore.js';
import { TaskScheduler } from './TaskScheduler.js';
import { CursorTaskRuntime } from '../runtime/CursorTaskRuntime.js';
import { assertCloudProjectReadiness } from '../runtime/CloudProjectReadiness.js';
import { isTerminalTaskStatus } from './TaskState.js';

/**
 * AAFE's business state owner. Cursor owns execution; this manager owns which
 * execution belongs to which isolated task and what the task means.
 */
export class TaskManager {
  constructor({
    root = process.cwd(),
    output = '.aafe',
    store = null,
    runtime = null,
    scheduler = null,
    maxConcurrentTasks = 4,
    runtimeOptions = {},
    validateProjectRuntime = true,
    recoverOnStart = true,
    onEvent = () => {}
  } = {}) {
    this.root = root;
    this.output = output;
    this.store = store ?? new TaskStore({ root, output });
    this.onEvent = onEvent;
    this.listeners = new Set();
    this.validateProjectRuntime = validateProjectRuntime;
    this.recoverOnStart = recoverOnStart;
    this.runtimeOptions = { ...runtimeOptions };
    this.runtime = runtime ?? new CursorTaskRuntime({
      onEvent: (event) => {
        void this.#recordRuntimeEvent(event);
      }
    });
    this.scheduler = scheduler ?? new TaskScheduler({
      maxConcurrentTasks,
      onEvent: (event) => this.#publish(event)
    });
  }

  async create(input = {}) {
    const context = isolatedContext(input.context, input);
    const task = await this.store.create({
      id: input.id,
      kind: input.kind,
      goal: input.goal ?? input.requirement,
      requirement: input.requirement,
      source: input.source,
      repository: normalizeRepository(input.repository, input.baseBranch),
      baseBranch: input.baseBranch,
      taskBranch: input.taskBranch
    }, context);
    this.#publish({ type: 'task.created', taskId: task.id, task });
    return task;
  }

  async initialize(options = {}) {
    if (options.recoverOnStart === false || this.recoverOnStart === false) return [];
    return this.recover(options);
  }

  async start(taskId, options = {}) {
    const task = await this.#require(taskId);
    if (task.status === 'running' || this.scheduler.has(taskId)) {
      throw new Error(`task-already-active:${taskId}`);
    }
    if (!['created', 'ready', 'waiting', 'failed', 'cancelled', 'blocked', 'completed'].includes(task.status)) {
      throw new Error(`task-not-runnable:${taskId}:${task.status}`);
    }

    if (this.validateProjectRuntime && options.validateProjectRuntime !== false) {
      try {
        const readiness = await assertCloudProjectReadiness(this.root);
        await this.store.appendEvent(taskId, 'task.runtime.ready', readiness);
      } catch (error) {
        await this.#markBlocked(task, error);
        throw error;
      }
    }

    await this.store.transition(taskId, 'queued');
    return this.scheduler.schedule(taskId, () => this.#execute(taskId, options));
  }

  async continue(taskId, message, options = {}) {
    const task = await this.#require(taskId);
    const context = await this.store.getContext(taskId);
    context.conversation ??= { messages: [] };
    context.conversation.messages ??= [];
    context.conversation.messages.push({
      role: 'user',
      content: String(message),
      createdAt: new Date().toISOString()
    });
    await this.store.replaceContext(taskId, context);
    return this.start(task.id, { ...options, prompt: String(message), followUp: true });
  }

  async cancel(taskId) {
    let task = await this.#require(taskId);
    const queued = this.scheduler.cancelQueued(taskId);
    let runtime = { cancelled: false, reason: 'not-running' };
    if (!queued && task.status === 'running') {
      runtime = await this.runtime.cancel(task, this.runtimeOptions);
    }
    task = await this.#require(taskId);
    if (!isTerminalTaskStatus(task.status)) {
      task = await this.store.transition(taskId, 'cancelled', {
        event: { queued, runtime }
      });
    }
    await this.runtime.close(taskId);
    this.#publish({ type: 'task.cancelled', taskId, queued, runtime });
    return task;
  }

  /**
   * Restore persisted work after an AAFE process restart.
   */
  async recover(options = {}) {
    const candidates = await this.store.list({
      statuses: ['queued', 'planning', 'ready', 'running'],
      limit: options.limit ?? 1000
    });
    const recovered = [];
    for (const task of candidates) {
      if (this.scheduler.has(task.id)) continue;
      if (task.status === 'running' && task.cursor?.agentId && task.cursor?.activeRunId) {
        recovered.push({
          taskId: task.id,
          promise: this.scheduler.schedule(task.id, () => this.#recoverRunning(task, options))
        });
        continue;
      }
      if (this.validateProjectRuntime && options.validateProjectRuntime !== false) {
        try {
          await assertCloudProjectReadiness(this.root);
        } catch (error) {
          await this.#markBlocked(task, error);
          continue;
        }
      }
      const reset = task.status === 'queued'
        ? task
        : await this.store.transition(task.id, 'queued', {
            event: { recovery: true, from: task.status }
          });
      recovered.push({
        taskId: reset.id,
        promise: this.scheduler.schedule(reset.id, () => this.#execute(reset.id, options))
      });
    }
    return recovered;
  }

  get(taskId) {
    return this.store.get(taskId);
  }

  getContext(taskId) {
    return this.store.getContext(taskId);
  }

  events(taskId) {
    return this.store.events(taskId);
  }

  list(options) {
    return this.store.list(options);
  }

  stats() {
    return this.scheduler.stats();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    await this.runtime.closeAll();
  }

  async #execute(taskId, options) {
    let task = await this.#require(taskId);
    task = await this.store.transition(taskId, 'running');
    const context = await this.store.getContext(taskId);
    const prompt = options.prompt ?? buildTaskPrompt(task, context);

    try {
      const result = await this.runtime.run(task, prompt, {
        ...this.runtimeOptions,
        ...options,
        idempotencyKey: options.idempotencyKey ?? `aafe-run-${task.id}-${task.cursor?.runs?.length ?? 0}`,
        onBinding: async ({ agentId, runId }) => {
          const latest = await this.#require(taskId);
          const runs = [...(latest.cursor?.runs ?? [])];
          if (!runs.some((item) => item.runId === runId)) {
            runs.push({ runId, status: 'running', startedAt: new Date().toISOString() });
          }
          await this.store.update(taskId, {
            cursor: { agentId, activeRunId: runId, runs }
          }, {
            eventType: 'task.cursor.bound',
            eventPayload: { agentId, runId }
          });
        }
      });
      return this.#finish(taskId, result, options);
    } catch (error) {
      const latest = await this.#require(taskId);
      if (latest.status === 'cancelled') {
        await this.runtime.close(taskId);
        return latest;
      }
      const status = /cancel/i.test(error instanceof Error ? error.message : String(error))
        ? 'cancelled'
        : 'failed';
      const failed = await this.store.transition(taskId, status, {
        error: error instanceof Error ? error.message : String(error)
      });
      await this.runtime.close(taskId);
      this.#publish({ type: 'task.failed', taskId, error: failed.error });
      return failed;
    }
  }

  async #recoverRunning(task, options) {
    try {
      const result = await this.runtime.recover(task, {
        ...this.runtimeOptions,
        ...options
      });
      return this.#finish(task.id, result, options);
    } catch (error) {
      const failed = await this.store.transition(task.id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
        event: { recovery: true }
      });
      await this.runtime.close(task.id);
      return failed;
    }
  }

  async #finish(taskId, result, options) {
    let task = await this.#require(taskId);
    if (task.status === 'cancelled') {
      await this.runtime.close(taskId);
      return task;
    }
    const runs = (task.cursor?.runs ?? []).map((run) => run.runId === result.runId
      ? { ...run, status: result.status, finishedAt: new Date().toISOString() }
      : run);
    const branch = result.git?.branches?.find((entry) => entry.branch)?.branch ?? task.taskBranch;
    task = await this.store.update(taskId, {
      cursor: { ...task.cursor, activeRunId: null, runs },
      taskBranch: branch
    }, {
      eventType: 'task.cursor.result',
      eventPayload: result
    });

    if (result.status === 'cancelled') {
      task = await this.store.transition(taskId, 'cancelled', { result });
    } else if (result.status === 'error' || result.status === 'missing') {
      task = await this.store.transition(taskId, 'failed', {
        error: result.text || `cursor-run-${result.status}`,
        result
      });
    } else if (typeof options.verify === 'function') {
      task = await this.store.transition(taskId, 'verifying');
      try {
        const verification = await options.verify(task, result);
        task = await this.store.transition(taskId, verification?.passed === false ? 'failed' : 'completed', {
          result: { execution: result, verification }
        });
      } catch (error) {
        task = await this.store.transition(taskId, 'failed', {
          error: error instanceof Error ? error.message : String(error),
          result
        });
      }
    } else {
      task = await this.store.transition(taskId, 'completed', { result });
    }

    await this.runtime.close(taskId);
    this.#publish({ type: 'task.finished', taskId, status: task.status, result: task.result });
    return task;
  }

  async #markBlocked(task, error) {
    const current = task.status === 'blocked'
      ? task
      : await this.store.transition(task.id, 'blocked', {
          error: error instanceof Error ? error.message : String(error),
          event: { readiness: error?.readiness ?? null }
        });
    this.#publish({ type: 'task.blocked', taskId: task.id, reason: current.error });
  }

  async #recordRuntimeEvent(event) {
    try {
      await this.store.appendEvent(event.taskId, event.type, event.payload);
    } catch {
      // A late SDK event after cancellation must not revive or crash a task.
    }
    this.#publish(event);
  }

  async #require(taskId) {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task-not-found:${taskId}`);
    return task;
  }

  #publish(event) {
    try { this.onEvent(event); } catch { /* observer failures do not change task state */ }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* observers are isolated */ }
    }
  }
}

function isolatedContext(context, input) {
  const base = structuredClone(context ?? {});
  return {
    userRequest: base.userRequest ?? input.requirement ?? input.goal ?? '',
    conversation: base.conversation ?? { messages: [] },
    project: base.project ?? {},
    plan: base.plan ?? null,
    constraints: base.constraints ?? [],
    metadata: base.metadata ?? {}
  };
}

function normalizeRepository(repository, baseBranch) {
  if (typeof repository === 'string') {
    return { url: repository, ...(baseBranch ? { baseBranch } : {}) };
  }
  if (!repository) return null;
  return { ...structuredClone(repository), ...(baseBranch ? { baseBranch } : {}) };
}

function buildTaskPrompt(task, context) {
  return [
    'You are the coding execution agent managed by AAFE.',
    'Use the project Rules and Skills provided by Cursor native project discovery.',
    'Do not treat this task payload as a replacement for repository Rules or Skills.',
    '',
    `Task ID: ${task.id}`,
    `Requirement: ${task.requirement ?? task.goal}`,
    task.taskBranch ? `Requested task branch: ${task.taskBranch}` : null,
    '',
    'Task-specific context:',
    JSON.stringify(context, null, 2),
    '',
    'Preserve existing behavior and unrelated user changes. Run focused verification and report the result.'
  ].filter(Boolean).join('\n');
}
