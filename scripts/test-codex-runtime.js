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

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexTaskRuntime } from '../src/agent-platform/runtime/CodexTaskRuntime.js';
import { TaskManager } from '../src/agent-platform/tasks/TaskManager.js';
import { loadWeComBotConfig, createTaskManagerOptions } from '../ai-bots/wecom/src/config.js';
import { parseWeComCommand } from '../ai-bots/wecom/src/commands.js';
import { resolveWeComAction } from '../ai-bots/wecom/src/resolver.js';
import { formatProgressEvent } from '../ai-bots/wecom/src/progress.js';
import { CodexAgentProvider } from '../src/agent-platform/runtime/providers/CodexAgentProvider.js';
import { createChatResponder } from '../ai-bots/wecom/src/chat.js';

function fixture(mode = 'success') {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { executable, args, options, prompt: '', signals: [] };
    calls.push(call);
    child.stdin.on('data', (chunk) => { call.prompt += chunk; });
    child.kill = (name) => {
      call.signals.push(name);
      if (mode === 'kill' && name === 'SIGTERM') return;
      queueMicrotask(() => child.emit('close', null));
    };
    child.stdin.on('finish', () => {
      if (['wait', 'kill'].includes(mode)) return;
      if (mode === 'bad') { child.stdout.write('not-json\n'); return; }
      const thread = args.includes('resume') ? args[args.indexOf('resume') + 1] : 'native-thread-' + calls.length;
      const lines = [
        { type: 'thread.started', thread_id: thread },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: '最终结论：已完成' } },
        { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } }
      ];
      if (mode === 'failed') lines[3] = { type: 'turn.failed', error: { message: 'secret-provider-detail' } };
      if (mode === 'incomplete') lines.pop();
      const bytes = Buffer.from(lines.map((line) => JSON.stringify(line)).join('\n'));
      // Split in the middle of a UTF-8 character and omit the trailing newline.
      const split = bytes.indexOf(Buffer.from('最终')) + 1;
      child.stdout.write(bytes.subarray(0, split));
      child.stdout.write(bytes.subarray(split));
      queueMicrotask(() => child.emit('close', 0));
    });
    return child;
  };
  return { calls, spawnProcess };
}

const state = fixture();
const events = [];
const bindings = [];
const runtime = new CodexTaskRuntime({ spawnProcess: state.spawnProcess, onEvent: (e) => events.push(e) });
const first = await runtime.run({ id: 'task-one' }, '分析项目', {
  cwd: '/tmp', executionMode: 'plan', apiKey: 'cursor-should-not-leak', model: 'grok-4.6',
  codex: { model: 'test-codex-model', apiKey: 'test-openai-key' },
  onBinding: (binding) => bindings.push(binding)
});
assert.equal(first.text, '最终结论：已完成');
assert.deepEqual(first.usage, { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10, totalTokens: 110, cost: null });
assert.match(state.calls[0].args.join(' '), /sandbox_mode="read-only"/);
assert.ok(!state.calls[0].args.includes('grok-4.6'));
assert.equal(state.calls[0].options.env.CODEX_API_KEY, 'test-openai-key');
assert.equal(state.calls[0].options.env.CURSOR_API_KEY, undefined);
assert.ok(!state.calls[0].args.includes('test-openai-key'));
assert.ok(!state.calls[0].args.includes('分析项目'));
assert.equal(state.calls[0].prompt, '分析项目');
assert.equal(bindings[0].agentId, first.agentId);
assert.equal(formatProgressEvent(events.find((e) => e.type === 'codex.message')).kind, 'assistant');

const second = await runtime.continue({ id: 'task-one', codex: { agentId: first.agentId } }, '按方案实现', { cwd: '/tmp' });
assert.equal(second.agentId, first.agentId);
assert.notEqual(second.runId, first.runId);
assert.ok(state.calls[1].args.includes('resume'));
assert.ok(!state.calls[1].args.includes('--last'));
assert.match(state.calls[1].args.join(' '), /sandbox_mode="workspace-write"/);
assert.equal(state.calls[1].options.env.CODEX_API_KEY, undefined);
await assert.rejects(runtime.run({ id: 'task-budget' }, 'long prompt', { tokenBudget: 1 }), /budget/);
await assert.rejects(runtime.run({ id: 'task-cloud' }, 'work', { mode: 'cloud' }), /local-workspace/);
await assert.rejects(runtime.recover({ id: 'task-one' }), /stale/);
await assert.rejects(runtime.run({ id: 'task-invalid', codex: { agentId: '--dangerously-bypass-approvals-and-sandbox' } }, 'work'), /invalid-thread/);

