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

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSourceFile } from '../ast/parseFile.js';
import { extractFromParsedFile } from '../ast/extractors.js';
import { resolveRoutesFromEntries } from '../routes/resolveRoutes.js';
import { ModuleResolver } from '../resolve/ModuleResolver.js';
import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

export class GraphAnalyzer {
  id = 'graph';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    const root = context.config.root;
    const repository = context.repository;
    if (!repository) {
      return createAnalysisResult(this.id, this.version, { nodes: [], edges: [], symbols: [], routes: [] }, {
        status: 'failed',
        diagnostics: [{ level: 'error', code: 'missing-repository', message: 'RepositoryAnalyzer must run first' }]
      });
    }

    const nodes = [];
    const edges = [];
    const symbols = [];
    const evidence = [];
    const moduleNodes = new Set();
    // One resolver for the whole pass: the alias table is read once and the
    // per-specifier results are memoized across every file that imports them.
    const resolver = context.resolver ?? await new ModuleResolver(root).load();
    context.resolver = resolver;
    const cache = context.incremental ?? null;

    nodes.push({
      id: 'project:root',
      type: 'Project',
      properties: {
        name: context.project.name,
        root,
        buildTool: repository.buildTool,
        frameworkHint: repository.frameworkHint
      }
    });

    for (const pkg of repository.packages ?? []) {
      nodes.push({ id: pkg.id, type: 'Package', properties: { ...pkg } });
      edges.push(edge('project:root', pkg.id, 'CONTAINS', [{ type: 'config', file: pkg.path }]));
    }

    for (const entry of repository.entrypoints ?? []) {
      nodes.push({
        id: entry.id,
        type: 'Entrypoint',
        properties: { path: entry.path, source: entry.source }
      });
      edges.push(edge('project:root', entry.id, 'HAS_ENTRY', [createEvidence({ type: 'config', file: entry.path })]));
    }

    const sourceFiles = (repository.files ?? [])
      .filter((file) => file.kind === 'source')
      .slice(0, context.config.maxAstFiles);

    let symbolCount = 0;
    for (const file of sourceFiles) {
      nodes.push({
        id: file.id,
        type: 'File',
        properties: {
          path: file.path,
          language: file.language,
          hash: file.hash,
          kind: file.kind
        }
      });

      // Re-parsing an unchanged file is the single biggest avoidable cost of a
      // repeat analysis, so a content-hash hit skips both the read and the AST.
      let extracted = cache?.get(file.path, file.hash) ?? null;
      if (!extracted) {
        const content = await safeRead(path.join(root, file.path));
        if (!content) continue;
        extracted = extractFromParsedFile(file.path, parseSourceFile(file.path, content), content);
        cache?.set(file.path, file.hash, extracted);
      }
      context.cache.parsed.set(file.path, { extracted });

      for (const component of extracted.components ?? []) {
        const sid = `symbol:${file.path}:${component.name}`;
        symbols.push({
          id: sid,
          fileId: file.id,
          name: component.name,
          kind: 'component',
          exported: false
        });
        nodes.push({
          id: sid,
          type: 'Symbol',
          properties: { name: component.name, kind: 'component', file: file.path }
        });
        edges.push(edge(file.id, sid, 'DECLARES', [createEvidence({ type: 'ast', file: file.path, symbol: component.name })]));
        symbolCount += 1;
      }

      for (const imp of extracted.imports ?? []) {
        const evidenceFor = () => [createEvidence({ type: 'dependency', file: file.path, reason: imp.source })];
        // An alias-resolved import becomes a real file->file edge. Left as an
        // opaque `import:@/x` node it would look external, and every module
        // reached only through an alias would drop out of the dependency graph.
        const target = await resolver.resolve(file.path, imp.source);
        if (target) {
          edges.push(edge(file.id, `file:${target}`, 'IMPORTS', evidenceFor()));
          continue;
        }

        edges.push(edge(file.id, `import:${imp.source}`, 'IMPORTS', evidenceFor()));
        if (!moduleNodes.has(imp.source)) {
          moduleNodes.add(imp.source);
          nodes.push({
            id: `import:${imp.source}`,
            type: 'Module',
            properties: { specifier: imp.source, external: !resolver.isInternal(imp.source) }
          });
        }
      }

      for (const call of (extracted.calls ?? []).slice(0, 30)) {
        edges.push(edge(file.id, `call:${call}`, 'CALLS', [
          createEvidence({ type: 'ast', file: file.path, symbol: call })
        ]));
      }
    }

    const routeGraph = await resolveRoutesFromEntries(root, repository.entryDiscovery ?? { entries: [], frameworkHint: repository.frameworkHint }, {
      maxDepth: context.config.maxDepth,
      maxAstFiles: context.config.maxAstFiles,
      resolver
    });

    for (const [file, node] of Object.entries(routeGraph.nodes ?? {})) {
      if (!context.cache.parsed.has(file)) {
        context.cache.parsed.set(file, { extracted: node });
      }
    }

    for (const route of routeGraph.routes ?? []) {
      const rid = `route:${route.path}:${route.file}`;
      nodes.push({
        id: rid,
        type: 'Route',
        properties: { path: route.path, file: route.file, component: route.component, source: route.source }
      });
      edges.push(edge(rid, `file:${route.file}`, 'ROUTES_TO', [
        createEvidence({ type: 'route', file: route.file, reason: route.path })
      ]));
      if (route.component && route.component !== route.file) {
        edges.push(edge(rid, `file:${route.component}`, 'ROUTES_TO', [
          createEvidence({ type: 'route', file: route.component, reason: route.path })
        ]));
      }
      evidence.push(createEvidence({ type: 'route', file: route.file, reason: route.path }));
    }

    // Attach route graph internals for downstream analyzers
    const data = {
      nodes,
      edges,
      symbols,
      routes: routeGraph.routes ?? [],
      routeGraph,
      visited: routeGraph.visited ?? []
    };

    return createAnalysisResult(this.id, this.version, data, {
      evidence: evidence.slice(0, 100),
      stats: {
        scannedFiles: sourceFiles.length,
        symbols: symbolCount,
        dependencies: edges.filter((item) => item.type === 'IMPORTS').length,
        aliasSources: resolver.sources,
        ...(cache ? { cache: cache.summary() } : {}),
        durationMs: Date.now() - started
      }
    });
  }
}

function edge(from, to, type, evidence = []) {
  return {
    id: `${type}:${from}->${to}`,
    from,
    to,
    type,
    evidence
  };
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
