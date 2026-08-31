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
 * Unified agent invocation protocol.
 *
 * @typedef {'requirement'|'diff'|'failure'|'analysis'|'generic'} TaskKind
 *
 * @typedef Task
 * @property {string} id
 * @property {TaskKind} kind
 * @property {string} goal            Human-readable objective.
 * @property {string} [requirement]
 * @property {string} [diffRef]       Git ref/range for diff-driven tasks.
 * @property {string} [failureRef]    Path to a test/failure artifact.
 *
 * @typedef ExecutionConstraints
 * @property {number} timeoutMs
 * @property {number} maxRetries
 * @property {number} maxParallel
 * @property {boolean} allowNetwork
 * @property {number} [tokenBudget]
 *
 * @typedef AgentRequest
 * @property {string} taskId
 * @property {string} runId
 * @property {string} agentId
 * @property {string} capability      Capability the planner asked for.
 * @property {string} goal
 * @property {*} input
 * @property {object} context         Project root, knowledge handle, prior results.
 * @property {ExecutionConstraints} constraints
 */

let taskCounter = 0;

/**
 * @returns {Task}
 */
export function createTask(partial = {}) {
  taskCounter += 1;
  return {
    id: partial.id ?? `task-${Date.now().toString(36)}-${taskCounter}`,
    kind: partial.kind ?? 'generic',
    goal: partial.goal ?? '',
    requirement: partial.requirement ?? null,
    diffRef: partial.diffRef ?? null,
    failureRef: partial.failureRef ?? null,
    scenario: partial.scenario ?? null,
    prUrl: partial.prUrl ?? null,
    e2eWrite: partial.e2eWrite ?? null,
    e2eUpdate: partial.e2eUpdate ?? false,
    e2eForce: partial.e2eForce ?? false,
    inlineToken: partial.inlineToken ?? null,
    dryRun: partial.dryRun ?? false,
    baseUrl: partial.baseUrl ?? null,
    urlRole: partial.urlRole ?? null,
    authMode: partial.authMode ?? null,
    authEnv: partial.authEnv ?? null,
    storageState: partial.storageState ?? null
  };
}

/**
 * @returns {AgentRequest}
 */
export function createAgentRequest(partial = {}) {
  return {
    taskId: partial.taskId ?? '',
    runId: partial.runId ?? '',
    agentId: partial.agentId ?? '',
    capability: partial.capability ?? '',
    goal: partial.goal ?? '',
    input: partial.input ?? null,
    context: partial.context ?? {},
    constraints: partial.constraints ?? defaultConstraints()
  };
}

/**
 * @returns {ExecutionConstraints}
 */
export function defaultConstraints(partial = {}) {
  return {
    timeoutMs: partial.timeoutMs ?? 120000,
    maxRetries: partial.maxRetries ?? 1,
    maxParallel: partial.maxParallel ?? 4,
    allowNetwork: partial.allowNetwork ?? false,
    // Spawning the project's own test suite is a side effect, so it stays off
    // until the caller asks for it (`aafe test --run`) or the project opts in.
    allowTestExecution: partial.allowTestExecution ?? false,
    tokenBudget: partial.tokenBudget ?? 12000
  };
}
