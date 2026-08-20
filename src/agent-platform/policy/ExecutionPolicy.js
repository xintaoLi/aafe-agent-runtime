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

import { defaultConstraints } from '../protocol/request.js';

/**
 * Commands that are irreversible from inside a run (RFC §34).
 *
 * The planner is not allowed to reach these, and a `cli` agent whose command
 * contains one is refused before it is ever spawned. This is a deliberately
 * coarse denylist: it does not try to be a shell parser, it tries to make the
 * obviously destructive cases impossible to reach by accident.
 */
export const FORBIDDEN_COMMAND_PATTERNS = Object.freeze([
  /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf]/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+push\b/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+branch\s+-D\b/,
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\bsudo\b/,
  />\s*\/dev\/sd[a-z]/
]);

/**
 * Timeout / retry / parallelism / cost budget for one run.
 * The planner may never widen these; only the project config can.
 */
export class ExecutionPolicy {
  constructor(policies = {}) {
    this.base = defaultConstraints(policies);
    // `tokenBudget` sizes one agent's context package; `maxTokens` caps what the
    // whole run may spend. Conflating them would let a single context package
    // exhaust the run, so they are separate knobs and the run-wide one is off
    // by default.
    this.maxTokens = positiveOrNull(policies.maxTokens);
    this.maxCost = positiveOrNull(policies.maxCost);
  }

  /**
   * Effective constraints for one agent, honouring per-agent overrides but
   * never exceeding the run-level parallelism or network permission.
   */
  constraintsFor(agent) {
    const override = agent?.execution ?? {};
    return {
      ...this.base,
      timeoutMs: clampPositive(override.timeoutMs, this.base.timeoutMs),
      maxRetries: clampNonNegative(override.maxRetries, this.base.maxRetries)
    };
  }

  get maxParallel() {
    return Math.max(1, this.base.maxParallel);
  }

  get allowNetwork() {
    return this.base.allowNetwork === true;
  }

  get tokenBudget() {
    return Number.isFinite(this.base.tokenBudget) ? this.base.tokenBudget : null;
  }

  /**
   * Providers that leave the process require explicit network permission, and
   * anything that can destroy the working tree is refused outright.
   */
  assertProviderAllowed(agent) {
    if (agent?.provider === 'http' && !this.allowNetwork) {
      return `network-disabled-for-http-agent:${agent.id}`;
    }
    return this.assertNotDestructive(agent);
  }

  /**
   * @returns {string|null} A skip reason, or null when the agent is safe to run.
   */
  assertNotDestructive(agent) {
    const candidates = [
      agent?.provider === 'cli' ? agent.ref : null,
      ...(agent?.tools ?? [])
    ].filter((value) => typeof value === 'string' && value);

    for (const candidate of candidates) {
      const pattern = FORBIDDEN_COMMAND_PATTERNS.find((regexp) => regexp.test(candidate));
      if (pattern) return `destructive-operation-denied:${agent.id}:${pattern.source}`;
    }
    return null;
  }

  /**
   * Run-level spend check (RFC §34). Enforced between steps rather than mid
   * call: aborting a request already in flight costs the tokens anyway.
   *
   * @param {{tokens?: number, cost?: number}} spent
   * @returns {string|null} The reason the run must stop, or null.
   */
  assertWithinBudget(spent = {}) {
    const tokens = Number(spent.tokens ?? 0);
    const cost = Number(spent.cost ?? 0);
    if (this.maxTokens !== null && tokens > this.maxTokens) {
      return `token-budget-exhausted:${Math.round(tokens)}/${this.maxTokens}`;
    }
    if (this.maxCost !== null && cost > this.maxCost) {
      return `cost-budget-exhausted:${cost.toFixed(4)}/${this.maxCost}`;
    }
    return null;
  }
}

/**
 * Run an async task under a timeout without leaking the underlying work's
 * rejection when the timer wins.
 */
export async function withTimeout(promiseFactory, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promiseFactory();
  let timer;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms: ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded-concurrency map preserving input order.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function positiveOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clampPositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
