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

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { toCodexMcpOverrides } from '../../cli/agentMcp.js';
import { parseTapdAssociation } from '../tasks/tapdPolicy.js';
import { codexWorkflowPrompt, codexToolReceipt } from './CodexWorkflow.js';
import { REPO_GITHUB_TOKEN_ENV, REPO_GONGFENG_TOKEN_ENV, githubHttpExtraHeader, withGithubGitAuthEnv } from '../../cli/repoConfig.js';
import { estimateTokens } from '../../ide-bridge/context/tokens.js';
import { normalizeUsage } from '../../llm/usage.js';

/**
 * Official CLI transport. Persist the native thread ID; never resume --last.
 * Login is owned by the operator (ChatGPT or API-key login), not by the bot.
 */
export class CodexTaskRuntime {
  static kind = 'codex';

  constructor({ onEvent = () => {}, spawnProcess = spawn } = {}) {
    this.onEvent = onEvent;
    this.spawnProcess = spawnProcess;
    this.active = new Map();
  }

  get kind() {
    return /** @type {typeof CodexTaskRuntime} */ (this.constructor).kind;
  }

  async run(task, prompt, options = {}) {
    if (!task?.id || !String(prompt ?? '').trim()) throw new Error('codex-task-prompt-required');
    if (options.mode === 'cloud') throw new Error('codex-local-workspace-required');
    if (this.active.has(task.id)) throw new Error('codex-task-already-running');
    if (task.codex?.agentId && !validThreadId(task.codex.agentId)) throw new Error('codex-invalid-thread-id');
    const settings = options.codex ?? {};
    const workflow = options.aafeWorkflow;
    const delivery = workflow?.enabled === true && settings.delivery?.enabled !== false && options.executionMode !== 'plan';
    if (delivery && !workflow.ready) return { status: 'blocked', text: 'codex-workflow-skills-missing:目标项目需提供 workflow-mode、repo-submit、tapd-submit-backfill 技能。' };
    prompt += '\nReturn the final JSON outcome matching the supplied schema. completed means all applicable AAFE gates are closed by successful execution or an allowed skip, not merely that the model turn ended. Use blocked for pending user choices, permissions or missing requirements; failed for execution failure. List unfinished required steps in remainingSteps. Never implement a TAPD title without reading its content. Never bypass sandbox or permission denial.';
    prompt += '\n' + codexWorkflowPrompt(workflow);
    if (!delivery) prompt += '\nDelivery execution is disabled for this run. Do not commit, push, create PR/MR or write TAPD; delivery=[] unless reporting a blocked request for those operations.';
    const budget = options.tokenBudget ?? 12000;
    if (!Number.isFinite(budget) || budget <= 0 || estimateTokens(prompt) > budget) {
      throw new Error('codex-context-budget-exceeded');
    }
    if (parseTapdAssociation(task.requirement ?? task.goal)
      && !Object.entries(settings.mcpServers ?? {}).some(([name, server]) => /tapd/i.test(name) && server.enabled !== false)) {
      return { status: 'blocked', text: 'codex-tapd-mcp-missing:请配置并启用 TAPD MCP（服务 ID 需含 tapd），或提供无需外部读取的完整需求。' };
    }
    let mcp;
    try { mcp = toCodexMcpOverrides(settings.mcpServers ?? {}, options.cwd, { approvalMode: delivery ? 'prompt' : undefined }); }
    catch (error) { return { status: 'blocked', text: error.message }; }
    const timeoutMs = settings.timeoutMs ?? 30 * 60_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('codex-invalid-timeout');
    const sandbox = options.executionMode === 'plan' ? 'read-only' : 'workspace-write';
    // Do not inherit desktop plugins or hooks. Authentication and exec rules
    // remain available; bot workers are not interactive desktop assistants.
    const args = ['exec', '--ignore-user-config',
      '--disable', 'plugins', '--disable', 'apps', '--disable', 'computer_use',
      '--disable', 'browser_use', '--disable', 'hooks',
      '-c', `approval_policy="${delivery ? 'on-request' : 'never'}"`, '-c', `sandbox_mode="${sandbox}"`, '--json',
      '--output-schema', fileURLToPath(new URL('./codex-outcome.schema.json', import.meta.url)),
      ...mcp.args,
      '-c', `shell_environment_policy.exclude=${JSON.stringify(['CODEX_API_KEY', 'OPENAI_API_KEY', ...Object.keys(mcp.env)])}`];
    if (delivery) args.push('--approve-for-me', '-c', 'approvals_reviewer="auto_review"');
    if (options.ephemeral) args.push('--ephemeral', '--skip-git-repo-check');
    const model = task.model ?? settings.model;
    if (model) args.push('--model', model);
    if (task.codex?.agentId) args.push('resume', task.codex.agentId);
    args.push('-');
    // Do not pass bot, TAPD or Cursor credentials into the child environment.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TEMP|TMP|LANG|LC_.*|CODEX_HOME|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|SYSTEMROOT)$/i.test(key)));
    if (settings.apiKey) env.CODEX_API_KEY = settings.apiKey;
    Object.assign(env, mcp.env);
    if (delivery) {
      const source = { ...process.env, ...options.envVars };
      for (const key of [...REPO_GITHUB_TOKEN_ENV, ...REPO_GONGFENG_TOKEN_ENV]) {
        if (source[key]) env[key] = String(source[key]);
      }
      // Rebuild only the known HTTPS auth config, never arbitrary GIT_CONFIG_* from ambient env.
      Object.assign(env, withGithubGitAuthEnv({}, env));
    }
    const runId = randomUUID();
    const receipts = [];
    const secretValues = [...new Set([settings.apiKey, ...Object.values(mcp.env),
      ...REPO_GITHUB_TOKEN_ENV.map((key) => env[key] ? githubHttpExtraHeader(env[key]).split(' ').at(-1) : null),
      ...[...REPO_GITHUB_TOKEN_ENV, ...REPO_GONGFENG_TOKEN_ENV].map((key) => env[key])].filter((value) => typeof value === 'string' && value.length > 3))];
    const redact = (value) => secretValues.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value));
    let agentId = task.codex?.agentId ?? null;
    let text = '', usage = normalizeUsage(), complete = false, failure = null, pending = '';
    const decoder = new StringDecoder('utf8');
    let events = Promise.resolve();
    const child = this.spawnProcess(settings.executable || 'codex', args, {
      cwd: options.cwd ?? task.workspace?.cwd ?? process.cwd(), env,
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false
    });
    let resolveClosed;
    const closed = new Promise((resolve) => { resolveClosed = resolve; });
    const active = { child, closed, cancelled: false, killTimer: null };
    this.active.set(task.id, active);
    const stop = (reason) => {
      failure ??= reason;
      signal(child, 'SIGTERM');
      active.killTimer ??= setTimeout(() => signal(child, 'SIGKILL'), 2000);
    };
    active.stop = stop;
    const emit = (type, payload) => this.onEvent({ taskId: task.id, type: `codex.${type}`, payload });
    const consume = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { stop('codex-invalid-json'); return; }
      events = events.then(async () => {
        if (event.type === 'thread.started') {
          if (!validThreadId(event.thread_id) || (agentId && agentId !== event.thread_id)) throw new Error('codex-thread-mismatch');
          agentId = event.thread_id;
          await options.onBinding?.({ agentId, runId });
        }
        if (event.type === 'turn.started') await emit('run.started', { runId });
        if (event.type === 'item.completed') {
          const receipt = codexToolReceipt(event.item);
          if (receipt) {
            receipt.id = `${runId}:${receipt.id}`;
            receipts.push(receipt);
            if (receipts.length > 256) receipts.shift();
            await options.onReceipt?.(receipt);
          }
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          text = redact(event.item.text ?? '').slice(-64_000);
          // Final structured output is rendered by the task notifier, not as raw JSON.
          if (!text.trimStart().startsWith('{')) await emit('message', { text, messageId: event.item.id });
        }
        if (event.type === 'item.started' && event.item?.type === 'command_execution') {
          await emit('message', { tools: [{ name: 'command', detail: redact(event.item.command ?? '').slice(0, 160) }] });
        }
        if (event.type === 'turn.completed') { complete = true; usage = normalizeUsage(event.usage); }
        if (event.type === 'turn.failed') failure = 'codex-turn-failed';
      }).catch((error) => stop(error.message));
    };
    child.stdout.on('data', (chunk) => {
      pending += decoder.write(chunk);
      if (pending.length > 2_000_000) { pending = ''; stop('codex-output-limit'); return; }
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      }
    });
    // Drain diagnostic output without persisting secrets from provider errors.
    let diagnosticTail = '', mcpStartupFailed = false;
    child.stderr.on('data', (chunk) => {
      diagnosticTail = (diagnosticTail + chunk.toString()).slice(-4096);
      if (/required MCP servers? failed|MCP.*(?:failed to initialize|startup failed)/i.test(diagnosticTail)) mcpStartupFailed = true;
    });
    child.stdin.on('error', () => stop('codex-stdin-failed'));
    const timer = setTimeout(() => stop('codex-run-timeout'), timeoutMs);
    child.on('error', (error) => { failure = error.code === 'ENOENT' ? 'codex-cli-not-found' : 'codex-process-error'; });
    child.on('close', (code) => resolveClosed(code));
    child.stdin.end(prompt);
    try {
      const code = await closed;
      pending += decoder.end();
      if (pending) consume(pending);
      await events;
      if (active.cancelled) return { status: 'cancelled', agentId, runId, text, usage };
      if (mcpStartupFailed) return { status: 'blocked', agentId, runId, usage, text: 'codex-mcp-startup-failed:检查 MCP 连通性、认证和工具初始化。' };
      if (failure || code !== 0 || !complete || !agentId) {
        throw new Error(failure ?? `codex-run-incomplete:exit-${code};check-cli-version-auth-and-approval-policy`);
      }
      await emit('run.completed', { runId, usage });
      let outcome;
      try { outcome = JSON.parse(text); } catch { /* fail closed below */ }
      if (!outcome || !['completed', 'blocked', 'failed'].includes(outcome.status)
        || typeof outcome.summary !== 'string' || !outcome.summary.trim()
        || !Array.isArray(outcome.evidence) || outcome.evidence.some((item) => typeof item !== 'string')
        || !Array.isArray(outcome.remainingSteps) || outcome.remainingSteps.some((item) => typeof item !== 'string')
        || !Array.isArray(outcome.delivery) || outcome.delivery.some((gate) => !gate
          || !['commit', 'pr', 'tapd_backfill'].includes(gate.gate)
          || !['proceed', 'skip', 'ask'].includes(gate.decision)
          || !['done', 'skipped', 'failed', 'blocked'].includes(gate.status)
          || ['reason', 'authorization', 'receipt'].some((key) => typeof gate[key] !== 'string')
          || !Array.isArray(gate.evidence) || gate.evidence.some((item) => typeof item !== 'string'))) {
        return { status: 'error', agentId, runId, text: 'codex-outcome-invalid', usage };
      }
      const status = outcome.status === 'completed' && (outcome.remainingSteps.length || !outcome.evidence.some((item) => item.trim()))
        ? 'blocked' : outcome.status;
      return { status: status === 'failed' ? 'error' : status, agentId, runId,
        text: outcome.summary + (outcome.remainingSteps.length ? `\n待处理：\n${outcome.remainingSteps.map((step) => `- ${step}`).join('\n')}` : ''),
        outcome: { ...outcome, status }, usage, receipts };
    } finally {
      clearTimeout(timer);
      clearTimeout(active.killTimer);
      this.active.delete(task.id);
    }
  }

  async continue(task, prompt, options = {}) {
    return this.run(task, prompt, options);
  }

  async recover(task) {
    // CLI processes cannot be reattached safely after the owning bot dies.
    // Keep the thread binding for an explicit follow-up, never auto-replay work.
    throw new Error(`codex-run-stale:${task?.id}`);
  }

  async cancel(task) {
    const active = this.active.get(task?.id);
    if (!active) return { cancelled: false, reason: 'codex-process-not-owned' };
    active.cancelled = true;
    active.stop('codex-run-cancelled');
    await active.closed;
    return { cancelled: true };
  }

  async close(taskId) { await this.cancel({ id: taskId }); }

  async closeAll() { await Promise.all([...this.active.keys()].map((id) => this.close(id))); }
}

function signal(child, name) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
    else child.kill(name);
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill(name);
  }
}

function validThreadId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
