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
 * Contracts for the testing and diagnosis capabilities (RFC §15, §16).
 *
 * The shapes the Test Agent and Failure Analyzer produce. The runtime enforces
 * them from the JSON Schemas under `src/agents/*/output.schema.json`; these
 * typedefs are the same contract in a form editors can use.
 *
 * @typedef TestPlan
 * @property {string} id
 * @property {string} feature
 * @property {string[]} preconditions
 * @property {TestScenario[]} scenarios
 *
 * @typedef TestScenario
 * @property {string} id
 * @property {string} title
 * @property {string[]} steps
 * @property {string[]} expected
 * @property {'critical'|'normal'|'low'} priority
 *
 * @typedef TestRunResult
 * @property {'passed'|'failed'|'skipped'} status
 * @property {string} scenarioId
 * @property {number} durationMs
 * @property {TestArtifacts} [artifacts]
 *
 * @typedef TestArtifacts
 * @property {string} [trace]
 * @property {string} [screenshot]
 * @property {string[]} [console]
 * @property {object[]} [network]
 *
 * @typedef FailureReport
 * @property {'assertion'|'runtime'|'network'|'timeout'|'environment'|'unknown'} classification
 * @property {string} rootCause
 * @property {string[]} relatedFiles
 * @property {string[]} relatedDataFlows
 * @property {'low'|'medium'|'high'} risk
 * @property {string[]} fixSuggestions
 * @property {string[]} regressionTests
 */

export const TESTING_CAPABILITIES = Object.freeze([
  'test-planning',
  'test-generation',
  'e2e-execution'
]);

export const DIAGNOSIS_CAPABILITIES = Object.freeze([
  'failure-analysis',
  'root-cause-analysis',
  'fix-analysis'
]);

export const FAILURE_CLASSIFICATIONS = Object.freeze([
  'assertion',
  'runtime',
  'network',
  'timeout',
  'environment',
  'unknown'
]);
