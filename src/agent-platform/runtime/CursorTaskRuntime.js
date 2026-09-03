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

const DEFAULT_API_KEY_ENV = 'CURSOR_API_KEY';
const DEFAULT_MODEL = 'composer-2.5';

/**
 * Durable Cursor Cloud runtime. A task owns one Agent and may create many Runs.
 * The SDK handle is process-local; the persisted agent id is enough to resume it.
 */
export class CursorTaskRuntime {
  constructor({
    env = process.env,
    importSdk = null,
    onEvent = () => {}
  } = {}) {
    this.env = env;
    this.importSdk = importSdk ?? (() => import('@cursor/sdk'));
    this.onEvent = onEvent;
    this.sessions = new Map();
    this.activeRuns = new Map();
  }

  async run(task, prompt, options = {}) {
    const { sdk, agent, apiKey } = await this.#agentFor(task, options);
    const sendOptions = {};
    if (options.mcpServers && Object.keys(options.mcpServers).length) {
      sendOptions.mcpServers = options.mcpServers;
    }
    if (options.idempotencyKey) sendOptions.idempotencyKey = options.idempotencyKey;

    let run;
    try {
      run = await agent.send(prompt, sendOptions);
    } catch (error) {
      throw cursorError('cursor-run-start-failed', error);
    }

    this.activeRuns.set(task.id, run);
    this.#emit(task.id, 'cursor.run.started', {
      agentId: agent.agentId,
      runId: run.id
    }, options);

    try {
      if (typeof options.onBinding === 'function') {
        await options.onBinding({ agentId: agent.agentId, runId: run.id });
      }
      const text = [];
      if (run.supports?.('stream') !== false && typeof run.stream === 'function') {
        for await (const message of run.stream()) {
          text.push(...extractText(message));
          this.#emit(task.id, 'cursor.message', normalizeMessage(message), options);
        }
      }
      const result = run.supports?.('wait') === false
        ? snapshotRun(run)
        : await run.wait();
      const normalized = normalizeResult(agent.agentId, run, result, text);
      this.#emit(task.id, 'cursor.run.completed', normalized, options);
      return normalized;
    } finally {
      if (this.activeRuns.get(task.id) === run) this.activeRuns.delete(task.id);
      // Keep the Agent session for a follow-up Run. TaskManager closes it only
      // when the AAFE task reaches a terminal state.
      void sdk;
      void apiKey;
    }
  }

  async continue(task, prompt, options = {}) {
    return this.run(task, prompt, options);
  }

  /**
   * Reattach to a run after the AAFE process restarted.
   */
  async recover(task, options = {}) {
    const agentId = task.cursor?.agentId;
    const runId = task.cursor?.activeRunId;
    if (!agentId || !runId) return { status: 'missing', agentId, runId };

    const { Agent } = await this.#sdk();
    const apiKey = this.#apiKey(options);
    let run;
    try {
      run = await Agent.getRun(runId, { runtime: 'cloud', agentId, apiKey });
    } catch (error) {
      throw cursorError('cursor-run-recover-failed', error);
    }

    if (run.status === 'running') {
      this.activeRuns.set(task.id, run);
      this.#emit(task.id, 'cursor.run.recovered', { agentId, runId }, options);
      const text = [];
      try {
        if (run.supports?.('stream') !== false && typeof run.stream === 'function') {
          for await (const message of run.stream()) {
            text.push(...extractText(message));
            this.#emit(task.id, 'cursor.message', normalizeMessage(message), options);
          }
        }
        const result = run.supports?.('wait') === false ? snapshotRun(run) : await run.wait();
        const normalized = normalizeResult(agentId, run, result, text);
        this.#emit(task.id, 'cursor.run.completed', normalized, options);
        return normalized;
      } finally {
        if (this.activeRuns.get(task.id) === run) this.activeRuns.delete(task.id);
      }
    }

    return normalizeResult(agentId, run, snapshotRun(run), []);
  }

  async cancel(task, options = {}) {
    const active = this.activeRuns.get(task.id);
    if (active) {
      if (active.supports?.('cancel') === false || typeof active.cancel !== 'function') {
        return { cancelled: false, reason: active.unsupportedReason?.('cancel') ?? 'cancel-unsupported' };
      }
      await active.cancel();
      this.#emit(task.id, 'cursor.run.cancelled', { runId: active.id }, options);
      return { cancelled: true, runId: active.id };
    }

    const runId = task.cursor?.activeRunId;
    const agentId = task.cursor?.agentId;
    if (!runId || !agentId) return { cancelled: false, reason: 'no-active-run' };
    const { Agent } = await this.#sdk();
    await Agent.cancelRun(runId, {
      runtime: 'cloud',
      agentId,
      apiKey: this.#apiKey(options)
    });
    this.#emit(task.id, 'cursor.run.cancelled', { runId }, options);
    return { cancelled: true, runId };
  }

  async close(taskId) {
    const session = this.sessions.get(taskId);
    this.sessions.delete(taskId);
    this.activeRuns.delete(taskId);
    await disposeAgent(session?.agent);
  }

  async closeAll() {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((taskId) => this.close(taskId)));
  }

  async #agentFor(task, options) {
    const existing = this.sessions.get(task.id);
    if (existing) return existing;

    const sdk = await this.#sdk();
    const apiKey = this.#apiKey(options);
    let agent;
    try {
      if (task.cursor?.agentId) {
        agent = await sdk.Agent.resume(task.cursor.agentId, {
          apiKey,
          ...(options.mcpServers ? { mcpServers: options.mcpServers } : {})
        });
      } else {
        agent = await sdk.Agent.create(this.#createOptions(task, options, apiKey));
      }
    } catch (error) {
      throw cursorError('cursor-agent-open-failed', error);
    }

    const session = { sdk, apiKey, agent };
    this.sessions.set(task.id, session);
    this.#emit(task.id, task.cursor?.agentId ? 'cursor.agent.resumed' : 'cursor.agent.created', {
      agentId: agent.agentId
    }, options);
    return session;
  }

  #createOptions(task, options, apiKey) {
    const repositories = normalizeRepositories(
      options.repository ?? options.repositories ?? task.repository,
      task.baseBranch
    );
    if (repositories.length === 0) throw new Error('cursor-cloud-repository-missing');

    const cloud = {
      repos: repositories,
      autoCreatePR: options.autoCreatePR === true,
      skipReviewerRequest: options.skipReviewerRequest !== false
    };
    if (options.environment) cloud.env = normalizeEnvironment(options.environment);
    if (options.envVars && Object.keys(options.envVars).length) cloud.envVars = options.envVars;

    return {
      apiKey,
      model: { id: options.model ?? DEFAULT_MODEL },
      name: options.name ?? `AAFE ${task.id}`,
      cloud,
      ...(options.mcpServers && Object.keys(options.mcpServers).length
        ? { mcpServers: options.mcpServers }
        : {}),
      idempotencyKey: options.agentIdempotencyKey ?? `aafe-agent-${task.id}`
    };
  }

  async #sdk() {
    let sdk;
    try {
      sdk = await this.importSdk();
    } catch (error) {
      throw cursorError('cursor-sdk-unavailable', error);
    }
    if (!sdk?.Agent?.create || !sdk.Agent?.resume || !sdk.Agent?.getRun) {
      throw new Error('cursor-sdk-durable-api-unavailable');
    }
    return sdk;
  }

  #apiKey(options) {
    const envName = options.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
    const key = options.apiKey ?? this.env[envName];
    if (!key) throw new Error(`cursor-sdk-api-key-missing:${envName}`);
    return key;
  }

  #emit(taskId, type, payload, options) {
    const event = { taskId, type, payload, createdAt: new Date().toISOString() };
    this.onEvent(event);
    options.onEvent?.(event);
  }
}

