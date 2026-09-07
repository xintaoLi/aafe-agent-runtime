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

import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTaskTransition, isTaskStatus } from './TaskState.js';

const TASK_FILE = 'task.json';
const CONTEXT_FILE = 'context.json';
const EVENTS_FILE = 'events.jsonl';
const INDEX_FILE = 'index.json';
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TAPD_ID = /\/(?:story|bug|task)\/detail\/(\d+)/i;

/**
 * Durable file-backed task state. Each task owns one directory, context file
 * and event log so no API can accidentally read another task's dynamic state.
 */
export class TaskStore {
  constructor({ root = process.cwd(), output = '.aafe' } = {}) {
    this.root = root;
    this.output = output;
    this.tasksDir = path.join(root, output, 'tasks');
    this.indexFile = path.join(this.tasksDir, INDEX_FILE);
    this.writeQueues = new Map();
    this.indexQueue = Promise.resolve();
  }

  async create(partial = {}, context = {}) {
    const now = new Date().toISOString();
    const id = validateTaskId(partial.id ?? createTaskId());
    const existing = await this.get(id);
    if (existing) throw new Error(`task-already-exists:${id}`);

    const task = {
      version: 1,
      id,
      kind: partial.kind ?? 'generic',
      goal: partial.goal ?? partial.requirement ?? '',
      requirement: partial.requirement ?? null,
      source: clone(partial.source ?? null),
      repository: clone(partial.repository ?? partial.workspace?.repository ?? null),
      workspace: clone(partial.workspace ?? null),
      baseBranch: partial.baseBranch ?? partial.workspace?.baseBranch ?? partial.repository?.baseBranch ?? partial.repository?.branch ?? null,
      taskBranch: partial.taskBranch ?? null,
      // Pinned at creation so every run of this task uses one model. Absent on
      // tasks created before model routing; those fall back to the runtime default.
      model: partial.model ?? null,
      provider: partial.provider ?? 'cursor',
      codex: { agentId: partial.codex?.agentId ?? null, activeRunId: partial.codex?.activeRunId ?? null, runs: clone(partial.codex?.runs ?? []) },
      status: partial.status ?? 'created',
      cursor: {
        agentId: partial.cursor?.agentId ?? null,
        activeRunId: partial.cursor?.activeRunId ?? null,
        runs: clone(partial.cursor?.runs ?? [])
      },
      sdd: clone(partial.sdd ?? null),
      // Where this task's work actually happens, written when a workspace is
      // leased. Without it the only record of the checkout is a log line.
      execution: clone(partial.execution ?? null),
      // Lifted out of the run result: a PR is a fact about the task, and every
      // reader was otherwise digging through `result.execution.git`.
      pullRequest: clone(partial.pullRequest ?? null),
      result: clone(partial.result ?? null),
      error: partial.error ?? null,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now
    };
    if (!isTaskStatus(task.status)) throw new Error(`unknown-task-status:${task.status}`);

    await this.#withTaskLock(id, async () => {
      await mkdir(this.#taskDir(id), { recursive: true });
      await atomicJsonWrite(this.#file(id, TASK_FILE), task);
      await atomicJsonWrite(this.#file(id, CONTEXT_FILE), clone(context));
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.created', {
        status: task.status
      }));
    });
    await this.#touchIndex(task);
    return clone(task);
  }

  async get(taskId) {
    const id = validateTaskId(taskId);
    return readJson(this.#file(id, TASK_FILE));
  }

  async getContext(taskId) {
    const id = validateTaskId(taskId);
    return clone((await readJson(this.#file(id, CONTEXT_FILE))) ?? {});
  }

  async replaceContext(taskId, context) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      await this.#require(id);
      const isolated = clone(context ?? {});
      await atomicJsonWrite(this.#file(id, CONTEXT_FILE), isolated);
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.context.updated'));
      return clone(isolated);
    });
  }

  async update(taskId, patch, { eventType = 'task.updated', eventPayload = null } = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.#require(id);
      if (patch?.status !== undefined) assertTaskTransition(current.status, patch.status);
      const next = {
        ...current,
        ...clone(patch ?? {}),
        id,
        cursor: patch?.cursor ? { ...current.cursor, ...clone(patch.cursor) } : current.cursor,
        codex: patch?.codex ? { ...current.codex, ...clone(patch.codex) } : current.codex,
        sdd: patch?.sdd ? { ...(current.sdd ?? {}), ...clone(patch.sdd) } : current.sdd,
        updatedAt: new Date().toISOString()
      };
      await atomicJsonWrite(this.#file(id, TASK_FILE), next);
      if (eventType) {
        await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, eventType, eventPayload ?? {
          status: next.status
        }));
      }
      await this.#touchIndex(next);
      return clone(next);
    });
  }

  async transition(taskId, status, payload = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.#require(id);
      assertTaskTransition(current.status, status);
      const next = {
        ...current,
        status,
        error: payload.error !== undefined ? payload.error : current.error,
        result: payload.result !== undefined ? clone(payload.result) : current.result,
        updatedAt: new Date().toISOString()
      };
      await atomicJsonWrite(this.#file(id, TASK_FILE), next);
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.status.changed', {
        from: current.status,
        to: status,
        ...clone(payload.event ?? {})
      }));
      await this.#touchIndex(next);
      return clone(next);
    });
  }

  async appendEvent(taskId, type, payload = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      await this.#require(id);
      const event = createEvent(id, type, payload);
      await appendJsonLine(this.#file(id, EVENTS_FILE), event);
      return clone(event);
    });
  }

  async events(taskId) {
    const id = validateTaskId(taskId);
    try {
      const text = await readFile(this.#file(id, EVENTS_FILE), 'utf8');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * The index decides which tasks are worth opening. A caller that only wants
   * one conversation's tasks would otherwise read every task file on disk to
   * throw almost all of them away, and that cost lands on the path where a chat
   * message is waiting for an answer.
   *
   * It is a cache, never the truth: the directory listing still drives the
   * result, an id the index has not seen is read anyway, and a stale entry is
   * corrected by the task file it points at.
   */
  async list({
    statuses = null,
    conversationId = null,
    userId = null,
    sourceType = null,
    limit = 100
  } = {}) {
    const ids = await this.#taskIds();
    if (!ids.length) return [];
    const filters = {
      allowed: Array.isArray(statuses) && statuses.length ? new Set(statuses) : null,
      conversationId,
      userId,
      sourceType
    };
    const index = await this.#readIndex();
    const known = [];
    const unknown = [];
    for (const id of ids) {
      const entry = index?.tasks?.[id];
      if (entry) known.push({ id, entry });
      else unknown.push(id);
    }

    const tasks = [];
    for (const id of unknown) {
      const task = await this.get(id);
      if (!task) continue;
      tasks.push(task);
      await this.#touchIndex(task);
    }
    const candidates = known
      .filter(({ entry }) => matches(entry, filters))
      .sort((a, b) => String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt)))
      .slice(0, Math.max(0, limit));
    for (const { id } of candidates) {
      const task = await this.get(id);
      if (task) tasks.push(task);
      else await this.#dropFromIndex(id);
    }

    return tasks
      .filter((task) => matches(indexEntry(task), filters))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, Math.max(0, limit));
  }

  async #taskIds() {
    let entries = [];
    try {
      entries = await readdir(this.tasksDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  async #readIndex() {
    return readJson(this.indexFile);
  }

  #touchIndex(task) {
    return this.#writeIndex((tasks) => {
      tasks[task.id] = indexEntry(task);
      return tasks;
    });
  }

  #dropFromIndex(taskId) {
    return this.#writeIndex((tasks) => {
      delete tasks[taskId];
      return tasks;
    });
  }

  /**
   * Serialized against itself so two task writes cannot clobber each other's
   * entry, and never allowed to fail the write it came from: losing a cache
   * line is not worth losing a task update.
   */
  #writeIndex(mutate) {
    const next = this.indexQueue.catch(() => {}).then(async () => {
      const current = (await this.#readIndex()) ?? {};
      const tasks = mutate({ ...(current.tasks ?? {}) });
      await atomicJsonWrite(this.indexFile, {
        version: 1,
        updatedAt: new Date().toISOString(),
        tasks
      });
    }).catch(() => {});
    this.indexQueue = next;
    return next;
  }

  async #require(taskId) {
    const task = await readJson(this.#file(taskId, TASK_FILE));
    if (!task) throw new Error(`task-not-found:${taskId}`);
    return task;
  }

  #taskDir(taskId) {
    return path.join(this.tasksDir, validateTaskId(taskId));
  }

  #file(taskId, name) {
    return path.join(this.#taskDir(taskId), name);
  }

  async #withTaskLock(taskId, action) {
    const previous = this.writeQueues.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.writeQueues.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(taskId) === current) this.writeQueues.delete(taskId);
    }
  }
}

