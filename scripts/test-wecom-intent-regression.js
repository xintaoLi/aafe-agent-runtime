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
import { parseWeComCommand, stripMentions } from '../ai-bots/wecom/src/commands.js';
import { createIntentAnalyzer } from '../ai-bots/wecom/src/understand.js';
import { handleWeComMessage } from '../ai-bots/wecom/src/handler.js';
import { createPendingStore } from '../ai-bots/wecom/src/pending.js';
import { createWorkspaceStore } from '../ai-bots/wecom/src/workspace.js';
import { sessionKeyFromSource, sourceFromFrame } from '../ai-bots/wecom/src/session.js';

// The user's three messages, as seen in the incident (never execute this PR).
const request = 'https://github.com/TencentBlueKing/bk-monitor/pull/12303\n\n分析这个PR，处理冲突，移除package.json 中\n"@biomejs/biome": "^2.1.4",\n"@blueking/bkui-lint": "0.0.3",\n其他冲突大部分是格式冲突';
const repo = '/Users/lixintao/github/bk-monitor/bklog/web';
const feedback = '目标仓库：' + repo + '，\n根据PR 处理冲突，更新PR';
const direct = '直接修改：\n' + feedback;
const frame = { body: { chattype: 'single', from: { userid: 'intent-test' } } };
function fixture({ configured = true, analyzer } = {}) {
  const tasks = [], started = [], continued = [], pending = createPendingStore(), replies = [];
  const config = { root: '/tmp/aafe-bot', agent: { provider: 'codex' },
    workflow: { mode: 'auto', intentConfidence: 0.7 },
    workspaces: configured ? [{ id: 'log-web', cwd: repo }] : [] };
  const manager = {
    async list() { return tasks; }, async get(id) { return tasks.find((task) => task.id === id) ?? null; },
    async create(input) { const task = { ...input, status: 'created', updatedAt: new Date().toISOString() }; tasks.push(task); return task; },
    async start(id) { started.push(id); },
    async continue(id, message) { continued.push({ id, message }); }
  };
  let sequence = 0;
  const understanding = analyzer ?? createIntentAnalyzer({ settings: {}, env: {},
    fetchImpl: () => { throw new Error('unexpected model call'); },
    importSdk: () => { throw new Error('must not call Cursor under Codex'); } });
  const send = (text, user = 'intent-test') => handleWeComMessage({ body: { ...frame.body,
    from: { userid: user }, msgid: 'incident-' + ++sequence, text: { content: text } } },
    { manager, pending, config, workspaces: createWorkspaceStore(config), understanding,
      replyAck: async (_frame, text) => { replies.push(text); return 'stream-fixture'; },
      replyProgress: async () => {}, logger: { event() {}, error() {} } });
  return { tasks, started, continued, pending, replies, send };
}
const parsed = parseWeComCommand(request);
assert.match(parsed.text, /@biomejs\/biome/);
assert.match(parsed.text, /@blueking\/bkui-lint/);
for (const text of ['@biomejs/biome', 'git@github.com:owner/repo.git', 'user@example.com', '"@blueking/bkui-lint": "0.0.3"']) {
  assert.equal(stripMentions(text), text);
}
assert.equal(stripMentions('@AAFE @机器人 修复登录'), '修复登录');

const rules = createIntentAnalyzer({ settings: {}, env: {} });
assert.equal(rules.backend, 'rules');
for (const text of [request, feedback, direct, '先分析问题，然后修复入口并补充测试', '分析 PR，删除无用依赖', '分析原因，同时修改实现',
  '我希望直接修改代码', '请把 package.json 中的两个依赖移除']) {
  const intent = await rules.analyze({ text: parseWeComCommand(text).text });
  assert.equal(intent?.kind, 'code', text);
  assert.ok(intent.confidence >= 0.7, text);
}
for (const text of ['分析这个 PR 是否有副作用', '分析如何修复冲突', '仅分析 PR，不要修改代码', '分析这个 PR，说明如何移除依赖，不要执行', '先分析，不修改；暂时不要提交 PR']) {
  const intent = await rules.analyze({ text });
  assert.equal(intent?.kind, 'analysis', text);
  assert.ok(intent.confidence >= 0.7, text);
}
const ready = fixture();
const result = await ready.send(request);
assert.equal(result.action.type, 'created');
assert.equal(ready.tasks[0].kind, 'requirement');
assert.equal(ready.tasks[0].provider, 'codex');
assert.equal(ready.tasks[0].workspace.cwd, repo);
assert.match(ready.tasks[0].requirement, /@biomejs\/biome/);
assert.equal(ready.started.length, 1);
assert.equal((await ready.send(feedback)).action.type, 'continue');
assert.equal((await ready.send(direct)).action.type, 'continue');
assert.equal(ready.tasks.length, 1, 'the three-turn conversation must not create duplicate PR tasks');
assert.equal(ready.continued.length, 2);
assert.ok(ready.continued.every((item) => item.id === ready.tasks[0].id));
assert.equal((await ready.send('直接修改：目标仓库：/tmp/different-project')).action.type, 'error');
assert.equal(ready.continued.length, 2, 'a follow-up must not silently switch the task checkout');

