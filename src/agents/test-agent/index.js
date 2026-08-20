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

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import { detectTestRunners } from '../../testing/runnerDetect.js';
import { parseTestReport } from '../../testing/reportParser.js';
import { buildTestPlan } from './plan.js';
import { generateTests } from './generate.js';

const execFileAsync = promisify(execFile);

/**
 * A3 — Test Agent (RFC §15).
 *
 * Planning and generation are deterministic and always safe to run. Execution
 * is not: it spawns the project's own test command, so it stays opt-in behind
 * `policies.allowTestExecution` rather than firing as a side effect of analysis.
 */
export class TestAgent {
  id = 'test-agent';
  version = '1.0.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const root = request.context?.root ?? process.cwd();
    const knowledge = request.context?.knowledge ?? this.knowledge;
    const runners = await detectTestRunners(root);

    switch (request.capability) {
      case 'test-planning':
        return this.#plan(request, root, knowledge, runners);
      case 'test-generation':
        return this.#generate(request, root, knowledge, runners);
      case 'e2e-execution':
        return this.#execute(request, root, runners);
      default:
        return agentSkipped(`unsupported-capability:${request.capability}`);
    }
  }

  async #plan(request, root, knowledge, runners) {
    const impact = pickImpact(request);
    if (!impact) {
      return agentSkipped('no-impact-report-to-plan-tests-from', {
        nextActions: [{ capability: 'requirement-impact', reason: 'test planning is scoped by the impact report' }]
      });
    }

    const started = Date.now();
    const plan = await buildTestPlan({
      impact,
      knowledge,
      requirement: request.input?.requirement ?? request.context?.task?.requirement ?? '',
      runners
    });

    const response = {
      metrics: { duration: Date.now() - started },
      evidence: plan.evidence,
      nextActions: plan.scenarios.length > 0
        ? [{ capability: 'test-generation', reason: 'turn the plan into runnable skeletons' }]
        : []
    };

    if (plan.scenarios.length === 0) {
      return agentPartial(plan, 'impact report yielded no testable artifact', response);
    }
    return agentSuccess(plan, response);
  }

  async #generate(request, root, knowledge, runners) {
    const plan = pickPlan(request)
      ?? (await this.#plan(request, root, knowledge, runners)).result;
    if (!plan?.scenarios?.length) {
      return agentSkipped('no-test-plan-available', {
        nextActions: [{ capability: 'test-planning', reason: 'generation needs a plan first' }]
      });
    }

    const started = Date.now();
    const files = generateTests(plan, { e2eRunner: runners.e2e.id, unitRunner: runners.unit.id });
    const write = request.input?.write === true;
    const written = [];

    if (write) {
      for (const file of files) {
        const target = path.join(root, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
        written.push(file.path);
      }
    }

    const result = {
      planId: plan.id,
      written,
      files: files.map((file) => ({
        path: file.path,
        runner: file.runner,
        // Content is returned inline so an IDE agent can apply it without a
        // second round trip; the orchestrator persists it under the run dir.
        content: file.content
      }))
    };

    const detected = runners.e2e.id ?? runners.unit.id;
    const response = { metrics: { duration: Date.now() - started } };
    return detected
      ? agentSuccess(result, response)
      : agentPartial(result, 'no test runner detected; defaulted to playwright/vitest templates', response);
  }

  async #execute(request, root, runners) {
    const runner = runners.e2e.id ? runners.e2e : runners.unit;
    if (!runner.id) {
      return agentSkipped('no-test-runner-detected', {
        result: { scripts: Object.keys(runners.scripts) }
      });
    }
    if (!runner.command) {
      return agentSkipped(`no-npm-script-runs-${runner.id}`, {
        result: { runner: runner.id, scripts: Object.keys(runners.scripts) }
      });
    }
    if (request.constraints?.allowTestExecution !== true) {
      return agentSkipped('test-execution-not-allowed', {
        result: {
          runner: runner.id,
          command: `npm run ${runner.command}`,
          enableWith: '.aafe.agents.json → policies.allowTestExecution = true (or aafe test --run)'
        }
      });
    }

    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync('npm', ['run', runner.command], {
        cwd: root,
        maxBuffer: 32 * 1024 * 1024,
        timeout: request.constraints?.timeoutMs ?? 600000
      });
      return agentSuccess(
        { runner: runner.id, command: runner.command, status: 'passed', report: parseTestReport(stdout || stderr) },
        { metrics: { duration: Date.now() - started } }
      );
    } catch (error) {
      const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.trim();
      return agentPartial(
        {
          runner: runner.id,
          command: runner.command,
          status: 'failed',
          exitCode: error?.code ?? null,
          report: parseTestReport(output)
        },
        'test run failed',
        {
          metrics: { duration: Date.now() - started },
          nextActions: [{ capability: 'failure-analysis', reason: 'a failing run needs root-cause analysis' }]
        }
      );
    }
  }
}

function pickImpact(request) {
  const prior = toEntries(request.context?.priorResults);
  for (const key of ['knowledge-validation', 'requirement-impact', 'change-impact']) {
    const value = prior.get(key)?.result;
    if (key === 'knowledge-validation' && value?.trustedImpact) return value.trustedImpact;
    if (key !== 'knowledge-validation' && value) return value;
  }
  return request.input?.impact ?? null;
}

function pickPlan(request) {
  return request.input?.plan ?? toEntries(request.context?.priorResults).get('test-planning')?.result ?? null;
}

function toEntries(priorResults) {
  if (!priorResults) return new Map();
  return priorResults instanceof Map ? priorResults : new Map(Object.entries(priorResults));
}
