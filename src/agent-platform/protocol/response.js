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
 * Unified agent response protocol.
 *
 * Agents may only *suggest* follow-up work via `nextActions`; the planner keeps
 * the final decision. Agents never schedule other agents themselves.
 *
 * @typedef SuggestedAction
 * @property {string} capability
 * @property {string} reason
 *
 * @typedef KnowledgeUpdate
 * @property {'upsert'|'downgrade'|'drop'} op
 * @property {string} kind        e.g. 'feature' | 'module' | 'flow'
 * @property {string} id
 * @property {*} [value]
 * @property {string} [reason]
 *
 * @typedef AgentResponse
 * @property {'success'|'failed'|'partial'|'skipped'} status
 * @property {*} result
 * @property {KnowledgeUpdate[]} [knowledgeUpdates]
 * @property {object[]} [evidence]   Reuses static-analysis Evidence shape.
 * @property {SuggestedAction[]} [nextActions]
 * @property {{tokens?:number,duration?:number,cost?:number}} [metrics]
 * @property {string} [reason]       Required when status is 'skipped' or 'failed'.
 */

export const AGENT_STATUS = Object.freeze(['success', 'failed', 'partial', 'skipped']);

/**
 * @returns {AgentResponse}
 */
export function createAgentResponse(partial = {}) {
  const status = AGENT_STATUS.includes(partial.status) ? partial.status : 'failed';
  return {
    status,
    result: partial.result ?? null,
    knowledgeUpdates: partial.knowledgeUpdates ?? [],
    evidence: partial.evidence ?? [],
    nextActions: normalizeNextActions(partial.nextActions),
    metrics: partial.metrics ?? {},
    ...(partial.reason ? { reason: partial.reason } : {})
  };
}

export function agentSuccess(result, extra = {}) {
  return createAgentResponse({ ...extra, status: 'success', result });
}

export function agentPartial(result, reason, extra = {}) {
  return createAgentResponse({ ...extra, status: 'partial', result, reason });
}

export function agentSkipped(reason, extra = {}) {
  return createAgentResponse({ result: null, ...extra, status: 'skipped', reason });
}

export function agentFailed(reason, extra = {}) {
  return createAgentResponse({ result: null, ...extra, status: 'failed', reason });
}

/**
 * Accepts an arbitrary provider payload (HTTP/CLI output) and coerces it into
 * the protocol shape so the orchestrator never sees a half-formed response.
 * @returns {AgentResponse}
 */
export function normalizeAgentResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return agentFailed('agent-returned-non-object');
  }
  if (!AGENT_STATUS.includes(raw.status)) {
    return agentFailed(`agent-returned-unknown-status:${String(raw.status)}`);
  }
  return createAgentResponse(raw);
}

function normalizeNextActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => action && typeof action.capability === 'string' && action.capability)
    .map((action) => ({
      capability: action.capability,
      reason: String(action.reason ?? '')
    }));
}
