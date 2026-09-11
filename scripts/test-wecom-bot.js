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
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { checkWeComModels, parseWeComArgs } from '../src/cli/wecom.js';
import { createChatResponder } from '../ai-bots/wecom/src/chat.js';
import {
  SMALLTALK_KINDS,
  SMALLTALK_REPLIES,
  pickSmalltalkReply
} from '../ai-bots/wecom/src/smalltalk.js';
import {
  DEFAULT_MODEL_RULES,
  createModelRouter,
  mergeModelRules,
  validateModelRules
} from '../ai-bots/wecom/src/models.js';
import { startWeComBot } from '../ai-bots/wecom/src/index.js';
import { parseWeComCommand, stripMentions } from '../ai-bots/wecom/src/commands.js';
import { analyzeWeComIntent } from '../ai-bots/wecom/src/intent.js';
import { parseCardEvent, buildTaskCard, buildCancelledCard, freshCardTaskId } from '../ai-bots/wecom/src/cards.js';
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
  resolveWeComModelConfig,
  resolveWeComRepoConfig,
  resolveWeComTapdConfig
} from '../ai-bots/wecom/src/config.js';
import {
  buildTaskPrompt,
  parseTapdAssociation
} from '../src/agent-platform/tasks/index.js';
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
import { handleWeComMessage, REUSE_ANALYSIS_TEXT } from '../ai-bots/wecom/src/handler.js';
import { HELP_TEXT, IDENTITY_TEXT, WELCOME_TEXT } from '../ai-bots/wecom/src/help.js';
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
  isStreamExpired,
  renderProgressView
} from '../ai-bots/wecom/src/progress.js';
import {
  buildAgentUIState,
  getThinkingPreview,
  resolveAgentUiStatus
} from '../ai-bots/wecom/src/ui.js';
import { resolveTaskAnchor } from '../ai-bots/wecom/src/context.js';
import { extractKeywords, leadingCandidate, scoreTaskCandidates } from '../ai-bots/wecom/src/candidates.js';
import { parseWeComQuote, scanTaskId, scanTaskIds, scanTaskSuffixes } from '../ai-bots/wecom/src/quote.js';
import { resolveWeComAction } from '../ai-bots/wecom/src/resolver.js';
import { conversationIdFromFrame, sessionKeyFromSource, sourceFromFrame } from '../ai-bots/wecom/src/session.js';

