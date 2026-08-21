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

import { looksLikeComponentFile } from '../routes/normalize.js';

/**
 * Partition visited graph files into modules by route ownership + directory heuristics.
 */
export function partitionModules(routeGraph, options = {}) {
  const maxModules = options.maxModules ?? 60;
  const modules = new Map();

  for (const route of routeGraph.routes ?? []) {
    const moduleId = moduleIdFromRoute(route);
    const mod = ensureModule(modules, moduleId, {
      kind: 'route',
      title: route.path || moduleId,
      routes: []
    });
    mod.routes.push(route);
    if (route.file) {
      mod.files.add(route.file);
      attachNodeSignals(mod, routeGraph.nodes?.[route.file]);
    }
    if (looksLikeComponentFile(route.component)) {
      mod.files.add(route.component);
      attachNodeSignals(mod, routeGraph.nodes?.[route.component]);
    }
  }

  for (const file of routeGraph.visited ?? []) {
    const moduleId = moduleIdFromFile(file);
    const mod = ensureModule(modules, moduleId, {
      kind: 'directory',
      title: moduleId,
      routes: []
    });
    mod.files.add(file);
    attachNodeSignals(mod, routeGraph.nodes?.[file]);
  }

  // Attach dependency edges between modules
  for (const edge of routeGraph.edges ?? []) {
    const fromId = moduleIdFromFile(edge.from);
    const toId = moduleIdFromFile(edge.to);
    if (fromId === toId) continue;
    const from = modules.get(fromId);
    if (from) from.dependsOn.add(toId);
  }

  const list = [...modules.values()]
    .map((mod) => ({
      id: mod.id,
      kind: mod.kind,
      title: mod.title,
      files: [...mod.files].sort(),
      routes: mod.routes,
      signals: [...mod.signals].sort(),
      dataHints: [...mod.dataHints].sort(),
      components: [...mod.components].sort(),
      dependsOn: [...mod.dependsOn].sort(),
      fileCount: mod.files.size
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.id.localeCompare(b.id))
    .slice(0, maxModules);

  return list;
}

function attachNodeSignals(mod, node) {
  if (!node) return;
  for (const signal of node.frameworkSignals ?? []) mod.signals.add(signal);
  for (const hint of node.dataHints ?? []) mod.dataHints.add(hint);
  for (const component of node.components ?? []) mod.components.add(component.name);
}

function ensureModule(map, id, defaults) {
  if (!map.has(id)) {
    map.set(id, {
      id,
      kind: defaults.kind,
      title: defaults.title,
      routes: [],
      files: new Set(),
      signals: new Set(),
      dataHints: new Set(),
      components: new Set(),
      dependsOn: new Set()
    });
  }
  return map.get(id);
}

function moduleIdFromRoute(route) {
  const pathPart = String(route.path || '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)[0];
  if (pathPart && pathPart !== ':' && !pathPart.startsWith(':')) {
    return slug(`route-${pathPart}`);
  }
  if (route.file) return moduleIdFromFile(route.file);
  return 'route-root';
}

function moduleIdFromFile(file) {
  const parts = String(file).split('/');
  const index = parts.findIndex((part) => ['src', 'packages', 'modules', 'apps', 'app', 'pages', 'views'].includes(part));
  if (index >= 0) {
    const slice = parts.slice(index, Math.min(parts.length - 1, index + 3));
    if (slice.length) return slug(slice.join('-'));
  }
  if (parts.length >= 2) return slug(parts.slice(0, 2).join('-'));
  return slug(parts[0] || 'root');
}

function slug(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/[/_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'module';
}
