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

import { createTaskId } from '../../../src/agent-platform/tasks/TaskStore.js';
import { parseTapdAssociation } from '../../../src/agent-platform/tasks/tapdPolicy.js';
import { leadingCandidate } from './candidates.js';
import { isExplicitAnchor, isWarmCompleted, ownedBy, resolveTaskAnchor, WARM_COMPLETED_MS } from './context.js';
import { isNewWork } from './intent.js';
import { isTerminalStatus } from './session.js';
import { pickSmalltalkReply } from './smalltalk.js';
import {
  classifyWorkspaceTarget,
  formatWorkspaceList,
  formatWorkspacePrompt,
  toTaskWorkspace
} from './workspace.js';

export async function resolveWeComAction(command, context, manager) {
  const { source } = context;
  const resolved = await bindImplicitCommand(command, context, manager);
  command = resolved;
  if (command.type === 'error') return command;

  if (command.type === 'create') {
    return createRequirementTask(command.requirement, context, manager, command.intent);
  }

  if (command.type === 'need-workspace') {
    return {
      type: 'need-workspace',
      requirement: command.requirement,
      message: formatWorkspacePrompt(context.botRoot ?? process.cwd(), context.workspaces ?? [])
    };
  }

  if (command.type === 'workspace-choice') {
    return chooseWorkspaceAndCreate(command, context, manager);
  }

  if (command.type === 'workspace-list') {
    const current = context.workspace?.id ?? context.currentWorkspace ?? null;
    return { type: 'workspace-list', message: formatWorkspaceList(context.workspaces ?? [], current) };
  }

  if (command.type === 'workspace-pick') {
    return {
      type: 'workspace-pick',
      message: formatWorkspaceList(context.workspaces ?? [], context.workspace?.id ?? null)
    };
  }

  if (command.type === 'workspace-switch') {
    const workspace = context.switchWorkspace?.(command.target, source.conversationId);
    if (workspace) return { type: 'workspace-switched', workspace };
    // The picker card's 当前目录 button and raw paths are not store entries.
    const selected = resolveChoice(command, context);
    if (selected.type === 'error') {
      return { type: 'error', message: `找不到仓库 ${command.target}。发送「仓库」查看列表。` };
    }
    context.rememberWorkspace?.(source.conversationId, selected.workspace);
    return { type: 'workspace-switched', workspace: selected.workspace };
  }

  if (command.type === 'continue') {
    const task = await requireTask(manager, command.taskId);
    if (!task || !canAccessTask(task, source)) {
      return { type: 'error', message: `找不到任务 ${command.taskId}` };
    }
    // An explicit `继续 <TaskID>` arrives without anchor metadata, so ownership
    // is settled here: in a group that is how a third party joins as a
    // participant rather than silently becoming the task's author.
    return {
      type: 'continue',
      task,
      message: command.message,
      anchor: command.anchor ?? 'explicit',
      via: command.via ?? 'task-id',
      // Carried through the re-wrap, or the evidence that bound the message is
      // gone by the time anything logs it.
      confidence: command.confidence ?? null,
      actorRole: command.actorRole ?? (ownedBy(task, source) ? 'owner' : 'participant'),
      ownerId: command.ownerId ?? task.source?.userId ?? null
    };
  }

  if (command.type === 'need-followup') {
    return { type: 'error', message: `请补充内容：继续 ${command.taskId}：<补充>` };
  }

  if (command.type === 'ambiguous-continue') {
    return ambiguousTasks(await listOpenTasks(manager, source, { match: 'owner' }), 'continue', source);
  }

  if (command.type === 'ack') {
    return ackReply(await listOpenTasks(manager, source, { match: 'owner' }), source);
  }

  if (command.type === 'status') {
    const task = await requireTask(manager, command.taskId);
    if (!task || !canAccessTask(task, source)) {
      return { type: 'error', message: `找不到任务 ${command.taskId}` };
    }
    return { type: 'status', task, scheduler: manager.stats?.() ?? null };
  }

  if (command.type === 'cancel') {
    const task = await requireTask(manager, command.taskId);
    if (!task || !canAccessTask(task, source)) {
      return { type: 'error', message: `找不到任务 ${command.taskId}` };
    }
    if (!canControlTask(task, source)) return foreignControl(task);
    const cancelled = await manager.cancel(task.id);
    return { type: 'cancelled', task: cancelled };
  }

  if (command.type === 'list') {
    const match = source.chattype === 'group' ? 'conversation' : 'user';
    const open = await listOpenTasks(manager, source, { match });
    return { type: 'list', tasks: open, scoped: match };
  }

  return { type: 'help' };
}

