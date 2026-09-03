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

import { parseWeComCommand } from './commands.js';

const HELP = /^(?:你好|您好|嗨|哈喽|hi|hello|hey|帮助|help|菜单|\?|？|怎么用|使用说明|你是谁)[！!。.~～]*$/i;
const ACK = /^(?:嗯+|好的|好|ok|okay|收到|谢谢|感谢|👍+)[！!。.~～]*$/i;
const LIST = /^(?:列表|我的任务|有哪些任务|任务列表)$/;
const WORKSPACE_LIST = /^(?:仓库|工作区|当前仓库)$/;
const STATUS = /^(?:状态|进度|怎么样了|做完了吗|好了没|好了吗|查一下|看看进度|任务状态)[?？]?$/;
const CANCEL = /^(?:取消|停止|别做了|停一下|终止|不要跑了|停下)(?:一下|当前)?(?:任务)?[。.!！]?$/;
const NEW_WORK = /https?:\/\/[^\s]*tapd\.(?:woa\.com|cn)\/[^\s]*|【[^】]{4,}】|^(?:请?帮我|麻烦|帮忙)?(?:做|修|改|实现|开发|处理|分析|排查|优化|看看|看一下|(?:fix|implement)\b)/i;
const FOLLOW = /^(?:再|继续|补充|改一下|改下|加上|不要|这里|那个|还是|顺便|另外再|这个不对|不对|再试)/;

export function analyzeWeComIntent(raw) {
  const command = parseWeComCommand(raw);
  if (command.type !== 'freeform') return command;
  return classifyFreeform(command.text);
}

export function classifyFreeform(text) {
  const body = String(text ?? '').trim();
  if (!body) return { type: 'help' };
  if (HELP.test(body)) return { type: 'help' };
  if (ACK.test(body)) return { type: 'ack' };
  if (LIST.test(body)) return { type: 'list' };
  if (WORKSPACE_LIST.test(body)) return { type: 'workspace-list' };
  if (STATUS.test(body)) return { type: 'implicit-status' };
  if (CANCEL.test(body)) return { type: 'implicit-cancel' };
  if (isNewWork(body)) return { type: 'implicit-route', text: body, prefer: 'new' };
  if (FOLLOW.test(body)) return { type: 'implicit-route', text: body, prefer: 'follow' };
  return { type: 'implicit-route', text: body, prefer: 'work' };
}

export function isNewWork(text) {
  return NEW_WORK.test(String(text ?? '').trim());
}