/**
 * Follow-up routing reads how long ago a task was touched, so fixtures date
 * themselves against the run rather than against a day in 2026.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

assert.equal(stripMentions('@RobotA @AAFE 做：增加搜索'), '做：增加搜索');
assert.deepEqual(parseWeComCommand('@AAFE 做：增加用户手机号搜索'), {
  type: 'create',
  requirement: '增加用户手机号搜索'
});
assert.deepEqual(parseWeComCommand('Codex：增加搜索'), {
  type: 'create',
  requirement: '增加搜索',
  provider: 'codex'
});
assert.deepEqual(parseWeComCommand('用 Codex 做：修登录'), {
  type: 'create',
  requirement: '修登录',
  provider: 'codex'
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
// A greeting is a conversation opener, not a request for the command list.
assert.deepEqual(analyzeWeComIntent('你好'), { type: 'smalltalk', kind: 'greeting', text: '你好' });
assert.equal(analyzeWeComIntent('在吗').kind, 'greeting');
assert.equal(analyzeWeComIntent('你是谁').kind, 'identity');
assert.equal(analyzeWeComIntent('你能做什么').kind, 'identity');
assert.equal(analyzeWeComIntent('会说话吗').kind, 'identity');
assert.equal(analyzeWeComIntent('1233').kind, 'unclear');
// The manual still has an explicit way in.
assert.equal(analyzeWeComIntent('帮助').type, 'help');
assert.equal(analyzeWeComIntent('help').type, 'help');
assert.equal(analyzeWeComIntent('菜单').type, 'help');
// Chit-chat is answered from the local pool, never by a model.
assert.equal(analyzeWeComIntent('谢谢').kind, 'thanks');
assert.equal(analyzeWeComIntent('你好厉害').kind, 'praise');
assert.equal(analyzeWeComIntent('今天天气不错').kind, 'casual');
assert.equal(analyzeWeComIntent('下班了').kind, 'farewell');
assert.equal(analyzeWeComIntent('拜拜').kind, 'farewell');
// Acknowledging an in-flight task is still its own thing.
assert.equal(analyzeWeComIntent('收到').type, 'ack');
assert.equal(analyzeWeComIntent('好的').type, 'ack');
// Real work never gets mistaken for chit-chat: the patterns match whole
// messages only, so a defect that happens to contain one of these words stays
// a defect.
assert.equal(analyzeWeComIntent('修一下登录页的报错').type, 'implicit-route');
assert.equal(analyzeWeComIntent('天气组件不对，改一下').type, 'implicit-route');
assert.equal(analyzeWeComIntent('这个下班打卡页面白屏了').type, 'implicit-route');
assert.equal(analyzeWeComIntent('厉害的功能都没实现').type, 'implicit-route');
assert.equal(analyzeWeComIntent('感谢页的样式错了').type, 'implicit-route');
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
// Real traffic pastes the link first and states the request underneath, and the
// parser collapses that newline. Anchoring to the message alone read it as a
// weak signal, which is what let an open task claim it.
assert.equal(
  analyzeWeComIntent('https://github.com/TencentBlueKing/bk-monitor/pull/12347\n分析一下这个 PR是否会对当前 Master 产生副作用').prefer,
  'new'
);
// Still anchored enough that an addendum stays an addendum.
assert.equal(analyzeWeComIntent('再帮我看看这里').prefer, 'follow');
// Digits alone are not a requirement, so they never reach a task or a model.
assert.equal(analyzeWeComIntent('1233').type, 'smalltalk');
assert.equal(analyzeWeComIntent('???').kind, 'unclear');
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
assert.equal(fromLocal.agent.provider, 'cursor');
assert.equal(fromLocal.workspaces[0].repository, 'local/repo');
const localManagerOptions = createTaskManagerOptions(fromLocal);
assert.equal(localManagerOptions.runtimeOptions.apiKey, 'crsr_local');
assert.equal(localManagerOptions.runtimeOptions.model, 'grok-4.6');
assert.equal(localManagerOptions.runtimeOptions.mode, 'cloud');
assert.equal(localManagerOptions.runtimeOptions.provider, 'cursor');
assert.equal(localManagerOptions.validateProjectRuntime, true);
assert.equal(localManagerOptions.repoAuth.aafeRoot, tmp);
assert.equal(localManagerOptions.repoAuth.overrideConfig, null);

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

const fromCodex = await loadWeComBotConfig({
  root: tmp,
  env: {
    WECOM_BOT_ID: 'codex-bot',
    WECOM_BOT_SECRET: 'codex-secret',
    AAFE_WECOM_PROVIDER: 'codex'
  }
});
assert.equal(fromCodex.agent.provider, 'codex');
assert.equal(createTaskManagerOptions(fromCodex).runtimeOptions.provider, 'codex');
let codexModelListCalls = 0;
assert.equal(await checkWeComModels(tmp, {
  loadConfig: async () => fromCodex,
  listModels: async () => { codexModelListCalls++; throw new Error('must-not-call-cursor'); },
  out: { log() {} }
}), 0);
assert.equal(codexModelListCalls, 0);

// Exercise real JSON parsing/normalization, not just injected config objects.
const groupedRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-grouped-'));
try {
  await writeFile(path.join(groupedRoot, 'wecom.local.json'), JSON.stringify({
    botId: 'group-bot', secret: 'group-secret', provider: 'codex',
    apiKey: 'legacy-cursor', model: 'legacy-model', codexApiKey: 'legacy-codex',
    cursor: { apiKey: 'group-cursor', model: 'cursor-model',
      models: { default: 'cursor-default', rules: [] }, autoCreatePR: false },
    codex: { CODEX_API_KEY: 'group-codex', apiKey: 'old-group-key', executable: '/fixture/codex', model: 'codex-model', timeoutMs: 12345 }
  }));
  const c = await loadWeComBotConfig({ root: groupedRoot, env: {} });
  assert.equal(c.apiKey, 'group-codex');
  assert.equal(c.cursor.apiKey, 'group-cursor');
  assert.equal(c.agent.model, 'codex-model');
  assert.equal(c.codex.executable, '/fixture/codex');
  assert.equal(c.codex.timeoutMs, 12345);
  assert.equal(c.intent.cursorApiKey, null);
  assert.equal(createTaskManagerOptions(c).runtimeOptions.codex.timeoutMs, 12345);
  assert.equal(createTaskManagerOptions(c).runtimeOptions.codex.apiKey, 'group-codex');
  assert.equal(createTaskManagerOptions(c).enabledProvider, 'codex');
  assert.equal(createTaskManagerOptions(c).runtimeOptions.apiKey, null);
  assert.equal(createTaskManagerOptions(c).runtimeOptions.model, 'codex-model');
  const switched = await loadWeComBotConfig({ root: groupedRoot, env: { AAFE_WECOM_PROVIDER: 'cursor' } });
  assert.equal(switched.apiKey, 'group-cursor');
  assert.equal(switched.agent.model, 'cursor-model');
  assert.equal(switched.models.default, 'cursor-default');
  assert.equal(switched.agent.autoCreatePR, false);
  assert.equal(switched.codex.apiKey, 'group-codex');
  assert.equal(createTaskManagerOptions(switched).runtimeOptions.codex, undefined);
  const overrides = await loadWeComBotConfig({ root: groupedRoot, env: {
    AAFE_WECOM_PROVIDER: 'cursor', CURSOR_API_KEY: 'env-cursor',
    AAFE_WECOM_CURSOR_MODEL: 'env-model', CODEX_API_KEY: 'env-codex'
  } });
  assert.equal(overrides.cursor.apiKey, 'env-cursor');
  assert.equal(overrides.cursor.model, 'env-model');
  assert.equal(overrides.codex.apiKey, 'env-codex');
  assert.equal(createTaskManagerOptions({ ...c, cursor: { ...c.cursor, apiKey: null } }).runtimeOptions.apiKey, null);
  const persisted = JSON.parse(await readFile(path.join(groupedRoot, 'wecom.local.json'), 'utf8'));
  persisted.codex.CODEX_API_KEY = '';
  await writeFile(path.join(groupedRoot, 'wecom.local.json'), JSON.stringify(persisted));
  assert.equal((await loadWeComBotConfig({ root: groupedRoot, env: {} })).codex.apiKey, 'old-group-key');
  delete persisted.codex.apiKey;
  delete persisted.codexApiKey;
  await writeFile(path.join(groupedRoot, 'wecom.local.json'), JSON.stringify(persisted));
  assert.equal((await loadWeComBotConfig({ root: groupedRoot, env: {} })).codex.apiKey, null);
} finally { await rm(groupedRoot, { recursive: true, force: true }); }

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
assert.deepEqual(fromDotEnv.workflow, { mode: 'auto', intentConfidence: 0.7 });
assert.equal(createTaskManagerOptions(fromDotEnv).runtimeOptions.workflowOverride, 'auto');

const manager = createFakeManager();
const created = await resolveWeComAction(
  { type: 'create', requirement: '增加搜索' },
  { source: sourceFromFrame(textFrame), repository: 'owner/repo', baseBranch: 'main' },
  manager
);
assert.equal(created.type, 'created');
assert.equal(created.start, true);
assert.equal(created.task.source.type, 'wecom');
assert.equal(created.task.taskBranch, null);
assert.match(created.task.id, /^task-/);
assert.equal(created.task.provider, 'cursor');

{
  const codexManager = createFakeManager();
  const createdCodex = await resolveWeComAction(
    { type: 'create', requirement: '用 Codex 修登录', provider: 'codex' },
    { source: sourceFromFrame(textFrame), repository: 'owner/repo', baseBranch: 'main' },
    codexManager
  );
  assert.equal(createdCodex.type, 'created');
  assert.equal(createdCodex.task.provider, 'codex');
  assert.equal(createdCodex.provider, 'codex');
}

const missingRepo = await resolveWeComAction(
  { type: 'create', requirement: '增加搜索' },
  { source: sourceFromFrame(textFrame), repository: null, requireWorkspace: true, botRoot: tmp },
  manager
);
assert.equal(missingRepo.type, 'need-workspace');

const createdLocal = await resolveWeComAction(
  { type: 'workspace-choice', text: '本地', requirement: '增加搜索' },
  { source: { ...sourceFromFrame(textFrame), messageId: 'workspace-choice' }, repository: null, requireWorkspace: true, botRoot: tmp },
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
// Mock replyAck does not confirm the combo frame, so the buttons go out as a
// standalone card instead of fake markdown.
assert.equal(opened.some((item) => item.card?.button_list?.some((button) => button.key === `cancel:${handled.action.task.id}`)), true);
assert.match(replies[0], new RegExp(`终止 ${handled.action.task.id}`));
assert.equal(replies[0].includes('**点击终止**'), false);
assert.match(replies[0], new RegExp(`对话 ID：\`${handled.action.task.id}\``));
const openedSession = opened.find((item) => item.taskId);
// The header the live view reuses stays free of the footer it appends itself.
assert.equal(openedSession.header.includes('对话 ID'), false);
assert.equal(openedSession.taskId, handled.action.task.id);
assert.equal(openedSession.streamId, 'stream-create');
await delay(10);
assert.deepEqual(started, [handled.action.task.id]);

// A greeting gets a greeting back, not the manual, and no task is created.
const helloReplies = [];
const helloHandled = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'hello-1', text: { content: '你好' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { helloReplies.push(content); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(helloHandled.action.type, 'smalltalk');
assert.equal(helloReplies[0].includes('Task ID'), false);
assert.match(helloReplies[0], /有什么要我做的/);

// The bot answers "who are you" from what it knows, with no model call.
const whoReplies = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'who-1', text: { content: '你是谁' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { whoReplies.push(content); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  chat: { async reply() { throw new Error('identity must not call a model'); } }
});
assert.equal(whoReplies[0], IDENTITY_TEXT);

// The manual is still one word away.
const helpReplies = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'help-1', text: { content: '帮助' } }
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
assert.equal(tapdHandled.action.task.taskBranch, null);
assert.equal(tapdHandled.action.task.context.tapd.enabled, true);
assert.equal(tapdHandled.action.task.context.tapd.association.shortId, '137887277');
assert.equal(tapdHandled.action.task.context.tapd.association.entryType, 'story');
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
  updatedAt: isoAgo(2 * HOUR),
  source: sourceFromFrame(textFrame),
  goal: 'stale'
});
staleAndDone.tasks[0].status = 'running';
await staleAndDone.create({
  id: 'task-just-done',
  status: 'completed',
  updatedAt: isoAgo(MINUTE),
  source: sourceFromFrame(textFrame),
  goal: 'done'
});
staleAndDone.tasks[1].status = 'completed';
// A finished task must not absorb a later message: that is how an unrelated
// sentence got appended to a TAPD story and re-ran it hours later. The live
// task takes it instead, even though the finished one was touched later.
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
assert.equal(latestFollow.action.task.id, 'task-stale-running');
assert.equal(latestFollow.action.anchor, 'active');
// An implicit target is stated with the way to change it, so a wrong guess
// surfaces on the next message instead of inside the agent's report.
assert.match(latestFollow.reply, /已追加到你最近活跃的任务/);

// Naming it explicitly still resumes it.
const explicitFollow = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'follow-latest-2',
    text: { content: '继续 task-just-done：1、析影响范围并做最小收敛自测' }
  }
}, {
  manager: staleAndDone,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(explicitFollow.action.type, 'continue');
assert.equal(explicitFollow.action.task.id, 'task-just-done');

// Once nothing is live, an explicit `继续` names the last finished task instead
// of dead-ending, so resuming it costs one copied line.
const doneOnly = createFakeManager();
await doneOnly.create({
  id: 'task-only-done',
  status: 'completed',
  updatedAt: '2026-09-03T12:13:27.724Z',
  source: sourceFromFrame(textFrame),
  goal: 'done'
});
doneOnly.tasks[0].status = 'completed';
const bareContinue = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'bare-continue-1', text: { content: '继续：加上单测' } }
}, {
  manager: doneOnly,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(bareContinue.action.type, 'error');
assert.equal(bareContinue.action.message.includes('继续 task-only-done：'), true);

// A decision a few minutes after the analysis finished belongs to that task,
// not to a second investigation whose requirement is the decision itself.
const justAnalysed = createFakeManager();
await justAnalysed.create({
  id: 'task-20260907034405-f5b346de',
  status: 'completed',
  updatedAt: isoAgo(12 * MINUTE),
  source: sourceFromFrame(textFrame),
  requirement: '分析这些 commit 怎么 squash',
  goal: '分析这些 commit 怎么 squash'
});
justAnalysed.tasks[0].status = 'completed';
const squashDecision = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'squash-1', text: { content: '全部 squash 成1个' } }
}, {
  manager: justAnalysed,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  understanding: { analyze: async (input) => fastIntent(input.text, input) }
});
assert.equal(squashDecision.action.type, 'continue');
assert.equal(squashDecision.action.task.id, 'task-20260907034405-f5b346de');
assert.equal(squashDecision.action.anchor, 'recent');
assert.equal(squashDecision.intent.kind, 'followup');
assert.equal(squashDecision.intent.action, 'apply');
assert.equal(squashDecision.intent.source, 'rules-fast');
assert.match(squashDecision.reply, /已接着刚完成的任务继续/);
assert.equal(justAnalysed.continues.length, 1);
assert.match(justAnalysed.continues[0].message, new RegExp(REUSE_ANALYSIS_TEXT));
assert.match(justAnalysed.continues[0].message, /全部 squash 成1个/);
// A real new request in the same state still starts its own task.
const newWorkWhileWarm = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'squash-2', text: { content: '帮我修一下另一个 bug' } }
}, {
  manager: justAnalysed,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  understanding: { analyze: async (input) => fastIntent(input.text, input) }
});
assert.equal(newWorkWhileWarm.action.type, 'created');
assert.notEqual(newWorkWhileWarm.action.task.id, 'task-20260907034405-f5b346de');

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
  updatedAt: isoAgo(20 * MINUTE),
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
  updatedAt: isoAgo(10 * MINUTE),
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

// --- quoting a message anchors the turn to the task it names ---------------
// WeCom sends the quoted content without its msgid, so the Task ID printed in
// every task reply is the only reliable handle.
const quoteFrame = {
  ...textFrame,
  body: {
    ...textFrame.body,
    quote: {
      msgtype: 'mixed',
      mixed: {
        msg_item: [
          { msgtype: 'text', text: { content: '结果\n复制按钮已修好。' } },
          { msgtype: 'text', text: { content: '对话 ID：`task-20260903124651-e441a17b`' } }
        ]
      }
    }
  }
};
const parsedQuote = parseWeComQuote(quoteFrame);
assert.equal(parsedQuote.present, true);
assert.match(parsedQuote.text, /复制按钮已修好/);
assert.equal(scanTaskId(parsedQuote.text), 'task-20260903124651-e441a17b');
assert.equal(parseWeComQuote(textFrame).present, false);
assert.equal(parseWeComQuote({ body: { quote: { msgtype: 'image', image: {} } } }).note, '引用了一条图片消息');
assert.equal(parseWeComQuote({ body: { quote: { msgtype: 'voice', voice: { content: '再加个开关' } } } }).text, '再加个开关');
// The loose id pattern the command parser accepts would match ordinary words,
// so this one is anchored to the generated shape.
assert.equal(scanTaskId('继续 task-abc：补充'), null);
assert.equal(scanTaskId('to do: tests'), null);

const quotedManager = createFakeManager();
await quotedManager.create({
  id: 'task-20260903124651-e441a17b',
  status: 'completed',
  updatedAt: isoAgo(3 * HOUR),
  source: sourceFromFrame(textFrame),
  requirement: '【日志检索结果复制按钮失效】',
  goal: '【日志检索结果复制按钮失效】'
});
quotedManager.tasks[0].status = 'completed';
await quotedManager.create({
  id: 'task-20260904090000-11112222',
  status: 'running',
  updatedAt: isoAgo(30 * MINUTE),
  source: sourceFromFrame(textFrame),
  requirement: '另一个需求',
  goal: '另一个需求'
});
quotedManager.tasks[1].status = 'running';
// A quote outranks both the live task and the wording: 4 says a finished task
// is out of the running unless it is referenced, and this references it.
const revived = await handleWeComMessage({
  ...quoteFrame,
  body: { ...quoteFrame.body, msgid: 'quote-1', text: { content: '这里还要加上单测' } }
}, {
  manager: quotedManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(revived.action.type, 'continue');
assert.equal(revived.action.task.id, 'task-20260903124651-e441a17b');
assert.equal(revived.action.anchor, 'quoted');
assert.equal(revived.action.via, 'task-id');
// The user chose the target, so there is nothing to warn them about.
assert.equal(/已追加到你最近活跃的任务/.test(revived.reply), false);

// Quoting one's own original requirement carries no id, so the requirement
// text is the fallback.
const byText = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'quote-2',
    text: { content: '这里还要加上单测' },
    quote: { msgtype: 'text', text: { content: '【日志检索结果复制按钮失效】 麻烦看下' } }
  }
}, {
  manager: quotedManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(byText.action.task.id, 'task-20260903124651-e441a17b');
assert.equal(byText.action.via, 'requirement-match');
assert.match(byText.reply, /按引用内容匹配到该任务/);

// A quote that matches nothing degrades to normal routing rather than binding
// to a task by accident.
const unmatchedQuote = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'quote-3',
    text: { content: '这里还要加上单测' },
    quote: { msgtype: 'text', text: { content: '同事发的一句无关的话' } }
  }
}, {
  manager: quotedManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(unmatchedQuote.action.task.id, 'task-20260904090000-11112222');
assert.equal(unmatchedQuote.action.anchor, 'active');

// A Task ID typed into free text is as explicit as quoting it.
const namedInText = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'quote-4',
    text: { content: 'task-20260903124651-e441a17b 这里还要加上单测' }
  }
}, {
  manager: quotedManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(namedInText.action.task.id, 'task-20260903124651-e441a17b');
assert.equal(namedInText.action.anchor, 'explicit');

// A mistyped id reports the miss instead of falling through to live work.
const namedMissing = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'quote-5',
    text: { content: 'task-20260903124651-ffffffff 这里还要加上单测' }
  }
}, {
  manager: quotedManager,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(namedMissing.action.type, 'error');
assert.match(namedMissing.action.message, /找不到任务 task-20260903124651-ffffffff/);

// --- group: a bystander contributes on purpose, and is recorded as one -----
const anchorGroup = createFakeManager();
await anchorGroup.create({
  id: 'task-20260904100000-aaaabbbb',
  status: 'running',
  updatedAt: isoAgo(15 * MINUTE),
  source: { type: 'wecom', conversationId: 'chat-9', chattype: 'group', userId: 'user-a' },
  requirement: 'A 的任务',
  goal: 'A 的任务'
});
anchorGroup.tasks[0].status = 'running';
const bystanderQuote = await handleWeComMessage({
  ...groupFrame,
  body: {
    ...groupFrame.body,
    msgid: 'g-anchor-1',
    from: { userid: 'user-b' },
    text: { content: '@AAFE 这里还要考虑灰度' },
    quote: { msgtype: 'text', text: { content: '对话 ID：`task-20260904100000-aaaabbbb`' } }
  }
}, {
  manager: anchorGroup,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(bystanderQuote.action.type, 'continue');
assert.equal(bystanderQuote.action.task.id, 'task-20260904100000-aaaabbbb');
assert.equal(bystanderQuote.action.actorRole, 'participant');
assert.equal(bystanderQuote.action.ownerId, 'user-a');
assert.match(bystanderQuote.reply, /已作为 user-a 任务的补充记录/);
assert.deepEqual(anchorGroup.continues.at(-1).options.author, { userId: 'user-b', role: 'participant' });

// Without that reference the same words are refused: an implicit reply must
// never merge into work somebody else started.
const bystanderPlain = await handleWeComMessage({
  ...groupFrame,
  body: {
    ...groupFrame.body,
    msgid: 'g-anchor-2',
    from: { userid: 'user-b' },
    text: { content: '@AAFE 再加上灰度' }
  }
}, {
  manager: anchorGroup,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(bystanderPlain.action.type, 'error');
assert.match(bystanderPlain.action.message, /请引用那条任务消息，或带上 Task ID/);
assert.match(bystanderPlain.action.message, /task-20260904100000-aaaabbbb/);

// The owner's own addendum stays an owner addendum.
const ownerAddendum = await handleWeComMessage({
  ...groupFrame,
  body: {
    ...groupFrame.body,
    msgid: 'g-anchor-3',
    from: { userid: 'user-a' },
    text: { content: '@AAFE 再加上灰度' }
  }
}, {
  manager: anchorGroup,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(ownerAddendum.action.type, 'continue');
assert.equal(ownerAddendum.action.actorRole, 'owner');
assert.deepEqual(anchorGroup.continues.at(-1).options.author, { userId: 'user-a', role: 'owner' });

// The @ guard is a second line of defence: it logs by default, because a mixed
// message can carry the mention outside the text and dropping a real request
// is worse than handling a stray one.
const guardEvents = [];
const unmentioned = {
  ...groupFrame,
  body: { ...groupFrame.body, msgid: 'g-guard-1', from: { userid: 'user-a' }, text: { content: '做：修一下登录页' } }
};
const guardLogged = await handleWeComMessage(unmentioned, {
  manager: createFakeManager(),
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  logger: { event: (type, payload) => guardEvents.push({ type, payload }), error() {}, warn() {} }
});
assert.equal(guardLogged.action.type, 'created');
assert.equal(guardEvents.some((item) => item.payload?.reason === 'group-no-mention'), true);
const guardStrict = await handleWeComMessage({
  ...unmentioned,
  body: { ...unmentioned.body, msgid: 'g-guard-2' }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  config: { repository: 'owner/repo', requireGroupMention: true },
  dedup: createMessageDedup()
});
assert.deepEqual(guardStrict, { skipped: true, reason: 'group-no-mention' });
assert.equal(
  (await loadWeComBotConfig({
    root: tmp,
    env: { WECOM_BOT_ID: 'b', WECOM_BOT_SECRET: 's', AAFE_WECOM_REQUIRE_GROUP_MENTION: '1' }
  })).requireGroupMention,
  true
);

// --- anchor precedence, without the message plumbing ----------------------
const anchorTasks = [
  {
    id: 'task-20260904120000-cccc1111',
    status: 'running',
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
    requirement: '最新的活跃任务'
  },
  {
    id: 'task-20260904110000-cccc2222',
    status: 'running',
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
    requirement: '更早的活跃任务'
  },
  {
    id: 'task-20260904100000-cccc3333',
    status: 'completed',
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
    requirement: '已经结束的任务'
  }
];
const anchorSource = { type: 'wecom', conversationId: 'chat-9', chattype: 'group', userId: 'user-a' };
// Two live tasks and nothing choosing between them: picking the newest would
// point an agent at the wrong branch without anybody noticing, so the anchor
// declines and hands back what the speaker has to choose from.
const activeAnchor = await resolveTaskAnchor({ tasks: anchorTasks, source: anchorSource, text: '再加上单测' });
assert.equal(activeAnchor.kind, 'ambiguous');
assert.equal(activeAnchor.taskId, null);
assert.deepEqual(activeAnchor.candidates.map((task) => task.id), [
  'task-20260904120000-cccc1111',
  'task-20260904110000-cccc2222'
]);
// One live task is unambiguous again.
const soleActive = await resolveTaskAnchor({
  tasks: [anchorTasks[0], anchorTasks[2]],
  source: anchorSource,
  text: '再加上单测'
});
assert.equal(soleActive.kind, 'active');
assert.equal(soleActive.taskId, 'task-20260904120000-cccc1111');
assert.equal(soleActive.actorRole, 'owner');
assert.equal(soleActive.confidence, 0.6);
// Gone quiet for long enough that continuing it is a guess about yesterday.
const staleAnchor = await resolveTaskAnchor({
  tasks: [{ ...anchorTasks[0], updatedAt: isoAgo(30 * HOUR) }],
  source: anchorSource,
  text: '再加上单测'
});
assert.equal(staleAnchor.kind, 'stale');
assert.equal(staleAnchor.candidates[0].id, 'task-20260904120000-cccc1111');
// The window is what makes it stale, not the presence of a timestamp.
assert.equal((await resolveTaskAnchor({
  tasks: [{ ...anchorTasks[0], updatedAt: isoAgo(30 * HOUR) }],
  source: anchorSource,
  text: '再加上单测',
  staleMs: 48 * HOUR
})).kind, 'active');
// Only a reference reaches the finished one.
const doneAnchor = await resolveTaskAnchor({
  tasks: anchorTasks,
  source: anchorSource,
  text: '再加上单测',
  quote: { present: true, text: '对话 ID：task-20260904100000-cccc3333' }
});
assert.equal(doneAnchor.kind, 'quoted');
assert.equal(doneAnchor.taskId, 'task-20260904100000-cccc3333');
// Nothing live and the completed task is still warm: the decision belongs to it.
const warmDone = await resolveTaskAnchor({
  tasks: [{ ...anchorTasks[2], updatedAt: isoAgo(4 * MINUTE) }],
  source: anchorSource,
  text: '全部 squash 成1个'
});
assert.equal(warmDone.kind, 'recent');
assert.equal(warmDone.taskId, 'task-20260904100000-cccc3333');
assert.equal(warmDone.via, 'last-completed');
// Yesterday's completed task still stays out, which is the original leak.
const coldDone = await resolveTaskAnchor({
  tasks: [{ ...anchorTasks[2], updatedAt: isoAgo(2 * HOUR) }],
  source: anchorSource,
  text: '全部 squash 成1个'
});
assert.equal(coldDone.kind, 'none');
// A speaker with no task of their own sees the others' live work, not an
// anchor into it.
const foreign = await resolveTaskAnchor({
  tasks: anchorTasks,
  source: { ...anchorSource, userId: 'user-c' },
  text: '再加上单测'
});
assert.equal(foreign.kind, 'none');
assert.equal(foreign.foreignActive.length, 2);
// An id outside this conversation is still resolvable, and reports the miss.
const viaLookup = await resolveTaskAnchor({
  tasks: [],
  source: anchorSource,
  text: '继续 task-20260904100000-cccc3333',
  lookup: async () => anchorTasks[2]
});
assert.equal(viaLookup.kind, 'explicit');
assert.equal(viaLookup.confidence, 1);
assert.equal((await resolveTaskAnchor({ tasks: [], source: anchorSource, text: 'task-20260904100000-cccc3333' })).kind, 'missing');
// A quoted id gets the same lookup a typed one does: a conversation only keeps
// its recent tasks, and a reference must not depend on which of the two ways
// the user chose to point at it.
const quotedLookup = await resolveTaskAnchor({
  tasks: [],
  source: anchorSource,
  text: '这里还要加上单测',
  quote: { present: true, text: '对话 ID：`task-20260904100000-cccc3333`' },
  lookup: async () => anchorTasks[2]
});
assert.equal(quotedLookup.kind, 'quoted');
assert.equal(quotedLookup.taskId, 'task-20260904100000-cccc3333');
// The tail of an id is what people retype off a footer, and it counts while
// exactly one task ends in it.
assert.deepEqual(scanTaskSuffixes('接着做 #cccc3333 这个'), ['cccc3333']);
assert.deepEqual(scanTaskSuffixes('task-20260904100000-cccc3333'), []);
assert.deepEqual(scanTaskSuffixes('20260904 12345678'), []);
const bySuffix = await resolveTaskAnchor({
  tasks: anchorTasks,
  source: anchorSource,
  text: '#cccc3333 这里还要加上单测'
});
assert.equal(bySuffix.kind, 'explicit');
assert.equal(bySuffix.via, 'task-suffix');
assert.equal(bySuffix.taskId, 'task-20260904100000-cccc3333');
// Two tasks ending the same way make it a coin flip, so it stops being a
// reference and the live-task rules take over.
assert.equal((await resolveTaskAnchor({
  tasks: [
    { ...anchorTasks[0], id: 'task-20260904120000-cccc3333' },
    { ...anchorTasks[1], id: 'task-20260904110000-cccc3333' }
  ],
  source: anchorSource,
  text: '#cccc3333 这里还要加上单测'
})).kind, 'ambiguous');
// Two tails naming two different tasks is not ambiguity, it is two references,
// and one instruction cannot be run against both.
assert.deepEqual(scanTaskIds('对比 task-20260904120000-cccc1111 和 task-20260904110000-cccc2222'), [
  'task-20260904120000-cccc1111',
  'task-20260904110000-cccc2222'
]);
const twoIds = await resolveTaskAnchor({
  tasks: anchorTasks,
  source: anchorSource,
  text: 'task-20260904120000-cccc1111 和 task-20260904110000-cccc2222 都提 PR'
});
assert.equal(twoIds.kind, 'multiple');
assert.equal(twoIds.taskId, null);
assert.deepEqual(twoIds.candidates.map((task) => task.id), [
  'task-20260904120000-cccc1111',
  'task-20260904110000-cccc2222'
]);
assert.equal((await resolveTaskAnchor({
  tasks: anchorTasks,
  source: anchorSource,
  text: '#cccc1111 和 #cccc2222 都提 PR'
})).kind, 'multiple');
// Repeating one id is still one reference.
assert.equal((await resolveTaskAnchor({
  tasks: anchorTasks,
  source: anchorSource,
  text: 'task-20260904120000-cccc1111 再看看 task-20260904120000-cccc1111'
})).kind, 'explicit');
const anchorManager = {
  async list() { return anchorTasks; },
  async get(id) { return anchorTasks.find((task) => task.id === id) ?? null; }
};
const multipleReply = await resolveWeComAction(
  { type: 'implicit-route', text: 'task-20260904120000-cccc1111 和 task-20260904110000-cccc2222 都提 PR' },
  { source: anchorSource },
  anchorManager
);
assert.equal(multipleReply.type, 'error');
assert.match(multipleReply.message, /一条指令只能作用于一个/);
assert.equal(multipleReply.message.includes('task-20260904120000-cccc1111'), true);
assert.equal(multipleReply.message.includes('task-20260904110000-cccc2222'), true);

// --- candidate ranking: still a question, but a better one ------------------
// Chinese has no word boundaries, so bigrams stand in for tokenisation.
assert.equal(extractKeywords('接口超时问题').has('超时'), true);
assert.equal(extractKeywords('timeout 改成 10s').has('timeout'), true);
// Two-letter latin words and stopwords are coincidence, not subject matter.
assert.equal(extractKeywords('fix the ui').size, 0);
const rankTasks = [
  {
    id: 'task-20260904120000-eeee1111',
    status: 'running',
    updatedAt: isoAgo(5 * HOUR),
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
    requirement: '首页性能优化，减少首屏加载'
  },
  {
    id: 'task-20260904110000-eeee2222',
    status: 'running',
    updatedAt: isoAgo(4 * HOUR),
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
    requirement: '修复登录接口 timeout'
  }
];
const ranked = await resolveTaskAnchor({
  tasks: rankTasks,
  source: anchorSource,
  text: 'timeout 改成 10 秒'
});
// The gate does not move: two live tasks still produce a question.
assert.equal(ranked.kind, 'ambiguous');
// What moves is the order, and the reason behind it.
assert.deepEqual(ranked.candidates.map((task) => task.id), [
  'task-20260904110000-eeee2222',
  'task-20260904120000-eeee1111'
]);
assert.equal(ranked.ranking[0].taskId, 'task-20260904110000-eeee2222');
assert.equal(ranked.ranking[0].reasons.some((r) => r.type === 'semantic_similarity'), true);
assert.equal(leadingCandidate(ranked.ranking).taskId, 'task-20260904110000-eeee2222');
const rankManager = { async list() { return rankTasks; }, async get() { return null; } };
const rankedReply = await resolveWeComAction(
  { type: 'implicit-route', text: 'timeout 改成 10 秒' },
  { source: anchorSource },
  rankManager
);
assert.match(rankedReply.message, /多个未结束任务/);
assert.match(rankedReply.message, /task-20260904110000-eeee2222（running · user-a · 内容最接近）/);
// The requirement is what tells the two apart, so the choice carries it.
assert.match(rankedReply.message, /修复登录接口 timeout/);
assert.equal(
  rankedReply.message.indexOf('eeee2222') < rankedReply.message.indexOf('eeee1111'),
  true
);
// Wording that favours neither must not be dressed up as a recommendation.
const tied = await resolveTaskAnchor({ tasks: rankTasks, source: anchorSource, text: '这个也改一下' });
assert.equal(tied.kind, 'ambiguous');
assert.equal(leadingCandidate(tied.ranking), null);
assert.equal((await resolveWeComAction(
  { type: 'implicit-route', text: '这个也改一下' },
  { source: anchorSource },
  rankManager
)).message.includes('内容最接近'), false);
// Recency alone ranks but never recommends.
const byRecency = scoreTaskCandidates(rankTasks, { text: '这个也改一下' });
assert.deepEqual(byRecency.map((entry) => entry.taskId), [
  'task-20260904110000-eeee2222',
  'task-20260904120000-eeee1111'
]);
assert.deepEqual(byRecency.map((entry) => entry.reasons.map((r) => r.type)), [['recent_task'], ['recent_task']]);
// A quoted TAPD link is the handle the task was created from, even when the
// wording around it changed.
const storyTasks = [{
  id: 'task-20260904130000-dddd4444',
  status: 'completed',
  source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' },
  requirement: '【容器场景 WebConsole 入口丢失】https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137887748'
}];
const byStory = await resolveTaskAnchor({
  tasks: storyTasks,
  source: anchorSource,
  text: '还要处理灰度',
  quote: { present: true, text: '需求：https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137887748' }
});
assert.equal(byStory.kind, 'quoted');
assert.equal(byStory.via, 'tapd-story');
assert.equal(byStory.taskId, 'task-20260904130000-dddd4444');

// --- the anchor gates seen through the handler ----------------------------
const twoLive = createFakeManager();
for (const id of ['task-live-1', 'task-live-2']) {
  await twoLive.create({
    id,
    status: 'running',
    updatedAt: isoAgo(5 * MINUTE),
    source: sourceFromFrame(textFrame),
    goal: id
  });
  twoLive.tasks.at(-1).status = 'running';
}
const twoLiveWeak = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'gate-1', text: { content: '这个也顺便处理下' } }
}, {
  manager: twoLive,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(twoLiveWeak.action.type, 'error');
assert.match(twoLiveWeak.action.message, /task-live-1/);
assert.match(twoLiveWeak.action.message, /task-live-2/);
// New work is still its own task; the gate only guards messages that were
// about to land on a guess.
const twoLiveNew = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'gate-2', text: { content: '【登录页按钮失效】麻烦修一下' } }
}, {
  manager: twoLive,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(twoLiveNew.action.type, 'created');

const longQuiet = createFakeManager();
await longQuiet.create({
  id: 'task-yesterday',
  status: 'running',
  updatedAt: isoAgo(30 * HOUR),
  source: sourceFromFrame(textFrame),
  goal: '昨天的任务'
});
longQuiet.tasks[0].status = 'running';
const quietWeak = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'gate-3', text: { content: '这个也顺便处理下' } }
}, {
  manager: longQuiet,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(quietWeak.action.type, 'error');
assert.match(quietWeak.action.message, /继续 task-yesterday：/);
// Pointing at it explicitly still works, however long it has been quiet.
const quietNamed = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'gate-4', text: { content: '继续 task-yesterday：这个也顺便处理下' } }
}, {
  manager: longQuiet,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(quietNamed.action.type, 'continue');

// A ship instruction with nothing to ship says so instead of creating a task
// whose requirement is 提交 PR 回填.
const nothingToShip = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'gate-5', text: { content: '提交 PR 回填' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  understanding: { analyze: async (input) => fastIntent(input.text, input) }
});
assert.equal(nothingToShip.action.type, 'error');
assert.equal(nothingToShip.intent.kind, 'followup');

// The same words against a quoted finished task resume it, which is the turn
// that used to wait on a model and get sent three times.
const shipped = createFakeManager();
await shipped.create({
  id: 'task-20260904072702-23adbfed',
  status: 'completed',
  updatedAt: isoAgo(4 * MINUTE),
  source: sourceFromFrame(textFrame),
  requirement: '【容器场景 WebConsole 入口丢失】',
  goal: '【容器场景 WebConsole 入口丢失】'
});
shipped.tasks[0].status = 'completed';
const shipReply = await handleWeComMessage({
  ...textFrame,
  body: {
    ...textFrame.body,
    msgid: 'gate-6',
    text: { content: '提交 PR 回填' },
    quote: { msgtype: 'text', text: { content: '对话 ID：`task-20260904072702-23adbfed`' } }
  }
}, {
  manager: shipped,
  replyAck: async () => {},
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  understanding: { analyze: async (input) => fastIntent(input.text, input) }
});
assert.equal(shipReply.action.type, 'continue');
assert.equal(shipReply.action.task.id, 'task-20260904072702-23adbfed');
assert.equal(shipReply.intent.source, 'rules-fast');

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
assert.equal(cancelUpdates[0].main_title.title, '⛔ 已终止');
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
assert.match(formatTaskNotify(notifyTask), /\*\*✅ 已完成\*\*/);
assert.match(formatTaskNotify(notifyTask), /任务已完成，但 Agent 未给出文字说明/);
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
assert.equal(formatTaskFooter('task-1', { running: true }), '对话 ID：`task-1`\n展开或停止请点消息下方按钮；也可发送 `终止 task-1`');
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
assert.equal(formatProgressEvent({ type: 'cursor.run.started' }).text, 'thinking');
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
}), /正在读取文件/);
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
assert.match(collapsed, /查看完整过程/);
assert.match(collapsed, /src\/f7\.js/);
assert.equal(collapsed.includes('src/f0.js'), false);
assert.match(collapsed, /正在读取文件/);
assert.equal(collapsed.includes('**✅ 最终结论**'), false);
const finishedView = renderProgressView({
  header: '**t1**',
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] },
    { kind: 'assistant', text: '复制按钮已修好。' }
  ],
  footer: '任务 **t1** 已完成',
  finished: true
});
assert.match(finishedView, /\*\*✅ 最终结论\*\*/);
assert.match(finishedView, /复制按钮已修好/);
assert.match(finishedView, /最近进展/);
assert.match(finishedView, /src\/a\.js/);
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
assert.match(runningBox, /展开或停止请点消息下方按钮/);
assert.match(runningBox, /终止 task-live/);
assert.equal(runningBox.includes('**点击终止**'), false);
assert.match(runningBox, /对话 ID：`task-live`/);
assert.equal(
  renderProgressView({
    header: '**task-live**',
    transcript: [{ kind: 'assistant', text: '好了' }],
    footer: formatTaskNotify({ id: 'task-live', status: 'completed', requirement: '需求' }),
    finished: true,
    taskId: 'task-live'
  }).includes('终止：'),
  false
);
const emptyFinish = renderProgressView({
  header: '**t-empty**',
  transcript: [{ kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] }],
  status: '已完成',
  finished: true,
  taskId: 't-empty'
});
assert.match(emptyFinish, /\*\*✅ 最终结论\*\*/);
assert.match(emptyFinish, /未给出文字说明/);
const expandedProcess = renderProgressView({
  header: '**t1**',
  transcript: [
    { kind: 'tool', tools: [{ name: 'Shell', detail: 'ls' }] },
    { kind: 'tool', tools: [{ name: 'Shell', detail: 'git status' }] },
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] }
  ],
  expanded: true,
  animate: false
});
assert.match(expandedProcess, /\*\*Shell\*\* · 2 次/);
assert.match(expandedProcess, /git status/);
assert.match(expandedProcess, /\*\*Read\*\*/);
const failedView = renderProgressView({
  header: '**t-fail**',
  transcript: [],
  status: '失败',
  finished: true,
  footer: formatTaskNotify({
    id: 't-fail',
    status: 'failed',
    requirement: '需求',
    error: 'cursor-run-start-failed:Agent x already has active run'
  }, {}, { includeConclusion: false }),
  taskId: 't-fail'
});
assert.equal(failedView.includes('✅'), false);
assert.match(failedView, /执行失败/);
assert.match(failedView, /already has active run/);
assert.equal(failedView.includes('未返回详细原因'), false);

