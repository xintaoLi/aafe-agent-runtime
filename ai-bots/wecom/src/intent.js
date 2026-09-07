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

// Asking for the manual and saying hello are different requests. Answering a
// greeting with the full command list is what made the bot feel like a vending
// machine, so only an explicit ask prints it.
const HELP = /^(?:帮助|help|菜单|命令|指令|\?|？|怎么用|使用说明|用法)[！!。.~～]*$/i;
const GREETING = /^(?:你好|您好|嗨|哈喽|哈啰|在吗|在么|early|morning|早|早上好|下午好|晚上好|hi|hello|hey|yo)[！!。.~～]*$/i;
const IDENTITY = /^(?:你是谁|你是什么|你叫什么|你能做什么|你会什么|你有什么用|能干嘛|会说话吗|介绍一下自己|自我介绍)[？?！!。.~～]*$/i;
const ACK = /^(?:嗯+|好的|好|ok|okay|收到|明白|知道了|👍+)[！!。.~～]*$/i;
// Chit-chat is matched on the whole message only. "今天天气不错" is small talk;
// "天气组件不对" is a defect, and an unanchored pattern would eat it.
const THANKS = /^(?:谢谢|谢了|多谢|感谢|辛苦了|辛苦啦|thanks|thx|thank you)[！!。.~～]*$/i;
const PRAISE = /^(?:你?好厉害|厉害了?|牛|牛啊|牛逼|你真棒|真棒|棒|给力|太强了|你真聪明|不错(?:哦|啊|嘛)?|可以啊|靠谱)[！!。.~～]*$/i;
const CASUAL = /^(?:今天)?(?:天气不错|天气真好|吃了吗|吃饭了吗|在干嘛|在忙吗|忙不忙|无聊|好无聊|困了|累了|摸鱼|周末愉快|早安)[？?！!。.~～]*$/i;
const FAREWELL = /^(?:再见|拜拜|bye|byebye|晚安|下班了?|先撤了?|走了|回头见|明天见)[！!。.~～]*$/i;
const LIST = /^(?:列表|我的任务|有哪些任务|任务列表)$/;
const WORKSPACE_LIST = /^(?:仓库|工作区|当前仓库)$/;
const STATUS = /^(?:状态|进度|怎么样了|做完了吗|好了没|好了吗|查一下|看看进度|任务状态)[?？]?$/;
const CANCEL = /^(?:取消|停止|别做了|停一下|终止|不要跑了|停下)(?:一下|当前)?(?:任务)?[。.!！]?$/;
// A pasted link may come before the request ("<url>\n分析一下这个 PR…"), and the
// parser collapses that newline, so the verb is allowed to follow a leading
// link as well as to open the message. It stays anchored otherwise: an
// unanchored verb would read "再帮我看看" as new work instead of an addendum.
const NEW_WORK = /https?:\/\/[^\s]*tapd\.(?:woa\.com|cn)\/[^\s]*|【[^】]{4,}】|(?:^|\n)\s*(?:https?:\/\/\S+\s+)?(?:请?帮我|麻烦|帮忙)?(?:做|修|改|实现|开发|处理|分析|排查|优化|看看|看一下|(?:fix|implement)\b)/i;
const FOLLOW = /^(?:再|继续|补充|改一下|改下|加上|不要|这里|那个|还是|顺便|另外再|这个不对|不对|再试)/;
// Digits and punctuation alone carry no requirement. Without this they used to
// become a task, and with classification they became the slowest message of
// the day before becoming a task.
const JUNK = /^[\d\s\p{P}\p{S}]{1,16}$/u;

export function analyzeWeComIntent(raw) {
  const command = parseWeComCommand(raw);
  if (command.type !== 'freeform') return command;
  return classifyFreeform(command.text);
}

export function classifyFreeform(text) {
  const body = String(text ?? '').trim();
  if (!body) return { type: 'help' };
  if (HELP.test(body)) return { type: 'help' };
  if (JUNK.test(body)) return { type: 'smalltalk', kind: 'unclear', text: body };
  if (GREETING.test(body)) return { type: 'smalltalk', kind: 'greeting', text: body };
  if (IDENTITY.test(body)) return { type: 'smalltalk', kind: 'identity', text: body };
  if (THANKS.test(body)) return { type: 'smalltalk', kind: 'thanks', text: body };
  if (PRAISE.test(body)) return { type: 'smalltalk', kind: 'praise', text: body };
  if (FAREWELL.test(body)) return { type: 'smalltalk', kind: 'farewell', text: body };
  if (CASUAL.test(body)) return { type: 'smalltalk', kind: 'casual', text: body };
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
