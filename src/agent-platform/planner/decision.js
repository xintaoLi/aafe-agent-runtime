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
 * The planner only ever emits decisions; it holds no file, shell or git
 * capability of its own (RFC §4, §34).
 *
 * @typedef {'invoke_agent'|'parallel'|'replan'|'complete'|'need_user_input'|'fail'} PlannerAction
 *
 * @typedef PlannerDecision
 * @property {PlannerAction} action
 * @property {string} [capability]      Requested capability, not an agent id.
 * @property {{capability:string,input?:*}[]} [tasks]  For `parallel`.
 * @property {*} [input]
 * @property {string} reason
 * @property {string[]} [expectedOutput]
 * @property {number} [confidence]
 */

export const PLANNER_ACTIONS = Object.freeze([
  'invoke_agent',
  'parallel',
  'replan',
  'complete',
  'need_user_input',
  'fail'
]);

export function invokeAgent(capability, reason, extra = {}) {
  return { action: 'invoke_agent', capability, reason, ...extra };
}

export function parallel(tasks, reason, extra = {}) {
  return { action: 'parallel', tasks, reason, ...extra };
}

export function complete(reason, extra = {}) {
  return { action: 'complete', reason, ...extra };
}

export function needUserInput(reason, extra = {}) {
  return { action: 'need_user_input', reason, ...extra };
}

export function fail(reason, extra = {}) {
  return { action: 'fail', reason, ...extra };
}

/**
 * Coerce an untrusted decision (e.g. an LLM completion) into the contract.
 * Returns null when it cannot be repaired, so the caller can fall back.
 * @returns {PlannerDecision|null}
 */
export function normalizeDecision(raw, { availableCapabilities = [] } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (!PLANNER_ACTIONS.includes(raw.action)) return null;

  const reason = String(raw.reason ?? '').trim() || 'no reason given';

  if (raw.action === 'invoke_agent') {
    const capability = String(raw.capability ?? '').trim();
    if (!capability) return null;
    if (availableCapabilities.length > 0 && !availableCapabilities.includes(capability)) return null;
    return {
      action: 'invoke_agent',
      capability,
      input: raw.input ?? null,
      reason,
      expectedOutput: toStringArray(raw.expectedOutput),
      confidence: toConfidence(raw.confidence)
    };
  }

  if (raw.action === 'parallel') {
    const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .map((task) => ({ capability: String(task?.capability ?? '').trim(), input: task?.input ?? null }))
      .filter((task) => task.capability
        && (availableCapabilities.length === 0 || availableCapabilities.includes(task.capability)));
    if (tasks.length === 0) return null;
    return { action: 'parallel', tasks, reason, confidence: toConfidence(raw.confidence) };
  }

  return { action: raw.action, reason, confidence: toConfidence(raw.confidence) };
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toConfidence(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
