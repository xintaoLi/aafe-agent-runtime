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

const TASK_ID = '(?:task-[A-Za-z0-9._-]+|[Tt][A-Za-z0-9._-]{1,127})';
const PREFIX = /^(?:@?AAFE[:：]?\s+)/i;

export function stripMentions(text) {
  return String(text ?? '')
    .replace(/@[^\s@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWeComCommand(raw) {
  const stripped = stripMentions(raw);
  const body = stripped.replace(PREFIX, '').trim();
  if (!body) return { type: 'help' };

  let match = body.match(/^做\s*[:：]\s*(.*)$/s);
  if (match) {
    const requirement = match[1].trim();
    return requirement ? { type: 'create', requirement } : { type: 'help' };
  }

  match = body.match(new RegExp(`^继续\\s+(${TASK_ID})\\s*[:：]\\s*(.+)$`, 's'));
  if (match) {
    const message = match[2].trim();
    return message
      ? { type: 'continue', taskId: match[1], message }
      : { type: 'need-followup', taskId: match[1] };
  }

  match = body.match(new RegExp(`^继续\\s+(${TASK_ID})\\s*$`));
  if (match) return { type: 'need-followup', taskId: match[1] };

  match = body.match(/^继续\s*[:：]\s*(.*)$/s);
  if (match) {
    const message = match[1].trim();
    return message
      ? { type: 'implicit-continue', message }
      : { type: 'ambiguous-continue' };
  }
  if (body === '继续') return { type: 'ambiguous-continue' };

  match = body.match(new RegExp(`^状态\\s+(${TASK_ID})\\s*$`));
  if (match) return { type: 'status', taskId: match[1] };
  if (/^状态$/.test(body)) return { type: 'implicit-status' };

  match = body.match(new RegExp(`^取消\\s+(${TASK_ID})\\s*$`));
  if (match) return { type: 'cancel', taskId: match[1] };
  if (/^取消$/.test(body)) return { type: 'implicit-cancel' };

  if (/^列表$/.test(body)) return { type: 'list' };

  return { type: 'freeform', text: body };
}