async function createRequirementTask(requirement, context, manager, intent = null) {
  const workspace = resolveCreateWorkspace(context);
  // Only work that edits code is worth an interactive round trip. Analysis and
  // Q&A run in the bot's own directory, which is a checkout as well, so asking
  // would just add a turn before the answer.
  const needsWorkspace = intent ? intent.kind === 'code' && intent.needsCode !== false : true;
  if (!workspace && context.requireWorkspace && needsWorkspace) {
    return {
      type: 'need-workspace',
      requirement,
      intent,
      message: formatWorkspacePrompt(context.botRoot ?? process.cwd(), context.workspaces ?? [])
    };
  }
  const botRoot = context.botRoot ?? process.cwd();
  const taskWorkspace = toTaskWorkspace(workspace ?? (needsWorkspace ? null : botWorkspace(botRoot)), botRoot);
  const id = createTaskId();
  // The model is pinned here and reused by every later run of this task, so a
  // follow-up cannot silently switch models mid-conversation.
  const routed = context.selectModel?.({ stage: 'task', intent, text: requirement }) ?? null;
  const tapd = buildTaskTapdContext(requirement, context.tapd);
  const task = await manager.create({
    id,
    kind: 'requirement',
    goal: requirement,
    requirement,
    repository: taskWorkspace?.repository ?? context.repository ?? null,
    baseBranch: taskWorkspace?.baseBranch ?? context.baseBranch ?? 'main',
    taskBranch: null,
    workspace: taskWorkspace,
    ...(routed?.model ? { model: routed.model } : {}),
    source: context.source,
    context: {
      userRequest: requirement,
      workspace: taskWorkspace,
      attachments: context.attachments ?? [],
      tapd,
      ...(intent ? { intent } : {}),
      ...(routed ? { model: routed } : {})
    }
  });
  return { type: 'created', task, start: true, workspace: taskWorkspace, intent, model: routed };
}

function buildTaskTapdContext(requirement, tapdConfig) {
  const config = tapdConfig && typeof tapdConfig === 'object' ? tapdConfig : { enabled: true };
  return {
    enabled: config.enabled !== false,
    config,
    association: parseTapdAssociation(requirement)
  };
}

function botWorkspace(root) {
  return { id: 'local', name: 'Bot 运行目录', cwd: root, repository: null, mode: 'local' };
}

async function chooseWorkspaceAndCreate(command, context, manager) {
  const selected = resolveChoice(command, context);
  if (selected.type === 'error') return selected;
  context.rememberWorkspace?.(context.source?.conversationId, selected.workspace);
  return createRequirementTask(command.requirement, {
    ...context,
    workspace: selected.workspace,
    requireWorkspace: false
  }, manager, command.intent ?? null);
}