assert.deepEqual(getThinkingPreview(['a', 'b', 'c', 'd', 'e']), ['c', 'd', 'e']);
assert.equal(resolveAgentUiStatus({ status: 'created' }), 'created');
assert.equal(resolveAgentUiStatus({ status: 'thinking' }), 'thinking');
assert.equal(resolveAgentUiStatus({
  status: 'thinking',
  transcript: [{ kind: 'tool', tools: [{ name: 'Read', detail: 'a.js' }] }]
}), 'executing');
assert.equal(resolveAgentUiStatus({ status: 'canceled', finished: true }), 'canceled');
const cancelingView = renderProgressView({
  header: '**t-stop**',
  status: 'canceling',
  transcript: [{ kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] }],
  taskId: 't-stop'
});
assert.match(cancelingView, /⏹ 正在终止/);
assert.match(cancelingView, /正在停止当前任务/);
assert.equal(cancelingView.includes('点击终止'), false);
const canceledView = renderProgressView({
  header: '**t-stop**',
  status: 'canceled',
  finished: true,
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'src/a.js' }] },
    { kind: 'tool', tools: [{ name: 'Grep', detail: 'copy' }] }
  ],
  taskId: 't-stop'
});
assert.match(canceledView, /⛔ 已终止/);
assert.match(canceledView, /任务已被用户终止/);
assert.match(canceledView, /已记录活动（不代表完成）/);
assert.match(canceledView, /正在读取文件/);
assert.equal(canceledView.includes('**✅ 最终结论**'), false);
const cotCollapsed = renderProgressView({
  header: '**t-cot**',
  transcript: [{ kind: 'thinking', text: '我现在考虑是不是应该先调用 AST Agent，但是又需要判断当前文件是否存在' }]
});
assert.match(cotCollapsed, /正在分析…/);
assert.equal(cotCollapsed.includes('AST Agent'), false);
const uiState = buildAgentUIState({
  transcript: [
    { kind: 'tool', tools: [{ name: 'Read', detail: 'a.js' }] },
    { kind: 'assistant', text: '问题在复制按钮。' }
  ],
  finished: true,
  status: 'completed'
});
assert.equal(uiState.status, 'completed');
assert.equal(uiState.thinking.total, 1);
assert.match(uiState.result.content, /问题在复制按钮/);

