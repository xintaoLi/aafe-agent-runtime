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

import { normalizeModuleId } from '../../knowledge/model/index.js';
import { loadE2eConfig } from '../../testing/e2e/config.js';
import { buildInventoryPack } from '../../testing/e2e/inventory.js';
import { planTestLayers, shouldRouteToUnitChain } from '../../testing/e2e/layers.js';
import { matchExistingCases } from '../../testing/e2e/match.js';
import { isRealRoute, normalizeEntry } from '../../testing/e2e/yaml.js';
import { filePathMatches, normalizeRouteRecord } from '../../static-analysis/routes/normalize.js';

/**
 * Build a test plan from what the platform already knows (RFC §15).
 *
 * Every scenario is derived from a concrete artifact — an affected route, a
 * feature with code evidence, or a business rule — so the plan can be traced
 * back and never invents a screen that does not exist.
 */
export async function buildTestPlan({
  impact,
  knowledge,
  requirement = '',
  runners,
  scenario = 'changes',
  root = process.cwd(),
  changedFiles = []
}) {
  if (scenario === 'coverage') {
    return buildCoveragePlan({ knowledge, requirement, runners, root });
  }

  let scopedImpact = impact;
  if (knowledge && changedFiles.length > 0) {
    const extraModules = [];
    for (const file of changedFiles) {
      const moduleId = await knowledge.findModuleByFile(file);
      if (moduleId) extraModules.push({ id: moduleId, score: 0.8 });
    }
    if (extraModules.length > 0) {
      const seen = new Set((impact?.affectedModules ?? []).map((item) => item.id));
      scopedImpact = {
        ...(impact ?? { risk: 'medium', affectedModules: [], affectedFeatures: [], affectedBusinessFlows: [], affectedDataFlows: [], affectedTests: [] }),
        affectedModules: [
          ...(impact?.affectedModules ?? []),
          ...extraModules.filter((item) => !seen.has(item.id))
        ]
      };
    }
  }

  const layers = planTestLayers(
    changedFiles.length > 0
      ? changedFiles
      : (scopedImpact?.affectedFiles ?? []).map((item) => item.path ?? item.file ?? item.id)
  );

  if (shouldRouteToUnitChain(layers)) {
    const base = await buildImpactPlan({ impact: scopedImpact, knowledge, requirement, runners, changedFiles });
    const matchedCases = await matchPlanCases(root, base, changedFiles);
    return {
      ...base,
      scenario,
      layers,
      matchedCases,
      e2eApplicable: false,
      scenarios: base.scenarios.filter((item) => item.kind !== 'e2e')
    };
  }

  const base = await buildImpactPlan({ impact: scopedImpact, knowledge, requirement, runners, changedFiles });
  const matchedCases = await matchPlanCases(root, base, changedFiles);
  return {
    ...base,
    scenario,
    layers,
    matchedCases,
    e2eApplicable: layers.primary === 'e2e' || base.scenarios.some((item) => item.kind === 'e2e')
  };
}

async function matchPlanCases(root, plan, changedFiles = []) {
  if (!root) return [];
  const config = await loadE2eConfig(root);
  const routeHints = (plan.scenarios ?? [])
    .map((item) => item.source?.path)
    .filter((item) => isRealRoute(item));
  return matchExistingCases(config.casesDirAbs, { routeHints, frontendPaths: changedFiles });
}