function normalizeRepositories(value, defaultRef) {
  const entries = Array.isArray(value) ? value : (value ? [value] : []);
  return entries.map((entry) => {
    if (typeof entry === 'string') return { url: entry, ...(defaultRef ? { startingRef: defaultRef } : {}) };
    const url = entry.url ?? entry.repo ?? entry.repository;
    if (!url) return null;
    return {
      url,
      ...(entry.startingRef ?? entry.baseBranch ?? entry.branch ?? defaultRef
        ? { startingRef: entry.startingRef ?? entry.baseBranch ?? entry.branch ?? defaultRef }
        : {}),
      ...(entry.prUrl ? { prUrl: entry.prUrl } : {})
    };
  }).filter(Boolean);
}

function normalizeEnvironment(value) {
  if (typeof value === 'string') return { type: 'cloud', name: value };
  return value;
}

function extractText(message) {
  const blocks = message?.message?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
}

function normalizeMessage(message) {
  return {
    type: message?.type ?? 'unknown',
    text: extractText(message).join(''),
    message: serializable(message)
  };
}

function snapshotRun(run) {
  return {
    id: run.id,
    status: run.status,
    result: run.result,
    model: run.model,
    durationMs: run.durationMs,
    git: run.git
  };
}

function normalizeResult(agentId, run, result, text) {
  return {
    agentId,
    runId: result?.id ?? run?.id ?? null,
    status: result?.status ?? run?.status ?? 'error',
    text: text.join('') || result?.result || run?.result || '',
    model: result?.model ?? run?.model ?? null,
    durationMs: result?.durationMs ?? run?.durationMs ?? null,
    git: serializable(result?.git ?? run?.git ?? null)
  };
}

async function disposeAgent(agent) {
  if (!agent) return;
  const dispose = agent[Symbol.asyncDispose] ?? agent.close;
  if (typeof dispose === 'function') await dispose.call(agent);
}

function serializable(value) {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function cursorError(prefix, error) {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`${prefix}:${message}`);
  wrapped.cause = error;
  wrapped.retryable = error?.isRetryable === true;
  return wrapped;
}