function resolveChoice(command, context) {
  const target = String(command.target ?? command.text ?? '').trim();
  const listed = (context.workspaces ?? []).find((item) => {
    const key = target.toLowerCase();
    return item.id === key || item.name.toLowerCase() === key;
  });
  if (listed) return { type: 'ok', workspace: listed };
  if (target === 'local' || target === '本地') {
    return {
      type: 'ok',
      workspace: {
        id: 'local',
        name: 'Bot 运行目录',
        cwd: context.botRoot,
        repository: null,
        mode: 'local'
      }
    };
  }
  const classified = classifyWorkspaceTarget(target, context.botRoot);
  if (classified.kind === 'local') {
    return {
      type: 'ok',
      workspace: {
        id: 'adhoc-local',
        name: classified.cwd,
        cwd: classified.cwd,
        repository: null,
        mode: 'local'
      }
    };
  }
  if (classified.kind === 'remote') {
    return {
      type: 'ok',
      workspace: {
        id: 'adhoc-remote',
        name: classified.repository,
        cwd: context.botRoot,
        repository: classified.repository,
        baseBranch: context.baseBranch ?? 'main',
        mode: 'cloud'
      }
    };
  }
  return { type: 'error', message: '无法识别仓库。请发送「本地」、本地路径、远程地址，或「仓库」里的 id。' };
}

function resolveCreateWorkspace(context) {
  if (context.workspace) return context.workspace;
  if (context.repository) {
    return {
      id: 'default',
      name: context.repository,
      cwd: context.botRoot,
      repository: context.repository,
      baseBranch: context.baseBranch ?? 'main',
      mode: 'cloud'
    };
  }
  return null;
}

async function bindImplicitCommand(command, context, manager) {
  const { source } = context;
  if (command.type === 'implicit-route' || command.type === 'implicit-continue') {
    // Conversation scope, not owner scope: a quote may point at a task somebody
    // else in the group started. Ownership is applied per anchor kind instead,
    // so an implicit binding still only ever reaches the speaker's own work.
    const { all } = await listConversationTasks(manager, source, { match: 'conversation' });
    const anchor = await resolveTaskAnchor({
      tasks: all,
      source,
      text: command.text ?? command.message ?? '',
      quote: context.quote ?? null,
      lookup: (id) => requireTask(manager, id),
      now: context.now,
      staleMs: staleWindow(command.intent, context),
      warmCompletedMs: context.warmCompletedMs
    });
    if (command.type === 'implicit-continue') {
      return followUp(anchor, all, command.message, source, command.intent);
    }
    return routeFreeform(command, anchor, all, source);
  }
  if (command.type === 'implicit-status') {
    const open = await listOpenTasks(manager, source, { match: 'owner' });
    if (open.length === 1) return { type: 'status', taskId: open[0].id };
    return ambiguousTasks(open, 'status', source);
  }
  if (command.type === 'implicit-cancel') {
    const open = await listOpenTasks(manager, source, { match: 'owner' });
    if (open.length === 1) return { type: 'cancel', taskId: open[0].id };
    return ambiguousTasks(open, 'cancel', source);
  }
  if (command.type === 'ambiguous-continue') {
    const open = await listOpenTasks(manager, source, { match: 'owner' });
    if (open.length === 1) return { type: 'need-followup', taskId: open[0].id };
  }
  return command;
}

function routeFreeform(command, anchor, tasks = [], source = {}) {
  const intent = command.intent ?? null;
  const prefer = intentPreference(intent) ?? command.prefer ?? 'work';
  const text = command.text;
  if (anchor.kind === 'missing') {
    return { type: 'error', message: `找不到任务 ${anchor.taskId}` };
  }
  // Naming several tasks is as deliberate as naming one, so it is answered
  // before any wording heuristic gets to reinterpret the message.
  if (anchor.kind === 'multiple') return multipleTargets(anchor.candidates, source);
  // Naming or quoting a task is a deliberate act, so it outranks any wording
  // heuristic. Starting separate work while pointing at an old task is what
  // `做：<需求>` is for.
  if (isExplicitAnchor(anchor)) return continueAnchor(anchor, text);
  if (prefer === 'new' || (prefer !== 'follow' && isNewWork(text))) {
    // A classifier that labels the decision as "code" would otherwise start a
    // second investigation whose requirement is the decision itself.
    if (anchor.kind === 'recent' && !isNewWork(text) && (intent?.action === 'apply' || intent?.kind === 'followup')) {
      return continueAnchor(anchor, text);
    }
    return { type: 'create', requirement: text, intent };
  }
  // Standalone work is already gone by here, so what is left would have landed
  // on the implicit anchor. Where that anchor declined, so does routing.
  const gated = anchorGate(anchor, source, intent);
  if (gated) return gated;
  if (prefer === 'follow') return followUp(anchor, tasks, text, source, intent);
  // `work`: nothing in the wording pointed anywhere and the classifier hedged.
  // Live work owned by the speaker takes it, which is what a reply in a running
  // conversation almost always means; the reply says which task it went to so a
  // wrong guess is visible and correctable in one message.
  if (anchor.task) return continueAnchor(anchor, text);
  return { type: 'create', requirement: text, intent };
}

