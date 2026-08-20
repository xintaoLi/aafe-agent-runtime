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

/**
 * Build per-module dataflow facts: route → page/files → store/api/hooks hints.
 */
export function buildDataflowReport(context) {
  const { projectName, modules, routeGraph, generatedAt } = context;
  const moduleDocs = modules.map((mod) => {
    const edges = buildModuleEdges(mod, routeGraph);
    return {
      id: mod.id,
      markdown: renderModuleDataflow(mod, edges),
      facts: {
        id: mod.id,
        dataHints: mod.dataHints,
        edges,
        routes: mod.routes.map((route) => route.path)
      }
    };
  });

  return {
    indexMarkdown: renderDataflowIndex({ projectName, generatedAt, modules }),
    modules: moduleDocs,
    graph: {
      generatedAt,
      modules: moduleDocs.map((item) => item.facts)
    }
  };
}

function buildModuleEdges(mod, routeGraph) {
  const edges = [];
  for (const route of mod.routes) {
    edges.push({
      from: `route:${route.path}`,
      to: `file:${route.file}`,
      kind: 'route-to-file'
    });
    if (route.component && route.component !== route.file) {
      edges.push({
        from: `file:${route.file}`,
        to: `component:${route.component}`,
        kind: 'file-to-component'
      });
    }
  }

  for (const file of mod.files) {
    const node = routeGraph.nodes?.[file];
    if (!node) continue;
    for (const hint of node.dataHints ?? []) {
      edges.push({ from: `file:${file}`, to: `data:${hint}`, kind: 'file-to-data' });
    }
    for (const imp of node.imports ?? []) {
      if (/store|api|service|request|hooks|composables|query/i.test(imp.source)) {
        edges.push({ from: `file:${file}`, to: `import:${imp.source}`, kind: 'file-to-import' });
      }
    }
  }

  return edges.slice(0, 120);
}

function renderDataflowIndex({ projectName, generatedAt, modules }) {
  return `# Dataflow Index

Generated: ${generatedAt}
Project: ${projectName}

## How to use (on-demand)

1. Match the task to a module id below.
2. Load **only** \`.ai-agent/.docs/dataflow/modules/<module-id>.md\`.
3. Use \`.ai-agent/.docs/facts/modules/<module-id>.json\` when machine-readable edges are needed.
4. Do not load every dataflow module file unless explicitly comparing modules.

## Modules

${modules.map((mod) => `- [\`${mod.id}\`](modules/${mod.id}.md) — hints: ${mod.dataHints.slice(0, 8).join(', ') || '—'}`).join('\n') || '- No modules.'}
`;
}

function renderModuleDataflow(mod, edges) {
  return `# Dataflow · ${mod.id}

## Summary

- Routes: ${mod.routes.map((route) => route.path).join(', ') || '—'}
- Data hints: ${mod.dataHints.join(', ') || '—'}

## Flow edges

${edges.length ? edges.map((edge) => `- \`${edge.from}\` -[${edge.kind}]-> \`${edge.to}\``).join('\n') : '- No edges extracted.'}

## Agent rules

- Load this file only for the matched module.
- Treat edges as facts for impact analysis; verify against current source when conflicting.
- Reserved LLM enrichment can refine narratives later via \`.ai-agent/.docs/llm/\`.
`;
}
