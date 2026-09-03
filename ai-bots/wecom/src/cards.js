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

/**
 * WeCom long-connection has no stream-plus-card message, so terminating lives
 * in the live stream text. This card only answers clicks on cards already sent
 * to a chat before that change.
 */
export function buildCancelledCard(taskId, cardTaskId) {
  return {
    card_type: 'text_notice',
    main_title: { title: '任务已终止', desc: String(taskId) },
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
  const event = frame?.body?.event ?? {};
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
