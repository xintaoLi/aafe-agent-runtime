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
import { buildTaskPresentation, renderTaskPresentation } from '../ai-bots/wecom/src/presentation.js';
import { formatTaskNotify, formatStatusReply, attachWeComNotifier } from '../ai-bots/wecom/src/notify.js';
import { createWeComProgressHub, renderStoredProcess } from '../ai-bots/wecom/src/progress.js';
import { buildTaskCard } from '../ai-bots/wecom/src/cards.js';
import { handleWeComCard, handleWeComMessage } from '../ai-bots/wecom/src/handler.js';
import { createPendingStore } from '../ai-bots/wecom/src/pending.js';
import { splitWeComMarkdown } from '../ai-bots/wecom/src/markdown.js';
import { sessionKeyFromSource, sourceFromFrame } from '../ai-bots/wecom/src/session.js';

const question = '请提供已部署本次改动的完整目标测试页面 URL。';
const summary = '代码修改、5 项测试、ESLint 和格式检查均已通过。Commit、PR、TAPD 回填暂缓，等待浏览器验证。';
const steps = [question, '完成聚焦浏览器验证。', '提交代码、创建 PR 并回填 TAPD。'];
const task = {
  id: 'task-wecom-ui', status: 'blocked', provider: 'codex',
  requirement: '【产品功能】Space 加载失败处理 [需求正文](https://example.com/story/137994989)',
  source: { type: 'wecom', conversationId: 'room-ui', chattype: 'group', userId: 'ann' },
  result: { text: summary + '\n待处理：\n' + steps.map((step) => '- ' + step).join('\n'),
    outcome: { status: 'blocked', summary, evidence: ['npm test: 5 passed'], remainingSteps: steps } }
};
task.error = task.result.text;
const view = buildTaskPresentation(task);
assert.equal(view.status, 'blocked');
assert.equal(view.question, question);
const text = formatTaskNotify(task);
assert.match(text, /⏸ 等待补充 \/ 确认/);
assert.doesNotMatch(text, /执行失败|✅ 最终结论|错误：|个分析步骤/);
assert.equal(text.split(summary).length - 1, 1);
assert.equal(text.split(question).length - 1, 1);
assert.equal(text.split(task.id).length - 1, 1);
assert.ok(text.indexOf(question) < text.indexOf(summary));
assert.match(text, /\[需求正文\]\(https:\/\/example.com\/story\/137994989\)/);
assert.equal(formatStatusReply(task), text);
assert.match(renderTaskPresentation(view, { expanded: true }), /Agent 报告的验证记录/);
assert.match(renderTaskPresentation(view, { expanded: true }), /npm test: 5 passed/);
const legacy = { ...task, result: { text: task.result.text } };
assert.equal(buildTaskPresentation(legacy).question, question);
assert.equal(formatTaskNotify(legacy).split(question).length - 1, 1);
const verifiedBlock = buildTaskPresentation({ ...task, result: {
  text: 'Agent 声称已完成', outcome: { status: 'completed', summary: 'Agent 声称已完成', remainingSteps: [] },
  deliveryVerification: { error: '缺少 TAPD 回填核验记录' }
} });
assert.equal(verifiedBlock.status, 'blocked', 'persisted task status beats the Agent claim');
assert.match(renderTaskPresentation(verifiedBlock), /缺少 TAPD 回填核验记录/);
assert.doesNotMatch(formatTaskNotify({ ...task, status: 'completed' }), /错误：/);
assert.match(formatTaskNotify({ id: 'task-error', status: 'failed', error: 'boom' }), /错误：boom/);

