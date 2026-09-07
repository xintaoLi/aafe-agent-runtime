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

import { parseTapdAssociation } from '../../../src/agent-platform/tasks/tapdPolicy.js';
import { scoreTaskCandidates } from './candidates.js';
import { scanTaskId, scanTaskIds, scanTaskSuffixes } from './quote.js';
import { isTerminalStatus } from './session.js';

/**
 * Requirement text is only trusted as a reference when the quote contains the
 * whole of it. Below this length a "match" is a coincidence, and binding a
 * message to the wrong task is worse than not binding it at all.
 */
const MIN_TEXT_MATCH = 8;

/**
 * How long a task may sit untouched and still absorb a message that points
 * nowhere in particular. Past it, "your last active task" is a guess about
 * yesterday's work, and waking an agent on it costs more to undo than one
 * question costs to ask.
 */
export const DEFAULT_STALE_MS = 12 * 60 * 60 * 1000;

/**
 * How long a completed task still counts as "the one I just watched finish".
 * Past it, appending would be a guess about yesterday; inside it, a decision
 * on that analysis (`全部 squash 成1个`) belongs to that task rather than to a
 * brand-new investigation that has none of the findings.
 */
export const WARM_COMPLETED_MS = 30 * 60 * 1000;

/**
 * How much the anchor is worth believing, by what found it. Nothing branches on
 * these yet; they travel with the anchor so a wrong binding can be explained
 * from the logs instead of reconstructed from the message.
 */
const CONFIDENCE = Object.freeze({
  'explicit:task-id': 1,
  'explicit:task-suffix': 0.9,
  'quoted:task-id': 0.95,
  'quoted:task-suffix': 0.85,
  'quoted:requirement-match': 0.8,
  'quoted:tapd-story': 0.8,
  'active:last-active': 0.6,
  'recent:last-completed': 0.65
});

/**
 * Which task does this message belong to? Answered before any routing, because
 * every later decision (append, create, ask) depends on it.
 *
 * Precedence is by strength of evidence: a named id beats a partial one, both
 * beat a quote, and a quote beats "the task you happen to have running". A
 * referenced task may be finished. The implicit one sees live work, and when
 * nothing is live it may see one just-completed owned task inside a short
 * warm window — that is the "I just watched it finish, here is the decision"
 * turn. Yesterday's completed task stays out, which is how a story that ended
 * hours ago used to claim every later message.
 *
 * The implicit anchor is also the only one that can be wrong without anybody
 * saying so, which is why it declines twice: with two live tasks and nothing
 * choosing between them, and with one that has gone quiet for `staleMs`.
 *
 * @param {object} options
 * @param {object[]} [options.tasks] Conversation-scoped tasks, newest first.
 * @param {(id: string) => Promise<object|null>} [options.lookup] Resolves an id
 *   named in the text or in a quote, which may live outside this conversation.
 * @returns {Promise<{kind: string, taskId: string|null, task: object|null,
 *   ownerId: string|null, actorRole: string|null, via: string|null,
 *   confidence: number, reasons: string[], candidates: object[],
 *   foreignActive: object[]}>}
 */
