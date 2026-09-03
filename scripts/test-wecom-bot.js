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
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseWeComArgs } from '../src/cli/wecom.js';
import { startWeComBot } from '../ai-bots/wecom/src/index.js';
import { parseWeComCommand, stripMentions } from '../ai-bots/wecom/src/commands.js';
import { analyzeWeComIntent } from '../ai-bots/wecom/src/intent.js';
import { createTaskManagerOptions, loadWeComBotConfig } from '../ai-bots/wecom/src/config.js';
import { createMessageDedup } from '../ai-bots/wecom/src/dedup.js';
import { createWeComGateway } from '../ai-bots/wecom/src/gateway.js';
import { handleWeComMessage } from '../ai-bots/wecom/src/handler.js';
import { HELP_TEXT } from '../ai-bots/wecom/src/help.js';
import {
  attachWeComNotifier,
  createRateLimiter,
  formatListReply,
  formatTaskNotify
} from '../ai-bots/wecom/src/notify.js';
import { resolveWeComAction } from '../ai-bots/wecom/src/resolver.js';
import { conversationIdFromFrame, sourceFromFrame } from '../ai-bots/wecom/src/session.js';

assert.equal(stripMentions('@RobotA @AAFE 做：增加搜索'), '做：增加搜索');
assert.deepEqual(parseWeComCommand('@AAFE 做：增加用户手机号搜索'), {
  type: 'create',
  requirement: '增加用户手机号搜索'
});
assert.deepEqual(parseWeComCommand('继续 task-20260903120000-abcd1234：补测试'), {
  type: 'continue',
  taskId: 'task-20260903120000-abcd1234',
  message: '补测试'
});
assert.deepEqual(parseWeComCommand('状态 T001'), { type: 'status', taskId: 'T001' });
assert.deepEqual(parseWeComCommand('取消 T001'), { type: 'cancel', taskId: 'T001' });
assert.deepEqual(parseWeComCommand('列表'), { type: 'list' });
assert.equal(parseWeComCommand('继续').type, 'ambiguous-continue');
assert.deepEqual(parseWeComCommand('继续：改样式'), {
  type: 'implicit-continue',
  message: '改样式'
});
assert.equal(parseWeComCommand('状态').type, 'implicit-status');
assert.equal(parseWeComCommand('取消').type, 'implicit-cancel');
assert.deepEqual(parseWeComCommand('你好'), { type: 'freeform', text: '你好' });
assert.equal(parseWeComCommand('做：').type, 'help');
assert.equal(analyzeWeComIntent('你好').type, 'help');
assert.equal(analyzeWeComIntent('谢谢').type, 'ack');
assert.equal(analyzeWeComIntent('怎么样了').type, 'implicit-status');
assert.deepEqual(analyzeWeComIntent('加上单测'), {
  type: 'implicit-route',
  text: '加上单测',
  prefer: 'follow'
});
const tapdPaste = '【日志检索结果复制按钮失效，点击后没有复制到内容】 https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137887277';
assert.deepEqual(analyzeWeComIntent(tapdPaste), {
  type: 'implicit-route',
  text: tapdPaste,
  prefer: 'new'
});
assert.equal(analyzeWeComIntent('登录页按钮颜色需要改成品牌色').prefer, 'work');

const textFrame = {
  headers: { req_id: 'req-1' },
  body: {
    msgid: 'm1',
    aibotid: 'bot-1',
    chattype: 'single',
    from: { userid: 'user-a' },
    msgtype: 'text',
    text: { content: '做：修登录' }
  }
};
assert.equal(conversationIdFromFrame(textFrame), 'user-a');
assert.deepEqual(sourceFromFrame(textFrame), {
  type: 'wecom',
  conversationId: 'user-a',
  chattype: 'single',
  messageId: 'm1',
  userId: 'user-a',
  chatbotId: 'bot-1'
});
assert.equal(conversationIdFromFrame({
  body: { chattype: 'group', chatid: 'chat-9', from: { userid: 'user-a' } }
}), 'chat-9');