/**
 * The two ways an implicit anchor refuses to guess. Both name what the speaker
 * can point at, because a refusal without a next line is just a dead end.
 */
function anchorGate(anchor, source = {}, intent = null) {
  if (anchor.kind === 'multiple') return multipleTargets(anchor.candidates, source);
  if (anchor.kind === 'ambiguous') {
    return ambiguousTasks(anchor.candidates, 'continue', source, anchor.ranking);
  }
  if (anchor.kind === 'stale') return staleTarget(anchor.candidates[0], intent);
  return null;
}

/**
 * Two tasks named in one message. Running the instruction against either would
 * be a coin flip with a branch on the line, and running it against both is not
 * something one message can ask for, so the split has to be the user's.
 */
function multipleTargets(candidates = [], source = {}) {
  const ids = candidates.map((task) => formatTaskChoice(task, source)).join('\n');
  return {
    type: 'error',
    message: `这条消息同时指向多个任务，一条指令只能作用于一个。\n${ids}\n请分开发送，例如「继续 ${candidates[0].id}：<指令>」。`
  };
}

/**
 * Beyond the window the "last active task" is a guess about yesterday, and an
 * agent restarted on it is expensive to undo. Naming it keeps resuming to one
 * copied line.
 */
function staleTarget(task, intent = null) {
  if (intent?.action === 'ship') {
    return {
      type: 'error',
      message: `提交类操作不会自动认领旧任务。\`${task.id}\` 已经有一段时间没有动静，要对它执行请发「继续 ${task.id}：<指令>」。`
    };
  }
  return {
    type: 'error',
    message: `你最近的任务 \`${task.id}\` 已经很久没有动静，不会自动接在它后面。要接着做请发「继续 ${task.id}：<补充>」，新需求直接发即可。`
  };
}

/**
 * §13's higher bar for irreversible work, expressed as a shorter memory rather
 * than an extra question. Appending a sentence to yesterday's task is cheap to
 * undo; pushing a branch, opening a PR or writing back to TAPD against the
 * wrong one is not, so a submit instruction only claims a task that is still
 * visibly warm and otherwise asks to be pointed at one.
 */
const SHIP_STALE_MS = 2 * 60 * 60 * 1000;

function staleWindow(intent, context = {}) {
  if (intent?.action === 'ship') return context.shipStaleMs ?? SHIP_STALE_MS;
  return context.staleMs;
}

/**
 * The explicit follow-up path: `继续：<补充>`, or wording that reads as an
 * addendum. Without a target this reports why instead of inventing one.
 */
function followUp(anchor, tasks = [], message, source = {}, intent = null) {
  if (anchor.kind === 'missing') {
    return { type: 'error', message: `找不到任务 ${anchor.taskId}` };
  }
  if (anchor.task) return continueAnchor(anchor, message);
  const gated = anchorGate(anchor, source, intent);
  if (gated) return gated;
  // Someone else's live task cannot be joined by accident; 2.2 participation
  // needs the speaker to point at it.
  if (anchor.foreignActive?.length) return needAnchor(anchor.foreignActive, source);
  return noFollowUpTarget(tasks, source);
}