export async function resolveTaskAnchor({
  tasks = [],
  source = {},
  text = '',
  quote = null,
  taskId = null,
  lookup = null,
  now = Date.now,
  staleMs = DEFAULT_STALE_MS,
  warmCompletedMs = WARM_COMPLETED_MS
} = {}) {
  const foreignActive = tasks.filter((task) => isActive(task) && !ownedBy(task, source));

  const referenced = await matchReferences(tasks, text, taskId, lookup);
  // One instruction cannot drive two tasks, and picking either would run it
  // against a branch the user did not mean. Naming both is the answer.
  if (referenced.tasks.length > 1) return undecided('multiple', referenced.tasks, foreignActive);
  if (referenced.tasks.length === 1) {
    return anchor('explicit', referenced.tasks[0], source, referenced.via, foreignActive);
  }
  if (referenced.missing) {
    // Named but unknown: say so rather than quietly falling through to whatever
    // else is running, which is how a typo would hit the wrong task.
    return {
      ...none(foreignActive),
      kind: 'missing',
      taskId: referenced.missing,
      via: 'task-id',
      reasons: ['task-id-not-found']
    };
  }

  if (quote?.present) {
    const quoted = await matchQuotedTask(tasks, quote, lookup);
    if (quoted) return anchor('quoted', quoted.task, source, quoted.via, foreignActive);
  }

  // `tasks` is newest first, so these are the speaker's live tasks in order.
  const mine = tasks.filter((task) => isActive(task) && ownedBy(task, source));
  if (mine.length > 1) {
    // Still a refusal, but a ranked one: an unordered list of three ids is a
    // worse question than the same list with the likeliest first.
    const ranking = scoreTaskCandidates(mine, { text, now });
    return undecided('ambiguous', ranking.map((entry) => entry.task), foreignActive, ranking);
  }
  if (mine.length === 1) {
    if (isStale(mine[0], now(), staleMs)) return undecided('stale', mine, foreignActive);
    return anchor('active', mine[0], source, 'last-active', foreignActive);
  }

  // Nothing live: a just-completed owned task is still the conversation for a
  // short window. Newest first, so recent[0] is the one they just watched.
  const recent = tasks.filter((task) => ownedBy(task, source) && isWarmCompleted(task, now(), warmCompletedMs));
  if (recent.length) {
    return anchor('recent', recent[0], source, 'last-completed', foreignActive);
  }

  return none(foreignActive);
}

/**
 * Every task the message points at by name, whether written in full or by the
 * tail people retype from a footer. An id that resolves to nothing is reported
 * separately: a typo has to be visible, not absorbed.
 */
async function matchReferences(tasks, text, taskId, lookup) {
  const found = [];
  const ids = taskId ? [String(taskId).toLowerCase()] : scanTaskIds(text);
  let missing = null;
  for (const id of ids) {
    const task = tasks.find((item) => String(item.id).toLowerCase() === id)
      ?? (lookup ? await lookup(id) : null);
    if (task) push(found, task);
    else missing ??= id;
  }
  if (found.length) return { tasks: found, via: 'task-id', missing: null };
  if (missing) return { tasks: [], via: null, missing };
  for (const task of matchSuffixes(tasks, text)) push(found, task);
  return { tasks: found, via: found.length ? 'task-suffix' : null, missing: null };
}

function push(list, task) {
  if (!list.some((item) => item.id === task.id)) list.push(task);
}

/**
 * An explicit anchor is the only thing that lets a non-owner contribute. A
 * finished task is revived by a reference, or by the speaker's own
 * just-completed task while it is still warm and nothing else is live.
 */
export function isExplicitAnchor(anchor) {
  return anchor?.kind === 'explicit' || anchor?.kind === 'quoted';
}

export function isActive(task) {
  return Boolean(task) && !isTerminalStatus(task.status);
}

/**
 * A completed task is warm while its last touch is inside the window. Failed
 * and cancelled stays out: those are not "I just watched the analysis finish".
 * An undated completed task is treated as cold, unlike a live one, because
 * reviving old records that never stored `updatedAt` is how yesterday leaked
 * into today.
 */
export function isWarmCompleted(task, ts, warmMs = WARM_COMPLETED_MS) {
  if (task?.status !== 'completed') return false;
  if (!(warmMs > 0)) return false;
  const touched = Date.parse(task?.updatedAt ?? task?.createdAt ?? '');
  if (!Number.isFinite(touched)) return false;
  return ts - touched <= warmMs;
}

export function ownedBy(task, source = {}) {
  const owner = task?.source?.userId ?? null;
  if (!owner || !source.userId) return true;
  return owner === source.userId;
}