const dedup = createMessageDedup({ limit: 2 });
assert.equal(dedup.accept('m1'), true);
assert.equal(dedup.accept('m1'), false);
assert.equal(dedup.accept('m2'), true);
assert.equal(dedup.accept('m3'), true);
assert.equal(dedup.has('m1'), false);

const limiter = createRateLimiter({ maxPerMinute: 2, now: sequentialNow([1, 2, 3, 70_000]) });
assert.equal(limiter.allow('c1'), true);
assert.equal(limiter.allow('c1'), true);
assert.equal(limiter.allow('c1'), false);
assert.equal(limiter.allow('c1'), true);

const emptyRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-empty-'));
await assert.rejects(
  () => loadWeComBotConfig({ root: emptyRoot, env: {}, readConfig: async () => ({}) }),
  /wecom-bot-credentials-missing/
);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-'));
await writeFile(path.join(tmp, '.aafe.config.json'), JSON.stringify({
  agent: { repository: 'owner/repo', manager: { output: '.aafe' } }
}), 'utf8');
const config = await loadWeComBotConfig({
  root: tmp,
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret' }
});
assert.equal(config.repository, 'owner/repo');
assert.equal(config.wsUrl, 'wss://openws.work.weixin.qq.com');

await writeFile(path.join(tmp, 'wecom.local.json'), JSON.stringify({
  botId: 'local-bot',
  secret: 'local-secret',
  apiKey: 'crsr_local',
  repository: 'local/repo'
}), 'utf8');
const fromLocal = await loadWeComBotConfig({ root: tmp, env: {} });
assert.equal(fromLocal.botId, 'local-bot');
assert.equal(fromLocal.secret, 'local-secret');
assert.equal(fromLocal.apiKey, 'crsr_local');
assert.equal(fromLocal.repository, 'local/repo');
const localManagerOptions = createTaskManagerOptions(fromLocal);
assert.equal(localManagerOptions.runtimeOptions.apiKey, 'crsr_local');
assert.equal(localManagerOptions.runtimeOptions.mode, 'cloud');
assert.equal(localManagerOptions.validateProjectRuntime, true);

const noRepoManagerOptions = createTaskManagerOptions({
  root: tmp,
  repository: null,
  apiKey: 'crsr_local',
  agent: {}
});
assert.equal(noRepoManagerOptions.validateProjectRuntime, false);
assert.equal(noRepoManagerOptions.runtimeOptions.mode, 'local');
assert.equal(noRepoManagerOptions.runtimeOptions.cwd, tmp);
assert.equal(noRepoManagerOptions.runtimeOptions.repository, null);

const envWins = await loadWeComBotConfig({
  root: tmp,
  env: { WECOM_BOT_ID: 'env-bot', WECOM_BOT_SECRET: 'env-secret', CURSOR_API_KEY: 'crsr_env' }
});
assert.equal(envWins.botId, 'env-bot');
assert.equal(envWins.apiKey, 'crsr_env');

const envRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-env-'));
await mkdir(path.join(envRoot, 'ai-bots/wecom'), { recursive: true });
await writeFile(path.join(envRoot, 'ai-bots/wecom/.env'), [
  'export WECOM_BOT_ID=dotenv-bot',
  'WECOM_BOT_SECRET="dotenv-secret"',
  'CURSOR_API_KEY=crsr_dotenv'
].join('\n'), 'utf8');
const fromDotEnv = await loadWeComBotConfig({ root: envRoot, env: {}, readConfig: async () => ({}) });
assert.equal(fromDotEnv.botId, 'dotenv-bot');
assert.equal(fromDotEnv.secret, 'dotenv-secret');
assert.equal(fromDotEnv.apiKey, 'crsr_dotenv');

const manager = createFakeManager();
const created = await resolveWeComAction(
  { type: 'create', requirement: '增加搜索' },
  { source: sourceFromFrame(textFrame), repository: 'owner/repo', baseBranch: 'main' },
  manager
);
assert.equal(created.type, 'created');
assert.equal(created.start, true);
assert.equal(created.task.source.type, 'wecom');
assert.match(created.task.id, /^task-/);

