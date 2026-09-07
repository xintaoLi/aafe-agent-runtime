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
 * Ranking for the case where the evidence chain ran out: several of the
 * speaker's tasks are live and nothing in the message points at one of them.
 *
 * The bot still asks rather than picks — a wrong branch is expensive and one
 * question is not — but an unordered list of ids is a bad question. Scoring
 * turns it into a good one: the likeliest task first, and a word about why, so
 * the answer is usually a glance rather than a hunt through three task ids.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'this', 'that', 'with', 'from', 'into', 'have', 'has',
  'was', 'were', 'are', 'you', 'your', 'our', 'not', 'but', 'can', 'all',
  'add', 'fix', 'use', 'get', 'set', 'run', 'make', 'let', 'now', 'please'
]);

/** Below this a shared word is coincidence rather than subject matter. */
const MIN_WORD = 3;

/**
 * How long a task stays "the one I was just working on". Past it recency says
 * nothing useful, which is the point at which the wording has to carry the
 * decision on its own.
 */
const RECENCY_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Weights follow the shape of the design note: wording outranks recency. */
const WEIGHT = Object.freeze({
  semantic_similarity: 0.25,
  recent_task: 0.15
});

/**
 * A message and a requirement are compared as bags of words. Latin words are
 * split on their own boundaries; Chinese has none, so overlapping bigrams stand
 * in for tokenisation — no dictionary, no dependency, and "超时" still matches
 * inside "接口超时问题", which is the whole point.
 */
export function extractKeywords(text) {
  const value = String(text ?? '').toLowerCase();
  const words = new Set();
  for (const [word] of value.matchAll(/[a-z][a-z0-9_-]+/g)) {
    if (word.length >= MIN_WORD && !STOPWORDS.has(word)) words.add(word);
  }
  // Ticket numbers, versions, timeouts: the digits are often the whole subject.
  for (const [digits] of value.matchAll(/\d{2,}/g)) words.add(digits);
  for (const run of value.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) words.add(run.slice(i, i + 2));
  }
  return words;
}

/**
 * @returns {{taskId: string, task: object, score: number,
 *   reasons: {type: string, score: number}[]}[]} Best first.
 */
export function scoreTaskCandidates(tasks = [], { text = '', now = Date.now } = {}) {
  const asked = extractKeywords(text);
  const ts = typeof now === 'function' ? now() : Number(now);
  return tasks
    .map((task) => {
      const reasons = [];
      const overlap = share(asked, extractKeywords(task.requirement ?? task.goal ?? ''));
      if (overlap > 0) {
        reasons.push({ type: 'semantic_similarity', score: round(overlap * WEIGHT.semantic_similarity) });
      }
      const fresh = recency(task, ts);
      if (fresh > 0) reasons.push({ type: 'recent_task', score: round(fresh * WEIGHT.recent_task) });
      const score = round(reasons.reduce((total, reason) => total + reason.score, 0));
      return { taskId: task.id, task, score, reasons };
    })
    .sort((a, b) => b.score - a.score
      || String(b.task.updatedAt ?? '').localeCompare(String(a.task.updatedAt ?? '')));
}

/**
 * A ranking is only worth showing when the top of it means something. Two tasks
 * a hair apart are not a recommendation, and presenting them as one trains the
 * user to accept whichever the bot listed first.
 */
export function leadingCandidate(ranking = [], { margin = 0.08 } = {}) {
  const [first, second] = ranking;
  if (!first?.score) return null;
  if (!first.reasons.some((reason) => reason.type === 'semantic_similarity')) return null;
  if (second && first.score - second.score < margin) return null;
  return first;
}

/** How much of what the user said this task accounts for. */
function share(asked, known) {
  if (!asked.size || !known.size) return 0;
  let hits = 0;
  for (const word of asked) if (known.has(word)) hits += 1;
  return hits / asked.size;
}

function recency(task, ts) {
  const touched = Date.parse(task?.updatedAt ?? task?.createdAt ?? '');
  if (!Number.isFinite(touched)) return 0;
  const age = ts - touched;
  if (age <= 0) return 1;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return 1 - (age / RECENCY_WINDOW_MS);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