const frame = { headers: { req_id: 'ui-request' }, body: { chattype: 'group', chatid: 'room-ui', from: { userid: 'ann' } } };
const eventFrame = (action, user = 'ann') => ({
  ...frame, body: { ...frame.body, from: { userid: user },
    event: { eventtype: 'template_card_event', template_card_event: { event_key: action + ':' + task.id } } }
});
const frames = [], cards = [];
let clock = 1000;
const hub = createWeComProgressHub({
  replyProgress: async (_frame, _id, content, finish) => { frames.push({ content, finish }); },
  replyCard: async (_frame, card) => { cards.push(card); },
  now: () => clock, heartbeatMs: 1000, textFlushMs: 0, stallMs: 0
});
hub.open({ taskId: task.id, frame, streamId: 'stream-ui', header: task.id + ' 继续\n旧需求不应重复' });
await hub.handle({ taskId: task.id, type: 'codex.run.started' });
clock += 1001;
await hub.tick();
assert.equal(frames.length, 1, 'default animation off: unchanged heartbeat sends no frame');
assert.doesNotMatch(frames[0].content, /🐧/);
const messages = [
  { messageId: 'public-1', text: '正在定位 Space 初始化入口。' },
  { messageId: 'public-2', text: '已定位分支，下一步补充回归测试。' },
  { tools: [{ name: 'command', detail: 'npm test' }], text: '测试命令已经启动。', messageId: 'public-3' }
];
for (const payload of messages) await hub.handle({ type: 'codex.message', taskId: task.id, payload });
await hub.handle({ type: 'codex.message', taskId: task.id, payload: { thinking: '内部原始推理绝对不能展示' } });
assert.match(hub.renderProcess(task.id), /正在定位 Space 初始化入口。/);
assert.match(hub.renderProcess(task.id), /已定位分支，下一步补充回归测试。/);
assert.match(hub.renderProcess(task.id), /测试命令已经启动。/);
assert.doesNotMatch(hub.renderProcess(task.id), /内部原始推理/);
await hub.handle({ type: 'task.finished', taskId: task.id, status: 'blocked' }, { task });
const final = frames.at(-1).content;
assert.equal(frames.at(-1).finish, true);
assert.match(final, /⏸ 等待补充/);
assert.doesNotMatch(final, /执行失败|最终结论|旧需求不应重复/);
assert.equal(final.split(summary).length - 1, 1);
assert.equal(final.split(task.id).length - 1, 1);
assert.match(final, /npm test/);
assert.match(hub.renderProcess(task.id), /5 passed/);
assert.match(hub.renderProcess(task.id), /需要你反馈/);
assert.equal(cards.length, 1);
assert.deepEqual(cards[0].button_list.map((button) => button.key), [
  'status:' + task.id, 'process:' + task.id, 'feedback:' + task.id
]);
for (const status of ['completed', 'failed', 'cancelled']) {
  const card = buildTaskCard({ ...task, status });
  assert.equal(card.button_list.length, 2);
  assert.doesNotMatch(card.main_title.title, /执行中/);
}
await hub.close();

const events = [
  { type: 'codex.message', payload: { text: '上一轮旧记录' } },
  { type: 'task.prompt.budget' },
  ...messages.map((payload) => ({ type: 'codex.message', payload })),
  { type: 'codex.message', payload: { thinking: '另一段内部推理' } }
];
const restored = renderStoredProcess(task, events);
assert.match(restored, /工作记录/);
assert.match(restored, /需要你反馈/);
assert.match(restored, /正在定位 Space/);
assert.doesNotMatch(restored, /上一轮旧记录|另一段内部推理/);
const pending = createPendingStore();
const continued = [], replies = [];
const manager = {
  async get(id) { return id === task.id ? task : null; },
  async events() { return events; }, async list() { return [task]; },
  async continue(...args) { continued.push(args); }, stats() { return {}; }
};
const deps = { manager, pending, logger: { event() {}, error() {} },
  sendText: async (content) => { replies.push(content); } };
const denied = await handleWeComCard(eventFrame('feedback', 'bob'), deps);
assert.equal(denied.reason, 'not-task-owner');
assert.equal(continued.length, 0);
const ask = await handleWeComCard(eventFrame('feedback'), deps);
assert.equal(ask.action.type, 'need-feedback');
assert.equal(continued.length, 0, 'opening the feedback card never executes/approves a gate');
assert.match(ask.reply, /点击本按钮不会执行或批准提交/);
const key = sessionKeyFromSource(sourceFromFrame(frame));
assert.equal(pending.get(key).taskId, task.id);
const follow = await handleWeComMessage({ ...frame, body: { ...frame.body,
  msgid: 'feedback-url', text: { content: 'https://example.com/test/space?index=1' } } }, {
  ...deps, config: { repository: 'owner/repo', workflow: { mode: 'auto', intentConfidence: 0.7 } },
  replyAck: async () => 'follow-stream',
  understanding: { async analyze() { throw new Error('explicit feedback must not call an intent model'); } }
});
assert.equal(follow.action.type, 'continue');
assert.equal(continued.length, 1);
assert.equal(continued[0][0], task.id);
assert.match(continued[0][1], /https:\/\/example.com\/test\/space\?index=1/);
assert.equal(continued[0][2].author.role, 'owner');
assert.equal(pending.get(key), null);
await handleWeComCard(eventFrame('feedback'), deps);
task.status = 'completed';
const stale = await handleWeComMessage({ ...frame, body: { ...frame.body, text: { content: '是' } } },
  { ...deps, replyAck: async () => 'stale-stream' });
