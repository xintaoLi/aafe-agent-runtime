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

import { partitionModules } from '../modules/partition.js';
import { createSemanticAnalyzer } from '../semantic/port.js';
import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

export class ArchitectureAnalyzer {
  id = 'architecture';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    if (context.config.architecture?.enabled === false) {
      return createAnalysisResult(this.id, this.version, { modules: [], layers: [], dependencies: [], risks: [] }, {
        status: 'partial',
        diagnostics: [{ level: 'info', code: 'disabled', message: 'architecture analyzer disabled' }]
      });
    }

    const routeGraph = context.graph?.routeGraph ?? { routes: [], visited: [], nodes: {}, edges: [] };
    const modules = partitionModules(routeGraph, { maxModules: 80 });
    const moduleModels = modules.map((mod) => ({
      id: `module:${mod.id}`,
      name: mod.id,
      files: mod.fileCount,
      filePaths: mod.files,
      dependencies: mod.dependsOn.map((id) => `module:${id}`),
      routes: mod.routes.map((route) => route.path),
      signals: mod.signals,
      evidence: mod.files.slice(0, 8).map((file) => createEvidence({
        type: 'source',
        file,
        reason: 'module membership'
      }))
    }));

    const dependencies = [];
    for (const mod of moduleModels) {
      for (const dep of mod.dependencies) {
        dependencies.push({
          from: mod.id,
          to: dep,
          type: 'MODULE_DEPENDS',
          evidence: mod.evidence.slice(0, 2)
        });
      }
    }

    const risks = detectRisks(moduleModels, dependencies);
    const semantic = createSemanticAnalyzer(context.config.llm);
    const semanticResult = await semantic.analyze({
      kind: 'architecture',
      modules: moduleModels
    }, context);

    const data = {
      modules: moduleModels,
      layers: [], // semantic / LLM territory — do not invent DDD layers statically
      dependencies,
      risks,
      semantic: semanticResult,
      note: 'Static facts only. Layer naming / DDD classification reserved for Semantic Port / LLM agents.'
    };

    return createAnalysisResult(this.id, this.version, data, {
      evidence: moduleModels.flatMap((mod) => mod.evidence).slice(0, 100),
      stats: {
        modules: moduleModels.length,
        dependencies: dependencies.length,
        durationMs: Date.now() - started
      }
    });
  }
}

function detectRisks(modules, dependencies) {
  const risks = [];
  const depCount = new Map();
  for (const dep of dependencies) {
    depCount.set(dep.from, (depCount.get(dep.from) ?? 0) + 1);
  }
  for (const mod of modules) {
    if ((depCount.get(mod.id) ?? 0) >= 8) {
      risks.push({
        id: `risk:high-coupling:${mod.name}`,
        type: 'high-coupling',
        module: mod.id,
        message: `Module ${mod.name} depends on ${depCount.get(mod.id)} modules`,
        evidence: mod.evidence.slice(0, 3)
      });
    }
    if (mod.files <= 1 && (depCount.get(mod.id) ?? 0) === 0 && mod.routes.length === 0) {
      risks.push({
        id: `risk:isolated:${mod.name}`,
        type: 'isolated-module',
        module: mod.id,
        message: `Module ${mod.name} appears isolated`,
        evidence: mod.evidence.slice(0, 2)
      });
    }
  }

  // Simple cycle detection on module dependency graph
  const adj = new Map();
  for (const dep of dependencies) {
    if (!adj.has(dep.from)) adj.set(dep.from, []);
    adj.get(dep.from).push(dep.to);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function dfs(node) {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      risks.push({
        id: `risk:cycle:${stack.slice(cycleStart).join('>')}`,
        type: 'circular-dependency',
        message: `Circular dependency: ${[...stack.slice(cycleStart), node].join(' -> ')}`,
        evidence: []
      });
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) dfs(next);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const mod of modules) dfs(mod.id);
  return risks.slice(0, 50);
}
