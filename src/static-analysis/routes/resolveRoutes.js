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

import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseSourceFile } from '../ast/parseFile.js';
import { extractFromParsedFile } from '../ast/extractors.js';
import { ModuleResolver } from '../resolve/ModuleResolver.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', 'out']);

/**
 * Resolve routes by walking imports from entry files + framework file-based routes.
 */
export async function resolveRoutesFromEntries(root, entryDiscovery, options = {}) {
  const maxDepth = options.maxDepth ?? 40;
  const maxFiles = options.maxAstFiles ?? 400;
  const framework = entryDiscovery.frameworkHint;
  // Aliased imports (`@/views/Foo`) are the normal way a frontend project
  // wires its routes; following only relative paths would stop the BFS at the
  // first alias and report most of the app as unreachable.
  const resolver = options.resolver ?? await new ModuleResolver(root).load();
  const graph = {
    nodes: {},
    edges: [],
    routes: [],
    warnings: [],
    visited: []
  };

  const queue = [];
  for (const entry of entryDiscovery.entries ?? []) {
    if (!entry.exists && entry.kind === 'candidate') continue;
    const file = entry.file;
    if (await fileExists(path.join(root, file))) {
      queue.push({ file, depth: 0, from: null });
    }
  }

  while (queue.length && graph.visited.length < maxFiles) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) continue;
    if (graph.nodes[current.file]) continue;

    const absolute = path.join(root, current.file);
    const content = await safeRead(absolute);
    if (!content) {
      graph.nodes[current.file] = { file: current.file, missing: true };
      continue;
    }

    const parsed = parseSourceFile(current.file, content);
    const extracted = extractFromParsedFile(current.file, parsed, content);
    graph.nodes[current.file] = {
      file: current.file,
      imports: extracted.imports,
      exports: extracted.exports,
      calls: unique(extracted.calls).slice(0, 40),
      frameworkSignals: unique(extracted.frameworkSignals),
      dataHints: unique(extracted.dataHints).slice(0, 40),
      components: extracted.components.slice(0, 20),
      routePaths: unique(extracted.routePaths),
      warnings: extracted.warnings
    };
    graph.visited.push(current.file);
    graph.warnings.push(...extracted.warnings);

    for (const routePath of extracted.routePaths) {
      graph.routes.push({
        path: routePath,
        file: current.file,
        component: extracted.routeObjects.find((item) => item.path === routePath)?.component ?? '',
        name: extracted.routeObjects.find((item) => item.path === routePath)?.name ?? '',
        source: 'ast'
      });
    }

    if (current.from) {
      graph.edges.push({ from: current.from, to: current.file, kind: 'import' });
    }

    for (const item of extracted.imports) {
      // A specifier that does not resolve inside the repository is a package;
      // it stays recorded on the node but the BFS does not follow it.
      const resolved = await resolver.resolve(current.file, item.source);
      if (!resolved) continue;
      if (graph.nodes[resolved]) {
        graph.edges.push({ from: current.file, to: resolved, kind: 'import' });
        continue;
      }
      queue.push({ file: resolved, depth: current.depth + 1, from: current.file });
    }
  }

  const fileRoutes = await collectFileBasedRoutes(root, framework);
  for (const route of fileRoutes) graph.routes.push(route);

  graph.routes = uniqueBy(graph.routes, (item) => `${item.path}|${item.file}|${item.component ?? ''}`);
  return graph;
}

async function collectFileBasedRoutes(root, framework) {
  const routes = [];
  if (framework === 'next' || framework === 'nuxt' || framework === 'vue3' || framework === 'vue2' || framework === 'react') {
    for (const base of ['app', 'pages', 'src/pages', 'src/views', 'views']) {
      const abs = path.join(root, base);
      if (!(await isDirectory(abs))) continue;
      const files = await walkFiles(abs, 800);
      for (const absolute of files) {
        const rel = normalize(path.relative(root, absolute));
        const ext = path.extname(rel).toLowerCase();
        if (!['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(ext)) continue;
        if (framework === 'next' && base.startsWith('app') && !/\/page\.(js|jsx|ts|tsx)$/.test(rel) && !/(^|\/)page\.(js|jsx|ts|tsx)$/.test(rel)) {
          if (!rel.includes('/pages/') && !rel.startsWith('pages/')) continue;
        }
        routes.push({
          path: inferRoutePath(rel),
          file: rel,
          component: rel,
          name: path.basename(rel, ext),
          source: 'file'
        });
      }
    }
  }
  return routes;
}

function inferRoutePath(file) {
  const withoutExt = file.replace(/\.[^.]+$/, '');
  let routeRoot = withoutExt
    .replace(/^.*\/(pages|views)\//, '/')
    .replace(/^(pages|views)\//, '/')
    .replace(/^.*\/app\//, '/')
    .replace(/^app\//, '/');
  routeRoot = routeRoot
    .replace(/\/page$/, '/')
    .replace(/\/index$/, '/')
    .replace(/\/_app$/, '/')
    .replace(/\/layout$/, '/')
    .replace(/\[\[\.\.\.(.+?)\]\]/g, ':$1*')
    .replace(/\[\.\.\.(.+?)\]/g, ':$1*')
    .replace(/\[(.+?)\]/g, ':$1')
    .replace(/\/+/g, '/');
  if (!routeRoot.startsWith('/')) routeRoot = `/${routeRoot}`;
  return routeRoot || '/';
}

async function walkFiles(dir, limit) {
  const results = [];
  async function walk(current) {
    if (results.length >= limit) return;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