// Replay an already pending conversation from the older broken router.
for (const answer of [feedback, direct]) {
  const f = fixture();
  f.pending.set(sessionKeyFromSource(sourceFromFrame(frame)), { type: 'need-intent', text: request, feedback: [] });
  assert.equal((await f.send(answer)).action.type, 'created');
  assert.equal(f.tasks.length, 1);
  assert.match(f.tasks[0].requirement, /pull\/12303/);
  assert.match(f.tasks[0].requirement, /@blueking\/bkui-lint/);
  assert.match(f.tasks[0].requirement, /更新PR/);
  assert.equal(f.tasks[0].workspace.cwd, repo);
  assert.equal(f.pending.get(sessionKeyFromSource(sourceFromFrame(frame))), null);
}
const unconfigured = fixture({ configured: false });
assert.equal((await unconfigured.send(request)).action.type, 'need-workspace');
assert.equal((await unconfigured.send(feedback)).action.type, 'created');
assert.equal(unconfigured.tasks[0].workspace.cwd, repo);
assert.match(unconfigured.tasks[0].requirement, /pull\/12303/);
assert.match(unconfigured.tasks[0].requirement, /更新PR/);
assert.match(unconfigured.tasks[0].requirement, /@biomejs\/biome/);

const restricted = fixture({ configured: false });
restricted.pending.set(sessionKeyFromSource(sourceFromFrame(frame)), { type: 'need-intent',
  text: request, feedback: ['仅分析，不修改'] });
assert.equal((await restricted.send('目标仓库：' + repo)).action.type, 'created');
assert.equal(restricted.tasks[0].kind, 'analysis', 'path-only feedback cannot discard the earlier read-only restriction');

const inline = fixture();
assert.equal((await inline.send('直接修改：目标仓库：/tmp/explicit-project，修复登录问题')).action.type, 'created');
assert.equal(inline.tasks[0].workspace.cwd, '/tmp/explicit-project', 'explicit target beats the configured default');

// Scope/authorization boundaries remain closed without a classifier model.
for (const text of ['分析这个 PR，是否需要移除依赖', '分析处理冲突的方案', '分析为何修改 package.json 后失败', '解释如何修复这个问题',
  '修复方案是什么', '分析 PR，修改建议是什么']) {
  const classified = await rules.analyze({ text });
  assert.ok(classified.kind !== 'code' || classified.confidence < 0.7, text);
}
const unknown = fixture();
const firstAsk = await unknown.send('这个事情怎么处理比较合适');
assert.equal(firstAsk.action.type, 'clarify');
const secondAsk = await unknown.send('还没确定');
assert.equal(secondAsk.action.type, 'clarify');
assert.notEqual(secondAsk.reply, firstAsk.reply);
assert.match(secondAsk.reply, /无需重复发送/);
assert.equal(unknown.tasks.length, 0);
const otherUser = await unknown.send('目标仓库：' + repo, 'someone-else');
assert.notEqual(otherUser.action.type, 'created', 'another user cannot fill the pending request');
const newRequest = await unknown.send('做：修复另一个登录问题');
assert.equal(newRequest.action.type, 'created');
assert.doesNotMatch(unknown.tasks[0].requirement, /这个事情怎么处理/);

const readonly = fixture();
readonly.pending.set(sessionKeyFromSource(sourceFromFrame(frame)), { type: 'need-intent', text: request, feedback: [] });
assert.equal((await readonly.send('仅分析，不修改；目标仓库：' + repo)).action.type, 'created');
assert.equal(readonly.tasks[0].kind, 'analysis');
assert.match(readonly.tasks[0].requirement, /仅分析，不修改/);
const ambiguousRepo = fixture();
assert.equal((await ambiguousRepo.send('直接修改：目标仓库：/tmp/one，目标仓库：/tmp/two')).action.type, 'error');
assert.equal(ambiguousRepo.tasks.length, 0);

console.log('wecom natural-language incident regression passed (no PR, model or repository writes)');
