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
import { isNewWork } from './intent.js';
import { isTerminalStatus } from './session.js';
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
    return createRequirementTask(command.requirement, context, manager);
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
    if (!workspace) {
      return { type: 'error', message: `找不到仓库 ${command.target}。发送「仓库」查看列表。` };
    }
    return { type: 'workspace-switched', workspace };
  }

  if (command.type === 'continue') {
    const task = await requireTask(manager, command.taskId);
    if (!task || !canAccessTask(task, source)) {
      return { type: 'error', message: `找不到任务 ${command.taskId}` };
    }
    return { type: 'continue', task, message: command.message };
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

async function createRequirementTask(requirement, context, manager) {
  const workspace = resolveCreateWorkspace(context);
  if (!workspace && context.requireWorkspace) {
    return {
      type: 'need-workspace',
      requirement,
      message: formatWorkspacePrompt(context.botRoot ?? process.cwd(), context.workspaces ?? [])
    };
  }
  const taskWorkspace = toTaskWorkspace(workspace, context.botRoot ?? process.cwd());
  const id = createTaskId();
  const task = await manager.create({
    id,
    kind: 'requirement',
    goal: requirement,
    requirement,
    repository: taskWorkspace?.repository ?? context.repository ?? null,
    baseBranch: taskWorkspace?.baseBranch ?? context.baseBranch ?? 'main',
    taskBranch: `aafe/task/${id}`,
    workspace: taskWorkspace,
    source: context.source,
    context: {
      userRequest: requirement,
      workspace: taskWorkspace,
      attachments: context.attachments ?? []
    }
  });
  return { type: 'created', task, start: true, workspace: taskWorkspace };
}

async function chooseWorkspaceAndCreate(command, context, manager) {
  const selected = resolveChoice(command, context);
  if (selected.type === 'error') return selected;
  context.rememberWorkspace?.(context.source?.conversationId, selected.workspace);
  return createRequirementTask(command.requirement, {
    ...context,
    workspace: selected.workspace,
    requireWorkspace: false
  }, manager);
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
  if (command.type === 'implicit-route') {
    const { open, latest } = await listConversationTasks(manager, source, { match: 'owner' });
    return routeFreeform(command, open, latest, source);
  }
  if (command.type === 'implicit-continue') {
    const { open, latest } = await listConversationTasks(manager, source, { match: 'owner' });
    const target = pickFollowUpTarget(open, latest);
    if (target) return { type: 'continue', taskId: target.id, message: command.message };
    return { type: 'ambiguous-continue' };
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

function routeFreeform(command, open, latest = null, source = {}) {
  const prefer = command.prefer ?? 'work';
  const text = command.text;
  if (prefer === 'new' || isNewWork(text)) {
    return { type: 'create', requirement: text };
  }
  const target = pickFollowUpTarget(open, latest);
  if (prefer === 'follow') {
    if (target) return { type: 'continue', taskId: target.id, message: text };
    if (open.length === 0) {
      return {
        type: 'error',
        message: source.chattype === 'group'
          ? '你在本群没有可继续的任务。其他人的任务请用「继续 <TaskID>：<补充>」。'
          : '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。'
      };
    }
    return { type: 'ambiguous-continue' };
  }
  if (target) return { type: 'continue', taskId: target.id, message: text };
  if (open.length === 0) return { type: 'create', requirement: text };
  return { type: 'ambiguous-continue' };
}

function pickFollowUpTarget(open = [], latest = null) {
  if (latest && isTerminalStatus(latest.status) && isNewerTask(latest, open)) {
    return latest;
  }
  if (open.length === 1) return open[0];
  return null;
}

function isNewerTask(task, others = []) {
  const ts = String(task.updatedAt ?? '');
  return others
    .filter((other) => other.id !== task.id)
    .every((other) => String(other.updatedAt ?? '') < ts);
}

function ambiguousTasks(open, action, source = {}) {
  if (open.length === 0) {
    return {
      type: 'error',
      message: source.chattype === 'group'
        ? '你在本群没有未结束任务。其他人的任务请带上显式 Task ID。'
        : '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。'
    };
  }
  const ids = open.map((task) => formatTaskChoice(task, source)).join('\n');
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

function formatTaskChoice(task, source = {}) {
  const owner = task.source?.userId && source.chattype === 'group'
    ? ` · ${task.source.userId}`
    : '';
  return `- ${task.id}（${task.status}${owner}）`;
}

function ackReply(open, source = {}) {
  if (open.length === 1) {
    return {
      type: 'ack',
      message: `任务 **${open[0].id}** 还在进行中。直接发补充即可继续，或发送「状态」。`
    };
  }
  if (open.length > 1) return ambiguousTasks(open, 'continue', source);
  return { type: 'help' };
}

export async function listOpenTasks(manager, source = {}, { match = 'user' } = {}) {
  const { open } = await listConversationTasks(manager, source, { match });
  return open;
}

async function listConversationTasks(manager, source = {}, { match = 'user' } = {}) {
  const tasks = await manager.list({ limit: 200 });
  const mine = tasks
    .filter((task) => matchesWeComSource(task, source, match))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  return {
    open: mine.filter((task) => !isTerminalStatus(task.status)),
    latest: mine[0] ?? null
  };
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

async function requireTask(manager, taskId) {
  try {
    return await manager.get(taskId);
  } catch (error) {
    if (/task-not-found|invalid-task-id/.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}