function continueAnchor(anchor, message) {
  return {
    type: 'continue',
    taskId: anchor.taskId,
    message,
    anchor: anchor.kind,
    via: anchor.via,
    confidence: anchor.confidence ?? null,
    actorRole: anchor.actorRole,
    ownerId: anchor.ownerId
  };
}

/**
 * A non-owner may contribute, but only on purpose: an implicit reply must not
 * land in a task started by somebody else, or two people's work merges.
 */
function needAnchor(foreignActive, source = {}) {
  const ids = foreignActive.map((task) => formatTaskChoice(task, source)).join('\n');
  return {
    type: 'error',
    message: `你在本群没有进行中的任务。要补充别人的任务，请引用那条任务消息，或带上 Task ID。\n${ids}\n用法：继续 <TaskID>：<补充>`
  };
}

/**
 * Explicit `继续` with nothing live: name the speaker's last finished task so
 * they can resume it by copying one line instead of hunting for its ID.
 */
function noFollowUpTarget(tasks = [], source = {}) {
  const latest = tasks.find((task) => ownedBy(task, source)) ?? null;
  if (latest && isTerminalStatus(latest.status)) {
    return {
      type: 'error',
      message: `当前没有进行中的任务。最近结束的是 \`${latest.id}\`，要接着做请发「继续 ${latest.id}：<补充>」。`
    };
  }
  return {
    type: 'error',
    message: source.chattype === 'group'
      ? '你在本群没有可继续的任务。其他人的任务请用「继续 <TaskID>：<补充>」。'
      : '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。'
  };
}

/**
 * The classifier only overrides routing when it is sure; a hedged answer keeps
 * the keyword preference the parser already produced. The 0.7 bar for `new`
 * exists so an open task never swallows a clearly standalone request.
 */
function intentPreference(intent) {
  if (!intent) return null;
  if (intent.kind === 'followup') return intent.confidence >= 0.5 ? 'follow' : null;
  return intent.confidence >= 0.7 ? 'new' : null;
}

function ambiguousTasks(open, action, source = {}, ranking = []) {
  if (open.length === 0) {
    return {
      type: 'error',
      message: source.chattype === 'group'
        ? '你在本群没有未结束任务。其他人的任务请带上显式 Task ID。'
        : '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。'
    };
  }
  const leading = leadingCandidate(ranking);
  const ids = open
    .map((task) => formatTaskChoice(task, source, task.id === leading?.taskId))
    .join('\n');
  const usage = action === 'status'
    ? '用法：状态 <TaskID>'
    : action === 'cancel'
      ? '用法：取消 <TaskID>'
      : '用法：继续 <TaskID>：<补充>';
  return {
    type: 'error',
    message: `有多个未结束任务，请带上显式 Task ID。\n${ids}\n${usage}`
  };
}

/**
 * The hint is only attached when the wording clearly favours one task. Marking
 * a near-tie as the likely answer teaches the user to accept whatever the bot
 * listed first, which is the mistake the question exists to avoid.
 */
function formatTaskChoice(task, source = {}, likely = false) {
  const owner = task.source?.userId && source.chattype === 'group'
    ? ` · ${task.source.userId}`
    : '';
  const hint = likely ? ' · 内容最接近' : '';
  return `- ${task.id}（${task.status}${owner}${hint}）${taskTitle(task)}`;
}

function taskTitle(task) {
  const goal = String(task.requirement ?? task.goal ?? '').replace(/\s+/g, ' ').trim();
  if (!goal) return '';
  return `\n  ${goal.length > 40 ? `${goal.slice(0, 40)}…` : goal}`;
}

