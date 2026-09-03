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

import { HELP_TEXT, MEDIA_UNSUPPORTED_TEXT } from './help.js';
import { analyzeWeComIntent } from './intent.js';
import { formatListReply, formatStatusReply } from './notify.js';
import { resolveWeComAction } from './resolver.js';
import { sourceFromFrame } from './session.js';

export async function handleWeComMessage(frame, {
  manager,
  replyAck,
  config,
  dedup,
  logger = console
} = {}) {
  const msgid = frame?.body?.msgid;
  if (msgid && dedup && !dedup.accept(msgid)) {
    return { skipped: true, reason: 'duplicate' };
  }

  const command = analyzeWeComIntent(frame?.body?.text?.content);
  const source = sourceFromFrame(frame);
  const action = await resolveWeComAction(command, {
    source,
    repository: config?.repository ?? null,
    baseBranch: config?.baseBranch ?? 'main'
  }, manager);

  const reply = await replyForAction(action, command);
  await replyAck(frame, reply, { finish: true });

  if (action.type === 'created' && action.start) {
    void Promise.resolve(manager.start(action.task.id)).catch((error) => {
      logger.error?.(`wecom-task-start-failed:${action.task.id}:${error instanceof Error ? error.message : error}`);
    });
  }
  if (action.type === 'continue') {
    void Promise.resolve(manager.continue(action.task.id, action.message)).catch((error) => {
      logger.error?.(`wecom-task-continue-failed:${action.task.id}:${error instanceof Error ? error.message : error}`);
    });
  }

  return { skipped: false, command, action, reply };
}

export async function handleWeComMedia(frame, { replyAck, dedup } = {}) {
  const msgid = frame?.body?.msgid;
  if (msgid && dedup && !dedup.accept(msgid)) {
    return { skipped: true, reason: 'duplicate' };
  }
  await replyAck(frame, MEDIA_UNSUPPORTED_TEXT, { finish: true });
  return { skipped: false, command: { type: 'media' } };
}

function replyForAction(action, command) {
  if (action.type === 'created') {
    return `已创建任务 **${action.task.id}**\n需求：${action.task.requirement}\nAgent 已在后台启动，完成后会再推送一条通知。`;
  }
  if (action.type === 'continue') {
    return `已继续任务 **${action.task.id}**\n补充：${action.message}`;
  }
  if (action.type === 'status') {
    return formatStatusReply(action.task, action.scheduler);
  }
  if (action.type === 'cancelled') {
    return `已取消任务 **${action.task.id}**`;
  }
  if (action.type === 'list') {
    return formatListReply(action.tasks);
  }
  if (action.type === 'error' || action.type === 'ack') {
    return action.message;
  }
  return HELP_TEXT;
}
