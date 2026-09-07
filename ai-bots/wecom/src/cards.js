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

const STATUS_TITLE = Object.freeze({
  created: '准备任务',
  queued: '任务排队中',
  running: '⚙️ 执行中',
  waiting: '任务等待补充',
  verifying: '任务验证中',
  blocked: '任务被阻塞'
});

/**
 * Rides along with the live progress message via `stream_with_template_card`,
 * so stopping a run is one click instead of copying an id back into the chat.
 *
 * It carries what the group needs to tell one running task from another —
 * whose it is, what it is about, which checkout it holds — because in a room
 * with three tasks in flight an id alone identifies nothing to a human.
 */
export function buildTaskCard(task) {
  const id = typeof task === 'string' ? task : String(task?.id ?? '');
  const detail = typeof task === 'string' ? null : task;
  const card = {
    card_type: 'button_interaction',
    main_title: { title: STATUS_TITLE[detail?.status] ?? '⚙️ 执行中', desc: id },
    // Reading comes before stopping, in both senses: it is the safer action and
    // the one anyone in the group is allowed to take.
    button_list: [
      { text: '查看状态', style: 1, key: `status:${id}` },
      { text: '查看完整过程', style: 1, key: `process:${id}` },
      { text: '终止', style: 3, key: `cancel:${id}` }
    ],
    task_id: freshCardTaskId('run', id)
  };
  const sub = taskSubTitle(detail);
  if (sub) card.sub_title_text = sub;
  return card;
}

function taskSubTitle(task) {
  if (!task) return '';
  const parts = [];
  const goal = clip(String(task.requirement ?? task.goal ?? '').replace(/\s+/g, ' ').trim(), 40);
  if (goal) parts.push(goal);
  if (task.source?.userId) parts.push(`发起人 ${task.source.userId}`);
  // The worktree is the difference between "the agent is editing my files" and
  // "the agent is editing its own copy", which is the first thing anyone asks
  // once more than one task is live.
  if (task.execution?.mode === 'worktree') parts.push('独立工作区');
  if (task.execution?.port) parts.push(`端口 ${task.execution.port}`);
  return parts.join(' · ');
}

export function buildCancelledCard(taskId, cardTaskId) {
  return {
    card_type: 'text_notice',
    main_title: { title: '⛔ 已终止', desc: String(taskId) },
    task_id: cardTaskId || freshCardTaskId('run', taskId)
  };
}

export function buildWorkspacePickerCard(workspaces, { includeLocal = true } = {}) {
  const buttons = [];
  if (includeLocal) buttons.push({ text: '当前目录', style: 1, key: 'ws:local' });
  for (const item of workspaces.slice(0, includeLocal ? 5 : 6)) {
    buttons.push({
      text: clip(item.name || item.id, 10),
      style: 1,
      key: `ws:${item.id}`
    });
  }
  return {
    card_type: 'button_interaction',
    main_title: { title: '选择仓库', desc: '代码任务按 AAFE git 流程执行' },
    sub_title_text: '也可直接发送本地路径或远程仓库地址。',
    button_list: buttons,
    task_id: freshCardTaskId('ws', 'pick')
  };
}

export function buildWorkspaceSwitchedCard(workspace, cardTaskId) {
  return {
    card_type: 'text_notice',
    main_title: {
      title: `已切换到 ${workspace?.name ?? workspace?.id ?? '仓库'}`,
      desc: workspace?.repository ?? workspace?.cwd ?? ''
    },
    task_id: cardTaskId || freshCardTaskId('ws', workspace?.id ?? 'none')
  };
}

export function parseCardEvent(frame = {}) {
  const event = cardEventPayload(frame);
  const key = cardEventKey(event);
  const sep = key.indexOf(':');
  const parsed = sep < 0
    ? { action: key || null, value: '' }
    : { action: key.slice(0, sep), value: key.slice(sep + 1) };
  return {
    ...parsed,
    cardTaskId: event.task_id ?? event.taskId ?? null
  };
}

/**
 * WeCom nests the click payload under `template_card_event`, one level below
 * the event envelope that carries `eventtype`.
 */
export function cardEventPayload(frame = {}) {
  const event = frame?.body?.event ?? {};
  const nested = event.template_card_event ?? event.templateCardEvent ?? null;
  return nested ? { ...event, ...nested } : event;
}

function cardEventKey(event = {}) {
  const direct = event.event_key ?? event.eventKey ?? event.EventKey ?? event.key;
  if (direct) return String(direct).trim();
  const button = event.button ?? event.selected_item ?? event.SelectedItem;
  if (button?.key) return String(button.key).trim();
  const items = event.selected_items ?? event.SelectedItems ?? [];
  if (Array.isArray(items) && items[0]?.key) return String(items[0].key).trim();
  return '';
}

export function wecomTaskId(prefix, value) {
  return `${prefix}_${String(value ?? '').replace(/[^A-Za-z0-9_@-]/g, '_')}`.slice(0, 128);
}

/**
 * WeCom rejects a card whose `task_id` was already used (errcode 42014), so a
 * second card for the same AAFE task still needs its own id.
 */
export function freshCardTaskId(prefix, value) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return wecomTaskId(prefix, `${value ?? ''}-${unique}`);
}

function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : value.slice(0, max);
}