const streamUpdates = [];
const hub = createWeComProgressHub({
  danceMs: 2500,
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
assert.match(streamUpdates.at(-1).content, /思考中/);
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

// Runtime cancellation can race TaskManager.cancel and report the same
// terminal status through both task.cancelled and task.finished. The notifier
// delivers that terminal state only once.
const duplicateTerminalListeners = [];
const duplicateTerminalMessages = [];
const duplicateTerminalTask = { ...notifyTask, id: 'task-terminal-dedup', status: 'cancelled' };
attachWeComNotifier({
  manager: {
    subscribe(listener) {
      duplicateTerminalListeners.push(listener);
      return () => {};
    },
    async get() { return duplicateTerminalTask; }
  },
  sendMessage: async (_chatid, body) => { duplicateTerminalMessages.push(body); },
  logger: { warn() {}, error() {}, event() {} }
});
await Promise.all([
  duplicateTerminalListeners[0]({ type: 'task.cancelled', taskId: duplicateTerminalTask.id }),
  duplicateTerminalListeners[0]({
    type: 'task.finished',
    taskId: duplicateTerminalTask.id,
    status: 'cancelled'
  })
]);
assert.equal(duplicateTerminalMessages.filter((body) => body.msgtype === 'markdown').length, 1);
assert.equal(duplicateTerminalMessages.filter((body) => body.msgtype === 'template_card').length, 1);

// Distinct runs in the same conversation can finish inside the dedup window.
// Both final answers and live-stream completion must reach their consumers.
for (const provider of ['cursor', 'codex', null]) {
  let terminalListener;
  const messages = [];
  const handled = [];
  attachWeComNotifier({
    manager: { subscribe(listener) { terminalListener = listener; return () => {}; } },
    sendMessage: async (_chatid, body) => { messages.push(body); },
    progress: { async handle(event) { handled.push(event); return false; } },
    logger: { warn() {}, error() {}, event() {} }
  });
  for (const runId of ['first-run', 'second-run']) {
    const task = { ...notifyTask, id: `fast-${provider}`, status: 'completed',
      result: { text: `answer-${runId}` },
      ...(provider ? { provider, [provider]: { activeRunId: null, runs: [{ runId }] } } : {}) };
    // Providers with a run id also work without observing the scheduling event.
    if (!provider) await terminalListener({ type: 'scheduler.queued', taskId: task.id });
    await terminalListener({ type: 'task.finished', taskId: task.id, task });
    await terminalListener({ type: 'task.finished', taskId: task.id, task });
  }
  assert.equal(messages.filter((body) => body.msgtype === 'markdown').length, 2);
  assert.ok(messages.some((body) => body.markdown?.content.includes('answer-second-run')));
  assert.equal(messages.filter((body) => body.msgtype === 'template_card').length, 2);
  assert.equal(handled.filter((event) => event.type === 'task.finished').length, 2);
}

// WeCom closes a stream 10 minutes after the message that opened it, and a code
// task routinely runs longer. The live view is wrapped up with an explanation
// and the progress continues as pushed messages.
let ttlClock = 1_780_000_000_000;
const ttlStream = [];
const ttlPushed = [];
const ttlHub = createWeComProgressHub({
  replyProgress: async (_frame, _streamId, content, finish) => { ttlStream.push({ content, finish }); },
  pushMessage: async (target, content) => { ttlPushed.push({ target, content }); },
  now: () => ttlClock,
  heartbeatMs: 60_000,
  danceMs: 0,
  streamTtlMs: 9 * MINUTE,
  pushIntervalMs: 3 * MINUTE
});
ttlHub.open({ taskId: 'task-long', frame: textFrame, streamId: 'stream-long', header: '**task-long**' });
await ttlHub.handle({ type: 'cursor.run.started', taskId: 'task-long' });
assert.equal(ttlStream.length, 1);
assert.equal(ttlStream[0].finish, false);

ttlClock += 9 * MINUTE;
await ttlHub.handle({
  taskId: 'task-long',
  type: 'cursor.message',
  payload: { type: 'assistant', text: '还在改代码' }
});
assert.equal(ttlStream.length, 2);
assert.equal(ttlStream.at(-1).finish, true, '到期前自己收尾，不等企微拒绝');
assert.match(ttlStream.at(-1).content, /10 分钟上限/);
assert.match(ttlStream.at(-1).content, /每约 3 分钟/);
assert.equal(ttlStream.at(-1).content.includes('**✅ 最终结论**'), false, '任务还没结束，不能当结论收');
assert.equal(ttlStream.at(-1).content.includes('🐧'), false);
assert.equal(ttlPushed.length, 0, '收尾帧刚带过当前进展，不立刻重复推');

ttlClock += MINUTE;
await ttlHub.tick();
assert.equal(ttlPushed.length, 0, '推送间隔内攒着');
ttlClock += 2 * MINUTE;
await ttlHub.tick();
assert.equal(ttlPushed.length, 1);
assert.equal(ttlPushed[0].target.chatid, 'user-a');
assert.match(ttlPushed[0].content, /还在改代码/);
assert.equal(ttlPushed[0].content.includes('🐧'), false, '静态消息不做动画');

const longFinish = [];
attachWeComNotifier({
  manager: {
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
    async get() { return notifyTask; }
  },
  sendMessage: async (chatid, body) => { longFinish.push({ chatid, body }); },
  progress: ttlHub
});
await listeners.at(-1)({
  type: 'task.finished',
  taskId: 'task-long',
  status: 'completed',
  task: { ...notifyTask, id: 'task-long' }
});
assert.equal(ttlPushed.length, 1, '终态归 notifier 发，进度通道不重复推一条');
assert.equal(longFinish.length, 2);
assert.equal(longFinish[1].body.msgtype, 'template_card');
assert.match(longFinish[0].body.markdown.content, /已完成/);
assert.equal(ttlHub.has('task-long'), false);
await ttlHub.close();

// The SDK rejects with the raw ack frame, so the expiry has to be recognised
// on `errcode` rather than on an Error message.
assert.equal(isStreamExpired({
  errcode: 846608,
  errmsg: 'stream message update expired (>10 minutes),cannot update'
}), true);
assert.equal(isStreamExpired(new Error('boom')), false);

const expiredPushed = [];
const expiredLogs = [];
const expiredHub = createWeComProgressHub({
  replyProgress: async () => {
    throw { errcode: 846608, errmsg: 'stream message update expired (>10 minutes),cannot update' };
  },
  pushMessage: async (_target, content) => { expiredPushed.push(content); },
  logger: { error: (line) => expiredLogs.push(line), event: () => {} },
  now: () => 1_780_000_000_000,
  heartbeatMs: 60_000,
  danceMs: 0
});
expiredHub.open({ taskId: 'task-expired', frame: textFrame, streamId: 'stream-expired', header: '**task-expired**' });
await expiredHub.handle({
  taskId: 'task-expired',
  type: 'cursor.message',
  payload: { type: 'assistant', text: '仍在跑' }
});
assert.equal(expiredPushed.length, 1, '被拒的那一帧改用推送补上，不能丢');
assert.match(expiredPushed[0], /仍在跑/);
assert.equal(expiredLogs.length, 0, '过期是预期内的降级，不算错误');
assert.equal(expiredHub.has('task-expired'), true, '会话继续存活');
await expiredHub.close();

// Any other ack failure still ends the session, but the log has to name it.
const deadLogs = [];
const deadHub = createWeComProgressHub({
  replyProgress: async () => { throw { errcode: 40001, errmsg: 'invalid credential' }; },
  logger: { error: (line) => deadLogs.push(line), event: () => {} },
  now: () => 1_780_000_000_000,
  heartbeatMs: 60_000,
  danceMs: 0
});
deadHub.open({ taskId: 'task-dead', frame: textFrame, streamId: 'stream-dead', header: '**task-dead**' });
await deadHub.handle({ taskId: 'task-dead', type: 'cursor.message', payload: { type: 'assistant', text: 'x' } });
assert.equal(deadHub.has('task-dead'), false);
assert.match(deadLogs[0], /wecom-progress-failed:task-dead:40001:invalid credential/);
assert.equal(deadLogs[0].includes('[object Object]'), false);

// Without a push channel the expiry can only be announced, not worked around.
let soloClock = 1_780_000_000_000;
const soloStream = [];
const soloHub = createWeComProgressHub({
  replyProgress: async (_frame, _streamId, content, finish) => { soloStream.push({ content, finish }); },
  now: () => soloClock,
  heartbeatMs: 60_000,
  danceMs: 0,
  streamTtlMs: 9 * MINUTE
});
soloHub.open({ taskId: 'task-solo', frame: textFrame, streamId: 'stream-solo', header: '**task-solo**' });
soloClock += 9 * MINUTE;
await soloHub.handle({ taskId: 'task-solo', type: 'cursor.message', payload: { type: 'assistant', text: 'y' } });
assert.equal(soloStream.at(-1).finish, true);
assert.match(soloStream.at(-1).content, /完成后如可推送会再通知|完成后会单独发消息通知/);
assert.equal(soloHub.has('task-solo'), false);

// A silent Agent on the push channel still gets keepalives, then a stall
// concludes instead of freezing on "仍在后台运行".
let stallClock = 1_780_000_000_000;
const stallPushed = [];
const stalledIds = [];
const stallHub = createWeComProgressHub({
  replyProgress: async () => {},
  pushMessage: async (_target, content) => { stallPushed.push(content); },
  now: () => stallClock,
  heartbeatMs: 60_000,
  danceMs: 0,
  streamTtlMs: 9 * MINUTE,
  pushIntervalMs: 3 * MINUTE,
  stallMs: 15 * MINUTE,
  onStall: async (taskId) => { stalledIds.push(taskId); }
});
stallHub.open({
  taskId: 'task-stall',
  frame: textFrame,
  streamId: 'stream-stall',
  header: '**task-stall**',
  source: sourceFromFrame(textFrame)
});
await stallHub.handle({
  taskId: 'task-stall',
  type: 'cursor.message',
  payload: { type: 'assistant', text: '正在创建 PR' }
});
stallClock += 9 * MINUTE;
await stallHub.tick();
stallClock += 3 * MINUTE;
await stallHub.tick();
assert.match(stallPushed.at(-1) ?? '', /正在创建 PR|仍在执行/);
assert.equal(stallPushed.at(-1).includes('**✅ 最终结论**'), false);
stallClock += 15 * MINUTE;
await stallHub.tick();
assert.equal(stalledIds[0], 'task-stall');
assert.equal(stallHub.has('task-stall'), true);
assert.equal(stallPushed.at(-1).includes('**✅ 最终结论**'), false);
assert.match(stallPushed.at(-1), /停止等待|长时间无新输出/);
await stallHub.close();

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
  listModels: async () => ['grok-4.6', 'gemini-3.8-flash', 'gpt-5.4-mini'],
  env: {}
});
// Boot checks model names once: a rule naming a model the account cannot run
// is dropped here instead of failing when a task starts.
assert.equal(startedBot.models.list().some((rule) => rule.id === 'ghost'), false);
assert.equal(startedBot.models.model({ stage: 'intent', text: 'x' }), 'gpt-5.4-mini');
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
assert.equal(sanitizeLogValue('AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46dG9r'), 'AUTHORIZATION: basic [redacted]');
assert.equal(sanitizeLogValue({ GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic encoded' }).GIT_CONFIG_VALUE_0, '[redacted]');
const authConsole = [];
createWeComLogger({ sink: { error: (...args) => authConsole.push(...args) } })
  .error('AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46dG9r');
assert.deepEqual(authConsole, ['AUTHORIZATION: basic [redacted]']);
assert.equal(sanitizeLogValue(new Error('AUTHORIZATION: basic encoded')).message, 'AUTHORIZATION: basic [redacted]');

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
assert.equal(captured.at(-1).data.command, 'smalltalk');

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
assert.equal(classifyIntentByRules('分析一下这次变更的影响面').needsCode, true);
assert.equal(classifyIntentByRules('composer 是什么意思').kind, 'question');
assert.equal(classifyIntentByRules('再加上一个开关', { hasActiveTask: true }).kind, 'followup');
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
// A follow-up word next to an open task still needs no model.
const addendum = await countingAnalyzer.analyze({ text: '再补充一点：加上单测', hasActiveTask: true });
assert.equal(addendum.kind, 'followup');
assert.equal(addendum.source, 'rules-fast');
assert.equal(modelCalls, 0);
// A quote next to live work is a reference, so even wording that carries no
// signal skips the model.
const quotedAddendum = await countingAnalyzer.analyze({
  text: '这个也要',
  hasActiveTask: true,
  quote: { present: true, text: '对话 ID：task-20260903111407-a9a64f81' }
});
assert.equal(quotedAddendum.kind, 'followup');
assert.equal(quotedAddendum.source, 'rules-fast');
// Quoting while starting something else is still new work.
assert.equal(
  fastIntent('帮我修一下另一个 bug', { hasActiveTask: true, quote: { present: true, text: 'x' } }).kind,
  'code'
);
assert.equal(modelCalls, 0);
// Without one, an open task no longer makes every sentence an addendum. Left
// unchecked that rule appended "我想下班" to a TAPD story; it is now the
// model's call.
assert.equal(fastIntent('我想下班', { hasActiveTask: true }), null);
// Ship verbs are the exception: commit, PR, TAPD backfill and rerunning the
// tests all happen to work that already exists, so they resolve without a
// model instead of reading as a new task called 提交 PR.
const shipIntent = fastIntent('1、析影响范围并做最小收敛自测\n2、 Commit / 提 PR', { hasActiveTask: true });
assert.equal(shipIntent.kind, 'followup');
assert.equal(shipIntent.source, 'rules-fast');
for (const line of ['提交 PR 回填', '提交并执行PR和回填', '帮我合并一下', '重跑一下自测']) {
  assert.equal(fastIntent(line).kind, 'followup', line);
}
// A Task ID outranks everything, in the text or in what was quoted.
const namedIntent = fastIntent('task-20260904072702-23adbfed 继续提交并执行PR和回填');
assert.equal(namedIntent.kind, 'followup');
assert.equal(namedIntent.confidence, 0.95);
// The quoted task had already finished, which used to send this to the model.
assert.equal(
  fastIntent('提交 PR 回填', {
    hasActiveTask: false,
    quote: { present: true, text: '对话 ID：`task-20260904072702-23adbfed`' }
  }).kind,
  'followup'
);
// Starting something new is still new work, ship verb or not.
assert.equal(fastIntent('帮我实现一键提交功能').kind, 'code');
// A decision on work that already exists is an addendum, running or not:
// otherwise 「全部 squash 成1个」 after an analysis becomes a new investigation.
for (const line of ['全部 squash 成1个', '按方案 A', '选第一个', 'squash 成1个']) {
  const apply = fastIntent(line);
  assert.equal(apply.kind, 'followup', line);
  assert.equal(apply.action, 'apply', line);
  assert.equal(apply.source, 'rules-fast', line);
}
assert.equal(fastIntent('帮我实现 squash 功能').kind, 'code');
// And mid-sentence the verb is just a word: with nothing live behind it this
// is a defect report, so it goes to the model like any other.
assert.equal(fastIntent('购物车合并逻辑有问题'), null);
assert.equal(fastIntent('购物车合并逻辑有问题', { hasActiveTask: true }).kind, 'followup');
// Only genuinely ambiguous new work is worth the wait.
assert.equal((await countingAnalyzer.analyze({ text: AMBIGUOUS })).source, 'cursor');
assert.equal(modelCalls, 1);
assert.equal(fastIntent(AMBIGUOUS), null);
// A leading verb decides new work even while a task is open.
assert.equal(fastIntent('帮我修一下另一个 bug', { hasActiveTask: true }).kind, 'code');

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
        needsCode: true,
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
// Repository analysis must choose its target instead of guessing the bot root.
assert.equal(analysisHandled.action.type, 'need-workspace');
assert.equal(analysisHandled.intent.kind, 'analysis');
assert.equal(stageUpdates[0].streamId, 'stream-intent');
assert.match(stageUpdates[0].content, /仓库/);
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
        needsCode: true,
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
assert.equal(crashHandled.action.type, 'clarify');
assert.equal(crashHandled.intent, null);
assert.equal(crashStageReplies.length, 1);

// Auto fails closed for every uncertain kind, not only low-confidence code.
for (const classified of [null, { kind: 'question', needsCode: false, confidence: 0.4 },
  { kind: 'analysis', needsCode: true, confidence: 0.6 },
  { kind: 'code', needsCode: false, confidence: 0.95 },
  { kind: 'unknown', confidence: 1 }]) {
  const waiting = createPendingStore();
  const isolated = createFakeManager();
  const result = await handleWeComMessage({ ...textFrame,
    body: { ...textFrame.body, text: { content: '这个事情怎么处理比较合适' } }
  }, { manager: isolated, pending: waiting, replyAck: async () => {},
    config: { repository: 'owner/repo', workflow: { mode: 'auto', intentConfidence: 0.7 } },
    understanding: { analyze: async () => classified } });
  assert.equal(result.action.type, 'clarify');
  assert.equal(isolated.tasks.length, 0);
}

const codeStageReplies = [];
// Clarification keeps the original request once, preserves media, and honors
// the latest explicit read-only choice without another model call.
{
  const waiting = createPendingStore();
  const isolated = createFakeManager();
  const config = { repository: 'owner/repo', workflow: { mode: 'auto', intentConfidence: 0.7 } };
  const send = (content, extra = {}) => handleWeComMessage({ ...textFrame,
    body: { ...textFrame.body, msgid: 'clarify-' + isolated.tasks.length + '-' + content,
      text: { content } } }, { manager: isolated, pending: waiting, config,
    replyAck: async () => {}, ...extra });
  const media = { filename: 'screen.png', path: '/tmp/fixture-screen.png', type: 'image' };
  assert.equal((await send('这个事情怎么处理比较合适', { attachments: [media] })).action.type, 'clarify');
  for (let i = 0; i < 6; i++) assert.equal((await send('还没确定')).action.type, 'clarify');
  const key = sessionKeyFromSource(sourceFromFrame(textFrame));
  assert.equal(waiting.get(key).text, '这个事情怎么处理比较合适');
  assert.equal(waiting.get(key).feedback.length, 4);
  const accepted = await send('仅分析，不修改');
  assert.equal(accepted.action.type, 'created');
  assert.equal(accepted.action.task.kind, 'analysis');
  assert.deepEqual(accepted.action.task.context.attachments, [media]);
  assert.equal(accepted.action.task.requirement.split('这个事情怎么处理比较合适').length, 2);
  assert.ok(accepted.action.task.requirement.endsWith('仅分析，不修改'));
  assert.equal(waiting.get(key), null);
  await send('这个事情怎么处理比较合适');
  assert.equal((await send('取消')).action.type, 'clarification-cancelled');
  assert.equal(waiting.get(key), null);
}

// Pending gate confirmation bypasses classification only for a unique owner
// target. A participant, multiple waiting tasks, or unrelated live work cannot
// make a generic yes authorize delivery.
for (const reply of ['好的', '是', '同意', '跳过', '不需要']) {
  const isolated = createFakeManager();
  const task = await isolated.create({ id: 'task-waiting-gate', source: sourceFromFrame(textFrame),
    provider: 'codex', delivery: { pendingGate: 'commit' } });
  task.status = 'blocked';
  const send = (from = textFrame.body.from) => handleWeComMessage({ ...textFrame,
    body: { ...textFrame.body, from, text: { content: reply } } }, {
    manager: isolated, config: { workflow: { mode: 'auto' } }, replyAck: async () => {},
    understanding: { analyze: async () => { throw new Error('must not classify a gate answer'); } },
    logger: { error() {}, event() {} }
  });
  assert.equal((await send()).action.type, 'continue');
  assert.equal(isolated.continues[0].id, task.id);
  assert.equal(isolated.continues[0].options.author.role, 'owner');
  assert.equal(isolated.continues[0].options.intent, null, 'yes must not upgrade an analysis task');
  assert.notEqual((await send({ userid: 'someone-else' })).action.type, 'continue');
  const other = await isolated.create({ id: 'task-other-waiting', source: task.source,
    delivery: { pendingGate: 'tapd_backfill' } });
  other.status = 'blocked';
  assert.equal((await send()).action.type, 'error');
  other.status = 'running';
  assert.equal((await send()).action.type, 'error');
  assert.equal(isolated.continues.length, 1);
}

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
// Repository-dependent analysis requires an explicit target.
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
assert.equal(readingAnalysis.type, 'need-workspace');

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
assert.equal(router.model({ stage: 'intent', text: '随便什么文本' }), 'gpt-5.4-mini');
// Requirement 2: code work and anything architectural takes the reasoning model.
assert.equal(router.select({ stage: 'task', intent: { kind: 'code' }, text: '修按钮' }).ruleId, 'code-work');
assert.equal(router.model({ stage: 'task', intent: { kind: 'code' }, text: '修按钮' }), 'grok-4.6');
assert.equal(router.model({ stage: 'task', intent: { kind: 'analysis' }, text: '看看重连日志' }), 'gpt-5.4-mini');
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
assert.equal(resilient.model({ stage: 'intent', text: 'x' }), 'gpt-5.4-mini');

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
  config: { root: '/bot/root', repository: 'owner/repo' },
  dedup: createMessageDedup(),
  models: router,
  understanding: {
    async analyze() {
      return { kind: 'analysis', label: '分析排查', needsCode: true, summary: '看重连', confidence: 0.9, source: 'rules-fast' };
    }
  }
});
assert.equal(modelRouted.action.task.model, 'gpt-5.4-mini');
assert.equal(modelRouted.action.model.ruleId, 'simple-analysis');
// The user can see which model the task got.
assert.match(modelReplies.join('\n'), /gpt-5\.4-mini/);

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
assert.equal(analysisHandled.action.task, undefined);

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
assert.match(modelCheckOut.join('\n'), /intent-classify\s+→ gpt-5\.4-mini/);
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
  listModels: async () => ['grok-4.6', 'gemini-3.8-flash', 'gpt-5.4-mini'],
  out: { log: (line) => onlineOut.push(line), error: (line) => onlineOut.push(line), warn() {} }
});
assert.equal(onlineCode, 1);
assert.match(onlineOut.join('\n'), /模型不存在：ghost-1/);
assert.match(onlineOut.join('\n'), /校验未通过/);

