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

import { complete, fail, invokeAgent, needUserInput, parallel } from './decision.js';

/**
 * Placeholder resolved per task: a diff-driven run scopes by diff, a
 * requirement-driven one by requirement. Keeping it a token means the plans
 * stay declarative instead of branching per task kind.
 */
const IMPACT_TOKEN = '@impact';

/**
 * Capability sequence per task kind. Every entry is optional at runtime: a
 * capability whose agent is disabled degrades to a skipped node rather than
 * aborting the run.
 *
 * An array entry is a parallel group: independent capabilities the orchestrator
 * may fan out at once (RFC §35).
 */
const CAPABILITY_PLANS = Object.freeze({
  requirement: ['requirement-impact', 'knowledge-validation', 'context-packaging'],
  diff: ['change-impact', 'knowledge-validation', 'context-packaging'],
  // A failure is diagnosed first, then re-scoped against the diff that caused it.
  failure: ['failure-analysis', 'change-impact', 'context-packaging'],
  analysis: [
    'project-analysis',
    ['architecture-analysis', 'dependency-analysis', 'data-flow-analysis', 'feature-analysis', 'business-flow-analysis']
  ],
  // Verification scopes by whatever the task carries, then plans, generates
  // and (only if explicitly allowed) runs the tests.
  test: [IMPACT_TOKEN, 'knowledge-validation', 'test-planning', 'test-generation', 'e2e-execution', 'context-packaging'],
  generic: ['requirement-impact', 'knowledge-validation', 'context-packaging']
});

const TERMINAL_CAPABILITY = 'context-packaging';

/**
 * Capabilities whose absence is a normal outcome rather than a blocked plan.
 * Running the suite is opt-in, so a skipped execution must not turn the whole
 * run into "needs user input".
 */
const OPTIONAL_CAPABILITIES = new Set(['e2e-execution', 'test-generation', 'knowledge-validation']);

/**
 * Deterministic planner. It is the default because the whole chain must be
 * usable offline with no API key, and because a reproducible plan is far
 * easier to debug than a sampled one.
 */
export class RulePlanner {
  constructor({ maxSteps = 12, maxSuggestions = 3 } = {}) {
    this.id = 'rule-planner';
    this.maxSteps = maxSteps;
    this.maxSuggestions = maxSuggestions;
    this.acceptedSuggestions = 0;
  }

  /**
   * @param {object} ctx
   * @returns {Promise<import('./decision.js').PlannerDecision>}
   */
  async decide(ctx) {
    const { task, state, knowledge } = ctx;
    const attempted = state.attemptedCapabilities();

    if (!attempted.has('project-analysis')) {
      const stale = await isKnowledgeStale(knowledge);
      if (stale.stale) {
        return invokeAgent('project-analysis', `project knowledge is ${stale.reason}`, {
          input: { reason: stale.reason },
          expectedOutput: ['modules', 'routes', 'features'],
          confidence: 0.9
        });
      }
    }

    const plan = resolvePlan(task);
    for (const step of plan) {
      if (Array.isArray(step)) {
        const pending = step
          .filter((capability) => !attempted.has(capability) && ctx.registry.hasCapability(capability));
        if (pending.length === 0) continue;
        if (pending.length === 1) {
          return invokeAgent(pending[0], `task kind "${task.kind}" requires ${pending[0]}`, {
            input: this.#inputFor(pending[0], ctx),
            confidence: 0.85
          });
        }
        return parallel(
          pending.map((capability) => ({ capability, input: this.#inputFor(capability, ctx) })),
          `${pending.length} independent analyses for task kind "${task.kind}"`,
          { confidence: 0.85 }
        );
      }

      if (attempted.has(step)) continue;
      return invokeAgent(step, `task kind "${task.kind}" requires ${step}`, {
        input: this.#inputFor(step, ctx),
        confidence: 0.85
      });
    }

    const suggestion = this.#nextSuggestion(ctx, attempted);
    if (suggestion) {
      this.acceptedSuggestions += 1;
      return invokeAgent(suggestion.capability, `agent suggested: ${suggestion.reason}`, {
        input: this.#inputFor(suggestion.capability, ctx),
        confidence: 0.6
      });
    }

    return this.#finish(ctx, plan);
  }

  #finish(ctx, planArg) {
    const { state, task } = ctx;
    const plan = planArg ?? resolvePlan(task);
    if (state.has(TERMINAL_CAPABILITY)) {
      return complete('context package is ready for the IDE agent');
    }

    const blocking = plan
      .flat()
      .filter((capability) => !OPTIONAL_CAPABILITIES.has(capability))
      .map((capability) => ({ capability, entry: state.history.find((item) => item.capability === capability) }))
      .filter(({ entry }) => entry && entry.status !== 'success' && entry.status !== 'partial');

    if (blocking.length > 0) {
      const detail = blocking.map(({ capability, entry }) => `${capability}: ${entry.reason ?? entry.status}`).join('; ');
      if (blocking.every(({ entry }) => entry.status === 'skipped')) {
        return needUserInput(`required capabilities are unavailable (${detail})`);
      }
      return fail(`required capabilities failed (${detail})`);
    }

    if (task.kind === 'analysis' && state.has('project-analysis')) {
      return complete('project analysis finished');
    }
    return fail('planner exhausted its plan without producing a context package');
  }

  #nextSuggestion(ctx, attempted) {
    if (this.acceptedSuggestions >= this.maxSuggestions) return null;
    return (ctx.state.pendingSuggestions ?? []).find((suggestion) =>
      !attempted.has(suggestion.capability) && ctx.registry.hasCapability(suggestion.capability)) ?? null;
  }

  #inputFor(capability, ctx) {
    const { task } = ctx;
    switch (capability) {
      case 'requirement-impact':
        return { requirement: task.requirement ?? task.goal };
      case 'change-impact':
        return { diffRef: task.diffRef ?? null };
      case 'failure-analysis':
        return { failureRef: task.failureRef ?? null };
      case 'knowledge-validation':
        return { source: 'impact' };
      case 'context-packaging':
        return { kind: task.kind, goal: task.goal };
      case 'test-planning':
      case 'test-generation':
      case 'e2e-execution':
        return { requirement: task.requirement ?? task.goal };
      default:
        return null;
    }
  }
}

/**
 * Expands a task kind's plan, resolving the `@impact` placeholder.
 * @returns {(string|string[])[]}
 */
function resolvePlan(task) {
  const plan = CAPABILITY_PLANS[task.kind] ?? CAPABILITY_PLANS.generic;
  const impact = task.diffRef || !task.requirement ? 'change-impact' : 'requirement-impact';
  return plan.map((step) => (Array.isArray(step)
    ? step.map((capability) => (capability === IMPACT_TOKEN ? impact : capability))
    : (step === IMPACT_TOKEN ? impact : step)));
}

async function isKnowledgeStale(knowledge) {
  if (!knowledge) return { stale: true, reason: 'unavailable' };
  try {
    return await knowledge.staleness();
  } catch (error) {
    return { stale: true, reason: `unreadable:${error instanceof Error ? error.message : String(error)}` };
  }
}

export { CAPABILITY_PLANS, TERMINAL_CAPABILITY };
