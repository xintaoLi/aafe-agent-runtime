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
 * Agent definitions are data, never hard-coded call sites. The planner asks for
 * a capability; the registry resolves which agent currently provides it, so an
 * `impact-analyzer-v2` can replace `impact-analyzer` without planner changes.
 *
 * The prompt and the two schemas live on the definition rather than in the
 * orchestrator (AGENTS.SCHEMA §12): swapping DeepSeek for Qwen3 must not be a
 * code change, and an agent's contract must travel with the agent.
 *
 * @typedef AgentConstraints
 * @property {number} [maxTokens]
 * @property {number} [timeoutMs]
 * @property {number} [confidenceThreshold]
 * @property {number} [maxCost]
 *
 * @typedef AgentDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} capabilities
 * @property {'local'|'http'|'cli'|'mcp'|'ide'} provider
 * @property {string} [ref]           Provider-specific locator (builtin:<id>, URL, argv template).
 * @property {string|null} [endpoint] Canonical address for remote agents; `ref` is derived from it.
 * @property {string} [model]
 * @property {boolean} enabled
 * @property {object} [execution]     Per-agent timeout/retry overrides.
 * @property {string|null} [prompt]       Prompt reference (`builtin:<id>` or a project path).
 * @property {string|object|null} [inputSchema]
 * @property {string|object|null} [outputSchema]
 * @property {'enforce'|'warn'|'off'} [schemaMode]
 * @property {number} [maxRepairAttempts]
 * @property {string[]} [tools]       Tool ids the agent is allowed to use.
 * @property {AgentConstraints} [constraints]
 */

export const SCHEMA_MODES = Object.freeze(['enforce', 'warn', 'off']);

/**
 * Builtin agents are deterministic code, so a contract violation is a bug in
 * this repository rather than an unreliable model: report it, don't fail the
 * run. Remote agents are the opposite — an out-of-contract answer from an
 * unknown implementation is exactly what the schema exists to stop.
 */
export function defaultSchemaMode(provider) {
  return provider === 'local' ? 'warn' : 'enforce';
}

/**
 * Canonical builtin agent matrix (RFC §37).
 * A3/A4 ship as registered contracts with stub implementations so IDE agents
 * get a stable `skipped` answer instead of an unknown-command error.
 */
export const BUILTIN_AGENTS = Object.freeze({
  'code-intelligence': {
    name: 'Code Intelligence Agent',
    description: 'Turns deterministic AST facts into project knowledge (A1).',
    capabilities: [
      'project-analysis',
      'architecture-analysis',
      'dependency-analysis',
      'data-flow-analysis',
      'feature-analysis',
      'business-flow-analysis'
    ],
    enabled: true
  },
  'impact-analyzer': {
    name: 'Impact Analyzer Agent',
    description: 'Predicts blast radius from a requirement or a git diff (A2).',
    capabilities: ['requirement-impact', 'change-impact', 'risk-analysis'],
    enabled: true
  },
  'test-agent': {
    name: 'Test Agent',
    description: 'Test planning, generation and E2E execution (A3).',
    capabilities: ['test-planning', 'test-generation', 'e2e-execution'],
    enabled: true
  },
  'failure-analyzer': {
    name: 'Failure Analyzer Agent',
    description: 'Root cause and fix analysis for failing tests (A4).',
    capabilities: ['failure-analysis', 'root-cause-analysis', 'fix-analysis'],
    enabled: true
  },
  'knowledge-validator': {
    name: 'Knowledge Validator Agent',
    description: 'Deterministic evidence checks that keep bad knowledge out (A5).',
    capabilities: ['knowledge-validation', 'evidence-check'],
    enabled: true
  },
  'context-agent': {
    name: 'Context / Evidence Agent',
    description: 'Builds the minimal traceable context package for IDE agents (A6).',
    capabilities: ['context-packaging', 'evidence-selection'],
    enabled: true
  }
});

export const ALL_CAPABILITIES = Object.freeze(
  Array.from(new Set(Object.values(BUILTIN_AGENTS).flatMap((agent) => agent.capabilities)))
);

/**
 * @returns {AgentDefinition}
 */
export function createAgentDefinition(id, partial = {}) {
  const builtin = BUILTIN_AGENTS[id] ?? {};
  const provider = partial.provider ?? 'local';
  const endpoint = partial.endpoint ?? null;
  const schemaMode = SCHEMA_MODES.includes(partial.schemaMode)
    ? partial.schemaMode
    : defaultSchemaMode(provider);

  return {
    id,
    name: partial.name ?? builtin.name ?? id,
    description: partial.description ?? builtin.description ?? '',
    capabilities: partial.capabilities ?? builtin.capabilities ?? [],
    provider,
    // `endpoint` is the contract-level address (AGENTS.SCHEMA §11); `ref` stays
    // the provider-level locator. Declaring only one of them is normal, so each
    // fills in for the other rather than forcing callers to repeat themselves.
    endpoint,
    ref: partial.ref ?? endpoint ?? `builtin:${id}`,
    model: partial.model ?? null,
    enabled: partial.enabled ?? builtin.enabled ?? false,
    execution: partial.execution ?? {},
    prompt: partial.prompt ?? `builtin:${id}`,
    inputSchema: partial.inputSchema ?? `builtin:${id}`,
    outputSchema: partial.outputSchema ?? `builtin:${id}`,
    schemaMode,
    maxRepairAttempts: Number.isInteger(partial.maxRepairAttempts) ? partial.maxRepairAttempts : 2,
    tools: Array.isArray(partial.tools) ? [...partial.tools] : [],
    constraints: { ...(partial.constraints ?? {}) }
  };
}