// An open question is answered in the same turn instead of becoming a task.
const askReplies = [];
const asked = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'ask-1', text: { content: 'composer 和 auto 模式有什么区别' } }
}, {
  manager: {
    async create() { throw new Error('a question must not create a task'); },
    async start() {}, async list() { return []; }, stats() { return {}; }
  },
  replyAck: async (_frame, content) => { askReplies.push(content); return 'stream-ask'; },
  replyProgress: async (_frame, _id, content) => { askReplies.push(content); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  chat: { async reply() { return 'auto 会替你挑模型，composer 是 Cursor 自研的快模型。'; } },
  understanding: {
    async analyze() {
      return { kind: 'question', label: '问答', needsCode: false, summary: '', confidence: 0.9, source: 'stub' };
    }
  }
});
assert.equal(asked.action.type, 'answer');
assert.equal(asked.reply, 'auto 会替你挑模型，composer 是 Cursor 自研的快模型。');
// It is an answer in progress, not a task being prepared.
assert.equal(askReplies.some((line) => line.includes('任务，正在进一步解析中')), false);

// A question that needs the repository still becomes a task.
const repoQuestion = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'ask-2', text: { content: '这个 bot 的重连是怎么实现的' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-ask-2',
  replyProgress: async () => {},
  progress: { open() {} },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  chat: { async reply() { throw new Error('repo questions must not be answered blind'); } },
  understanding: {
    async analyze() {
      return { kind: 'question', label: '问答', needsCode: true, summary: '', confidence: 0.9, source: 'stub' };
    }
  }
});
assert.equal(repoQuestion.action.type, 'created');

