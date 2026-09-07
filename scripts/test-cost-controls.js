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
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextAgent } from '../src/agents/context-agent/index.js';
import { TaskManager, buildTaskPrompt } from '../src/agent-platform/tasks/TaskManager.js';
import { CursorTaskRuntime } from '../src/agent-platform/runtime/CursorTaskRuntime.js';
import { AgentRuntime } from '../src/agent-platform/runtime/AgentRuntime.js';
import { LlmClient } from '../src/llm/LlmClient.js';
import { normalizeUsage } from '../src/llm/usage.js';
import { createMessageInbox } from '../ai-bots/wecom/src/inbox.js';
import { fastIntent } from '../ai-bots/wecom/src/understand.js';
import { resolveWeComAction } from '../ai-bots/wecom/src/resolver.js';
import { scanTaskId } from '../ai-bots/wecom/src/quote.js';
import { scratchPrompt } from '../ai-bots/wecom/src/scratch.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-cost-controls-'));
const sent = [];
const runtime = {
  kind: 'cursor',
  async run(task, prompt, options) {
    sent.push({ prompt, mode: options.executionMode, model: options.model });
    const runId = `r${sent.length}`;
    await options.onBinding({ agentId: 'agent-test', runId });
    return { status: 'finished', runId, text: '鉴权入口是 src/auth.js:42；下一步验证该分支。', usage: normalizeUsage({ input_tokens: 20, output_tokens: 10 }) };
  },
  async close() {}, async closeAll() {}, async cancel() { return { cancelled: true }; }
};
const manager = new TaskManager({ root, runtime, validateProjectRuntime: false,
  workspaces: { async acquire() { return { mode: 'shared', cwd: root }; }, release() {} }
});
const source = { type: 'wecom', conversationId: 'chat', userId: 'owner', messageId: 'm1' };
const context = { source, workspace: { cwd: root, mode: 'local' } };
const command = { type: 'create', requirement: '只分析当前项目鉴权', intent: { kind: 'analysis', needsCode: true } };
const created = await resolveWeComAction(command, context, manager);
assert.equal(scanTaskId(created.task.id), created.task.id);
assert.equal((await manager.getContext(created.task.id)).intent.kind, 'analysis');
assert.equal((await resolveWeComAction(command, context, manager)).task.id, created.task.id);
assert.equal((await manager.list()).length, 1, 'replaying a message cannot create a second task');
await manager.start(created.task.id);
assert.equal(sent[0].mode, 'plan');
const finished = await manager.get(created.task.id);
assert.match(buildTaskPrompt(finished, await manager.getContext(finished.id)), /src\/auth.js:42/);
assert.equal(finished.cursor.runs[0].usage.totalTokens, 30);
await manager.continue(finished.id, '按方案实现', { author: { userId: 'owner', role: 'owner' }, intent: { kind: 'code', needsCode: true }, model: 'implementation-model', messageId: 'follow-1' });
assert.equal(sent.at(-1).mode, 'agent');
assert.equal(sent.at(-1).model, 'implementation-model');
const beforeDuplicate = sent.length;
await manager.continue(finished.id, '按方案实现', { messageId: 'follow-1' });
assert.equal(sent.length, beforeDuplicate);
await manager.create({ id: 'cancelled', requirement: '分析', source });
await manager.cancel('cancelled');
await manager.continue('cancelled', '继续这项任务', { author: { userId: 'owner' } });
assert.equal((await manager.get('cancelled')).status, 'completed');
let finishRun;
const runNormally = runtime.run;
runtime.run = async function(task, prompt, options) {
  if (prompt === 'first follow-up') await new Promise(resolve => { finishRun = resolve; });
  return runNormally.call(this, task, prompt, options);
};
const firstFollowUp = manager.continue('cancelled', 'first follow-up');
while (!finishRun) await new Promise(r => setImmediate(r));
let queuedTimeout;
const queued = await Promise.race([
  manager.continue('cancelled', 'second follow-up'),
  new Promise((_resolve, reject) => { queuedTimeout = setTimeout(() => reject(new Error('follow-up lock held for whole run')), 1000); })
]).finally(() => clearTimeout(queuedTimeout));
assert.equal(queued.followUpQueued, true);
assert.equal((await manager.getContext('cancelled')).pendingFollowUps.length, 1);
finishRun();
await firstFollowUp;
while ((await manager.get('cancelled')).status !== 'completed') await new Promise(r => setImmediate(r));
runtime.run = runNormally;

assert.equal(fastIntent('这个项目的路由鉴权是如何使用的').needsCode, true);
assert.equal(fastIntent('分析 JavaScript 闭包').needsCode, false);
assert.equal((await resolveWeComAction(command, { source, requireWorkspace: true, botRoot: root }, manager)).type, 'need-workspace');
const oversized = await new ContextAgent().run({ input: {}, context: {
  task: { goal: '必须保留的用户约束'.repeat(1000) },
  priorResults: { 'requirement-impact': { result: { affectedFiles: [] } } }
}, constraints: { tokenBudget: 100 } });
assert.equal(oversized.status, 'failed');
assert.match(oversized.reason, /budget-exceeded/);
const normal = await new ContextAgent().run({ input: {}, context: { task: { goal: 'check' }, priorResults: { 'requirement-impact': { result: {} } } }, constraints: { tokenBudget: 12000 } });
assert.equal(normal.metrics.tokens, undefined);
assert.ok(normal.metrics.estimatedContextTokens > 0);

