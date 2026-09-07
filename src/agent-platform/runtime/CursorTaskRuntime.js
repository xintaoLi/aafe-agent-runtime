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

import { cloudSafeEnvVars } from '../tasks/workspaceRepoEnv.js';

const DEFAULT_API_KEY_ENV = 'CURSOR_API_KEY';
const DEFAULT_MODEL = 'composer-2.5';

/**
 * Durable Cursor runtime. A task owns one Agent and may create many Runs.
 * With a repository it uses Cloud; without one it uses a local Agent on cwd.
 * The SDK handle is process-local; the persisted agent id is enough to resume it.
 */
export class CursorTaskRuntime {
  static kind = 'cursor';

  constructor({
    env = process.env,
    shellEnv = null,
    importSdk = null,
    onEvent = () => {}
  } = {}) {
    this.env = env;
    // Local Cursor shells inherit process env, not a detached copy. Tests may
    // pass a fake object so injection stays off the real process.
    this.shellEnv = shellEnv ?? env;
    this.importSdk = importSdk ?? (() => import('@cursor/sdk'));
    this.onEvent = onEvent;
    this.sessions = new Map();
    this.activeRuns = new Map();
  }

  get kind() {
    return /** @type {typeof CursorTaskRuntime} */ (this.constructor).kind;
  }