assert.equal(stale.reason, 'feedback-task-changed');
assert.equal(continued.length, 1, 'a stale card cannot resume a changed task');
task.status = 'blocked';
await handleWeComCard(eventFrame('feedback'), deps);
task.checkpoint = { runId: 'next-blocked-run' };
const newRun = await handleWeComMessage({ ...frame, body: { ...frame.body, text: { content: '同意' } } },
  { ...deps, replyAck: async () => 'new-run' });
assert.equal(newRun.reason, 'feedback-task-changed');
assert.equal(continued.length, 1, 'feedback for an older gate cannot authorize a new blocked run');
await handleWeComCard(eventFrame('process'), deps);
assert.match(replies.at(-1), /工作记录/);
await handleWeComCard(eventFrame('feedback'), deps);
const cancelled = await handleWeComMessage({ ...frame, body: { ...frame.body, text: { content: '取消' } } },
  { ...deps, replyAck: async () => 'cancel-feedback' });
assert.equal(cancelled.action.type, 'feedback-cancelled');
assert.equal(task.status, 'blocked');
assert.equal(pending.get(key), null);

const secret = formatTaskNotify({ id: 'task-secret', status: 'failed',
  error: 'Authorization: Basic ZmFrZTpzZWNyZXQ= OPENAI_API_KEY=fake-key githubAccessToken="fake-token"' });
assert.doesNotMatch(secret, /ZmFrZTpzZWNyZXQ|fake-key|fake-token/);
const long = ('测试 🐧 中文内容。\n'.repeat(800)) + '最后一行';
const pages = splitWeComMarkdown(long);
assert.equal(pages.join(''), long);
assert.ok(pages.length > 1 && pages.every((page) => Buffer.byteLength(page) <= 3000));
assert.doesNotMatch(pages.join(''), /\uFFFD/);
assert.equal(splitWeComMarkdown('🐧'.repeat(2000)).join(''), '🐧'.repeat(2000));

const pushed = [], notifyErrors = [];
let notify;
const longTask = { ...task, result: { outcome: {
  summary: '这是很长的公开结论。'.repeat(200), remainingSteps: [question] } } };
attachWeComNotifier({ manager: { subscribe(callback) { notify = callback; return () => {}; } },
  sendMessage: async (_id, body) => {
    if (body.msgtype === 'template_card') throw new Error('card-unavailable');
    pushed.push(body.markdown.content);
  },
  logger: { warn: (error) => notifyErrors.push(error), event() {} }
});
await notify({ type: 'task.blocked', taskId: task.id, task: longTask });
assert.ok(pushed.length > 1);
assert.ok(pushed.every((page) => Buffer.byteLength(page) <= 3000));
assert.match(pushed.join(''), /等待补充 \/ 确认/);
assert.match(pushed.at(-1), /对话 ID/);
assert.ok(notifyErrors.some((error) => error.includes('card-unavailable')));
assert.equal(task.status, 'blocked', 'card transport failure never changes task result');

const exiting = [];
const exitHub = createWeComProgressHub({ replyProgress: async (_frame, _id, content) => { exiting.push(content); } });
exitHub.open({ taskId: 'task-exiting', frame, streamId: 'exit' });
await exitHub.close();
assert.match(exiting.at(-1), /本轮未完成/);
assert.doesNotMatch(exiting.at(-1), /✅/);
console.log('wecom presentation and feedback tests passed');
