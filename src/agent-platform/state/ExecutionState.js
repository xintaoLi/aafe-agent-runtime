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
 * Mutable state the planner observes between steps.
 *
 * @typedef ExecutionHistoryEntry
 * @property {number} step
 * @property {string} agent
 * @property {string} capability
 * @property {string} status
 * @property {string} [reason]
 * @property {number} durationMs
 */

export class ExecutionState {
  constructor({ task, runId, root }) {
    this.task = task;
    this.runId = runId;
    this.root = root;
    this.step = 0;
    /** @type {Map<string, import('../protocol/response.js').AgentResponse>} */
    this.resultsByCapability = new Map();
    /** @type {ExecutionHistoryEntry[]} */
    this.history = [];
    /** @type {import('../protocol/response.js').SuggestedAction[]} */
    this.pendingSuggestions = [];
    /** @type {object[]} */
    this.knowledgeUpdates = [];
    /** @type {string[]} */
    this.diagnostics = [];
    /**
     * Run-wide spend. Aggregated here rather than derived from the history at
     * the end, because the policy has to be able to stop the run mid-flight.
     */
    this.metrics = { tokens: 0, cost: 0, agentCalls: 0, agentDurationMs: 0, byAgent: {} };
    this.replans = 0;
    this.startedAt = Date.now();
  }

  record(node, response) {
    this.step += 1;
    if (response.status === 'success' || response.status === 'partial') {
      this.resultsByCapability.set(node.capability, response);
    }
    const durationMs = (node.finishedAt ?? Date.now()) - (node.startedAt ?? Date.now());
    this.history.push({
      step: this.step,
      node: node.id,
      agent: node.agent,
      capability: node.capability,
      status: response.status,
      ...(response.reason ? { reason: response.reason } : {}),
      ...(response.contract ? { contract: compactContract(response.contract) } : {}),
      durationMs
    });
    this.knowledgeUpdates.push(...(response.knowledgeUpdates ?? []));
    this.pendingSuggestions = [...(response.nextActions ?? [])];
    this.#accumulate(node, response, durationMs);
    return this;
  }

  /**
   * Fold one agent's self-reported metrics into the run total. Agents report
   * what they know; nothing is inferred, so a zero here means "not measured"
   * rather than "free".
   */
  #accumulate(node, response, durationMs) {
    const metrics = response.metrics ?? {};
    const tokens = Number(metrics.tokens ?? 0);
    const cost = Number(metrics.cost ?? 0);
    const duration = Number(metrics.duration ?? durationMs ?? 0);

    this.metrics.agentCalls += 1;
    if (Number.isFinite(tokens)) this.metrics.tokens += tokens;
    if (Number.isFinite(cost)) this.metrics.cost += cost;
    if (Number.isFinite(duration)) this.metrics.agentDurationMs += duration;

    const key = node.agent ?? 'unknown';
    const entry = this.metrics.byAgent[key] ?? { calls: 0, tokens: 0, cost: 0, durationMs: 0 };
    entry.calls += 1;
    entry.tokens += Number.isFinite(tokens) ? tokens : 0;
    entry.cost += Number.isFinite(cost) ? cost : 0;
    entry.durationMs += Number.isFinite(duration) ? duration : 0;
    this.metrics.byAgent[key] = entry;
  }

  /**
   * Planner-visible spend, used by ExecutionPolicy.assertWithinBudget.
   */
  spent() {
    return { tokens: this.metrics.tokens, cost: this.metrics.cost };
  }

  resultFor(capability) {
    return this.resultsByCapability.get(capability) ?? null;
  }

  has(capability) {
    return this.resultsByCapability.has(capability);
  }

  /**
   * Capabilities already attempted, regardless of outcome. Used by the planner
   * to avoid re-requesting a capability that failed or was skipped.
   */
  attemptedCapabilities() {
    return new Set(this.history.map((entry) => entry.capability));
  }

  satisfiedCapabilities() {
    return new Set(this.resultsByCapability.keys());
  }

  failedCapabilities() {
    return this.history.filter((entry) => entry.status === 'failed').map((entry) => entry.capability);
  }

  skippedCapabilities() {
    return this.history.filter((entry) => entry.status === 'skipped').map((entry) => entry.capability);
  }

  /**
   * The `executionState` block of PlannerInput (AGENTS.SCHEMA §2.1).
   */
  toPlannerView() {
    return {
      status: this.step === 0 ? 'initial' : 'running',
      step: this.step,
      completedSteps: Array.from(this.resultsByCapability.keys()),
      failedSteps: this.failedCapabilities(),
      skippedSteps: this.skippedCapabilities(),
      currentResults: this.history.map((entry) => ({
        capability: entry.capability,
        agent: entry.agent,
        status: entry.status,
        ...(entry.reason ? { reason: entry.reason } : {})
      })),
      diagnostics: this.diagnostics
    };
  }

  toJSON() {
    return {
      runId: this.runId,
      task: this.task,
      step: this.step,
      history: this.history,
      satisfied: Array.from(this.resultsByCapability.keys()),
      knowledgeUpdates: this.knowledgeUpdates,
      diagnostics: this.diagnostics,
      metrics: this.metrics,
      replans: this.replans,
      durationMs: Date.now() - this.startedAt
    };
  }
}

/**
 * Keep the per-step contract diagnostics readable in `run.json`: the schema
 * verdicts matter, the repair transcript does not.
 */
function compactContract(contract) {
  return {
    ...(contract.input && contract.input !== 'ok' ? { input: contract.input } : {}),
    ...(contract.output && contract.output !== 'ok' ? { output: contract.output } : {}),
    ...(contract.evidence && contract.evidence !== 'ok' ? { evidence: contract.evidence } : {}),
    ...(contract.repairs?.length ? { repairs: contract.repairs.length } : {}),
    ...(contract.attempts > 1 ? { attempts: contract.attempts } : {})
  };
}
