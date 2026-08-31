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
 * Build per-module architecture summaries from partitioned modules + route graph.
 */
export function buildArchitectureReport(context) {
  const { projectName, entryDiscovery, modules, routeGraph, generatedAt } = context;
  const moduleDocs = modules.map((mod) => ({
    id: mod.id,
    markdown: renderModuleArchitecture(mod, routeGraph),
    facts: {
      id: mod.id,
      title: mod.title,
      kind: mod.kind,
      files: mod.files,
      routes: mod.routes.map((route) => ({
        path: route.path,
        file: route.file,
        component: route.component,
        source: route.source
      })),
      signals: mod.signals,
      components: mod.components,
      dependsOn: mod.dependsOn
    }
  }));

  return {
    indexMarkdown: renderArchitectureIndex({
      projectName,
      generatedAt,
      entryDiscovery,
      modules,
      routeCount: routeGraph.routes?.length ?? 0
    }),
    modules: moduleDocs
  };
}

function renderArchitectureIndex({ projectName, generatedAt, entryDiscovery, modules, routeCount }) {
  return `# Architecture Index

Generated: ${generatedAt}
Project: ${projectName}

## How to use (on-demand)

1. Read this index to match the task to a module id.
2. Load **only** \`.ai-agent/.docs/architecture/modules/<module-id>.md\` for hit modules.
3. Do **not** read every module file in one pass.
4. For data flow, use \`.ai-agent/skills/dataflow-on-demand.md\`.

## Entry & Build

- Build tool: \`${entryDiscovery.buildTool}\`
- Framework hint: \`${entryDiscovery.frameworkHint}\`
- Entries:
${(entryDiscovery.entries ?? []).map((entry) => `  - \`${entry.file}\` (${entry.source})`).join('\n') || '  - (none)'}

## Modules (${modules.length}) · Routes ${routeCount}

${modules.map((mod) => `- [\`${mod.id}\`](modules/${mod.id}.md) — ${mod.fileCount} files, ${mod.routes.length} routes, depends: ${mod.dependsOn.join(', ') || '—'}`).join('\n') || '- No modules detected.'}
`;
}

function renderModuleArchitecture(mod, routeGraph) {
  const keyFiles = mod.files.slice(0, 30);
  return `# Architecture · ${mod.id}

## Summary

- Title: ${mod.title}
- Kind: ${mod.kind}
- Files: ${mod.fileCount}
- Framework signals: ${mod.signals.join(', ') || '—'}
- Depends on modules: ${mod.dependsOn.join(', ') || '—'}

## Routes

${mod.routes.length ? mod.routes.map((route) => `- \`${route.path}\` → ${route.component || route.file} (${route.file})`).join('\n') : '- No owned routes.'}

## Key files

${keyFiles.map((file) => {
    const node = routeGraph.nodes?.[file];
    const signals = node?.frameworkSignals?.length ? ` [${node.frameworkSignals.join(', ')}]` : '';
    return `- \`${file}\`${signals}`;
  }).join('\n') || '- —'}

## Components

${mod.components.length ? mod.components.map((name) => `- ${name}`).join('\n') : '- —'}

## Agent rules

- Read this file only when the task matches this module.
- Prefer listed key files before broad search.
- Pair with \`.ai-agent/.docs/dataflow/modules/${mod.id}.md\` when tracing state/API flow.
`;
}
