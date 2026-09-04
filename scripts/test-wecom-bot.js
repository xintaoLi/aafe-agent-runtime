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
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { checkWeComModels, parseWeComArgs } from '../src/cli/wecom.js';
import {
  DEFAULT_MODEL_RULES,
  createModelRouter,
  mergeModelRules,
  validateModelRules
} from '../ai-bots/wecom/src/models.js';
import { startWeComBot } from '../ai-bots/wecom/src/index.js';
import { parseWeComCommand, stripMentions } from '../ai-bots/wecom/src/commands.js';
import { analyzeWeComIntent } from '../ai-bots/wecom/src/intent.js';
import { parseCardEvent, buildCancelledCard, freshCardTaskId } from '../ai-bots/wecom/src/cards.js';
import { handleWeComCard, handleWeComMedia } from '../ai-bots/wecom/src/handler.js';
import { createPendingStore } from '../ai-bots/wecom/src/pending.js';
import {
  classifyWorkspaceTarget,
  createWorkspaceStore,
  parseWorkspaces
} from '../ai-bots/wecom/src/workspace.js';
import {
  createTaskManagerOptions,
  loadWeComBotConfig,
  resolveWeComIntentConfig,
  resolveWeComModelConfig
} from '../ai-bots/wecom/src/config.js';
import {
  classifyIntentByRules,
  createIntentAnalyzer,
  fastIntent,
  parseIntent
} from '../ai-bots/wecom/src/understand.js';
import { createWeComLogger, resolveWeComLogConfig, sanitizeLogValue } from '../ai-bots/wecom/src/logger.js';
import { inferMediaType, mediaRequirement, parseWeComMedia } from '../ai-bots/wecom/src/media.js';
import { createMessageDedup } from '../ai-bots/wecom/src/dedup.js';
import { createWeComGateway } from '../ai-bots/wecom/src/gateway.js';
import { handleWeComMessage } from '../ai-bots/wecom/src/handler.js';
import { HELP_TEXT } from '../ai-bots/wecom/src/help.js';
import {
  attachWeComNotifier,
  createRateLimiter,
  formatListReply,
  formatTaskFooter,
  formatTaskNotify
} from '../ai-bots/wecom/src/notify.js';
import {
  createWeComProgressHub,
  danceFrame,
  formatProgressEvent,
  renderProgressView
} from '../ai-bots/wecom/src/progress.js';
import { resolveWeComAction } from '../ai-bots/wecom/src/resolver.js';
import { conversationIdFromFrame, sessionKeyFromSource, sourceFromFrame } from '../ai-bots/wecom/src/session.js';

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
assert.equal(parseWeComCommand('仓库').type, 'workspace-list');
assert.deepEqual(parseWeComCommand('切换 bklog'), { type: 'workspace-switch', target: 'bklog' });
assert.equal(classifyWorkspaceTarget('本地', '/tmp/bot').kind, 'local');
assert.equal(classifyWorkspaceTarget('owner/repo', '/tmp/bot').kind, 'remote');
assert.equal(classifyWorkspaceTarget('https://tapd.woa.com/x', '/tmp/bot').kind, 'unknown');
assert.equal(parseCardEvent({
  body: { event: { event_key: 'cancel:task-1' } }
}).action, 'cancel');
assert.equal(parseCardEvent({
  body: { event: { EventKey: 'cancel:task-2', task_id: 'run_task-2' } }
}).value, 'task-2');
assert.equal(parseCardEvent({
  body: { event: { EventKey: 'cancel:task-2', task_id: 'run_task-2' } }
}).cardTaskId, 'run_task-2');
// WeCom rejects a repeated card task_id with errcode 42014.
assert.notEqual(buildCancelledCard('task-1').task_id, buildCancelledCard('task-1').task_id);
assert.equal(buildCancelledCard('task-1', 'run_fixed').task_id, 'run_fixed');
assert.match(freshCardTaskId('run', 'task-1'), /^run_task-1-/);
assert.equal(parseWeComCommand('继续').type, 'ambiguous-continue');
assert.deepEqual(parseWeComCommand('继续：改样式'), {
  type: 'implicit-continue',
  message: '改样式'
});
assert.equal(parseWeComCommand('状态').type, 'implicit-status');
assert.equal(parseWeComCommand('取消').type, 'implicit-cancel');
assert.equal(parseWeComCommand('终止').type, 'implicit-cancel');
assert.equal(parseWeComCommand('终止 T001').type, 'cancel');
assert.equal(parseWeComCommand('停止当前任务').type, 'implicit-cancel');
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
// Digits alone are not a requirement, so they never reach a task or a model.
assert.equal(analyzeWeComIntent('1233').type, 'help');
assert.equal(analyzeWeComIntent('???').type, 'help');
assert.equal(analyzeWeComIntent('1、2、3都执行，TAPD MCP已有').type, 'implicit-route');

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
assert.equal(sessionKeyFromSource({
  chattype: 'group',
  conversationId: 'chat-9',
  userId: 'user-a'
}), 'chat-9::user-a');
assert.equal(sessionKeyFromSource({
  chattype: 'single',
  conversationId: 'user-a',
  userId: 'user-a'
}), 'user-a');

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
  agent: { repository: 'owner/repo', model: 'composer-2.5', manager: { output: '.aafe' } }
}), 'utf8');
const config = await loadWeComBotConfig({
  root: tmp,
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret' }
});
assert.equal(config.repository, 'owner/repo');
assert.equal(config.wsUrl, 'wss://openws.work.weixin.qq.com');
assert.equal(config.log.enabled, false);
assert.equal(config.agent.model, 'composer-2.5');

await writeFile(path.join(tmp, 'wecom.local.json'), JSON.stringify({
  botId: 'local-bot',
  secret: 'local-secret',
  apiKey: 'crsr_local',
  repository: 'local/repo',
  model: 'grok-4.6'
}), 'utf8');
const fromLocal = await loadWeComBotConfig({ root: tmp, env: {} });
assert.equal(fromLocal.botId, 'local-bot');
assert.equal(fromLocal.secret, 'local-secret');
assert.equal(fromLocal.apiKey, 'crsr_local');
assert.equal(fromLocal.repository, 'local/repo');
assert.equal(fromLocal.agent.model, 'grok-4.6');
assert.equal(fromLocal.workspaces[0].repository, 'local/repo');
const localManagerOptions = createTaskManagerOptions(fromLocal);
assert.equal(localManagerOptions.runtimeOptions.apiKey, 'crsr_local');
assert.equal(localManagerOptions.runtimeOptions.model, 'grok-4.6');
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
  env: {
    WECOM_BOT_ID: 'env-bot',
    WECOM_BOT_SECRET: 'env-secret',
    CURSOR_API_KEY: 'crsr_env',
    AAFE_WECOM_MODEL: 'composer-2.5'
  }
});
assert.equal(envWins.botId, 'env-bot');
assert.equal(envWins.apiKey, 'crsr_env');
assert.equal(envWins.agent.model, 'composer-2.5');

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
  { source: sourceFromFrame(textFrame), repository: null, requireWorkspace: true, botRoot: tmp },
  manager
);
assert.equal(missingRepo.type, 'need-workspace');

