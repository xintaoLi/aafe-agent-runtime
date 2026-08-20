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

import { buildModuleGraph, degreeStats, detectCycles } from '../../knowledge/graph/relations.js';
import { normalizeModuleId } from '../../knowledge/model/index.js';

/**
 * Domain projections over already-analyzed knowledge.
 *
 * `project-analysis` is the only capability that runs the AST pipeline. The
 * five narrower capabilities read the persisted facts instead, which is what
 * makes fanning them out in parallel (RFC §35) worthwhile rather than five
 * redundant full analyses.
 */
export const VIEW_CAPABILITIES = Object.freeze([
  'architecture-analysis',
  'dependency-analysis',
  'data-flow-analysis',
  'feature-analysis',
  'business-flow-analysis'
]);

export function isViewCapability(capability) {
  return VIEW_CAPABILITIES.includes(capability);
}

/**
 * @returns {Promise<{ view: string, [key: string]: * }>}
 */
export async function buildView(capability, knowledge) {
  switch (capability) {
    case 'architecture-analysis':
      return architectureView(knowledge);
    case 'dependency-analysis':
      return dependencyView(knowledge);
    case 'data-flow-analysis':
      return dataFlowView(knowledge);
    case 'feature-analysis':
      return featureView(knowledge);
    case 'business-flow-analysis':
      return businessView(knowledge);
    default:
      throw new Error(`Unknown code-intelligence view: ${capability}`);
  }
}

async function architectureView(knowledge) {
  const [architecture, modulesIndex, relations] = await Promise.all([
    knowledge.architecture(),
    knowledge.modulesIndex(),
    knowledge.relations()
  ]);

  const modules = modulesIndex.map((entry) => ({
    id: entry.id,
    routes: entry.summary?.routes ?? 0,
    components: entry.summary?.components ?? 0,
    features: entry.summary?.features ?? 0,
    dependsOn: (entry.dependencies ?? []).map(normalizeModuleId)
  }));

  return {
    view: 'architecture',
    moduleCount: modules.length,
    modules,
    dependencies: relations.modules.map((relation) => ({
      from: normalizeModuleId(relation.from),
      to: normalizeModuleId(relation.to)
    })),
    risks: architecture.risks ?? []
  };
}

async function dependencyView(knowledge) {
  const [modulesIndex, relations] = await Promise.all([knowledge.modulesIndex(), knowledge.relations()]);
  const graph = buildModuleGraph(relations.modules);
  const ids = modulesIndex.map((entry) => normalizeModuleId(entry.id));
  const degrees = degreeStats(graph, ids);
  const cycles = detectCycles(graph);

  return {
    view: 'dependency',
    edgeCount: relations.modules.length,
    cycles,
    // Leaf modules are cheap to change; hubs are where regressions spread from.
    hubs: degrees.filter((item) => item.dependents >= 2).slice(0, 15),
    leaves: degrees.filter((item) => item.dependents === 0).map((item) => item.id).slice(0, 30),
    orphans: ids.filter((id) => !graph.forward.has(id) && !graph.reverse.has(id))
  };
}

async function dataFlowView(knowledge) {
  const [dataflow, relations] = await Promise.all([knowledge.dataflow(), knowledge.relations()]);
  const byModule = new Map();
  for (const relation of relations.dataflow) {
    const moduleId = normalizeModuleId(relation.moduleId);
    if (!moduleId) continue;
    const entry = byModule.get(moduleId) ?? { moduleId, flows: new Set(), edges: 0 };
    entry.flows.add(relation.flowId);
    entry.edges += 1;
    byModule.set(moduleId, entry);
  }

  return {
    view: 'data-flow',
    flowCount: (dataflow.flows ?? []).length,
    levels: dataflow.levels ?? {},
    byModule: Array.from(byModule.values())
      .map((entry) => ({ moduleId: entry.moduleId, flows: entry.flows.size, edges: entry.edges }))
      .sort((a, b) => b.edges - a.edges)
      .slice(0, 30)
  };
}

async function featureView(knowledge) {
  const candidates = await knowledge.features();
  return {
    view: 'feature',
    total: candidates.length,
    // Evidence-free candidates are reported separately so the validator can
    // downgrade them instead of them silently looking as solid as the rest.
    grounded: candidates.filter((item) => (item.evidence ?? []).length > 0).length,
    features: candidates.slice(0, 60).map((item) => ({
      id: item.id,
      name: item.name,
      confidence: item.confidence ?? 0,
      entrypoints: (item.entrypoints ?? []).slice(0, 4),
      evidence: (item.evidence ?? []).slice(0, 3)
    }))
  };
}

async function businessView(knowledge) {
  const candidates = await knowledge.business();
  return {
    view: 'business-flow',
    total: candidates.length,
    grounded: candidates.filter((item) => (item.evidence ?? []).length > 0).length,
    flows: candidates.slice(0, 60).map((item) => ({
      id: item.id ?? item.name,
      name: item.name ?? item.id,
      confidence: item.confidence ?? 0,
      evidence: (item.evidence ?? []).slice(0, 3)
    }))
  };
}