async function buildCoveragePlan({ knowledge, requirement, runners, root }) {
  const config = await loadE2eConfig(root);
  const pack = await buildInventoryPack({ knowledge, root, casesDir: config.casesDirAbs });
  const scenarios = [];
  const evidence = [];
  if (!pack.ok) {
    return {
      id: `plan:${Date.now().toString(36)}`,
      requirement: requirement || 'full coverage from analyze',
      risk: 'low',
      scenario: 'coverage',
      runner: { e2e: runners?.e2e?.id ?? 'playwright', unit: runners?.unit?.id ?? null },
      scenarios: [],
      existingTests: [],
      coverageGaps: [{ moduleId: '*', reason: pack.error ?? 'analyze-output-missing' }],
      evidence: [],
      inventory: pack
    };
  }

  for (const chain of pack.suggestedChains) {
    const entry = chain.entryHints?.[0];
    if (!isRealRoute(entry)) continue;
    scenarios.push({
      id: chain.id,
      caseId: chain.kind === 'feature' ? null : chain.id,
      title: chain.title,
      kind: 'e2e',
      steps: [`Navigate to ${entry}`, 'Wait for the page to load'],
      expected: ['No console errors', 'No HTTP errors'],
      priority: chain.kind === 'feature' ? 'normal' : 'critical',
      source: { type: chain.kind === 'feature' ? 'feature' : 'route', path: normalizeEntry(entry), moduleId: chain.moduleId, file: chain.file, coverage: chain.coverage },
      relatedFeature: chain.featureId ?? null
    });
    evidence.push({ type: 'route', file: chain.file ?? chain.moduleId, reason: `route ${entry}` });
  }

  return {
    id: `plan:${Date.now().toString(36)}`,
    requirement: requirement || 'full coverage from analyze',
    risk: 'medium',
    scenario: 'coverage',
    runner: { e2e: runners?.e2e?.id ?? 'playwright', unit: runners?.unit?.id ?? null },
    scenarios: dedupe(scenarios),
    existingTests: pack.matchedCases.map((item) => item.file),
    coverageGaps: (pack.verification?.missingFeatures ?? []).map((item) => ({
      moduleId: item.id,
      reason: item.reason
    })),
    evidence: evidence.slice(0, 40),
    inventory: pack,
    e2eApplicable: scenarios.length > 0
  };
}

async function buildImpactPlan({ impact, knowledge, requirement = '', runners, changedFiles = [] }) {
  const affectedModules = (impact?.affectedModules ?? []).slice(0, 8);
  const scenarios = [];
  const evidence = [];

  const routeScenarios = [
    ...await routesForModules(knowledge, affectedModules),
    ...await routesForChangedFiles(knowledge, changedFiles)
  ];
  for (const route of routeScenarios) {
    scenarios.push({
      id: `scenario:route:${slug(route.path)}`,
      title: `${route.moduleId}: ${route.path} still renders and responds`,
      kind: 'e2e',
      steps: [
        `Navigate to ${route.path}`,
        'Wait for the primary content of the page to settle',
        'Exercise the interaction touched by this change'
      ],
      expected: [
        'The route renders without a runtime or console error',
        'Data required by the view is present',
        'No regression in the surrounding navigation'
      ],
      priority: priorityFor(route.score, impact?.risk),
      source: { type: 'route', moduleId: route.moduleId, path: normalizeEntry(route.path), file: route.file ?? null }
    });
    evidence.push({ type: 'route', file: route.file ?? route.moduleId, reason: `route ${route.path}` });
  }

  for (const feature of (impact?.affectedFeatures ?? []).slice(0, 10)) {
    const anchor = (feature.evidence ?? [])[0];
    scenarios.push({
      id: `scenario:feature:${slug(feature.id ?? feature.label)}`,
      title: `Feature "${feature.label}" keeps working after the change`,
      kind: 'e2e',
      steps: [
        `Reach the entry point of "${feature.label}"`,
        'Perform the feature\'s primary user action',
        'Verify the resulting state'
      ],
      expected: [`"${feature.label}" behaves as before the change`],
      priority: priorityFor(feature.score, impact?.risk),
      source: { type: 'feature', id: feature.id, file: anchor?.file ?? null }
    });
    if (anchor) evidence.push(anchor);
  }

  for (const flow of (impact?.affectedBusinessFlows ?? []).slice(0, 8)) {
    scenarios.push({
      id: `scenario:business:${slug(flow.id ?? flow.label)}`,
      title: `Business rule "${flow.label}" is still enforced`,
      kind: 'unit',
      steps: ['Set up the inputs the rule guards', 'Invoke the code path that applies the rule'],
      expected: ['The rule accepts valid input and rejects invalid input as before'],
      priority: 'critical',
      source: { type: 'business', id: flow.id }
    });
  }

  for (const dataFlow of (impact?.affectedDataFlows ?? []).slice(0, 6)) {
    scenarios.push({
      id: `scenario:dataflow:${slug(dataFlow.id)}`,
      title: `Data flow ${dataFlow.id} still delivers data end to end`,
      kind: 'integration',
      steps: ['Trigger the request at the top of the flow', 'Follow the response through to the view'],
      expected: ['Each hop in the flow produces the shape the next hop expects'],
      priority: 'normal',
      source: { type: 'data-flow', id: dataFlow.id }
    });
  }

  const existing = (impact?.affectedTests ?? []).slice(0, 30);

  return {
    id: `plan:${Date.now().toString(36)}`,
    requirement: requirement || null,
    risk: impact?.risk ?? 'low',
    runner: {
      e2e: runners?.e2e?.id ?? null,
      unit: runners?.unit?.id ?? null
    },
    scenarios: dedupe(scenarios).sort(byPriority),
    existingTests: existing,
    // Blind spots are the point of the plan: modules in the blast radius with
    // no covering test today are exactly where a regression will slip through.
    coverageGaps: coverageGaps(affectedModules, existing),
    evidence: evidence.slice(0, 20)
  };
}

