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

/**
 * Build a test plan from what the platform already knows (RFC §15).
 *
 * Every scenario is derived from a concrete artifact — an affected route, a
 * feature with code evidence, or a business rule — so the plan can be traced
 * back and never invents a screen that does not exist.
 */
export async function buildTestPlan({ impact, knowledge, requirement = '', runners }) {
  const affectedModules = (impact?.affectedModules ?? []).slice(0, 8);
  const scenarios = [];
  const evidence = [];

  const routeScenarios = await routesForModules(knowledge, affectedModules);
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
      source: { type: 'route', moduleId: route.moduleId, path: route.path }
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
    for (const route of (slice?.routes ?? []).slice(0, 4)) {
      if (!route?.path) continue;
      routes.push({
        moduleId: slice.id,
        path: route.path,
        file: route.file ?? slice.files?.[0] ?? null,
        score: item.score ?? 0.5
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