// When the model is unreachable the turn still ends with something useful.
const chatDegraded = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'ask-3', text: { content: 'composer 是什么' } }
}, {
  manager: createFakeManager(),
  replyAck: async () => 'stream-ask-3',
  replyProgress: async () => {},
  progress: { open() {} },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup(),
  chat: { async reply() { return null; } },
  understanding: {
    async analyze() {
      return { kind: 'question', label: '问答', needsCode: false, summary: '', confidence: 0.9, source: 'stub' };
    }
  }
});
assert.equal(chatDegraded.action.type, 'answer');
assert.match(chatDegraded.reply, /稍后重试/);

// A chat responder with nothing configured stays quiet rather than throwing.
const idleChat = createChatResponder({ settings: { enabled: false } });
assert.equal(idleChat.backend, 'none');
assert.equal(await idleChat.reply('在吗'), null);
const cursorChat = createChatResponder({
  settings: { cursorApiKey: 'crsr_x' },
  selectModel: ({ stage }) => (stage === 'chat' ? 'gpt-5.4-mini' : null),
  importSdk: async () => ({
    Agent: {
      async prompt(_text, options) {
        assert.equal(options.model.id, 'gpt-5.4-mini');
        return { status: 'finished', result: '```\n就是个快模型。\n```' };
      }
    }
  })
});
assert.equal(cursorChat.backend, 'cursor');
// The fence a model adds around prose is not part of the answer.
assert.equal(await cursorChat.reply('composer 是什么'), '就是个快模型。');
const brokenChat = createChatResponder({
  settings: { cursorApiKey: 'crsr_x' },
  logger: { warn() {} },
  importSdk: async () => ({ Agent: { async prompt() { throw new Error('nope'); } } })
});
assert.equal(await brokenChat.reply('x'), null);

