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

import { createEvidence } from '../types/evidence.js';
import { normalizeRouteRecord } from '../routes/normalize.js';

/**
 * Build per-module analysis bundles:
 * routes + components + features + dataflow + relations.
 */
export function buildModuleBundles(context) {
  const modules = context.architecture?.modules ?? [];
  const features = context.features?.candidates ?? [];
  const dataflow = context.dataflow ?? { flows: [] };
  const routeGraph = context.graph?.routeGraph ?? { nodes: {}, edges: [] };

  const bundles = modules.map((mod) => {
    const fileSet = new Set(mod.filePaths ?? []);
    const components = collectComponents(mod, context);
    const routes = (mod.routes ?? []).map((route) => {
      const record = normalizeRouteRecord(route);
      return {
        path: record.path,
        name: record.name,
        file: record.file,
        component: record.component,
        source: record.source,
        evidence: [createEvidence({ type: 'route', file: record.file, reason: record.path })]
      };
    });

    const moduleFeatures = features.filter((feature) =>
      feature.entrypoints?.some((entry) => routes.some((route) => route.path === entry || route.file === entry))
      || feature.evidence?.some((item) => fileSet.has(item.file))
    );

    const moduleFlows = (dataflow.flows ?? []).filter((flow) =>
      flow.kind === 'application'
        ? routes.some((route) => route.path === flow.entrypoint || fileSet.has(String(flow.nodes?.[1] || '').replace(/^file:/, '')))
        : (flow.nodes ?? []).some((node) => {
          const path = String(node).replace(/^file:/, '');
          return fileSet.has(path);
        })
    );

    const componentRelations = collectComponentRelations(mod, components, routeGraph, context);
    const summary = {
      routes: routes.length,
      components: components.length,
      features: moduleFeatures.length,
      flows: moduleFlows.length,
      dependsOn: mod.dependencies ?? []
    };

    return {
      id: mod.id,
      name: mod.name,
      files: mod.files,
      filePaths: mod.filePaths ?? [],
      dependencies: mod.dependencies ?? [],
      signals: mod.signals ?? [],
      routes,
      components,
      features: moduleFeatures,
      dataflow: {
        flows: moduleFlows.slice(0, 80),
        levels: {
          application: moduleFlows.filter((flow) => flow.kind === 'application').length,
          import: moduleFlows.filter((flow) => flow.kind === 'import').length,
          call: moduleFlows.filter((flow) => flow.kind === 'call').length
        }
      },
      componentRelations,
      architecture: {
        kind: 'module',
        boundaries: {
          files: mod.filePaths ?? [],
          routes: routes.map((route) => route.path),
          components: components.map((item) => item.name)
        },
        outboundModules: mod.dependencies ?? [],
        evidence: mod.evidence ?? []
      },
      summary,
      evidence: [
        ...(mod.evidence ?? []).slice(0, 8),
        ...routes.flatMap((route) => route.evidence).slice(0, 8)
      ]
    };
  });

  const relations = {
    modules: (context.architecture?.dependencies ?? []).map((dep) => ({
      from: dep.from,
      to: dep.to,
      type: dep.type || 'MODULE_DEPENDS',
      evidence: dep.evidence ?? []
    })),
    components: bundles.flatMap((bundle) =>
      bundle.componentRelations.map((rel) => ({ ...rel, moduleId: bundle.id }))
    ),
    dataflow: bundles.flatMap((bundle) =>
      (bundle.dataflow.flows ?? [])
        .filter((flow) => flow.kind === 'application')
        .flatMap((flow) => (flow.edges ?? []).map((edge) => ({
          moduleId: bundle.id,
          flowId: flow.id,
          from: edge.from,
          to: edge.to,
          type: edge.type
        })))
    ),
    architectureFlows: bundles.flatMap((bundle) =>
      (bundle.dependencies ?? []).map((dep) => ({
        from: bundle.id,
        to: dep,
        type: 'ARCHITECTURE_FLOW',
        via: 'module-dependency'
      }))
    )
  };

  return { bundles, relations };
}

function collectComponents(mod, context) {
  const components = [];
  const seen = new Set();
  for (const file of mod.filePaths ?? []) {
    const extracted = context.cache.parsed.get(file)?.extracted;
    for (const component of extracted?.components ?? []) {
      const key = `${file}:${component.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      components.push({
        name: component.name,
        kind: component.kind || 'component',
        file,
        evidence: [createEvidence({ type: 'ast', file, symbol: component.name })]
      });
    }
    // page-like file without explicit component name
    if (/(pages|views|app)\//.test(file) && !(extracted?.components?.length)) {
      const base = file.split('/').pop()?.replace(/\.[^.]+$/, '') || file;
      const key = `${file}:${base}`;
      if (!seen.has(key)) {
        seen.add(key);
        components.push({
          name: base,
          kind: 'page',
          file,
          evidence: [createEvidence({ type: 'source', file, reason: 'page-like file' })]
        });
      }
    }
  }
  return components.slice(0, 80);
}

function collectComponentRelations(mod, components, routeGraph, context) {
  const relations = [];
  const fileToComponents = new Map();
  for (const component of components) {
    if (!fileToComponents.has(component.file)) fileToComponents.set(component.file, []);
    fileToComponents.get(component.file).push(component);
  }

  for (const file of mod.filePaths ?? []) {
    const extracted = context.cache.parsed.get(file)?.extracted;
    const fromComponents = fileToComponents.get(file) ?? [{ name: shortName(file), file }];
    for (const imp of extracted?.imports ?? []) {
      if (!imp.source?.startsWith('.')) continue;
      // approximate: relate to known module files by basename match in visited graph
      for (const other of mod.filePaths ?? []) {
        if (other === file) continue;
        const base = other.split('/').pop()?.replace(/\.[^.]+$/, '');
        if (!base) continue;
        if (!imp.source.includes(base)) continue;
        const toComponents = fileToComponents.get(other) ?? [{ name: shortName(other), file: other }];
        relations.push({
          from: fromComponents[0].name,
          fromLabel: fromComponents[0].name,
          to: toComponents[0].name,
          toLabel: toComponents[0].name,
          type: 'IMPORTS',
          fromFile: file,
          toFile: other,
          evidence: [createEvidence({ type: 'dependency', file, reason: imp.source })]
        });
      }
    }
  }

  // route → page component
  for (const route of mod.routes ?? []) {
    if (!route.file) continue;
    const pageComponents = fileToComponents.get(route.file) ?? [];
    for (const component of pageComponents.slice(0, 2)) {
      relations.push({
        from: `route:${route.path}`,
        fromLabel: route.path,
        to: component.name,
        toLabel: component.name,
        type: 'ROUTES_TO',
        fromFile: route.file,
        toFile: component.file,
        evidence: [createEvidence({ type: 'route', file: route.file, reason: route.path })]
      });
    }
  }

  return uniqueRelations(relations).slice(0, 120);
}

function uniqueRelations(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.from}|${item.to}|${item.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function shortName(file) {
  return String(file).split('/').pop()?.replace(/\.[^.]+$/, '') || file;
}
