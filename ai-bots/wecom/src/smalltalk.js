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
 * Chit-chat is the one kind of message where a model earns nothing: the reply
 * carries no information, so paying seconds and tokens for it only makes the
 * bot slower at the moment it should feel most immediate. Twenty canned lines
 * picked at random read as a personality; one canned line reads as a robot.
 *
 * Every line stays short and at most one line per group nudges back toward
 * work — a bot that answers "今天天气不错" with "有需求发我" every time is
 * worse than one that just says something human.
 */
export const SMALLTALK_REPLIES = Object.freeze({
  praise: Object.freeze([
    '过奖了，我就是跑得快一点。',
    '这话我记下了，下次改 bug 更有劲。',
    '主要是需求写得清楚，我照着做而已。',
    '还行吧，起码不写错别字。',
    '客气了，活儿给我就行。'
  ]),
  casual: Object.freeze([
    '是不错，可惜我只能在终端里看看。',
    '我这边永远是晴天，没有窗户那种。',
    '不知道，我一天到晚都在看 diff。',
    '还行，就是有点想念绿色的 CI。',
    '你先聊，我随时能开工。'
  ]),
  farewell: Object.freeze([
    '好，回头见。',
    '拜拜，有活随时喊我。',
    '晚安，任务我盯着。',
    '走好，别忘了合分支。',
    '溜了溜了，明天见。'
  ]),
  thanks: Object.freeze([
    '不客气。',
    '应该的。',
    '小事，下次接着来。',
    '不谢，我也就动动手。',
    '客气啥，都是活儿。'
  ])
});

export const SMALLTALK_KINDS = Object.freeze(Object.keys(SMALLTALK_REPLIES));

/**
 * @param {string} kind One of SMALLTALK_KINDS.
 * @param {object} [options]
 * @param {() => number} [options.random] Injectable for deterministic tests.
 * @returns {string|null} null when the kind has no pool, so callers can fall back.
 */
export function pickSmalltalkReply(kind, { random = Math.random } = {}) {
  const pool = SMALLTALK_REPLIES[kind];
  if (!pool?.length) return null;
  const index = Math.floor(random() * pool.length);
  return pool[Math.min(pool.length - 1, Math.max(0, index))];
}
