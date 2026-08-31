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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AnalyzeOrchestrator } from '../../static-analysis/orchestrator.js';
import { resolveAnalyzeConfig } from '../../static-analysis/types/config.js';
import { createAnalyzeContext } from '../../static-analysis/types/context.js';
import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import { buildView, isViewCapability } from './views.js';

const execFileAsync = promisify(execFile);

/**
 * A1 — Code Intelligence.
 *
 * A thin shell over the deterministic analyze pipeline. Per RFC §13 the agent
 * does not parse anything itself: the static analyzer extracts facts, the
 * agent's job is to make them available as project knowledge.
 *
 * `project-analysis` produces the facts; the five narrower capabilities only
 * project them, which is what makes fanning those out in parallel cheap.
 */
export class CodeIntelligenceAgent {
  id = 'code-intelligence';
  version = '1.1.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const root = request.context?.root ?? process.cwd();
    const knowledge = request.context?.knowledge ?? this.knowledge;
    const force = request.input?.force === true;

    if (isViewCapability(request.capability)) {
      return this.#runView(request.capability, knowledge);
    }

    if (!force && knowledge) {
      const staleness = await knowledge.staleness();
      if (!staleness.stale) {
        return agentSuccess(await summarizeFromKnowledge(knowledge, staleness), {
          metrics: { duration: 0 },
          nextActions: []
        });
      }
    }

    const started = Date.now();
    const projectConfig = await readJson(path.join(root, '.aafe.config.json')) ?? {};
    const packageInfo = await readJson(path.join(root, 'package.json')) ?? {};
    const config = resolveAnalyzeConfig(root, projectConfig, { quiet: true });

    const context = createAnalyzeContext({
      root,
      config,
      project: {
        name: packageInfo.name ?? path.basename(root),
        root,
        version: packageInfo.version ?? null
      },
      commit: await gitHead(root)
    });

    const result = await new AnalyzeOrchestrator({ onPhase: () => {} }).run(context);
    knowledge?.invalidate();

    const summary = {
      source: 'analyze',
      stats: result.runtime.stats,
      modules: (result.architecture?.modules ?? []).map((mod) => ({ id: mod.id, name: mod.name, files: mod.files })),
      routes: (result.graph?.routes ?? []).length,
      features: (result.features?.candidates ?? []).length,
      risks: result.architecture?.risks ?? [],
      output: config.output,
      persist: result.persistResult ?? null
    };

    const semanticSkipped = result.architecture?.semantic?.status === 'not_available';
    const response = {
      metrics: { duration: Date.now() - started },
      evidence: (result.architecture?.modules ?? []).flatMap((mod) => (mod.evidence ?? []).slice(0, 1)).slice(0, 20)
    };

    return semanticSkipped
      ? agentPartial(summary, `semantic enrichment unavailable: ${result.architecture?.semantic?.reason ?? 'static-only'}`, response)
      : agentSuccess(summary, response);
  }

  /**
   * Domain views read persisted facts instead of re-running the pipeline, so
   * the planner can fan several of them out at once.
   */
  async #runView(capability, knowledge) {
    if (!knowledge) return agentSkipped('knowledge-store-unavailable');
    if (!(await knowledge.exists())) {
      return agentSkipped('analyze-output-missing', {
        nextActions: [{ capability: 'project-analysis', reason: `${capability} needs analyzed project knowledge` }]
      });
    }

    const started = Date.now();
    const view = await buildView(capability, knowledge);
    const staleness = await knowledge.staleness();
    const response = { metrics: { duration: Date.now() - started } };

    if (staleness.stale) {
      return agentPartial(view, `knowledge is ${staleness.reason}`, {
        ...response,
        nextActions: [{ capability: 'project-analysis', reason: `knowledge is ${staleness.reason}` }]
      });
    }
    return agentSuccess(view, response);
  }
}

/**
 * Fresh knowledge on disk is authoritative; re-running the AST pass would
 * produce the same facts at a much higher cost.
 */
async function summarizeFromKnowledge(knowledge, staleness) {
  const [manifest, index, modules] = await Promise.all([
    knowledge.manifest(),
    knowledge.index(),
    knowledge.modulesIndex()
  ]);
  const architecture = await knowledge.architecture();
  return {
    source: 'cache',
    reason: staleness.reason,
    stats: index?.stats ?? {},
    modules: modules.map((mod) => ({ id: mod.id, name: mod.id, files: mod.summary?.routes ?? 0 })),
    routes: (index?.entrypoints ?? []).length,
    features: index?.stats?.features ?? 0,
    risks: architecture?.risks ?? [],
    output: manifest?.output ?? '.aafe',
    commit: manifest?.analysis?.commit ?? null
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function gitHead(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
