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
 * WeCom hands us the quoted message as a content snapshot under `body.quote`
 * and never its msgid, so a reference can only be followed by reading what the
 * quote says. That is enough here: every task reply the bot sends carries its
 * Task ID in the footer, so quoting one of them yields the id verbatim.
 */

const MEDIA_LABEL = Object.freeze({
  image: '图片',
  file: '文件',
  video: '视频',
  voice: '语音'
});

/**
 * Anchored to the generated shape (`task-` + 14 digits + 8 hex) rather than the
 * loose id pattern the command parser accepts, because this one runs over free
 * text where `[Tt][A-Za-z0-9._-]{1,127}` would match most words.
 */
const TASK_ID_IN_TEXT = /\btask-\d{14}-[0-9a-f]{8}\b/i;
const TASK_ID_IN_TEXT_ALL = /\btask-\d{14}-[0-9a-f]{8}\b/gi;

/**
 * The 8-hex tail of a Task ID, which is what people actually retype after
 * reading a footer on a phone. All-digit runs are skipped because a date or a
 * ticket number looks identical, and the caller still has to find exactly one
 * task ending in it before the reference counts.
 */
const TASK_SUFFIX_IN_TEXT = /(?<![0-9a-z_-])#?([0-9a-f]{8})(?![0-9a-z_-])/gi;

/**
 * @returns {{ present: boolean, msgtype: string|null, text: string, note: string|null }}
 */
export function parseWeComQuote(frame = {}) {
  const quote = frame?.body?.quote;
  if (!quote || typeof quote !== 'object') {
    return { present: false, msgtype: null, text: '', note: null };
  }
  const msgtype = nonEmpty(quote.msgtype);
  const text = quoteText(quote);
  return { present: true, msgtype, text, note: quoteNote(msgtype, text) };
}

export function scanTaskId(text) {
  const match = String(text ?? '').match(TASK_ID_IN_TEXT);
  return match ? match[0] : null;
}

/**
 * Partial references, newest first in the order they were written. These are
 * only candidates: a suffix is a reference when one task and no other ends in
 * it, which is a decision for whoever holds the task list.
 *
 * @returns {string[]}
 */
/**
 * Every Task ID in the message, in the order they were typed. One message may
 * point at more than one task, and taking only the first would silently apply
 * the instruction to whichever the user happened to write down first.
 */
export function scanTaskIds(text) {
  const found = [];
  for (const match of String(text ?? '').matchAll(TASK_ID_IN_TEXT_ALL)) {
    const id = match[0].toLowerCase();
    if (!found.includes(id)) found.push(id);
  }
  return found;
}

export function scanTaskSuffixes(text) {
  const found = [];
  for (const match of String(text ?? '').matchAll(TASK_SUFFIX_IN_TEXT)) {
    const suffix = match[1].toLowerCase();
    if (/^\d+$/.test(suffix) || found.includes(suffix)) continue;
    found.push(suffix);
  }
  return found;
}

/**
 * A voice quote arrives already transcribed, and a mixed one is a list, so both
 * reduce to text. Images and files carry no words and only contribute a label.
 */
function quoteText(quote) {
  const parts = [];
  if (quote.text?.content) parts.push(String(quote.text.content));
  if (quote.voice?.content) parts.push(String(quote.voice.content));
  for (const item of quote.mixed?.msg_item ?? []) {
    if (item?.text?.content) parts.push(String(item.text.content));
  }
  return parts.join('\n').trim();
}

function quoteNote(msgtype, text) {
  const label = MEDIA_LABEL[msgtype];
  if (label && !text) return `引用了一条${label}消息`;
  if (!text) return '引用了一条消息';
  return null;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}