  async run(task, prompt, options = {}) {
    this.#applyLocalShellEnv(task, options);
    let { sdk, agent, apiKey, recreated } = await this.#agentFor(task, options);
    const sendOptions = {};
    if (options.mcpServers && Object.keys(options.mcpServers).length) {
      sendOptions.mcpServers = options.mcpServers;
    }
    if (options.idempotencyKey) sendOptions.idempotencyKey = options.idempotencyKey;
    this.#attachCloudRunEnv(task, options, sendOptions);

    // A replacement Agent has no Cursor-side history, so the durable AAFE
    // context has to be replayed instead of only the latest follow-up.
    const message = recreated && options.fallbackPrompt ? options.fallbackPrompt : prompt;

    let run;
    try {
      const started = await this.#startRun(task, agent, message, sendOptions, options);
      run = started.run;
      agent = started.agent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/^cursor-/.test(message)) throw error;
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
    // A local Run only exists inside the process that started it, so after a
    // restart it is gone rather than merely unreachable.
    const local = runtimeKind(task, options) === 'local';
    let run;
    try {
      run = await Agent.getRun(runId, this.#runScope(task, options, agentId));
    } catch (error) {
      throw cursorError(local ? 'cursor-run-stale' : 'cursor-run-recover-failed', error);
    }

    if (run.status === 'running') {
      // Nobody is left to finish it, and streaming it would block until this
      // process dies too, which is what left tasks stuck in `running`.
      if (local) {
        throw cursorError('cursor-run-stale', new Error(`local run ${runId} did not survive the restart`));
      }
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
    await Agent.cancelRun(runId, this.#runScope(task, options, agentId));
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
    const previousAgentId = task.cursor?.agentId ?? null;
    let agent = null;
    let recreated = false;

    if (previousAgentId) {
      try {
        agent = await sdk.Agent.resume(previousAgentId, this.#resumeOptions(task, options, apiKey));
      } catch (error) {
        if (!isAgentMissing(error)) throw cursorError('cursor-agent-open-failed', error);
        // The Agent expired or lives in another local store. The task keeps its
        // own durable context, so a replacement Agent can carry the work on.
        recreated = true;
        this.#emit(task.id, 'cursor.agent.lost', {
          agentId: previousAgentId,
          reason: errorMessage(error)
        }, options);
      }
    }

    if (!agent) {
      try {
        agent = await sdk.Agent.create(this.#createOptions(task, options, apiKey, recreated));
      } catch (error) {
        throw cursorError('cursor-agent-open-failed', error);
      }
    }

    const session = { sdk, apiKey, agent, recreated };
    this.sessions.set(task.id, session);
    this.#emit(task.id, agentOpenEvent(previousAgentId, recreated), {
      agentId: agent.agentId,
      previousAgentId
    }, options);
    return session;
  }

  /**
   * Cursor refuses a second send while a Run is still active. A hung attempt
   * (or a parked restart) often leaves that Run behind, so continue would
   * otherwise fail with "already has active run".
   */
  async #startRun(task, agent, message, sendOptions, options) {
    try {
      return { run: await agent.send(message, sendOptions), agent };
    } catch (error) {
      if (!isActiveRunConflict(error)) throw error;
      this.#emit(task.id, 'cursor.run.conflict', {
        agentId: agent.agentId,
        reason: errorMessage(error)
      }, options);
      await this.#releaseLeftoverRun(task, options, agent);
      try {
        return { run: await agent.send(message, sendOptions), agent };
      } catch (retryError) {
        if (!isActiveRunConflict(retryError)) throw retryError;
        const replacement = await this.#replaceAgent(task, options);
        return {
          run: await replacement.agent.send(options.fallbackPrompt || message, sendOptions),
          agent: replacement.agent
        };
      }
    }
  }

  async #releaseLeftoverRun(task, options, agent) {
    const active = this.activeRuns.get(task.id);
    if (active && typeof active.cancel === 'function') {
      try { await active.cancel(); } catch { /* leftover */ }
      if (this.activeRuns.get(task.id) === active) this.activeRuns.delete(task.id);
    }
    const runId = task.cursor?.activeRunId ?? active?.id ?? null;
    const agentId = task.cursor?.agentId ?? agent?.agentId ?? null;
    if (!runId || !agentId) return;
    if (active?.id && active.id === runId) return;
    try {
      const { Agent } = await this.#sdk();
      await Agent.cancelRun(runId, this.#runScope(task, options, agentId));
      this.#emit(task.id, 'cursor.run.cancelled', { runId, reason: 'stale-active-run' }, options);
    } catch {
      /* the send retry reports whether the Agent is free */
    }
  }

  async #replaceAgent(task, options) {
    const previousAgentId = task.cursor?.agentId ?? null;
    await this.close(task.id);
    const session = await this.#agentFor({
      ...task,
      cursor: { ...(task.cursor ?? {}), agentId: null, activeRunId: null }
    }, options);
    session.recreated = true;
    this.#emit(task.id, 'cursor.agent.recreated', {
      agentId: session.agent.agentId,
      previousAgentId,
      reason: 'stale-active-run'
    }, options);
    return session;
  }

  #resumeOptions(task, options, apiKey) {
    const scope = this.#localScope(task, options);
    return {
      apiKey,
      model: { id: options.model ?? DEFAULT_MODEL },
      ...(scope ? { local: scope } : {}),
      ...(options.mcpServers && Object.keys(options.mcpServers).length
        ? { mcpServers: options.mcpServers }
        : {})
    };
  }

  /**
   * A local Agent lives in the store of the workspace it was created in, so
   * resume, getRun and cancelRun all have to name that cwd again.
   */
  #localScope(task, options) {
    if (runtimeKind(task, options) !== 'local') return null;
    const cwd = options.cwd ?? task.workspace?.cwd ?? options.root ?? process.cwd();
    return { cwd };
  }

  #runScope(task, options, agentId) {
    const scope = this.#localScope(task, options);
    if (scope) return { runtime: 'local', cwd: scope.cwd };
    return { runtime: 'cloud', agentId, apiKey: this.#apiKey(options) };
  }

  #createOptions(task, options, apiKey, recreated = false) {
    const repositories = normalizeRepositories(
      options.repository ?? options.repositories ?? task.repository,
      task.baseBranch
    );
    const baseKey = options.agentIdempotencyKey ?? `aafe-agent-${task.id}`;
    const create = {
      apiKey,
      model: { id: options.model ?? DEFAULT_MODEL },
      name: options.name ?? `AAFE ${task.id}`,
      ...(options.mcpServers && Object.keys(options.mcpServers).length
        ? { mcpServers: options.mcpServers }
        : {}),
      idempotencyKey: recreated ? `${baseKey}-${Date.now()}` : baseKey
    };

    if (repositories.length === 0) {
      create.local = {
        cwd: options.cwd ?? task.workspace?.cwd ?? options.root ?? process.cwd()
      };
      return create;
    }

    const cloud = {
      repos: repositories,
      autoCreatePR: options.autoCreatePR === true,
      skipReviewerRequest: options.skipReviewerRequest !== false
    };
    if (options.environment) cloud.env = normalizeEnvironment(options.environment);
    const cloudVars = cloudSafeEnvVars(options.envVars);
    if (Object.keys(cloudVars).length) cloud.envVars = cloudVars;
    create.cloud = cloud;
    return create;
  }

  /**
   * Local agents inherit this process's environment. Inject before create/send
   * so git / gh / aafe repo pr see GITHUB_TOKEN without reading a gitignored
   * config file from a worktree.
   */
  #applyLocalShellEnv(task, options) {
    if (runtimeKind(task, options) !== 'local') return;
    const vars = options.envVars;
    if (!vars || typeof vars !== 'object') return;
    for (const [key, value] of Object.entries(vars)) {
      if (!key || value == null || value === '') continue;
      if (String(this.shellEnv[key] ?? '').trim()) continue;
      this.shellEnv[key] = String(value);
    }
  }

  #attachCloudRunEnv(task, options, sendOptions) {
    if (runtimeKind(task, options) !== 'cloud') return sendOptions;
    const cloudVars = cloudSafeEnvVars(options.envVars);
    if (!Object.keys(cloudVars).length) return sendOptions;
    sendOptions.cloud = { ...(sendOptions.cloud ?? {}), envVars: cloudVars };
    return sendOptions;
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