const createdLocal = await resolveWeComAction(
  { type: 'workspace-choice', text: '本地', requirement: '增加搜索' },
  { source: sourceFromFrame(textFrame), repository: null, requireWorkspace: true, botRoot: tmp },
  manager
);
assert.equal(createdLocal.type, 'created');
assert.equal(createdLocal.task.workspace.mode, 'local');
assert.equal(createdLocal.task.workspace.cwd, tmp);
createdLocal.task.status = 'completed';

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
const ackFinishes = [];
const opened = [];
const ackManager = createFakeManager({
  onStart(id) { started.push(id); }
});
const handled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'create-1', text: { content: '做：增加手机号搜索' } }
}, {
  manager: ackManager,
  replyAck: async (_frame, content, extra) => {
    replies.push(content);
    ackFinishes.push(extra?.finish);
    return 'stream-create';
  },
  replyCard: async (_frame, card) => { opened.push({ card }); },
  progress: { open(session) { opened.push(session); } },
  config: { repository: 'owner/repo', baseBranch: 'main' },
  dedup: createMessageDedup()
});
assert.equal(handled.action.type, 'created');
assert.equal(replies[0].includes(handled.action.task.id), true);
assert.equal(ackFinishes[0], false);
// Terminating lives in the live stream text, not in a separate card.
assert.equal(opened.some((item) => item.card), false);
assert.match(replies[0], new RegExp(`终止：发送 \`终止 ${handled.action.task.id}\``));
assert.match(replies[0], new RegExp(`对话 ID：\`${handled.action.task.id}\``));
const openedSession = opened.find((item) => item.taskId);
// The header the live view reuses stays free of the footer it appends itself.
assert.equal(openedSession.header.includes('对话 ID'), false);
assert.equal(openedSession.taskId, handled.action.task.id);
assert.equal(openedSession.streamId, 'stream-create');
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

