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

import { RulePlanner } from './RulePlanner.js';
import { normalizeDecision } from './decision.js';

const SYSTEM_PROMPT = `You are the AAFE planner. You decide the next single step of a
frontend project-analysis run. You never write code, never run commands and never
choose an agent by name — you choose a capability.

Reply with one JSON object:
{"action":"invoke_agent"|"parallel"|"replan"|"complete"|"need_user_input"|"fail",
 "capability":"<one of the available capabilities>",
 "tasks":[{"capability":"..."}],
 "reason":"<short justification>",
 "expectedOutput":["..."],
 "confidence":0.0}

Rules:
- Only request capabilities from the available list.
- Never request a capability that already succeeded.
- The run is finished once a context package exists; then answer "complete".`;

/**
 * LLM-driven planner. Any transport error, malformed completion or
 * out-of-contract capability falls back to the deterministic planner, so
 * enabling the LLM can slow a run down but can never break it.
 */
export class LlmPlanner {
  /**
   * @param {import('../../llm/LlmClient.js').LlmClient} client
   */
  constructor(client, { maxSteps = 12, fallback = new RulePlanner({ maxSteps }) } = {}) {
    this.id = 'llm-planner';
    this.client = client;
    this.maxSteps = maxSteps;
    this.fallback = fallback;
    /** @type {string[]} */
    this.fallbackReasons = [];
  }

  async decide(ctx) {
    if (!this.client?.isConfigured()) {
      return this.#fallback(ctx, this.client?.unavailableReason() ?? 'llm-client-missing');
    }

    const available = Object.entries(ctx.capabilities)
      .filter(([, owner]) => !String(owner).startsWith('unavailable'))
      .map(([capability]) => capability);

    const result = await this.client.chatJson([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(this.#observation(ctx, available)) }
    ]);

    if (result.status !== 'success') {
      return this.#fallback(ctx, result.reason);
    }

    const decision = normalizeDecision(result.data, { availableCapabilities: available });
    if (!decision) {
      return this.#fallback(ctx, 'llm-decision-out-of-contract');
    }

    if (decision.action === 'invoke_agent' && ctx.state.attemptedCapabilities().has(decision.capability)) {
      return this.#fallback(ctx, `llm-repeated-capability:${decision.capability}`);
    }

    if (decision.action === 'invoke_agent' && decision.input == null) {
      decision.input = { requirement: ctx.task.requirement ?? ctx.task.goal, diffRef: ctx.task.diffRef ?? null };
    }
    return decision;
  }

  async #fallback(ctx, reason) {
    this.fallbackReasons.push(reason);
    ctx.state.diagnostics.push(`llm-planner fell back to rules: ${reason}`);
    const decision = await this.fallback.decide(ctx);
    return { ...decision, reason: `${decision.reason} (rule fallback: ${reason})` };
  }

  #observation(ctx, available) {
    return {
      task: {
        kind: ctx.task.kind,
        goal: ctx.task.goal,
        requirement: ctx.task.requirement ?? null,
        diffRef: ctx.task.diffRef ?? null
      },
      availableCapabilities: available,
      satisfiedCapabilities: Array.from(ctx.state.satisfiedCapabilities()),
      history: ctx.state.history.map((entry) => ({
        capability: entry.capability,
        status: entry.status,
        reason: entry.reason ?? null
      })),
      agentSuggestions: ctx.state.pendingSuggestions,
      step: ctx.state.step,
      maxSteps: this.maxSteps
    };
  }
}