// The chat stage is routable like any other.
assert.equal(createModelRouter({ logger: { error() {} } }).model({ stage: 'chat', text: 'x' }), 'gpt-5.4-mini');
assert.equal(validateModelRules([{ id: 'c', model: 'x', stage: 'chat' }]).ok, true);

// The manual greets a newcomer once; coming back does not repeat it.
const welcomed = [];
const greeted = new Set();
const welcomeBot = await startWeComBot({
  config: { root: tmp, botId: 'bot', secret: 'secret', agent: { mcp: { enabled: false } } },
  manager: { async initialize() { return []; }, subscribe() { return () => {}; }, async close() {} },
  WSClient: FakeWSClient,
  keepAlive: false,
  exitOnShutdown: false,
  installSignals: false,
  mcpServers: {},
  listModels: async () => { throw new Error('offline'); },
  greeted,
  env: {}
});
welcomeBot.gateway.client.replyWelcome = async (_frame, body) => { welcomed.push(body.text.content); };
const enterChat = welcomeBot.gateway.client.handlers.get('event.enter_chat');
const enterFrame = (userid) => ({ headers: { req_id: `w-${userid}` }, body: { aibotid: 'bot', chattype: 'single', from: { userid } } });
await enterChat(enterFrame('newcomer'));
await enterChat(enterFrame('newcomer'));
await enterChat(enterFrame('someone-else'));
await delay(10);
assert.equal(welcomed[0], HELP_TEXT);
// Re-opening the chat must not re-print the manual.
assert.equal(welcomed[1], WELCOME_TEXT);
assert.equal(welcomed[2], HELP_TEXT);
await welcomeBot.shutdown('test');

// Twenty lines across four groups, all non-empty and distinct.
const pool = Object.values(SMALLTALK_REPLIES).flat();
assert.equal(pool.length, 20);
assert.equal(new Set(pool).size, 20);
assert.equal(pool.every((line) => typeof line === 'string' && line.trim().length > 0), true);
assert.deepEqual(SMALLTALK_KINDS, ['praise', 'casual', 'farewell', 'thanks']);
// Picking is random but stays inside the group and never runs off the end.
assert.equal(pickSmalltalkReply('praise', { random: () => 0 }), SMALLTALK_REPLIES.praise[0]);
assert.equal(pickSmalltalkReply('praise', { random: () => 0.999 }), SMALLTALK_REPLIES.praise.at(-1));
assert.equal(pickSmalltalkReply('praise', { random: () => 1 }), SMALLTALK_REPLIES.praise.at(-1));
assert.equal(pickSmalltalkReply('nope'), null);
assert.equal(SMALLTALK_REPLIES.casual.includes(pickSmalltalkReply('casual')), true);
// Over many turns the bot does not repeat itself, which is the whole point.
const seen = new Set();
for (let i = 0; i < 200; i += 1) seen.add(pickSmalltalkReply('farewell'));
assert.equal(seen.size, SMALLTALK_REPLIES.farewell.length);

// Chit-chat is answered locally: no model, no task, and a line from the pool.
for (const [text, kind] of [['你好厉害', 'praise'], ['今天天气不错', 'casual'], ['拜拜', 'farewell'], ['谢谢', 'thanks']]) {
  const replies = [];
  const result = await handleWeComMessage({
    ...textFrame,
    body: { ...textFrame.body, msgid: `chat-${kind}`, text: { content: text } }
  }, {
    manager: {
      async create() { throw new Error('chit-chat must not create a task'); },
      async start() {}, async list() { return []; }, stats() { return {}; }
    },
    replyAck: async (_frame, content) => { replies.push(content); },
    config: { repository: 'owner/repo' },
    dedup: createMessageDedup(),
    chat: { async reply() { throw new Error('chit-chat must not call a model'); } },
    understanding: { async analyze() { throw new Error('chit-chat must not be classified'); } },
    random: () => 0
  });
  assert.equal(result.action.type, 'smalltalk');
  assert.equal(result.action.kind, kind);
  assert.equal(replies[0], SMALLTALK_REPLIES[kind][0]);
}

// Thanking the bot with nothing running is small talk, not a reason for a manual.
const idleThanks = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'thanks-idle', text: { content: '收到' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content) => { idleThanks.push(content); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(idleThanks[0].includes('Task ID'), false);
assert.equal(SMALLTALK_REPLIES.thanks.includes(idleThanks[0]), true);

// Bringing the agent up is one line, not a five-step checklist.
for (const type of ['scheduler.queued', 'scheduler.started', 'cursor.agent.created', 'cursor.agent.resumed', 'task.cursor.bound']) {
  const item = formatProgressEvent({ type });
  assert.equal(item.text, 'created');
  assert.equal(item.log, false);
}
// Things the user might act on are still written into the process list.
assert.equal(formatProgressEvent({ type: 'task.followup.queued' }).log, '已收到补充');
assert.equal(formatProgressEvent({ type: 'task.blocked' }).log, '被阻塞');
// An error carries detail worth keeping even on a silent status.
assert.equal(formatProgressEvent({ type: 'cursor.run.completed', error: 'boom' }).extra, 'boom');

const bootFrames = [];
const bootHub = createWeComProgressHub({
  replyProgress: async (_frame, _streamId, content) => { bootFrames.push(content); },
  danceMs: 0,
  heartbeatMs: 60_000
});
bootHub.open({ taskId: 'task-boot', frame: textFrame, streamId: 'stream-boot', header: '**task-boot**' });
for (const type of ['scheduler.queued', 'scheduler.started', 'cursor.agent.resumed', 'cursor.run.started']) {
  await bootHub.handle({ taskId: 'task-boot', type });
}
const booting = bootFrames.at(-1);
// No process list and no placeholder while starting: the status line says it.
assert.equal(booting.includes('思考过程'), false);
assert.equal(booting.includes('等待 Agent 输出'), false);
assert.equal(booting.includes('排队中'), false);
assert.equal(booting.includes('已接上 Agent'), false);
assert.match(booting, /\*\*⌛ 思考中\*\*/);
// Real work does show up.
await bootHub.handle({
  taskId: 'task-boot',
  type: 'cursor.message',
  payload: { tools: [{ name: 'shell', detail: 'npm test' }] }
});
assert.match(bootFrames.at(-1), /\*\*⚙️ 执行中\*\*/);
assert.match(bootFrames.at(-1), /正在执行命令/);
await bootHub.close();

// Terminating is a button on the live message, not a command to retype.
const cancelCard = buildTaskCard('task-live');
assert.equal(cancelCard.card_type, 'button_interaction');
assert.deepEqual(cancelCard.source, { desc: '任务', desc_color: 0 });
assert.deepEqual(cancelCard.button_list.map((button) => button.key), ['process:task-live', 'cancel:task-live']);
assert.deepEqual(cancelCard.button_list.map((button) => button.text), ['查看完整过程', '终止']);
assert.deepEqual(cancelCard.action_menu, {
  desc: '更多操作',
  action_list: [{ text: '查看状态', key: 'status:task-live' }]
});
assert.equal(cancelCard.main_title.desc, 'task-live');
// Two cards for one task must not collide on task_id (WeCom errcode 42014).
assert.notEqual(buildTaskCard('task-live').task_id, cancelCard.task_id);
// The click routes back to the cancel action already handled.
assert.deepEqual(parseCardEvent({
  body: { event: { template_card_event: { event_key: 'cancel:task-live', task_id: cancelCard.task_id } } }
}), { action: 'cancel', value: 'task-live', cardTaskId: cancelCard.task_id });
// Top-right menu actions use the same event_key route as main buttons.
assert.deepEqual(parseCardEvent({
  body: { event: { template_card_event: { event_key: 'status:task-live', task_id: cancelCard.task_id } } }
}), { action: 'status', value: 'task-live', cardTaskId: cancelCard.task_id });

// Running task controls are always delivered as one standalone card. The
// stream acknowledgement carries progress text only, even if its transport
// result claims a combined card was attached.
const taskAckFrames = [];
const standaloneTaskCards = [];
const standaloneProgress = [];
const cardedTask = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'card-1', text: { content: '做：修一下复制按钮' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content, options) => {
    taskAckFrames.push({ content, ...options });
    return { streamId: 'stream-card', cardAttached: true };
  },
  replyProgress: async () => {},
  replyCard: async (_frame, card) => { standaloneTaskCards.push(card); },
  progress: { open(options) { standaloneProgress.push(options); } },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(taskAckFrames.length, 1);
assert.equal(taskAckFrames[0].card ?? null, null);
assert.equal(taskAckFrames[0].finish, false);
assert.equal(standaloneTaskCards.length, 1);
assert.deepEqual(
  standaloneTaskCards[0].button_list.map((button) => button.key),
  [`process:${cardedTask.action.task.id}`, `cancel:${cardedTask.action.task.id}`]
);
assert.equal(standaloneTaskCards[0].action_menu.action_list[0].key, `status:${cardedTask.action.task.id}`);
assert.equal(standaloneTaskCards[0].button_list.at(-1).text, '终止');
assert.equal(standaloneProgress[0].combined, undefined);

// A turn that ends immediately has nothing to terminate, so it sends no card.
const plain = [];
const plainCards = [];
await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'card-2', text: { content: '帮助' } }
}, {
  manager: createFakeManager(),
  replyAck: async (_frame, content, options) => { plain.push({ content, ...options }); },
  replyCard: async (_frame, card) => { plainCards.push(card); },
  config: { repository: 'owner/repo' },
  dedup: createMessageDedup()
});
assert.equal(plain[0].card ?? null, null);
assert.equal(plainCards.length, 0);

// The gateway keeps the progress stream plain even when obsolete callers pass
// card options.
const streamCalls = [];
const plainStreamGateway = createWeComGateway({
  botId: 'b',
  secret: 's',
  WSClient: class {
    on() {}
    connect() {}
    async replyStream(_frame, _id, content) { streamCalls.push({ kind: 'stream', content }); }
    async replyStreamWithCard() { streamCalls.push({ kind: 'combined' }); }
  },
  logger: { warn() {} }
});
await plainStreamGateway.replyAck(textFrame, '跑起来了', { finish: false, card: buildTaskCard('task-x') });
await plainStreamGateway.replyProgress(textFrame, 'stream-x', '继续执行', false);
assert.deepEqual(streamCalls, [
  { kind: 'stream', content: '跑起来了' },
  { kind: 'stream', content: '继续执行' }
]);

const tapdUrl = 'https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137887748';
assert.deepEqual(parseTapdAssociation(`【容器 WebConsole】 ${tapdUrl}`), {
  url: tapdUrl,
  workspaceId: '10158081',
  entryType: 'story',
  entryId: '1010158081137887748',
  shortId: '137887748',
  branchType: 'feat'
});
assert.equal(parseTapdAssociation('增加搜索'), null);
assert.equal(resolveWeComTapdConfig({ project: { tapd: { enabled: false, pr_field: 'source' } } }).enabled, true);
assert.equal(resolveWeComTapdConfig({ project: { tapd: { enabled: false, pr_field: 'source' } } }).pr_field, 'source');
assert.equal(resolveWeComTapdConfig({ project: { tapd: { enabled: false } } }).projectEnabled, false);
assert.equal(resolveWeComTapdConfig({
  project: { tapd: { enabled: true } },
  local: { tapd: { enabled: false } }
}).enabled, false);
assert.equal(resolveWeComTapdConfig({
  env: { AAFE_WECOM_TAPD_ENABLED: '0' },
  local: { tapd: { enabled: true } }
}).enabled, false);