const staleAndDone = createFakeManager();
await staleAndDone.create({
  id: 'task-stale-running',
  status: 'running',
  updatedAt: '2026-09-03T11:14:14.600Z',
  source: sourceFromFrame(textFrame),
  goal: 'stale'
});
staleAndDone.tasks[0].status = 'running';
staleAndDone.tasks[0].updatedAt = '2026-09-03T11:14:14.600Z';
await staleAndDone.create({
  id: 'task-just-done',
  status: 'completed',
  updatedAt: '2026-09-03T12:13:27.724Z',
  source: sourceFromFrame(textFrame),
  goal: 'done'
});
staleAndDone.tasks[1].status = 'completed';
staleAndDone.tasks[1].updatedAt = '2026-09-03T12:13:27.724Z';
const latestFollow = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'follow-latest-1',
    text: { content: '1、析影响范围并做最小收敛自测\n2、 Commit / 提 PR' }
  }
}, {
  manager: staleAndDone,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(latestFollow.action.type, 'continue');
assert.equal(latestFollow.action.task.id, 'task-just-done');

const groupFrame = {
  headers: { req_id: 'req-g' },
  body: {
    msgid: 'g1',
    aibotid: 'bot-1',
    chattype: 'group',
    chatid: 'chat-9',
    from: { userid: 'user-b' },
    msgtype: 'text',
    text: { content: '加上单测' }
  }
};
const groupManager = createFakeManager();
await groupManager.create({
  id: 'task-owner-a',
  status: 'running',
  updatedAt: '2026-09-03T12:00:00.000Z',
  source: { type: 'wecom', conversationId: 'chat-9', chattype: 'group', userId: 'user-a' },
  goal: 'A 的任务'
});
groupManager.tasks[0].status = 'running';
const groupSteal = await handleWeComMessage(groupFrame, {
  manager: groupManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.notEqual(groupSteal.action.type, 'continue');
assert.notEqual(groupSteal.action.task?.id, 'task-owner-a');

await groupManager.create({
  id: 'task-owner-b',
  status: 'running',
  updatedAt: '2026-09-03T12:10:00.000Z',
  source: { type: 'wecom', conversationId: 'chat-9', chattype: 'group', userId: 'user-b' },
  goal: 'B 的任务'
});
groupManager.tasks[1].status = 'running';
const groupOwn = await handleWeComMessage({
  ...groupFrame,
  body: { ...groupFrame.body, msgid: 'g2', text: { content: '加上单测' } }
}, {
  manager: groupManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(groupOwn.action.type, 'continue');
assert.equal(groupOwn.action.task.id, 'task-owner-b');

const groupHelpA = await handleWeComMessage({
  ...groupFrame,
  body: { ...groupFrame.body, msgid: 'g3', from: { userid: 'user-b' }, text: { content: '继续 task-owner-a：补测试' } }
}, {
  manager: groupManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(groupHelpA.action.type, 'continue');
assert.equal(groupHelpA.action.task.id, 'task-owner-a');

const groupPending = createPendingStore();
const groupAsk = await handleWeComMessage({
  ...groupFrame,
  body: { ...groupFrame.body, msgid: 'g4', from: { userid: 'user-a' }, text: { content: tapdPaste } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  pending: groupPending,
  workspaces: {
    list: () => [],
    hasConfigured: () => false,
    getActive: () => null
  },
  config: { root: tmp, repository: null },
  dedup: createMessageDedup()
});
assert.equal(groupAsk.action.type, 'need-workspace');
assert.equal(groupPending.get('chat-9'), null);
assert.equal(groupPending.get('chat-9::user-a')?.type, 'need-workspace');
const groupOtherPath = await handleWeComMessage({
  ...groupFrame,
  body: { ...groupFrame.body, msgid: 'g5', from: { userid: 'user-b' }, text: { content: '/tmp/other' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  pending: groupPending,
  workspaces: {
    list: () => [],
    hasConfigured: () => false,
    getActive: () => null,
    remember() {}
  },
  config: { root: tmp, repository: null },
  dedup: createMessageDedup()
});
assert.notEqual(groupOtherPath.action.type, 'created');
assert.equal(groupPending.get('chat-9::user-a')?.type, 'need-workspace');

const alreadyActiveReplies = [];
const alreadyActiveFailed = [];
const alreadyActiveManager = createFakeManager();
alreadyActiveManager.continue = async () => {
  throw new Error('task-already-active:task-open-1');
};
await alreadyActiveManager.create({
  id: 'task-open-1',
  status: 'running',
  source: sourceFromFrame(textFrame),
  goal: '旧任务'
});
alreadyActiveManager.tasks[0].status = 'running';
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'follow-active-1', text: { content: '加上单测' } }
}, {
  manager: alreadyActiveManager,
  replyAck: async (_frame, content) => { alreadyActiveReplies.push(content); },
  progress: {
    open() {},
    fail(_taskId, error) { alreadyActiveFailed.push(error); }
  },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
await delay(10);
assert.equal(alreadyActiveFailed.length, 0);
assert.match(alreadyActiveReplies[0], /继续/);

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

const pending = createPendingStore();
const askHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'ask-ws-1', text: { content: tapdPaste } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  pending,
  workspaces: {
    list: () => [],
    hasConfigured: () => false,
    getActive: () => null
  },
  config: { root: tmp, repository: null },
  dedup: createMessageDedup()
});
assert.equal(askHandled.action.type, 'need-workspace');
assert.equal(pending.get('user-a').type, 'need-workspace');

const chosen = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'ask-ws-2', text: { content: '本地' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  pending,
  workspaces: {
    list: () => [],
    hasConfigured: () => false,
    getActive: () => null,
    remember() {}
  },
  config: { root: tmp, repository: null },
  dedup: createMessageDedup()
});
assert.equal(chosen.action.type, 'created');
assert.equal(chosen.action.workspace.mode, 'local');

const store = createWorkspaceStore({
  root: tmp,
  workspaces: [
    { id: 'aafe', name: 'AAFE', cwd: tmp },
    { id: 'demo', name: 'Demo', repository: 'owner/demo' }
  ],
  currentWorkspace: 'aafe'
});
assert.equal(store.getActive().id, 'aafe');
assert.equal(store.switchTo('demo').repository, 'owner/demo');
assert.equal(parseWorkspaces([{ id: 'x', cwd: tmp }]).length, 1);

const cancelUpdates = [];
const cancelManager = createFakeManager();
await cancelManager.create({
  id: 'task-card-1',
  status: 'running',
  source: sourceFromFrame(textFrame)
});
cancelManager.tasks[0].status = 'running';
const cardHandled = await handleWeComCard({
  headers: { req_id: 'card-1' },
  body: {
    msgid: 'card-msg',
    chattype: 'single',
    from: { userid: 'user-a' },
    msgtype: 'event',
    event: { eventtype: 'template_card_event', event_key: 'cancel:task-card-1', task_id: 'run_task-card-1' }
  }
}, {
  manager: cancelManager,
  sendText: async () => {},
  updateCard: async (_frame, card) => { cancelUpdates.push(card); },
  progress: { fail() {} }
});
assert.equal(cardHandled.action.type, 'cancelled');
assert.equal(cancelManager.tasks[0].status, 'cancelled');
assert.equal(cancelUpdates[0].main_title.title, '任务已终止');
assert.equal(cancelUpdates[0].task_id, 'run_task-card-1');

// WeCom nests the click payload under `template_card_event`.
const nestedClick = {
  headers: { req_id: 'card-2' },
  body: {
    msgid: 'card-msg-2',
    chattype: 'single',
    from: { userid: 'user-a' },
    msgtype: 'event',
    event: {
      eventtype: 'template_card_event',
      template_card_event: {
        card_type: 'button_interaction',
        event_key: 'ws:local',
        task_id: 'ws_pick-mtmcduhityys1r'
      }
    }
  }
};
assert.deepEqual(parseCardEvent(nestedClick), {
  action: 'ws',
  value: 'local',
  cardTaskId: 'ws_pick-mtmcduhityys1r'
});

const wsPushed = [];
const wsUpdates = [];
const wsStarted = [];
const wsManager = createFakeManager({ onStart(id) { wsStarted.push(id); } });
const wsPending = createPendingStore();
wsPending.set('user-a', { type: 'need-workspace', requirement: '修复复制按钮', source: sourceFromFrame(textFrame) });
const wsHandled = await handleWeComCard(nestedClick, {
  manager: wsManager,
  sendText: async (content) => { wsPushed.push(content); },
  updateCard: async (_frame, card) => { wsUpdates.push(card); },
  progress: { open() { throw new Error('card clicks cannot open a stream'); }, fail() {} },
  pending: wsPending,
  config: { root: tmp, repository: 'owner/repo', baseBranch: 'main' }
});
assert.equal(wsHandled.action.type, 'created');
assert.equal(wsUpdates.length, 1);
// A card-event req_id only accepts the card update, so text is pushed instead.
assert.equal(wsPushed.length, 1);
assert.match(wsPushed[0], /对话 ID：`task-/);
await delay(10);
assert.deepEqual(wsStarted, [wsHandled.action.task.id]);

// The picker card sends `local` for 当前目录, which is no store entry.
const switched = await resolveWeComAction({ type: 'workspace-switch', target: 'local' }, {
  source: sourceFromFrame(textFrame),
  botRoot: tmp,
  workspaces: [],
  switchWorkspace: () => null
}, createFakeManager());
assert.equal(switched.type, 'workspace-switched');
assert.equal(switched.workspace.cwd, tmp);
assert.equal(classifyWorkspaceTarget('local', tmp).kind, 'local');
assert.equal(
  (await resolveWeComAction({ type: 'workspace-switch', target: '不存在的仓库' }, {
    source: sourceFromFrame(textFrame),
    botRoot: tmp,
    workspaces: [],
    switchWorkspace: () => null
  }, createFakeManager())).type,
  'error'
);

// A rejected card update is cosmetic and must not abort the task it created.
const wsPending2 = createPendingStore();
wsPending2.set('user-a', { type: 'need-workspace', requirement: '再修一次', source: sourceFromFrame(textFrame) });
const degradedPushed = [];
const degraded = await handleWeComCard(nestedClick, {
  manager: createFakeManager(),
  sendText: async (content) => { degradedPushed.push(content); },
  updateCard: async () => { throw { errcode: 846605, errmsg: 'invalid req_id' }; },
  pending: wsPending2,
  config: { root: tmp, repository: 'owner/repo', baseBranch: 'main' },
  logger: { error() {}, warn() {}, event() {} }
});
assert.equal(degraded.action.type, 'created');
assert.equal(degradedPushed.length, 1);

// An unparsed card event must not answer with a stream reply.
const unknownCard = await handleWeComCard({
  headers: { req_id: 'card-3' },
  body: {
    msgid: 'card-msg-3',
    chattype: 'single',
    from: { userid: 'user-a' },
    msgtype: 'event',
    event: { eventtype: 'template_card_event', template_card_event: { card_type: 'button_interaction' } }
  }
}, {
  manager: wsManager,
  sendText: async () => { throw new Error('must not reply to an unknown card event'); },
  updateCard: async () => { throw new Error('must not update an unknown card event'); },
  logger: { warn() {}, event() {} }
});
assert.equal(unknownCard.skipped, true);
assert.equal(unknownCard.reason, 'unknown-card-event');

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
assert.match(formatTaskNotify(notifyTask), /对话 ID：`task-done`$/);
// A retry that succeeded must not report the previous attempt's error.
assert.equal(
  formatTaskNotify({ ...notifyTask, error: 'cursor-agent-open-failed:Agent x not found' })
    .includes('错误'),
  false
);
assert.match(
  formatTaskNotify({ ...notifyTask, status: 'failed', error: 'boom' }),
  /错误：boom/
);
assert.equal(formatTaskFooter('task-1'), '对话 ID：`task-1`');
assert.equal(formatTaskFooter('task-1', { running: true }), '对话 ID：`task-1`\n终止：发送 `终止 task-1`');
assert.equal(formatTaskFooter(null), '');
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

assert.equal(formatProgressEvent({ type: 'cursor.run.started' }).kind, 'status');
assert.match(formatProgressEvent({ type: 'cursor.run.started' }).text, /Agent 输出中/);
assert.equal(formatProgressEvent({
  type: 'cursor.message',
  payload: { type: 'tool_call', message: { toolCall: { name: 'Read', input: { path: 'src/a.js' } } } }
}).kind, 'tool');
assert.equal(formatProgressEvent({
  type: 'cursor.message',
  payload: { type: 'tool_call', message: { toolCall: { name: 'Read', input: { path: 'src/a.js' } } } }
}).tools[0].detail, 'src/a.js');
assert.equal(formatProgressEvent({
  type: 'cursor.message',
  payload: { type: 'assistant', text: '正在看复制按钮' }
}).kind, 'assistant');
assert.match(renderProgressView({
  header: '**t1**',
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] },
    { kind: 'assistant', text: '正在看复制按钮' }
  ]
}), /正在看复制按钮/);
assert.match(renderProgressView({
  header: '**t1**',
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] }
  ]
}), /Read/);
const collapsed = renderProgressView({
  header: '**t1**',
  transcript: [
    ...Array.from({ length: 8 }, (_, index) => ({
      kind: 'tool',
      tools: [{ name: 'Read', detail: `src/f${index}.js` }]
    })),
    { kind: 'assistant', text: '这一段过程草稿不应整段铺在过程里' }
  ]
});
assert.match(collapsed, /另有 3 步已收起/);
assert.match(collapsed, /src\/f7\.js/);
assert.equal(collapsed.includes('src/f0.js'), false);
assert.match(collapsed, /\*\*正在\*\*/);
assert.equal(collapsed.includes('**结果**'), false);
const finishedView = renderProgressView({
  header: '**t1**',
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] },
    { kind: 'assistant', text: '复制按钮已修好。' }
  ],
  footer: '任务 **t1** 已完成',
  finished: true
});
assert.match(finishedView, /\*\*结果\*\*/);
assert.match(finishedView, /复制按钮已修好/);
assert.match(finishedView, /已完成/);
assert.equal(finishedView.includes('**正在**'), false);
// The title dances while the task runs and stops once the stream is finished.
assert.equal(finishedView.includes('🐧'), false);
const danceTitles = [0, 1, 2, 3, 4].map((tick) => renderProgressView({
  header: '**t1** 继续\n补充内容',
  transcript: [],
  tick
}).split('\n')[0]);
assert.equal(danceTitles[0], `**t1** 继续 ${danceFrame(0)}`);
assert.equal(danceTitles[1], `**t1** 继续 ${danceFrame(1)}`);
assert.equal(danceTitles[2], `**t1** 继续 ${danceFrame(2)}`);
assert.equal(danceTitles[4], danceTitles[0]);
assert.notEqual(danceTitles[0], danceTitles[1]);
assert.notEqual(danceTitles[1], danceTitles[2]);
assert.equal(new Set([0, 1, 2, 3].map((tick) => danceFrame(tick))).size, 3);
assert.match(renderProgressView({ header: '**t1**', transcript: [], tick: 1 }), /🐧/);
// Terminating and the copyable id sit at the bottom of the running box.
const runningBox = renderProgressView({
  header: '**task-live** 继续',
  transcript: [{ kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] }],
  taskId: 'task-live'
});
assert.match(runningBox, /终止：发送 `终止 task-live`$/);
assert.match(runningBox, /对话 ID：`task-live`/);
assert.equal(
  renderProgressView({
    header: '**task-live**',
    transcript: [{ kind: 'assistant', text: '好了' }],
    footer: formatTaskNotify({ id: 'task-live', status: 'completed', requirement: '需求' }),
    finished: true,
    taskId: 'task-live'
  }).includes('终止：发送'),
  false
);

const streamUpdates = [];
const hub = createWeComProgressHub({
  replyProgress: async (_frame, streamId, content, finish) => {
    streamUpdates.push({ streamId, content, finish });
  },
  now: () => 1_780_000_000_000,
  heartbeatMs: 60_000
});
hub.open({
  taskId: 'task-live',
  frame: textFrame,
  streamId: 'stream-live',
  header: '已创建任务 **task-live**'
});
await hub.handle({ type: 'cursor.run.started', taskId: 'task-live' });
assert.equal(streamUpdates.at(-1).finish, false);
assert.match(streamUpdates.at(-1).content, /Agent 输出中/);
await hub.handle({
  type: 'cursor.message',
  taskId: 'task-live',
  payload: { type: 'assistant', text: '先看复制按钮的点击处理。' }
});
assert.match(streamUpdates.at(-1).content, /先看复制按钮/);
await hub.handle({
  type: 'cursor.message',
  taskId: 'task-live',
  payload: {
    type: 'tool_call',
    tools: [{ name: 'Read', detail: 'src/copy.js' }]
  }
});
assert.match(streamUpdates.at(-1).content, /src\/copy\.js/);
assert.match(streamUpdates.at(-1).content, /🐧/);
assert.notEqual(
  streamUpdates.at(-1).content.split('\n')[0],
  streamUpdates.at(-2).content.split('\n')[0]
);

// A silent Agent still animates, driven by the hub's own cadence.
let danceClock = 1_780_000_000_000;
const danceUpdates = [];
const danceHub = createWeComProgressHub({
  replyProgress: async (_frame, _streamId, content, finish) => {
    danceUpdates.push({ content, finish });
  },
  now: () => danceClock,
  heartbeatMs: 60_000,
  danceMs: 2_000
});
danceHub.open({
  taskId: 'task-dance',
  frame: textFrame,
  streamId: 'stream-dance',
  header: '**task-dance** 继续'
});
await danceHub.handle({ type: 'cursor.run.started', taskId: 'task-dance' });
const beforeDance = danceUpdates.at(-1).content.split('\n')[0];
await danceHub.tick();
assert.equal(danceUpdates.length, 1, '心跳窗口内不重复刷新');
danceClock += 2_000;
await danceHub.tick();
assert.equal(danceUpdates.length, 2);
assert.notEqual(danceUpdates.at(-1).content.split('\n')[0], beforeDance);
await danceHub.cancel('task-dance');
assert.equal(danceUpdates.at(-1).finish, true);
assert.equal(danceUpdates.at(-1).content.includes('🐧'), false);
danceClock += 10_000;
await danceHub.tick();
assert.equal(danceUpdates.length, 3, '结束后不再动画');
await danceHub.close();

const streamedFinish = [];
attachWeComNotifier({
  manager: {
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
    async get() { return notifyTask; }
  },
  sendMessage: async (chatid, body) => { streamedFinish.push({ chatid, body }); },
  progress: hub
});
await listeners.at(-1)({
  type: 'task.finished',
  taskId: 'task-live',
  status: 'completed',
  task: { ...notifyTask, id: 'task-live' }
});
assert.equal(streamUpdates.at(-1).finish, true);
assert.match(streamUpdates.at(-1).content, /已完成/);
assert.equal(streamedFinish.length, 0);
await hub.close();

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
  async replyStreamWithCard() { this.combo = true; }
  async replyTemplateCard(frame, card) { this.card = { frame, card }; }
  async sendMessage(chatid, body) { this.sent = { chatid, body }; }
  async downloadFile(url, aeskey) {
    this.downloaded = { url, aeskey };
    return { buffer: Buffer.from('png'), filename: 'shot.png' };
  }
  async uploadMedia(buffer, options) {
    this.uploaded = { bytes: buffer.length, options };
    return { media_id: 'media-1', type: options.type };
  }
  async replyMedia(frame, mediaType, mediaId) {
    this.repliedMedia = { frame, mediaType, mediaId };
  }
  async sendMediaMessage(chatid, mediaType, mediaId) {
    this.sentMedia = { chatid, mediaType, mediaId };
  }
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
assert.equal(gateway.client.combo, undefined);
await gateway.replyCard({
  headers: { req_id: 'r1' },
  body: { chattype: 'single', from: { userid: 'user-a' } }
}, buildCancelledCard('t1'));
assert.equal(gateway.client.card.card.main_title.desc, 't1');
gateway.client.handlers.get('event')({ body: { event: { eventtype: 'disconnected_event' } } });
assert.equal(gateway.kicked, true);

assert.deepEqual(parseWeComArgs(['--root=/tmp/app', '--config=/tmp/wecom.local.json', '--no-recover']), {
  probes: [],
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
    agent: { mcp: { enabled: false } },
    models: resolveWeComModelConfig({
      local: { models: { rules: [{ id: 'ghost', model: 'gpt-9-turbo', match: 'x' }] } }
    })
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
  mcpServers: {},
  listModels: async () => ['grok-4.6', 'gemini-3.8-flash'],
  env: {}
});
// Boot checks model names once: a rule naming a model the account cannot run
// is dropped here instead of failing when a task starts.
assert.equal(startedBot.models.list().some((rule) => rule.id === 'ghost'), false);
assert.equal(startedBot.models.model({ stage: 'intent', text: 'x' }), 'gemini-3.8-flash');
assert.deepEqual(recovered, ['ok']);
assert.equal(startedBot.gateway.client.connected, true);
await startedBot.shutdown('test');
assert.deepEqual(recovered, ['ok', 'closed']);

assert.equal(resolveWeComLogConfig({ env: {}, local: {} }).enabled, false);
assert.equal(resolveWeComLogConfig({ env: { WECOM_LOG: '1' }, local: { log: { enabled: false } } }).enabled, true);
assert.equal(resolveWeComLogConfig({ env: { WECOM_LOG: '0' }, local: { log: { enabled: true } } }).enabled, false);
assert.equal(sanitizeLogValue({ secret: 'x', apiKey: 'y', text: 'ok' }).secret, '[redacted]');
assert.equal(sanitizeLogValue({ secret: 'x', apiKey: 'y', text: 'ok' }).apiKey, '[redacted]');
assert.equal(sanitizeLogValue({ secret: 'x', apiKey: 'y', text: 'ok' }).text, 'ok');

const logRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-log-'));
const enabledDir = path.join(logRoot, 'on');
const disabledDir = path.join(logRoot, 'off');
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const fileLogger = createWeComLogger({
  enabled: true,
  dir: enabledDir,
  sink: silent,
  now: () => new Date(2026, 8, 3, 12)
});
fileLogger.info('hello');
fileLogger.event('message.in', { msgid: 'm1', secret: 'hidden' });
await fileLogger.flush();
const logText = await readFile(path.join(enabledDir, 'wecom-2026-09-03.jsonl'), 'utf8');
const rows = logText.trim().split('\n').map((line) => JSON.parse(line));
assert.equal(rows[0].event, 'console');
assert.equal(rows[0].payload.message, 'hello');
assert.equal(rows[1].event, 'message.in');
assert.equal(rows[1].payload.msgid, 'm1');
assert.equal(rows[1].payload.secret, '[redacted]');

const offLogger = createWeComLogger({ enabled: false, dir: disabledDir, sink: silent });
offLogger.info('should-not-write');
offLogger.event('message.in', { msgid: 'm2' });
await offLogger.flush();
await assert.rejects(() => access(disabledDir), /ENOENT/);

const envLog = await loadWeComBotConfig({
  root: tmp,
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret', WECOM_LOG: '1', WECOM_LOG_DIR: enabledDir }
});
assert.equal(envLog.log.enabled, true);
assert.equal(envLog.log.dir, enabledDir);

const captured = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'log-1', text: { content: '你好' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-log',
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  logger: { event: (name, data) => captured.push({ name, data }), error() {} }
});
assert.equal(captured[0].name, 'message.in');
assert.equal(captured.at(-1).name, 'message.out');
assert.equal(captured.at(-1).data.command, 'help');

assert.equal(parseWeComMedia({
  body: { msgtype: 'voice', voice: { content: '做：增加搜索' } }
}).text, '做：增加搜索');
assert.equal(parseWeComMedia({
  body: { msgtype: 'image', image: { url: 'https://x', aeskey: 'k' } }
}).assets[0].aeskey, 'k');
assert.equal(parseWeComMedia({
  body: {
    msgtype: 'mixed',
    mixed: {
      msg_item: [
        { msgtype: 'text', text: { content: '@机器人 看图' } },
        { msgtype: 'image', image: { url: 'https://img', aeskey: 'ik' } }
      ]
    }
  }
}).text.includes('看图'), true);
assert.equal(inferMediaType('a.png'), 'image');
assert.match(mediaRequirement({ type: 'image', text: '' }, [{ filename: 'a.png', path: '/tmp/a.png' }]), /图片/);

const imageReplies = [];
const imageHandled = await handleWeComMedia({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'img-1',
    msgtype: 'image',
    image: { url: 'https://img', aeskey: 'aes-1' }
  }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { imageReplies.push(content); return 'stream-img'; },
  config: { root: tmp, repository: 'owner/repo', baseBranch: 'main' },
  dedup: createMessageDedup(),
  downloadFile: async (url, aeskey) => {
    assert.equal(url, 'https://img');
    assert.equal(aeskey, 'aes-1');
    return { buffer: Buffer.from('png-bytes'), filename: 'bug.png' };
  }
});
assert.equal(imageHandled.action.type, 'created');
assert.match(imageHandled.action.task.requirement, /bug\.png/);
assert.equal(imageHandled.action.task.context?.attachments?.[0]?.filename, 'bug.png');
assert.match(imageReplies[0], /bug\.png/);

const voiceHandled = await handleWeComMedia({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'voice-1',
    msgtype: 'voice',
    voice: { content: '做：增加搜索' }
  }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-voice',
  config: { root: tmp, repository: 'owner/repo' },
  dedup: createMessageDedup(),
  downloadFile: async () => { throw new Error('voice-should-not-download'); }
});
assert.equal(voiceHandled.action.type, 'created');
assert.equal(voiceHandled.action.task.requirement, '增加搜索');

await gateway.replyMedia({ headers: { req_id: 'r2' } }, 'image', 'media-1');
assert.equal(gateway.client.repliedMedia.mediaType, 'image');
const uploaded = await gateway.uploadMedia(Buffer.from('x'), { type: 'file', filename: 'a.txt' });
assert.equal(uploaded.media_id, 'media-1');
await gateway.sendMedia('user-a', 'file', 'media-1');
assert.equal(gateway.client.sentMedia.mediaType, 'file');

assert.equal(classifyIntentByRules('帮我修一下登录按钮点击没反应').kind, 'code');
assert.equal(classifyIntentByRules('帮我修一下登录按钮点击没反应').needsCode, true);
assert.equal(classifyIntentByRules('分析一下这次变更的影响面').kind, 'analysis');
assert.equal(classifyIntentByRules('分析一下这次变更的影响面').needsCode, false);
assert.equal(classifyIntentByRules('composer 是什么意思').kind, 'question');
assert.equal(classifyIntentByRules('再加上一个开关', { hasOpenTask: true }).kind, 'followup');
// The same words without an open task are a fresh request, not a follow-up.
assert.notEqual(classifyIntentByRules('再加上一个开关').kind, 'followup');
// Unclassifiable text keeps the old behaviour of asking for a repository.
assert.equal(classifyIntentByRules('xyzzy').needsCode, true);

assert.deepEqual(
  parseIntent('```json\n{"kind":"analysis","needs_code":false,"summary":"看影响面","confidence":0.9}\n```'),
  {
    kind: 'analysis',
    label: '分析排查',
    needsCode: false,
    summary: '看影响面',
    confidence: 0.9,
    source: 'llm'
  }
);
assert.equal(parseIntent('看不出来是什么'), null);
assert.equal(parseIntent('{"kind":"nope"}'), null);
assert.equal(parseIntent('{"kind":"code","summary":"改按钮","confidence":1}').needsCode, true);
assert.equal(parseIntent('{"kind":"code","confidence":9}').confidence, 1);

const httpAnalyzer = createIntentAnalyzer({
  settings: { endpoint: 'https://llm.example/v1/chat/completions', model: 'fast-1' },
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: '{"kind":"analysis","needs_code":false,"summary":"排查耗时","confidence":0.8}'
        }
      }]
    })
  })
});
assert.equal(httpAnalyzer.backend, 'llm');
// AMBIGUOUS has no leading verb and no TAPD marker, so only a model can label it.
const AMBIGUOUS = '登录页按钮颜色需要改成品牌色';
const httpIntent = await httpAnalyzer.analyze({ text: AMBIGUOUS });
assert.equal(httpIntent.kind, 'analysis');
assert.equal(httpIntent.source, 'llm');
assert.equal(httpIntent.summary, '排查耗时');

// A backend failure must not stop the turn: the rules answer instead.
const brokenAnalyzer = createIntentAnalyzer({
  settings: { endpoint: 'https://llm.example/v1/chat/completions', model: 'fast-1' },
  fetchImpl: async () => { throw new Error('boom'); },
  logger: { warn() {} }
});
const brokenIntent = await brokenAnalyzer.analyze({ text: AMBIGUOUS });
assert.equal(brokenIntent.source, 'rules');
assert.equal(brokenIntent.kind, 'code');
assert.match(brokenIntent.reason, /boom/);

// With no endpoint the Cursor key drives one read-only prompt in the workspace.
const cursorCalls = [];
const cursorAnalyzer = createIntentAnalyzer({
  settings: { cursorApiKey: 'crsr_x', cursorModel: 'grok-4.6' },
  cwd: '/tmp/repo',
  importSdk: async () => ({
    Agent: {
      async prompt(message, options) {
        cursorCalls.push({ message, options });
        return {
          status: 'finished',
          result: '好的\n{"kind":"code","needs_code":true,"summary":"修按钮","confidence":0.95}'
        };
      }
    }
  })
});
assert.equal(cursorAnalyzer.backend, 'cursor');
const cursorIntent = await cursorAnalyzer.analyze({ text: AMBIGUOUS });
assert.equal(cursorIntent.kind, 'code');
assert.equal(cursorIntent.source, 'cursor');
assert.equal(cursorCalls[0].options.mode, 'plan');
assert.deepEqual(cursorCalls[0].options.local, { cwd: '/tmp/repo' });
assert.deepEqual(cursorCalls[0].options.model, { id: 'grok-4.6' });

const timedOutAnalyzer = createIntentAnalyzer({
  settings: { cursorApiKey: 'crsr_x', timeoutMs: 20 },
  importSdk: async () => ({ Agent: { prompt: () => delay(200).then(() => ({ result: '{}' })) } }),
  logger: { warn() {} }
});
const timedOut = await timedOutAnalyzer.analyze({ text: AMBIGUOUS });
assert.equal(timedOut.source, 'rules');
assert.match(timedOut.reason, /intent-timeout/);

assert.equal(createIntentAnalyzer({ settings: { enabled: false, cursorApiKey: 'crsr_x' } }).backend, 'rules');
assert.equal(createIntentAnalyzer({ settings: {} }).backend, 'rules');

const intentConfig = resolveWeComIntentConfig({
  env: { AAFE_WECOM_INTENT_TIMEOUT_MS: '9000' },
  local: { intent: { endpoint: 'https://llm.example/v1/chat/completions', model: 'fast-1' } },
  apiKey: 'crsr_x'
});
assert.equal(intentConfig.enabled, true);
assert.equal(intentConfig.timeoutMs, 9000);
assert.equal(intentConfig.cursorApiKey, 'crsr_x');
// Unset by design: the `intent` stage rule picks the classifier model, and
// this field is the escape hatch that overrides it.
assert.equal(intentConfig.cursorModel, null);
assert.equal(
  resolveWeComIntentConfig({ env: { AAFE_WECOM_INTENT_CURSOR_MODEL: 'gpt-5.4-mini' } }).cursorModel,
  'gpt-5.4-mini'
);
assert.equal(resolveWeComIntentConfig({ env: { AAFE_WECOM_INTENT_ENABLED: 'false' } }).enabled, false);

// The fast path answers without a model wherever the signal is unmistakable.
let modelCalls = 0;
const countingAnalyzer = createIntentAnalyzer({
  settings: { cursorApiKey: 'crsr_x' },
  importSdk: async () => ({
    Agent: {
      async prompt() {
        modelCalls += 1;
        return { status: 'finished', result: '{"kind":"code","needs_code":true,"confidence":0.9}' };
      }
    }
  })
});
const tapdPasteIntent = await countingAnalyzer.analyze({
  text: '【日志检索结果复制按钮失效，点击后没有复制到内容】\nhttps://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137887277'
});
assert.equal(tapdPasteIntent.source, 'rules-fast');
assert.equal(tapdPasteIntent.kind, 'code');
assert.equal((await countingAnalyzer.analyze({ text: '帮我修一下登录按钮' })).source, 'rules-fast');
assert.equal((await countingAnalyzer.analyze({ text: '分析一下这次变更的影响面' })).kind, 'analysis');
assert.equal((await countingAnalyzer.analyze({ text: 'composer 是什么意思' })).kind, 'question');
// Real traffic: an addendum to the one open task never needed a model either.
const addendum = await countingAnalyzer.analyze({
  text: '1、析影响范围并做最小收敛自测\n2、 Commit / 提 PR',
  hasOpenTask: true
});
assert.equal(addendum.kind, 'followup');
assert.equal(addendum.source, 'rules-fast');
assert.equal(modelCalls, 0);
// Only genuinely ambiguous new work is worth the wait.
assert.equal((await countingAnalyzer.analyze({ text: AMBIGUOUS })).source, 'cursor');
assert.equal(modelCalls, 1);
assert.equal(fastIntent(AMBIGUOUS), null);
// A leading verb decides new work even while a task is open.
assert.equal(fastIntent('帮我修一下另一个 bug', { hasOpenTask: true }).kind, 'code');

const stageReplies = [];
const stageUpdates = [];
const analysisHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-1', text: { content: '分析一下这个 bot 的重连逻辑' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { stageReplies.push(content); return 'stream-intent'; },
  replyProgress: async (_frame, streamId, content, finish, extra) => {
    stageUpdates.push({ streamId, content, finish, blocking: extra?.blocking });
  },
  progress: { open() {} },
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  understanding: {
    async analyze() {
      return {
        kind: 'analysis',
        label: '分析排查',
        needsCode: false,
        summary: '看重连逻辑',
        confidence: 0.9,
        source: 'rules-fast'
      };
    }
  }
});
// An instant classification skips the announcement: two frames in the same
// millisecond would only flash something unreadable.
assert.equal(stageReplies.length, 1);
assert.match(stageReplies[0], /这是一个\*\*分析排查\*\*任务，正在进一步解析中…/);
assert.match(stageReplies[0], /看重连逻辑/);
// Analysis touches no repository, so it runs in the bot directory right away.
assert.equal(analysisHandled.action.type, 'created');
assert.equal(analysisHandled.action.task.workspace.cwd, path.resolve('/bot/root'));
assert.equal(analysisHandled.intent.kind, 'analysis');
assert.equal(stageUpdates[0].streamId, 'stream-intent');
assert.match(stageUpdates[0].content, /分析排查/);
// The stage the user must see cannot be dropped by the non-blocking path.
assert.equal(stageUpdates[0].blocking, true);

// A classification that has to wait announces itself first.
const slowStageReplies = [];
const slowStageUpdates = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-slow', text: { content: '登录页按钮颜色需要改成品牌色' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { slowStageReplies.push(content); return 'stream-slow'; },
  replyProgress: async (_frame, _streamId, content) => { slowStageUpdates.push(content); },
  progress: { open() {} },
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  intentAckGraceMs: 5,
  understanding: {
    async analyze() {
      await delay(40);
      return {
        kind: 'analysis',
        label: '分析排查',
        needsCode: false,
        summary: '看按钮改色',
        confidence: 0.9,
        source: 'llm'
      };
    }
  }
});
assert.equal(slowStageReplies[0], '正在理解分析中…');
assert.match(slowStageUpdates[0], /这是一个\*\*分析排查\*\*任务/);

// A classifier that throws must not cost the turn.
const crashStageReplies = [];
const crashHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-crash', text: { content: '登录页按钮颜色需要改成品牌色' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { crashStageReplies.push(content); return 'stream-crash'; },
  replyProgress: async () => {},
  progress: { open() {} },
  config: { root: '/bot/root', repository: 'owner/repo' },
  dedup: createMessageDedup(),
  logger: { error() {}, event() {} },
  understanding: { async analyze() { throw new Error('classifier down'); } }
});
assert.equal(crashHandled.action.type, 'created');
assert.equal(crashHandled.intent, null);
assert.equal(crashStageReplies.length, 1);

const codeStageReplies = [];
const codeStageUpdates = [];
const intentPending = createPendingStore();
const codeHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-2', text: { content: '把日志检索的复制按钮修好' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { codeStageReplies.push(content); return 'stream-code'; },
  replyProgress: async (_frame, _streamId, content) => { codeStageUpdates.push(content); },
  pending: intentPending,
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  understanding: {
    async analyze() {
      return {
        kind: 'code',
        label: '代码开发',
        needsCode: true,
        summary: '修复制按钮',
        confidence: 0.95,
        source: 'llm'
      };
    }
  }
});
// Analysis that wants to read a repository still runs in the bot directory
// instead of spending a turn on a question.
const readingAnalysis = await resolveWeComAction({
  type: 'create',
  requirement: '分析一下断线重连',
  intent: { kind: 'analysis', label: '分析排查', needsCode: true, confidence: 0.9 }
}, {
  source: { type: 'wecom', conversationId: 'user-a' },
  botRoot: '/bot/root',
  requireWorkspace: true,
  workspaces: []
}, createFakeManager());
assert.equal(readingAnalysis.action ?? readingAnalysis.type, 'created');
assert.equal(readingAnalysis.task.workspace.cwd, path.resolve('/bot/root'));

assert.equal(codeHandled.action.type, 'need-workspace');
assert.match(codeStageReplies[0], /代码开发/);
assert.match(codeStageUpdates[0], /需要先选定仓库/);
assert.equal(intentPending.get('user-a').intent.kind, 'code');

// Answering the repository question must not spend another classification.
const chosenAfterIntent = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-3', text: { content: '本地' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-code-2',
  pending: intentPending,
  progress: { open() {} },
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  understanding: {
    async analyze() { throw new Error('pending answers must skip classification'); }
  }
});
assert.equal(chosenAfterIntent.action.type, 'created');
assert.equal(chosenAfterIntent.action.task.context.intent.kind, 'code');
assert.match(chosenAfterIntent.reply, /代码开发/);

// Control words keep the regex fast path so a stop stays instant.
let classifications = 0;
const controlReplies = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'intent-4', text: { content: '列表' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { controlReplies.push(content); return 'stream-list'; },
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  understanding: {
    async analyze() { classifications += 1; return classifyIntentByRules('列表'); }
  }
});
assert.equal(classifications, 0);
assert.equal(controlReplies.length, 1);

const modelReplies = [];
const router = createModelRouter({ logger: { error() {} } });
// Requirement 1: classification always takes the fast model.
assert.equal(router.model({ stage: 'intent', text: '随便什么文本' }), 'gemini-3.8-flash');
// Requirement 2: code work and anything architectural takes the reasoning model.
assert.equal(router.select({ stage: 'task', intent: { kind: 'code' }, text: '修按钮' }).ruleId, 'code-work');
assert.equal(router.model({ stage: 'task', intent: { kind: 'code' }, text: '修按钮' }), 'grok-4.6');
assert.equal(router.model({ stage: 'task', intent: { kind: 'analysis' }, text: '看看重连日志' }), 'gemini-3.8-flash');
// Order is priority: architecture beats the plain analysis rule.
const architectural = router.select({ stage: 'task', intent: { kind: 'analysis' }, text: '分析一下整体架构分层' });
assert.equal(architectural.ruleId, 'complex-code');
assert.equal(architectural.model, 'grok-4.6');
assert.equal(router.select({ stage: 'task', intent: null, text: '' }).ruleId, 'fallback');
// An intent-stage rule never answers a task-stage question and vice versa.
assert.notEqual(router.select({ stage: 'task', intent: { kind: 'code' }, text: 'x' }).ruleId, 'intent-classify');

// Requirement 3: a project rule is the same shape and wins over the built-ins.
const custom = validateModelRules([
  { id: 'ui-polish', model: 'claude-sonnet-5', match: '样式|css|文案', note: '轻量 UI 改动' }
]);
assert.equal(custom.ok, true);
const customRouter = createModelRouter({
  rules: mergeModelRules(custom.rules),
  logger: { error() {} }
});
assert.equal(customRouter.model({ stage: 'task', intent: { kind: 'code' }, text: '改一下按钮样式' }), 'claude-sonnet-5');
assert.equal(customRouter.model({ stage: 'task', intent: { kind: 'code' }, text: '修登录逻辑' }), 'grok-4.6');
// Reusing a built-in id replaces it in place rather than leaving both.
const replaced = mergeModelRules(validateModelRules([
  { id: 'code-work', model: 'claude-opus-5', intent: ['code'] }
]).rules);
assert.equal(replaced.filter((rule) => rule.id === 'code-work').length, 1);
assert.equal(createModelRouter({ rules: replaced, logger: { error() {} } })
  .model({ stage: 'task', intent: { kind: 'code' }, text: '修登录' }), 'claude-opus-5');

// New rules are validated before they are trusted.
const bad = validateModelRules([
  { id: 'no-model', match: 'x' },
  { model: 'grok-4.6' },
  { id: 'bad-regex', model: 'grok-4.6', match: '([' },
  { id: 'bad-intent', model: 'grok-4.6', intent: ['refactor'] },
  { id: 'bad-stage', model: 'grok-4.6', stage: 'plan' },
  { id: 'bad-conf', model: 'grok-4.6', minConfidence: 3 },
  { id: 'dupe', model: 'grok-4.6' },
  { id: 'dupe', model: 'grok-4.6' }
]);
assert.equal(bad.ok, false);
assert.equal(bad.rules.length, 1);
assert.equal(bad.errors.length, 7);
assert.match(bad.errors.join('\n'), /缺少 model/);
assert.match(bad.errors.join('\n'), /不是合法正则/);
assert.match(bad.errors.join('\n'), /未知 intent：refactor/);
assert.match(bad.errors.join('\n'), /stage 只能是/);
assert.match(bad.errors.join('\n'), /minConfidence/);
assert.match(bad.errors.join('\n'), /id 重复/);
assert.equal(validateModelRules('nope').ok, false);
// The online check rejects a model the account cannot run.
assert.equal(validateModelRules([{ id: 'x', model: 'gpt-9' }], { models: ['grok-4.6'] }).ok, false);
assert.equal(validateModelRules([{ id: 'x', model: 'grok-4.6' }], { models: ['grok-4.6'] }).ok, true);
// An invalid rule is dropped, never fatal: the router still routes.
const droppedErrors = [];
const resilient = createModelRouter({
  rules: [{ id: 'broken', model: 'grok-4.6', match: '([' }, ...DEFAULT_MODEL_RULES],
  logger: { error: (message) => droppedErrors.push(message) }
});
assert.equal(droppedErrors.length, 1);
assert.equal(resilient.model({ stage: 'intent', text: 'x' }), 'gemini-3.8-flash');

const modelConfig = resolveWeComModelConfig({
  local: { models: { default: 'claude-opus-5', rules: [{ id: 'mine', model: 'grok-4.5', match: 'x' }] } }
});
assert.equal(modelConfig.default, 'claude-opus-5');
assert.equal(modelConfig.rules[0].id, 'mine');
assert.equal(modelConfig.rules.length, DEFAULT_MODEL_RULES.length + 1);
assert.deepEqual(modelConfig.configErrors, []);
assert.equal(resolveWeComModelConfig({ local: { models: { rules: [{ model: 'x' }] } } }).configErrors.length, 1);
assert.equal(resolveWeComModelConfig({ env: { AAFE_WECOM_MODEL_DEFAULT: 'gpt-5.6-sol' } }).default, 'gpt-5.6-sol');

// The routed model is pinned on the task so every later run reuses it.
const modelRouted = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'model-1', text: { content: '分析一下这个 bot 的重连逻辑' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { modelReplies.push(content); return 'stream-model'; },
  replyProgress: async (_frame, _streamId, content) => { modelReplies.push(content); },
  progress: { open() {} },
  config: { root: '/bot/root' },
  dedup: createMessageDedup(),
  models: router,
  understanding: {
    async analyze() {
      return { kind: 'analysis', label: '分析排查', needsCode: false, summary: '看重连', confidence: 0.9, source: 'rules-fast' };
    }
  }
});
assert.equal(modelRouted.action.task.model, 'gemini-3.8-flash');
assert.equal(modelRouted.action.model.ruleId, 'simple-analysis');
// The user can see which model the task got.
assert.match(modelReplies.join('\n'), /gemini-3\.8-flash/);

const codeRouted = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'model-2', text: { content: '重构一下检索模块的分层架构' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-model-2',
  replyProgress: async () => {},
  progress: { open() {} },
  config: { root: '/bot/root', repository: 'owner/repo' },
  dedup: createMessageDedup(),
  models: router,
  understanding: {
    async analyze() {
      return { kind: 'code', label: '代码开发', needsCode: true, summary: '重构分层', confidence: 0.95, source: 'llm' };
    }
  }
});
assert.equal(codeRouted.action.task.model, 'grok-4.6');
assert.equal(codeRouted.action.model.ruleId, 'complex-code');

// Without a router the task carries no model and the manager default applies.
assert.equal(analysisHandled.action.task.model, undefined);

const modelCheckOut = [];
const checkCode = await checkWeComModels('/tmp/app', {
  offline: true,
  probes: ['分析一下整体架构'],
  loadConfig: async () => ({
    apiKey: null,
    models: resolveWeComModelConfig({ local: {} })
  }),
  out: { log: (line) => modelCheckOut.push(line), error: (line) => modelCheckOut.push(line), warn() {} }
});
assert.equal(checkCode, 0);
assert.match(modelCheckOut.join('\n'), /intent-classify\s+→ gemini-3\.8-flash/);
assert.match(modelCheckOut.join('\n'), /任务执行 · intent=analysis\s+→ grok-4\.6\s+（complex-code）/);
assert.match(modelCheckOut.join('\n'), /校验通过/);

const failOut = [];
const failCode = await checkWeComModels('/tmp/app', {
  offline: true,
  loadConfig: async () => ({
    apiKey: null,
    models: resolveWeComModelConfig({ local: { models: { rules: [{ id: 'x', model: 'ghost-1' }] } } })
  }),
  listModels: async () => ['grok-4.6'],
  out: { log: (line) => failOut.push(line), error: (line) => failOut.push(line), warn() {} }
});
assert.equal(failCode, 0);
// Offline cannot know the model is fake; the online check is what catches it.
const onlineOut = [];
const onlineCode = await checkWeComModels('/tmp/app', {
  probes: [],
  loadConfig: async () => ({
    apiKey: 'crsr_x',
    models: resolveWeComModelConfig({ local: { models: { rules: [{ id: 'x', model: 'ghost-1' }] } } })
  }),
  listModels: async () => ['grok-4.6', 'gemini-3.8-flash'],
  out: { log: (line) => onlineOut.push(line), error: (line) => onlineOut.push(line), warn() {} }
});
assert.equal(onlineCode, 1);
assert.match(onlineOut.join('\n'), /模型不存在：ghost-1/);
assert.match(onlineOut.join('\n'), /校验未通过/);

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
