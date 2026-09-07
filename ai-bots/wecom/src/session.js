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

export function conversationIdFromFrame(frame = {}) {
  const body = frame.body ?? {};
  const chattype = body.chattype === 'group' ? 'group' : 'single';
  if (chattype === 'group') return String(body.chatid ?? '').trim();
  return String(body.from?.userid ?? body.chatid ?? '').trim();
}

export function sourceFromFrame(frame = {}) {
  const body = frame.body ?? {};
  const chattype = body.chattype === 'group' ? 'group' : 'single';
  const userId = String(body.from?.userid ?? '').trim();
  return {
    type: 'wecom',
    conversationId: conversationIdFromFrame(frame),
    chattype,
    messageId: String(body.msgid ?? '').trim() || null,
    userId,
    chatbotId: String(body.aibotid ?? '').trim() || null
  };
}

export function sessionKeyFromSource(source = {}) {
  const conversationId = String(source.conversationId ?? '').trim();
  const userId = String(source.userId ?? '').trim();
  if (source.chattype === 'group' && conversationId && userId) {
    return `${conversationId}::${userId}`;
  }
  return conversationId || userId;
}

export function notifyTargetFromSource(source = {}) {
  const conversationId = String(source.conversationId ?? '').trim();
  if (!conversationId) return null;
  return {
    chatid: conversationId,
    chatType: source.chattype === 'group' ? 2 : 1
  };
}

export function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}
