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

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import { detectTestRunners } from '../../testing/runnerDetect.js';
import { parseTestReport } from '../../testing/reportParser.js';
import { loadE2eConfig } from '../../testing/e2e/config.js';
import { executeE2eCases } from '../../testing/e2e/runner.js';
import { persistImpactPack, writeInventoryCases } from '../../testing/e2e/inventory.js';
import { fetchPullRequest, parsePrUrl, resolvePrToken } from '../../testing/e2e/pr.js';
import { collectDiffFacts } from '../../static-analysis/git/DiffFacts.js';
import { shouldRouteToUnitChain } from '../../testing/e2e/layers.js';
import { buildTestPlan } from './plan.js';
import { generateTests } from './generate.js';

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
    const task = request.context?.task ?? {};
    const scenario = request.input?.scenario ?? task.scenario ?? 'changes';
    const impact = pickImpact(request);

    if (scenario !== 'coverage' && scenario !== 'pr' && !impact) {
      return agentSkipped('no-impact-report-to-plan-tests-from', {
        nextActions: [{ capability: 'requirement-impact', reason: 'test planning is scoped by the impact report' }]
      });
    }

    const started = Date.now();
    const changedFiles = await this.#changedFiles(request, root);
    if (changedFiles?.blocked) {
      return agentPartial(
        { blocked: true, error: changedFiles.error, scenario },
        changedFiles.error,
        { metrics: { duration: Date.now() - started } }
      );
    }
    const plan = await buildTestPlan({
      impact,
      knowledge,
      requirement: request.input?.requirement ?? task.requirement ?? task.goal ?? '',
      runners,
      scenario,
      root,
      changedFiles: changedFiles ?? []
    });
    plan.scenario = scenario;
    plan.pr = task.prUrl ? { url: task.prUrl } : plan.pr ?? null;

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
    if (plan?.blocked) {
      return agentPartial(plan, plan.error ?? 'blocked', {});
    }
    if (!plan?.scenarios?.length) {
      return agentSkipped('no-test-plan-available', {
        nextActions: [{ capability: 'test-planning', reason: 'generation needs a plan first' }]
      });
    }

    const task = request.context?.task ?? {};
    const writeRequested = request.input?.write ?? task.e2eWrite ?? true;
    const e2e = await loadE2eConfig(root);
    const write = writeRequested && e2e.enabled;
    const started = Date.now();
    const config = e2e;
    const written = [];
    let files = [];

    if (plan.scenario === 'coverage' && plan.inventory && write) {
      const coverageWrite = await writeInventoryCases(plan.inventory, {
        casesDir: config.casesDirAbs,
        update: task.e2eUpdate === true || request.input?.update === true,
        force: task.e2eForce === true || request.input?.force === true
      });
      written.push(...coverageWrite.written.map((item) => path.relative(root, item.file)));
      files = generateTests(plan, { e2eRunner: runners.e2e.id, unitRunner: runners.unit.id, casesDir: config.casesDir });
    } else {
      files = generateTests(plan, { e2eRunner: runners.e2e.id, unitRunner: runners.unit.id, casesDir: config.casesDir });
      if (write && !shouldRouteToUnitChain(plan.layers)) {
        for (const file of files) {
          const target = path.join(root, file.path);
          await mkdir(path.dirname(target), { recursive: true });
          try {
            await writeFile(target, file.content, { encoding: 'utf8', flag: file.overwrite ? 'w' : 'wx' });
            written.push(file.path);
          } catch (error) {
            if (error?.code === 'EEXIST') continue;
            throw error;
          }
        }
      }
    }

    if (plan.inventory) {
      await persistImpactPack(config.impactDirAbs, 'inventory.json', plan.inventory);
    } else if (write && (plan.scenario === 'changes' || plan.scenario === 'pr')) {
      await persistImpactPack(
        config.impactDirAbs,
        plan.scenario === 'pr' ? 'pr-plan.json' : 'changes.json',
        { scenario: plan.scenario, layers: plan.layers, pr: plan.pr ?? null, scenarios: plan.scenarios }
      );
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

  async #changedFiles(request, root) {
    const task = request.context?.task ?? {};
    if (task.prUrl) {
      try {
        if (task.inlineToken) {
          resolvePrToken({ provider: parsePrUrl(task.prUrl).provider, inlineToken: task.inlineToken });
        }
        const fetched = await fetchPullRequest(task.prUrl, { root });
        await persistImpactPack(
          (await loadE2eConfig(root)).impactDirAbs,
          `pr-${fetched.number}.json`,
          fetched
        );
        return fetched.files.map((file) => file.path);
      } catch (error) {
        return { blocked: true, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const diff = await collectDiffFacts(root, task.diffRef ?? request.input?.diffRef ?? null);
    return (diff.files ?? []).map((file) => file.path);
  }

  async #execute(request, root, runners) {
    const task = request.context?.task ?? {};
    const plan = pickPlan(request);
    if (plan?.blocked) {
      return agentSkipped('pr-fetch-blocked', { result: plan });
    }
    if (shouldRouteToUnitChain(plan?.layers)) {
      return agentSkipped('e2e-not-applicable', {
        result: { layers: plan.layers, enableWith: 'unit tests via project runner' }
      });
    }
    const e2e = await loadE2eConfig(root);
    if (!e2e.enabled) {
      return agentSkipped('e2e-not-enabled', {
        result: { enableWith: 'aafe e2e enable' }
      });
    }
    if (request.constraints?.allowTestExecution !== true) {
      return agentSkipped('test-execution-not-allowed', {
        result: {
          runner: 'playwright',
          command: 'aafe test --run',
          enableWith: '.aafe.agents.json → policies.allowTestExecution = true (or aafe test --run)'
        }
      });
    }

    const started = Date.now();
    const caseIds = collectCaseIds(plan, task.scenario ?? request.input?.scenario);
    const executed = await executeE2eCases({
      root,
      caseIds,
      dryRun: task.dryRun === true,
      baseUrl: task.baseUrl ?? null,
      urlRole: task.urlRole ?? null,
      authMode: task.authMode ?? null,
      authEnv: task.authEnv ?? null,
      storageState: task.storageState ?? null
    });
    const status = executed.report?.verdict ?? 'uncertain';
    const result = {
      runner: 'playwright',
      command: 'aafe test --run',
      status: status === 'passed' ? 'passed' : 'failed',
      verdict: status,
      reportDir: executed.reportDir,
      htmlPath: executed.htmlPath,
      jsonPath: executed.jsonPath,
      report: parseTestReport(JSON.stringify(executed.report)),
      detectedRunners: runners.e2e.id ?? runners.unit.id,
      needInput: executed.needInput ?? null,
      askUser: executed.askUser ?? false,
      prompt: executed.prompt ?? null,
      persistBaseUrl: executed.persistBaseUrl ?? false
    };
    if (status === 'passed') {
      return agentSuccess(result, { metrics: { duration: Date.now() - started } });
    }
    return agentPartial(result, executed.report?.statusReason ?? 'e2e run did not pass', {
      metrics: { duration: Date.now() - started },
      nextActions: [{ capability: 'failure-analysis', reason: 'a failing run needs root-cause analysis' }]
    });
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

function collectCaseIds(plan, scenario) {
  const fromPlan = (plan?.scenarios ?? []).map((item) => item.caseId).filter(Boolean);
  const fromMatch = (plan?.matchedCases ?? []).map((item) => item.id);
  const ids = [...new Set([...fromPlan, ...fromMatch])];
  if (scenario === 'coverage') return ids.length > 0 ? ids : null;
  return ids;
}

function toEntries(priorResults) {
  if (!priorResults) return new Map();
  return priorResults instanceof Map ? priorResults : new Map(Object.entries(priorResults));
}