function ackReply(open, source = {}) {
  if (open.length === 1) {
    return {
      type: 'ack',
      message: `任务 **${open[0].id}** 还在进行中。直接发补充即可继续，或发送「状态」。`
    };
  }
  if (open.length > 1) return ambiguousTasks(open, 'continue', source);
  // Nothing running, so there is nothing to acknowledge. Printing the manual
  // here was the same reflex that made greetings feel mechanical.
  return { type: 'ack', message: pickSmalltalkReply('thanks') ?? '收到。' };
}

export async function listOpenTasks(manager, source = {}, { match = 'user' } = {}) {
  const { open } = await listConversationTasks(manager, source, { match });
  return open;
}

/**
 * Classification needs to know whether a follow-up word can land somewhere:
 * live work, or a just-completed owned task still inside the warm window.
 */
export async function listOwnerContinuable(manager, source = {}, {
  now = Date.now,
  warmMs = WARM_COMPLETED_MS
} = {}) {
  const { all, open } = await listConversationTasks(manager, source, { match: 'owner' });
  const ts = typeof now === 'function' ? now() : Number(now);
  const hasRecentCompleted = all.some((task) => isWarmCompleted(task, ts, warmMs));
  return {
    open,
    hasActiveTask: open.length > 0,
    hasRecentTask: open.length > 0 || hasRecentCompleted
  };
}

async function listConversationTasks(manager, source = {}, { match = 'user' } = {}) {
  // Narrowed by the store's index so a chat message does not wait on every task
  // file on disk. The local filter stays as the authority: the query only ever
  // asks for a subset of what it accepts, and a manager without index support
  // simply returns more.
  const tasks = await manager.list({ limit: 200, sourceType: 'wecom', ...scopeQuery(source, match) });
  const mine = tasks
    .filter((task) => matchesWeComSource(task, source, match))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  return {
    all: mine,
    open: mine.filter((task) => !isTerminalStatus(task.status)),
    latest: mine[0] ?? null
  };
}

function scopeQuery(source = {}, match = 'user') {
  if (match === 'owner') {
    return {
      ...(source.conversationId ? { conversationId: source.conversationId } : {}),
      ...(source.userId ? { userId: source.userId } : {})
    };
  }
  if (match === 'conversation' && source.conversationId) {
    return { conversationId: source.conversationId };
  }
  return source.userId ? { userId: source.userId } : {};
}

function matchesWeComSource(task, source = {}, match = 'user') {
  if (task.source?.type !== 'wecom') return false;
  if (match === 'owner') {
    if (source.conversationId && task.source.conversationId !== source.conversationId) return false;
    if (source.userId) return task.source.userId === source.userId;
    return true;
  }
  if (match === 'conversation' && source.conversationId) {
    return task.source.conversationId === source.conversationId;
  }
  if (source.userId) return task.source.userId === source.userId;
  return true;
}

function canAccessTask(task, source = {}) {
  if (!task) return false;
  if (task.source?.type !== 'wecom') return true;
  if (source.conversationId && task.source.conversationId === source.conversationId) return true;
  if (source.userId && task.source.userId === source.userId) return true;
  return false;
}

/**
 * Reading a task and stopping it are different rights. Anyone in the
 * conversation may see one — that is how a group follows work — but killing a
 * run that is halfway through writing files costs its owner everything and the
 * bystander nothing, so only the person who started it may end it.
 *
 * Tasks with no recorded owner predate this and stay controllable, otherwise
 * they would be unstoppable.
 */
export function canControlTask(task, source = {}) {
  if (!task) return false;
  if (task.source?.type !== 'wecom') return true;
  const owner = task.source?.userId ?? null;
  if (!owner) return true;
  return source.userId === owner;
}

function foreignControl(task) {
  return {
    type: 'error',
    message: `任务 \`${task.id}\` 由 ${task.source?.userId ?? '其他人'} 发起，只有发起人能终止。你可以引用它补充内容。`
  };
}

async function requireTask(manager, taskId) {
  try {
    return await manager.get(taskId);
  } catch (error) {
    if (/task-not-found|invalid-task-id/.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}