assert.equal(resolveWeComRepoConfig({
  local: { repo: { githubAccessToken: 'ghp_wecom_local' } }
}).githubAccessToken, 'ghp_wecom_local');
assert.equal(resolveWeComRepoConfig({
  env: { AAFE_WECOM_GITHUB_TOKEN: 'ghp_wecom_env' },
  local: { repo: { githubAccessToken: 'ghp_wecom_local' } }
}).githubAccessToken, 'ghp_wecom_env');
assert.equal(resolveWeComRepoConfig({ local: {} }).githubAccessToken, null);

const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-repo-'));
await writeFile(path.join(repoRoot, 'wecom.local.json'), JSON.stringify({
  botId: 'bot',
  secret: 'secret',
  repo: { githubAccessToken: 'ghp_wecom_file' }
}), 'utf8');
const repoFromLocal = await loadWeComBotConfig({ root: repoRoot, env: {}, readConfig: async () => ({}) });
assert.equal(repoFromLocal.repo.githubAccessToken, 'ghp_wecom_file');
assert.equal(
  createTaskManagerOptions(repoFromLocal).repoAuth.overrideConfig.repo.githubAccessToken,
  'ghp_wecom_file'
);

const projectTapdOff = await mkdtemp(path.join(os.tmpdir(), 'aafe-wecom-tapd-'));
await writeFile(path.join(projectTapdOff, '.aafe.config.json'), JSON.stringify({
  tapd: { enabled: false, pr_field: 'custom_field_pr' },
  agent: { repository: 'owner/repo' }
}), 'utf8');
const tapdFromProject = await loadWeComBotConfig({
  root: projectTapdOff,
  env: { WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'secret' }
});
assert.equal(tapdFromProject.tapd.enabled, true);
assert.equal(tapdFromProject.tapd.pr_field, 'custom_field_pr');
assert.equal(tapdFromProject.tapd.projectEnabled, false);

const wecomTapdOff = await handleWeComMessage({
  ...textFrame,
  body: { ...textFrame.body, msgid: 'tapd-off-1', text: { content: tapdPaste } }
}, {
  manager: createFakeManager(),
  replyAck: async () => {},
  config: { repository: 'owner/repo', tapd: { enabled: false } },
  dedup: createMessageDedup()
});
assert.equal(wecomTapdOff.action.task.taskBranch, null);
assert.equal(wecomTapdOff.action.task.context.tapd.enabled, false);
assert.equal(wecomTapdOff.action.task.context.tapd.association.shortId, '137887277');

const tapdPrompt = buildTaskPrompt({
  id: 'task-20260904072702-23adbfed',
  requirement: `【容器 WebConsole】 ${tapdUrl}`,
  source: { type: 'wecom' }
}, {
  userRequest: `【容器 WebConsole】 ${tapdUrl}`,
  tapd: {
    enabled: true,
    association: parseTapdAssociation(tapdUrl)
  }
});
assert.equal(tapdPrompt.includes('Requested task branch:'), false);
assert.equal(tapdPrompt.includes('aafe/task/task-20260904072702-23adbfed'), false);
assert.match(tapdPrompt, /short_id=137887748/);
assert.match(tapdPrompt, /#137887748/);
assert.match(tapdPrompt, /overrides the target project/);
assert.match(tapdPrompt, /--story=137887748/);

const platformBranchPrompt = buildTaskPrompt({
  id: 'task-x',
  requirement: '增加搜索',
  taskBranch: 'aafe/task/task-x',
  source: { type: 'wecom' }
}, { userRequest: '增加搜索' });
assert.equal(platformBranchPrompt.includes('Requested task branch:'), false);
assert.equal(platformBranchPrompt.includes('Candidate TAPD branch:'), false);

// --- only the owner may end a run ------------------------------------------
const ownedManager = createFakeManager();
ownedManager.tasks.push({
  id: 'task-owned',
  status: 'running',
  updatedAt: isoAgo(MINUTE),
  source: { type: 'wecom', conversationId: 'room-1', userId: 'ann' },
  goal: 'ann 的任务'
});
const groupSource = (userId) => ({ type: 'wecom', chattype: 'group', conversationId: 'room-1', userId });

const strangerCancel = await resolveWeComAction(
  { type: 'cancel', taskId: 'task-owned' },
  { source: groupSource('bob') },
  ownedManager
);
assert.equal(strangerCancel.type, 'error');
assert.match(strangerCancel.message, /只有发起人能终止/);
assert.equal(ownedManager.tasks[0].status, 'running', '一个旁观者不能停掉别人正在跑的 Agent');

// Seeing it is still everyone's right; only stopping it is not.
const strangerStatus = await resolveWeComAction(
  { type: 'status', taskId: 'task-owned' },
  { source: groupSource('bob') },
  ownedManager
);
assert.equal(strangerStatus.type, 'status');

const ownerCancel = await resolveWeComAction(
  { type: 'cancel', taskId: 'task-owned' },
  { source: groupSource('ann') },
  ownedManager
);
assert.equal(ownerCancel.type, 'cancelled');

// The button is visible to the whole group, so it answers to the same check.
const cardManager = createFakeManager();
cardManager.tasks.push({
  id: 'task-carded',
  status: 'running',
  source: { type: 'wecom', conversationId: 'room-1', userId: 'ann' },
  goal: 'ann 的任务'
});
const deniedTexts = [];
const deniedTap = await handleWeComCard({
  body: {
    chattype: 'group',
    chatid: 'room-1',
    from: { userid: 'bob' },
    event: { eventtype: 'template_card_event', template_card_event: { event_key: 'cancel:task-carded' } }
  }
}, {
  manager: cardManager,
  sendText: async (content) => { deniedTexts.push(content); }
});
assert.equal(deniedTap.skipped, true);
assert.equal(deniedTap.reason, 'not-task-owner');
assert.equal(cardManager.tasks[0].status, 'running');
assert.match(deniedTexts.join('\n'), /只有发起人能终止/);

// Reading is the other half of that check: a bystander who may not stop the
// task may still see where it got to, without retyping the id.
assert.deepEqual(parseCardEvent({
  body: { event: { template_card_event: { event_key: 'status:task-carded' } } }
}), { action: 'status', value: 'task-carded', cardTaskId: null });
const viewedTexts = [];
const viewedTap = await handleWeComCard({
  body: {
    chattype: 'group',
    chatid: 'room-1',
    from: { userid: 'bob' },
    event: { eventtype: 'template_card_event', template_card_event: { event_key: 'status:task-carded' } }
  }
}, {
  manager: cardManager,
  sendText: async (content) => { viewedTexts.push(content); }
});
assert.equal(viewedTap.skipped, false);
assert.equal(viewedTap.action.type, 'status');
assert.equal(cardManager.tasks[0].status, 'running');
assert.match(viewedTexts.join('\n'), /task-carded/);

const processTexts = [];
const processHub = createWeComProgressHub({
  replyProgress: async () => {},
  danceMs: 0,
  heartbeatMs: 60_000,
  stallMs: 0
});
processHub.open({
  taskId: 'task-carded',
  frame: textFrame,
  streamId: 'stream-process',
  header: '**task-carded**'
});
await processHub.handle({
  taskId: 'task-carded',
  type: 'cursor.message',
  payload: { tools: [{ name: 'Shell', detail: 'ls' }, { name: 'Shell', detail: 'git status' }] }
});
const processTap = await handleWeComCard({
  body: {
    chattype: 'group',
    chatid: 'room-1',
    from: { userid: 'bob' },
    event: { eventtype: 'template_card_event', template_card_event: { event_key: 'process:task-carded' } }
  }
}, {
  manager: cardManager,
  progress: processHub,
  sendText: async (content) => { processTexts.push(content); }
});
assert.equal(processTap.action.type, 'process');
assert.match(processTexts.join('\n'), /工作记录/);
assert.match(processTexts.join('\n'), /\*\*Shell\*\* · 2 次/);
await processHub.close();

const ownerTap = await handleWeComCard({
  body: {
    chattype: 'group',
    chatid: 'room-1',
    from: { userid: 'ann' },
    event: { eventtype: 'template_card_event', template_card_event: { event_key: 'cancel:task-carded' } }
  }
}, { manager: cardManager, sendText: async () => {} });
assert.equal(ownerTap.action.type, 'cancelled');
assert.equal(cardManager.tasks[0].status, 'cancelled');

// --- a submit instruction will not claim a task that has gone quiet ---------
const shipManager = createFakeManager();
shipManager.tasks.push({
  id: 'task-quiet',
  status: 'waiting',
  updatedAt: isoAgo(3 * HOUR),
  source: { type: 'wecom', conversationId: 'user-a', userId: 'user-a' },
  goal: '昨天的活'
});
const shipContext = { source: sourceFromFrame(textFrame) };
const submitIntent = { kind: 'followup', label: '追加', needsCode: false, confidence: 0.85, action: 'ship' };

const shipGated = await resolveWeComAction(
  { type: 'implicit-route', text: '提 PR', intent: submitIntent },
  shipContext,
  shipManager
);
assert.equal(shipGated.type, 'error');
assert.match(shipGated.message, /提交类操作不会自动认领旧任务/);
assert.match(shipGated.message, /task-quiet/);

// The same task, three hours old, still takes an ordinary addendum: the higher
// bar is for the actions that cannot be undone by sending another message.
const plainFollowUp = await resolveWeComAction(
  { type: 'implicit-route', text: '再补一个空态', intent: { kind: 'followup', label: '追加', needsCode: false, confidence: 0.85 } },
  shipContext,
  shipManager
);
assert.equal(plainFollowUp.type, 'continue');
assert.equal(plainFollowUp.task.id, 'task-quiet');
// The evidence that bound it survives into the action the handler logs.
assert.equal(plainFollowUp.anchor, 'active');
assert.equal(plainFollowUp.confidence, 0.6);

// Warm work is shipped without ceremony.
shipManager.tasks[0].updatedAt = isoAgo(10 * MINUTE);
const shipWarm = await resolveWeComAction(
  { type: 'implicit-route', text: '提 PR', intent: submitIntent },
  shipContext,
  shipManager
);
assert.equal(shipWarm.type, 'continue');
assert.equal(shipWarm.task.id, 'task-quiet');

assert.equal(fastIntent('提 PR', { hasActiveTask: true })?.action, 'ship');
assert.equal(fastIntent('增加手机号搜索')?.action, undefined);

// --- the task card names the task, not just its id --------------------------
const richCard = buildTaskCard({
  id: 'task-rich',
  status: 'running',
  requirement: '增加手机号搜索',
  source: { type: 'wecom', userId: 'ann' },
  execution: { mode: 'worktree', port: 41003 }
});
assert.equal(richCard.main_title.title, '⚙️ 执行中');
assert.equal(richCard.main_title.desc, 'task-rich');
assert.match(richCard.sub_title_text, /增加手机号搜索/);
assert.match(richCard.sub_title_text, /发起人 ann/);
assert.match(richCard.sub_title_text, /独立工作区/);
assert.match(richCard.sub_title_text, /端口 41003/);
assert.deepEqual(richCard.button_list.map((b) => b.key), ['process:task-rich', 'cancel:task-rich']);
assert.deepEqual(richCard.source, { desc: '任务', desc_color: 0 });
assert.deepEqual(richCard.action_menu.action_list.map((action) => action.key), ['status:task-rich']);
// A bare id is still enough to draw one.
assert.equal(buildTaskCard('task-plain').main_title.desc, 'task-plain');
assert.equal(buildTaskCard('task-plain').sub_title_text, undefined);

console.log('wecom bot tests passed');

function createFakeManager({ onStart } = {}) {
  const tasks = [];
  const continues = [];
  return {
    tasks,
    continues,
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
    async continue(id, message, options = {}) {
      continues.push({ id, message, options });
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