export function createTaskId(now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `task-${stamp}-${randomUUID().slice(0, 8)}`;
}

/**
 * Only what a caller can filter on before deciding to open the task, plus a
 * title so a picker can be drawn without reading anything else.
 */
function indexEntry(task) {
  return {
    status: task.status ?? null,
    updatedAt: task.updatedAt ?? null,
    sourceType: task.source?.type ?? null,
    conversationId: task.source?.conversationId ?? null,
    userId: task.source?.userId ?? null,
    title: String(task.requirement ?? task.goal ?? '').slice(0, 120),
    tapdId: tapdIdOf(task)
  };
}

function tapdIdOf(task) {
  const url = task.source?.tapdUrl ?? task.repository?.tapdUrl ?? null;
  const match = url ? String(url).match(TAPD_ID) : null;
  return match ? match[1] : null;
}

function matches(entry, { allowed, conversationId, userId, sourceType }) {
  if (allowed && !allowed.has(entry.status)) return false;
  if (sourceType && entry.sourceType !== sourceType) return false;
  if (conversationId && entry.conversationId !== conversationId) return false;
  if (userId && entry.userId !== userId) return false;
  return true;
}

function createEvent(taskId, type, payload = {}) {
  return {
    id: randomUUID(),
    taskId,
    type,
    payload: clone(payload),
    createdAt: new Date().toISOString()
  };
}

function validateTaskId(value) {
  const id = String(value ?? '');
  if (!TASK_ID_PATTERN.test(id)) throw new Error(`invalid-task-id:${id}`);
  return id;
}

async function atomicJsonWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function appendJsonLine(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