const missingRepo = await resolveWeComAction(
  { type: 'create', requirement: '增加搜索' },
  { source: sourceFromFrame(textFrame), repository: null },
  manager
);
assert.equal(missingRepo.type, 'created');
assert.equal(missingRepo.start, true);
assert.equal(missingRepo.task.repository, null);
missingRepo.task.status = 'completed';

manager.tasks[0].status = 'running';
manager.tasks.push({
  id: 'task-other',
  status: 'running',
  source: { type: 'wecom', conversationId: 'chat-x', userId: 'user-a' },
  goal: 'other'
});
const singleContinue = await resolveWeComAction(
  { type: 'ambiguous-continue' },
  { source: sourceFromFrame(textFrame) },
  manager
);
assert.equal(singleContinue.type, 'error');
assert.match(singleContinue.message, new RegExp(created.task.id));
assert.match(singleContinue.message, /请补充内容/);

manager.tasks.push({
  id: 'task-same-chat',
  status: 'running',
  source: { type: 'wecom', conversationId: 'user-a', userId: 'user-a' },
  goal: 'same chat'
});
const ambiguous = await resolveWeComAction(
  { type: 'ambiguous-continue' },
  { source: sourceFromFrame(textFrame) },
  manager
);
assert.match(ambiguous.message, /多个未结束任务/);
assert.equal(ambiguous.message.includes(created.task.id), true);
assert.equal(ambiguous.message.includes('task-same-chat'), true);
assert.equal(ambiguous.message.includes('task-other'), false);

const listed = await resolveWeComAction({ type: 'list' }, { source: sourceFromFrame(textFrame) }, manager);
assert.equal(listed.tasks.some((task) => task.id === created.task.id), true);

const replies = [];
const started = [];
const ackManager = createFakeManager({
  onStart(id) { started.push(id); }
});
const handled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'create-1', text: { content: '做：增加手机号搜索' } }
}, {
  manager: ackManager,
  replyAck: async (_frame, content) => { replies.push(content); },
  config: { repository: 'owner/repo', baseBranch: 'main' },
  dedup: createMessageDedup()
});
assert.equal(handled.action.type, 'created');
assert.equal(replies[0].includes(handled.action.task.id), true);
await delay(10);
assert.deepEqual(started, [handled.action.task.id]);

const helpReplies = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'help-1', text: { content: '你好' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { helpReplies.push(content); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(helpReplies[0], HELP_TEXT);

const tapdReplies = [];
const tapdStarted = [];
const tapdHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'tapd-1', text: { content: tapdPaste } }
}, {
  manager: createFakeManager({ onStart(id) { tapdStarted.push(id); } }),
  replyAck: async (_frame, content) => { tapdReplies.push(content); },
  config: { repository: 'owner/repo', baseBranch: 'main' },
  dedup: createMessageDedup()
});
assert.equal(tapdHandled.action.type, 'created');
assert.equal(tapdHandled.action.task.requirement, tapdPaste);
assert.equal(tapdReplies[0].includes(tapdHandled.action.task.id), true);
await delay(10);
assert.deepEqual(tapdStarted, [tapdHandled.action.task.id]);

const followManager = createFakeManager();
const existing = await followManager.create({
  id: 'task-open-1',
  status: 'running',
  source: sourceFromFrame(textFrame),
  goal: '旧任务'
});
existing.status = 'running';
const followHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'follow-1', text: { content: '加上单测' } }
}, {
  manager: followManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(followHandled.action.type, 'continue');
assert.equal(followHandled.action.task.id, 'task-open-1');
assert.equal(followHandled.action.message, '加上单测');

const newDuringOpen = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'new-1', text: { content: tapdPaste } }
}, {
  manager: followManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo', baseBranch: 'main' },
  dedup: createMessageDedup()
});
assert.equal(newDuringOpen.action.type, 'created');
assert.notEqual(newDuringOpen.action.task.id, 'task-open-1');

