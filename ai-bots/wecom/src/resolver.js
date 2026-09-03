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

export async function resolveWeComAction(command, context, manager) {
  const { source, repository, baseBranch } = context;
  const resolved = await bindImplicitCommand(command, context, manager);
  command = resolved;
  if (command.type === 'error') return command;

  if (command.type === 'create') {
    const id = createTaskId();
    const task = await manager.create({
      id,
      kind: 'requirement',
      goal: command.requirement,
      requirement: command.requirement,
      repository: repository ?? null,
      baseBranch: baseBranch ?? 'main',
      taskBranch: `aafe/task/${id}`,
      source,
      context: { userRequest: command.requirement }
    });
    return { type: 'created', task, start: true };
  }

  if (command.type === 'continue') {
    const task = await requireTask(manager, command.taskId);
    if (!task) return { type: 'error', message: `找不到任务 ${command.taskId}` };
    return { type: 'continue', task, message: command.message };
  }

  if (command.type === 'need-followup') {
    return { type: 'error', message: `请补充内容：继续 ${command.taskId}：<补充>` };
  }

  if (command.type === 'ambiguous-continue') {
    return ambiguousTasks(await listOpenTasks(manager, source, { match: 'conversation' }), 'continue');
  }

  if (command.type === 'ack') {
    return ackReply(await listOpenTasks(manager, source, { match: 'conversation' }));
  }

  if (command.type === 'status') {
    const task = await requireTask(manager, command.taskId);
    if (!task) return { type: 'error', message: `找不到任务 ${command.taskId}` };
    return { type: 'status', task, scheduler: manager.stats?.() ?? null };
  }

  if (command.type === 'cancel') {
    const task = await requireTask(manager, command.taskId);
    if (!task) return { type: 'error', message: `找不到任务 ${command.taskId}` };
    const cancelled = await manager.cancel(task.id);
    return { type: 'cancelled', task: cancelled };
  }

  if (command.type === 'list') {
    const open = await listOpenTasks(manager, source, { match: 'user' });
    return { type: 'list', tasks: open };
  }

  return { type: 'help' };
}

async function bindImplicitCommand(command, context, manager) {
  const { source } = context;
  if (command.type === 'implicit-route') {
    const open = await listOpenTasks(manager, source, { match: 'conversation' });
    return routeFreeform(command, open);
  }
  if (command.type === 'implicit-continue') {
    const open = await listOpenTasks(manager, source, { match: 'conversation' });
    if (open.length === 1) return { type: 'continue', taskId: open[0].id, message: command.message };
    return { type: 'ambiguous-continue' };
  }
  if (command.type === 'implicit-status') {
    const open = await listOpenTasks(manager, source, { match: 'conversation' });
    if (open.length === 1) return { type: 'status', taskId: open[0].id };
    return ambiguousTasks(open, 'status');
  }
  if (command.type === 'implicit-cancel') {
    const open = await listOpenTasks(manager, source, { match: 'conversation' });
    if (open.length === 1) return { type: 'cancel', taskId: open[0].id };
    return ambiguousTasks(open, 'cancel');
  }
  if (command.type === 'ambiguous-continue') {
    const open = await listOpenTasks(manager, source, { match: 'conversation' });
    if (open.length === 1) return { type: 'need-followup', taskId: open[0].id };
  }
  return command;
}

function routeFreeform(command, open) {
  const prefer = command.prefer ?? 'work';
  const text = command.text;
  if (prefer === 'new' || isNewWork(text)) {
    return { type: 'create', requirement: text };
  }
  if (prefer === 'follow') {
    if (open.length === 1) return { type: 'continue', taskId: open[0].id, message: text };
    if (open.length === 0) {
      return { type: 'error', message: '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。' };
    }
    return { type: 'ambiguous-continue' };
  }
  if (open.length === 0) return { type: 'create', requirement: text };
  if (open.length === 1) return { type: 'continue', taskId: open[0].id, message: text };
  return { type: 'ambiguous-continue' };
}

function ambiguousTasks(open, action) {
  if (open.length === 0) {
    return { type: 'error', message: '当前会话没有未结束任务。直接发需求或 TAPD 链接即可创建。' };
  }
  const ids = open.map((task) => `- ${task.id}（${task.status}）`).join('\n');
  const usage = action === 'status'
    ? '用法：状态 <TaskID>'
    : action === 'cancel'
      ? '用法：取消 <TaskID>'
      : '用法：继续 <TaskID>：<补充>';
  return {
    type: 'error',
    message: `当前会话有多个未结束任务，请带上显式 Task ID。\n${ids}\n${usage}`
  };
}

function ackReply(open) {
  if (open.length === 1) {
    return {
      type: 'ack',
      message: `任务 **${open[0].id}** 还在进行中。直接发补充即可继续，或发送「状态」。`
    };
  }
  if (open.length > 1) return ambiguousTasks(open, 'continue');
  return { type: 'help' };
}

export async function listOpenTasks(manager, source = {}, { match = 'user' } = {}) {
  const tasks = await manager.list({ limit: 200 });
  return tasks.filter((task) => {
    if (isTerminalStatus(task.status)) return false;
    if (task.source?.type !== 'wecom') return false;
    if (match === 'conversation' && source.conversationId) {
      return task.source.conversationId === source.conversationId;
    }
    if (source.userId) return task.source.userId === source.userId;
    return true;
  });
}

async function requireTask(manager, taskId) {
  try {
    return await manager.get(taskId);
  } catch (error) {
    if (/task-not-found|invalid-task-id/.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}