async function routesForModules(knowledge, modules) {
  if (!knowledge) return [];
  const routes = [];
  for (const item of modules) {
    const slice = await knowledge.getModule(normalizeModuleId(item.id));
    for (const route of (slice?.routes ?? []).slice(0, 8)) {
      const record = normalizeRouteRecord(route);
      if (!isRealRoute(record.path)) continue;
      routes.push({
        moduleId: slice.id,
        path: record.path,
        file: record.file || record.component || slice.files?.[0] || null,
        score: item.score ?? 0.5
      });
    }
  }
  return routes.slice(0, 15);
}

async function routesForChangedFiles(knowledge, changedFiles) {
  if (!knowledge || changedFiles.length === 0) return [];
  const routes = [];
  const modules = await knowledge.modulesIndex();
  for (const entry of modules) {
    const slice = await knowledge.getModule(normalizeModuleId(entry.id));
    if (!slice) continue;
    for (const route of slice.routes ?? []) {
      const record = normalizeRouteRecord(route);
      if (!isRealRoute(record.path)) continue;
      const related = changedFiles.some((file) =>
        filePathMatches(file, record.file)
        || filePathMatches(file, record.component)
        || (slice.files ?? []).some((owned) => filePathMatches(file, owned))
      );
      if (!related) continue;
      routes.push({
        moduleId: slice.id,
        path: record.path,
        file: record.file || record.component || null,
        score: 0.85
      });
    }
  }
  return routes.slice(0, 15);
}

function coverageGaps(modules, existingTests) {
  const covered = new Set();
  for (const test of existingTests) {
    for (const segment of test.split('/')) covered.add(segment.toLowerCase());
  }
  return modules
    .filter((item) => !Array.from(covered).some((segment) => item.id.toLowerCase().includes(segment)))
    .map((item) => ({ moduleId: item.id, reason: 'no test file maps to this module' }));
}

function priorityFor(score, risk) {
  if (risk === 'high' || (score ?? 0) >= 0.85) return 'critical';
  if ((score ?? 0) >= 0.4) return 'normal';
  return 'low';
}

const PRIORITY_ORDER = { critical: 0, normal: 1, low: 2 };

function byPriority(a, b) {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

function dedupe(scenarios) {
  const byId = new Map();
  for (const scenario of scenarios) {
    if (!byId.has(scenario.id)) byId.set(scenario.id, scenario);
  }
  return Array.from(byId.values());
}

function slug(value) {
  return String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'unknown';
}