const notifyTask = {
  id: 'task-done',
  status: 'completed',
  requirement: '增加搜索',
  source: { type: 'wecom', conversationId: 'user-a', chattype: 'single' },
  result: { git: { files: ['src/a.js'], prUrl: 'https://example.com/pr/1' } }
};
assert.match(formatTaskNotify(notifyTask), /task-done/);
assert.match(formatTaskNotify(notifyTask), /src\/a\.js/);
assert.match(formatTaskNotify(notifyTask), /https:\/\/example.com\/pr\/1/);
assert.match(formatListReply([]), /没有未结束/);

const sent = [];
const listeners = [];
attachWeComNotifier({
  manager: {
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
    async get() { return notifyTask; }
  },
  sendMessage: async (chatid, body) => { sent.push({ chatid, body }); }
});
await listeners[0]({ type: 'task.finished', taskId: 'task-done', status: 'completed', task: notifyTask });
assert.equal(sent[0].chatid, 'user-a');
assert.equal(sent[0].body.msgtype, 'markdown');
assert.match(sent[0].body.markdown.content, /已完成/);

class FakeWSClient {
  constructor(options) { this.options = options; this.handlers = new Map(); }
  on(event, handler) {
    this.handlers.set(event, handler);
  }
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  async replyWelcome(frame, body) { this.welcome = { frame, body }; }
  async replyStream(frame, streamId, content, finish) {
    this.stream = { frame, streamId, content, finish };
  }
  async sendMessage(chatid, body) { this.sent = { chatid, body }; }
}
const gateway = createWeComGateway({
  botId: 'bot',
  secret: 'secret',
  WSClient: FakeWSClient
});
gateway.connect();
assert.equal(gateway.client.connected, true);
await gateway.replyAck({ headers: { req_id: 'r1' } }, 'ack');
assert.equal(gateway.client.stream.finish, true);
gateway.client.handlers.get('event')({ body: { event: { eventtype: 'disconnected_event' } } });
assert.equal(gateway.kicked, true);

assert.deepEqual(parseWeComArgs(['--root=/tmp/app', '--config=/tmp/wecom.local.json', '--no-recover']), {
  root: '/tmp/app',
  config: '/tmp/wecom.local.json',
  recoverOnStart: false
});

const recovered = [];
const startedBot = await startWeComBot({
  config: {
    root: tmp,
    botId: 'bot',
    secret: 'secret',
    wsUrl: 'wss://openws.work.weixin.qq.com',
    repository: 'owner/repo',
    agent: { mcp: { enabled: false } }
  },
  manager: {
    async initialize() { recovered.push('ok'); return []; },
    subscribe() { return () => {}; },
    async close() { recovered.push('closed'); }
  },
  WSClient: FakeWSClient,
  keepAlive: false,
  exitOnShutdown: false,
  installSignals: false,
  mcpServers: {}
});
assert.deepEqual(recovered, ['ok']);
assert.equal(startedBot.gateway.client.connected, true);
await startedBot.shutdown('test');
assert.deepEqual(recovered, ['ok', 'closed']);

console.log('wecom bot tests passed');

function createFakeManager({ onStart } = {}) {
  const tasks = [];
  return {
    tasks,
    async create(input) {
      const task = { ...input, status: 'created' };
      tasks.push(task);
      return task;
    },
    async start(id) {
      onStart?.(id);
      const task = tasks.find((item) => item.id === id);
      if (task) task.status = 'running';
      return task;
    },
    async continue(id, message) {
      onStart?.(id);
      return { id, message, status: 'running' };
    },
    async cancel(id) {
      const task = tasks.find((item) => item.id === id);
      if (task) task.status = 'cancelled';
      return task;
    },
    async get(id) {
      return tasks.find((item) => item.id === id) ?? null;
    },
    async list() {
      return [...tasks];
    },
    stats() {
      return { runningTaskIds: tasks.filter((task) => task.status === 'running').map((task) => task.id) };
    },
    subscribe() { return () => {}; }
  };
}

function sequentialNow(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