/**
 * The bot stamps its Task ID into the footer of every task reply, so quoting
 * one of them is an exact reference. Quoting one's own original requirement
 * carries no id, hence the fallbacks: the requirement verbatim, and the TAPD
 * ticket the task was created from, which survives any rewording around it.
 *
 * An id found here goes through `lookup` like one typed into the text does. A
 * conversation only carries its most recent tasks, and a reference that works
 * when typed must not fail when quoted.
 */
async function matchQuotedTask(tasks, quote, lookup) {
  const body = String(quote.text ?? '').trim();
  const named = scanTaskId(body);
  if (named) {
    const task = tasks.find((item) => item.id === named) ?? (lookup ? await lookup(named) : null);
    if (task) return { task, via: 'task-id' };
  }
  const suffixed = matchSuffix(tasks, body);
  if (suffixed) return { task: suffixed, via: 'task-suffix' };
  if (body.length < MIN_TEXT_MATCH) return null;
  const byRequirement = tasks.find((item) => {
    const requirement = String(item.requirement ?? item.goal ?? '').trim();
    return requirement.length >= MIN_TEXT_MATCH && body.includes(requirement);
  });
  if (byRequirement) return { task: byRequirement, via: 'requirement-match' };
  const story = parseTapdAssociation(body);
  if (!story) return null;
  const byStory = tasks.find((item) => {
    const other = parseTapdAssociation(item.requirement ?? item.goal ?? '');
    return other?.entryId === story.entryId;
  });
  return byStory ? { task: byStory, via: 'tapd-story' } : null;
}

/**
 * A partial id is a reference only while it is unambiguous. A tail shared by
 * two tasks would make that one a coin flip, so it is dropped and the caller
 * falls back on better evidence — but two different tails naming two different
 * tasks is not ambiguity, it is two references.
 */
function matchSuffixes(tasks, text) {
  const found = [];
  for (const suffix of scanTaskSuffixes(text)) {
    const hits = tasks.filter((task) => String(task.id ?? '').toLowerCase().endsWith(`-${suffix}`));
    if (hits.length === 1) found.push(hits[0]);
  }
  return found;
}

function matchSuffix(tasks, text) {
  const hits = matchSuffixes(tasks, text);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * `updatedAt` is missing on tasks written before it was recorded. Those are
 * treated as fresh: refusing to continue a task because the bot cannot date it
 * would break work that is otherwise fine.
 */
function isStale(task, ts, staleMs) {
  if (!(staleMs > 0)) return false;
  const touched = Date.parse(task?.updatedAt ?? task?.createdAt ?? '');
  if (!Number.isFinite(touched)) return false;
  return ts - touched > staleMs;
}

function anchor(kind, task, source, via, foreignActive) {
  const ownerId = task.source?.userId ?? null;
  return {
    kind,
    taskId: task.id,
    task,
    ownerId,
    actorRole: ownedBy(task, source) ? 'owner' : 'participant',
    via,
    confidence: CONFIDENCE[`${kind}:${via}`] ?? 0.5,
    reasons: [`${kind}:${via}`],
    candidates: [task],
    foreignActive
  };
}

/**
 * Evidence points at these and no further. The candidates ride along so the
 * reply can name what the speaker has to choose between.
 */
const UNDECIDED = Object.freeze({
  ambiguous: { confidence: 0.4, reason: 'multiple-active-tasks' },
  stale: { confidence: 0.3, reason: 'last-active-is-stale' },
  multiple: { confidence: 0.5, reason: 'multiple-tasks-referenced' }
});

function undecided(kind, candidates, foreignActive, ranking = []) {
  return {
    ...none(foreignActive),
    kind,
    confidence: UNDECIDED[kind]?.confidence ?? 0.3,
    reasons: [UNDECIDED[kind]?.reason ?? kind],
    candidates,
    ranking
  };
}

function none(foreignActive) {
  return {
    kind: 'none',
    taskId: null,
    task: null,
    ownerId: null,
    actorRole: null,
    via: null,
    confidence: 0,
    reasons: [],
    candidates: [],
    ranking: [],
    foreignActive
  };
}