function runtimeKind(task, options = {}) {
  const mode = String(options.mode ?? options.runtime ?? '').toLowerCase();
  if (mode === 'local') return 'local';
  if (mode === 'cloud') return 'cloud';
  const repositories = normalizeRepositories(
    options.repository ?? options.repositories ?? task.repository,
    task.baseBranch
  );
  return repositories.length === 0 ? 'local' : 'cloud';
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

function extractContentBlocks(message) {
  const content = message?.message?.content ?? message?.content;
  return Array.isArray(content) ? content : [];
}

function extractText(message) {
  return extractContentBlocks(message)
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
}

function extractThinking(message) {
  return extractContentBlocks(message)
    .filter((block) => ['thinking', 'reasoning', 'thought'].includes(block?.type))
    .map((block) => block.thinking ?? block.text ?? block.reasoning ?? '')
    .filter(Boolean)
    .join('');
}

function extractTools(message) {
  const tools = [];
  const type = String(message?.type ?? '');
  if (/tool/i.test(type)) {
    const raw = message.toolCall ?? message.tool_call ?? message;
    const name = raw.name ?? raw.toolName ?? raw.function?.name;
    if (name) tools.push({ name, detail: toolDetail(raw) });
  }
  for (const block of extractContentBlocks(message)) {
    if (!/tool/i.test(String(block?.type ?? ''))) continue;
    const name = block.name ?? block.toolName ?? block.tool_call?.name ?? block.toolCall?.name;
    if (name) tools.push({ name, detail: toolDetail(block) });
  }
  return dedupeTools(tools);
}

function toolDetail(tool) {
  const input = tool.input ?? tool.args ?? tool.arguments ?? tool.params
    ?? tool.toolCall?.input ?? tool.tool_call?.input ?? {};
  if (typeof input === 'string') return input.slice(0, 160);
  if (!input || typeof input !== 'object') return '';
  const file = input.path ?? input.file ?? input.filename ?? input.target_file ?? input.uri;
  const query = input.query ?? input.pattern ?? input.grep ?? input.search;
  const command = input.command ?? input.cmd;
  if (file && query) return `${file} · ${query}`;
  return String(file ?? query ?? command ?? input.url ?? '').slice(0, 160);
}

function dedupeTools(tools) {
  const seen = new Set();
  return tools.filter((tool) => {
    const key = `${tool.name}:${tool.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMessage(message) {
  return {
    type: message?.type ?? 'unknown',
    text: extractText(message).join(''),
    thinking: extractThinking(message),
    tools: extractTools(message),
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
  const wrapped = new Error(`${prefix}:${errorMessage(error)}`);
  wrapped.cause = error;
  wrapped.retryable = error?.isRetryable === true;
  return wrapped;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const known = error.message ?? error.errmsg ?? error.error;
    if (known) return String(known);
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function isAgentMissing(error) {
  return /not found|does not exist|no such agent|unknown agent/i.test(errorMessage(error));
}

function isActiveRunConflict(error) {
  return /already has active run|active run in progress|run already (?:active|running)/i.test(errorMessage(error));
}

function agentOpenEvent(previousAgentId, recreated) {
  if (recreated) return 'cursor.agent.recreated';
  return previousAgentId ? 'cursor.agent.resumed' : 'cursor.agent.created';
}