let sdkOpened = false;
await assert.rejects(new CursorTaskRuntime({ importSdk: async () => { sdkOpened = true; return {}; } }).run({ id: 'too-big' }, 'x'.repeat(10000), { tokenBudget: 100 }), /budget-exceeded/);
assert.equal(sdkOpened, false);
let sendOptions;
const sdkRuntime = new CursorTaskRuntime({ env: { CURSOR_API_KEY: 'test' }, importSdk: async () => ({ Agent: {
  async create() { return { agentId: 'a', async send(_prompt, options) { sendOptions = options; return { id: 'sdk-run', supports: () => false, result: '结论', status: 'finished' }; }, close() {} }; },
  async resume() {}, async getRun() {}
} }) });
await sdkRuntime.run({ id: 'read', kind: 'analysis' }, 'inspect');
assert.equal(sendOptions.mode, 'plan');
await sdkRuntime.closeAll();
let cancelled = 0;
let disposed = 0;
let finishWait;
await assert.rejects(scratchPrompt({ Agent: { async create() { return {
  async send() { return { wait: () => new Promise(r => { finishWait = r; }), async cancel() { cancelled++; finishWait({ status: 'cancelled' }); } }; },
  close() { disposed++; }
}; } } }, 'hello', {}, { timeoutMs: 10, label: 'intent' }), /intent-timeout/);
await new Promise(r => setImmediate(r));
assert.equal(cancelled, 1);
assert.equal(disposed, 1);

const usageEvents = [];
let body;
const client = new LlmClient({ endpoint: 'https://example.invalid/chat', model: 'test', maxOutputTokens: 128, tokenBudget: 500, onUsage: e => usageEvents.push(e) }, { fetchImpl: async (_url, options) => {
  body = JSON.parse(options.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'not JSON' } }], usage: { prompt_tokens: 11, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 7 } } }) };
} });
const invalid = await client.chatJson([{ role: 'user', content: 'hello' }]);
assert.equal(invalid.usage.prompt_tokens, 11, 'malformed outputs still consumed tokens');
assert.equal(body.max_tokens, 128);
assert.equal(usageEvents[0].usage.totalTokens, 14);
assert.equal(usageEvents[0].usage.cachedInputTokens, 7);
assert.equal(normalizeUsage().totalTokens, null);
assert.equal((await client.chat([{ role: 'user', content: 'x'.repeat(10000) }])).status, 'failed');
assert.equal(usageEvents.length, 1);

// Schema repair usage must include the rejected generation, not only the fix.
let attempts = 0;
const repairRuntime = new AgentRuntime({ providers: { http: { async invoke() {
  attempts++;
  return { status: 'success', result: attempts === 1 ? {} : { answer: 'yes' }, metrics: { tokens: 10 } };
} } }, contracts: { contractsFor: async () => ({ outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } } }) } });
const repaired = await repairRuntime.invoke({ id: 'repair', provider: 'http' }, { constraints: {}, input: {} });
assert.equal(repaired.metrics.tokens, 20);

const inboxFile = path.join(root, 'inbox.json');
const inbox = createMessageInbox({ file: inboxFile });
const frame = (id, content = '做：测试') => ({ body: { msgid: id, from: { userid: 'u' }, text: { content } } });
let calls = 0;
await Promise.all([inbox.dispatch(frame('one'), async () => ++calls), inbox.dispatch(frame('one'), async () => ++calls)]);
assert.equal(calls, 1);
await createMessageInbox({ file: inboxFile }).dispatch(frame('one'), async () => ++calls);
assert.equal(calls, 1, 'receipt survives process restart');
await assert.rejects(inbox.dispatch(frame('retry'), async () => { throw new Error('temporary'); }));
await inbox.dispatch(frame('retry'), async () => ++calls);
assert.equal(calls, 2);
let release;
const order = [];
const blocked = inbox.dispatch(frame('slow'), async () => { order.push('slow'); await new Promise(r => { release = r; }); });
while (!release) await new Promise(r => setImmediate(r));
const next = inbox.dispatch(frame('next'), async () => order.push('next'));
const cardFrame = frame('workspace-card');
delete cardFrame.body.text;
cardFrame.body.event = { template_card_event: { event_key: 'ws:local' } };
const cardChoice = inbox.dispatch(cardFrame, async () => order.push('workspace'));
await inbox.dispatch(frame('stop', '取消 task-test'), async () => order.push('stop'));
assert.deepEqual(order, ['slow', 'stop']);
release();
await Promise.all([blocked, next, cardChoice]);
assert.deepEqual(order, ['slow', 'stop', 'next', 'workspace']);
await manager.close();
console.log('cost controls tests passed');