for (const mode of ['bad', 'failed', 'incomplete']) {
  const f = fixture(mode);
  const r = new CodexTaskRuntime({ spawnProcess: f.spawnProcess });
  await assert.rejects(r.run({ id: mode }, 'work'), /codex-(invalid-json|turn-failed|run-incomplete)/);
  assert.equal(r.active.size, 0);
}
const waiting = fixture('wait');
const cancelRuntime = new CodexTaskRuntime({ spawnProcess: waiting.spawnProcess });
const pending = cancelRuntime.run({ id: 'task-cancel' }, 'work');
await assert.rejects(cancelRuntime.run({ id: 'task-cancel' }, 'work'), /already-running/);
assert.equal((await cancelRuntime.cancel({ id: 'task-cancel' })).cancelled, true);
assert.equal((await pending).status, 'cancelled');
assert.deepEqual(waiting.calls[0].signals, ['SIGTERM']);
const timeoutState = fixture('wait');
await assert.rejects(new CodexTaskRuntime({ spawnProcess: timeoutState.spawnProcess }).run(
  { id: 'task-timeout' }, 'work', { codex: { timeoutMs: 10 } }
), /timeout/);
assert.deepEqual(timeoutState.calls[0].signals, ['SIGTERM']);
const stubborn = fixture('kill');
await assert.rejects(new CodexTaskRuntime({ spawnProcess: stubborn.spawnProcess }).run(
  { id: 'task-force-stop' }, 'work', { codex: { timeoutMs: 10 } }
), /timeout/);
assert.deepEqual(stubborn.calls[0].signals, ['SIGTERM', 'SIGKILL']);

const config = await loadWeComBotConfig({
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret', AAFE_WECOM_PROVIDER: 'codex', CURSOR_API_KEY: 'cursor-key' },
  readConfig: async () => ({ agent: { provider: 'cursor', model: 'grok-4.6', apiKey: 'cursor-project-key' } }),
  readLocalConfig: async () => ({ codex: { model: 'codex-only' } })
});
assert.equal(config.agent.apiKey, null);
assert.equal(config.agent.apiKeyEnv, 'OPENAI_API_KEY');
assert.equal(config.agent.model, 'codex-only');
assert.equal(config.codex.apiKey, null);
assert.equal(config.intent.cursorApiKey, null);
assert.ok(config.intent.codex);
assert.equal(createTaskManagerOptions(config).runtimeOptions.codex.model, 'codex-only');
assert.equal(parseWeComCommand('ChatGPT：分析当前项目').provider, 'codex');
const switched = await loadWeComBotConfig({
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret', AAFE_WECOM_PROVIDER: 'codex' },
  readConfig: async () => ({}),
  readLocalConfig: async () => ({ provider: 'cursor', model: 'grok-4.6', apiKey: 'cursor-key' })
});
assert.equal(switched.codex.model, null);
assert.equal(switched.apiKey, null);

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-codex-runtime-'));
const managerState = fixture();
const manager = new TaskManager({
  root, runtime: new CodexTaskRuntime({ spawnProcess: managerState.spawnProcess }),
  validateProjectRuntime: false, recoverOnStart: false, workspaceOptions: { worktrees: false }
});
try {
  const action = await resolveWeComAction(parseWeComCommand('Codex：分析当前项目的鉴权'), {
    source: { type: 'wecom', userId: 'owner', conversationId: 'room', messageId: 'one' },
    botRoot: root, workspace: { cwd: root }, provider: 'cursor', codexModel: 'codex-only',
    selectModel: () => { throw new Error('cursor-router-must-not-run'); }
  }, manager);
  assert.equal(action.task.provider, 'codex');
  assert.equal(action.task.kind, 'analysis');
  const done = await manager.start(action.task.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.codex.agentId, 'native-thread-1');
  assert.equal(done.cursor.agentId, null);
  assert.equal(done.codex.runs[0].usage.totalTokens, 110);
  await manager.continue(done.id, '按方案实现', { intent: { kind: 'code', needsCode: true } });
  const continued = await manager.get(done.id);
  assert.equal(continued.codex.runs.length, 2);
  assert.equal(continued.codex.agentId, done.codex.agentId);
  assert.equal(managerState.calls[1].prompt.includes('按方案实现'), true);
  assert.equal(managerState.calls[1].args.includes(done.codex.agentId), true);
  await manager.store.transition(done.id, 'queued');
  await manager.store.transition(done.id, 'running');
  const recovered = await manager.recover();
  await Promise.all(recovered.map((entry) => entry.promise));
  assert.equal((await manager.get(done.id)).error, 'task-interrupted:process-restart');
  assert.equal(managerState.calls.length, 2);
} finally {
  await manager.close();
  await rm(root, { recursive: true, force: true });
}

const providerState = fixture();
const chatRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-codex-chat-test-'));
try {
  const chatState = fixture();
  const chat = createChatResponder({
    settings: { codex: { model: 'chat-only' } }, cwd: chatRoot, logger: {},
    createCodexRuntime: () => new CodexTaskRuntime({ spawnProcess: chatState.spawnProcess })
  });
  assert.equal(chat.backend, 'codex');
  assert.equal(await chat.reply('什么是闭包？'), '最终结论：已完成');
  assert.ok(chatState.calls[0].args.includes('--ephemeral'));
  assert.ok(chatState.calls[0].args.includes('--skip-git-repo-check'));
  assert.match(chatState.calls[0].args.join(' '), /sandbox_mode="read-only"/);
} finally { await rm(chatRoot, { recursive: true, force: true }); }
const provider = new CodexAgentProvider({ spawnProcess: providerState.spawnProcess });
const response = await provider.invoke({ model: 'codex-test' }, { goal: 'analyze', constraints: {}, context: {} });
assert.equal(response.status, 'success');
assert.equal(response.metrics.tokens, 110);
console.log('codex runtime tests passed (mocked CLI, no model calls)');
