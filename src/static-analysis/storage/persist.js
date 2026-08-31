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

import { access, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFormatGate } from '../emit/formats.js';
import {
  mermaidArchitectureOverview,
  mermaidComponentRelations,
  mermaidDataflow,
  mermaidModuleArchitecture,
  mermaidModuleRoutes
} from '../emit/mermaid.js';
import { buildModuleBundles } from '../modules/buildBundles.js';
import { EXTRACTOR_VERSION } from '../ast/extractors.js';

/**
 * Layout:
 *   <output>/
 *     manifest.json          # Agent root entry
 *     index.json             # Agent compact index
 *     README.md              # Human root entry
 *     knowledge/             # global analysis domains
 *     modules/               # per-module slices
 *       index.json
 *       <id>/
 *         index.json         # module Agent entry
 *         README.md
 *         json/              # Agent
 *         mmd/               # Human
 */
const LEGACY_ROOT_DIRS = [
  'repository',
  'graph',
  'architecture',
  'dataflow',
  'features',
  'business',
  'evidence',
  'relations',
  'llm'
];

const LEGACY_MODULE_FILES = [
  'routes.json',
  'routes.mmd',
  'architecture.json',
  'architecture.mmd',
  'components.json',
  'components.mmd',
  'features.json',
  'features.mmd',
  'dataflow.json',
  'dataflow.mmd'
];

/**
 * Directories under analyze.output that `--force` must not wipe.
 * E2E reports/auth and planner run history live beside analysis facts.
 */
export const PRESERVED_ANALYZE_OUTPUT_DIRS = ['e2e', 'runs'];

export class AnalysisStorage {
  plan(context) {
    const output = context.config.output;
    return [
      `${output}/manifest.json`,
      `${output}/index.json`,
      `${output}/modules/index.json`,
      `${output}/knowledge/architecture/json/analysis.json`,
      `${output}/knowledge/relations/json/modules.json`
    ];
  }

  async persist(context) {
    const output = context.config.output;
    const root = context.config.root;
    const outAbs = path.isAbsolute(output) ? output : path.join(root, output);
    const writes = {};
    const gate = createFormatGate(context.config.formats ?? []);

    if (context.config.skipExisting && await directoryHasContent(outAbs)) {
      return { mode: 'skip-existing', skipped: true, output, formats: gate.list, writes };
    }

    if (await directoryHasContent(outAbs) && process.stderr.isTTY && !context.config.force && !context.config.quiet) {
      console.error(`[aafe analyze] ${output} already exists; using merge. Use --force to overwrite or --skip-existing to skip.`);
    }

    const forceMigration = context.config.force
      ? await resetAnalyzeOutputForForce(outAbs)
      : null;

    const files = this.buildFiles(context, output, gate);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      const previous = await safeRead(abs);
      if (!context.config.force && previous && sameContent(previous, content)) {
        writes[rel] = 'unchanged';
        continue;
      }
      await writeFile(abs, content);
      writes[rel] = previous ? 'updated' : 'created';
    }

    await cleanupLegacyRoot(outAbs);
    await cleanupLegacyModuleFiles(outAbs, Object.keys(files));

    return {
      mode: context.config.force ? 'force' : 'merge',
      skipped: false,
      output,
      formats: gate.list,
      writes,
      forceMigration
    };
  }

  buildFiles(context, output, gate) {
    const files = {};
    const repository = context.repository ?? { files: [], packages: [], entrypoints: [] };
    const graph = context.graph ?? { nodes: [], edges: [], symbols: [] };
    const architecture = context.architecture ?? { modules: [], dependencies: [], risks: [] };
    const dataflow = context.dataflow ?? { flows: [], levels: {} };
    const features = context.features ?? { candidates: [] };
    const business = context.business ?? { candidates: [] };
    const moduleAnalysis = context.moduleAnalysis ?? buildModuleBundles(context);
    const bundles = moduleAnalysis.bundles ?? [];
    const relations = moduleAnalysis.relations ?? { modules: [], components: [], dataflow: [], architectureFlows: [] };

    const K = `${output}/knowledge`;

    // --- Outer Agent / Human entries only ---
    files[`${output}/manifest.json`] = JSON.stringify({
      version: '1',
      project: {
        name: context.project.name,
        root: '.',
        version: context.project.version
      },
      analysis: {
        version: '0.3.0',
        timestamp: Date.now(),
        commit: context.runtime.commit,
        formats: gate.list,
        extractorVersion: EXTRACTOR_VERSION
      },
      analyzers: Object.fromEntries(
        Object.entries(context.results ?? {}).map(([id, result]) => [id, result.version])
      ),
      llm: {
        enabled: Boolean(context.config.llm?.enabled),
        provider: context.config.llm?.provider ?? null
      },
      output,
      entry: {
        agent: 'index.json',
        human: 'README.md',
        modules: 'modules/index.json',
        knowledge: 'knowledge/'
      },
      layout: {
        root: ['manifest.json', 'index.json', 'README.md'],
        knowledge: 'knowledge/<domain>/{json,mmd,md}/',
        modules: 'modules/<id>/{index.json,README.md,json/,mmd/}',
        agent: 'json/jsonl',
        human: 'mmd/md'
      }
    }, null, 2) + '\n';

    files[`${output}/index.json`] = JSON.stringify({
      project: context.project.name,
      formats: gate.list,
      stats: context.runtime.stats,
      entrypoints: (repository.entrypoints ?? []).map((entry) => entry.path),
      buildTool: repository.buildTool,
      frameworkHint: repository.frameworkHint,
      paths: {
        modulesIndex: 'modules/index.json',
        knowledge: {
          repository: 'knowledge/repository/json/',
          graph: 'knowledge/graph/jsonl/',
          architecture: 'knowledge/architecture/json/analysis.json',
          dataflow: 'knowledge/dataflow/json/analysis.json',
          features: 'knowledge/features/json/candidates.json',
          business: 'knowledge/business/json/candidates.json',
          relations: 'knowledge/relations/json/',
          evidence: 'knowledge/evidence/json/index.json'
        }
      },
      modules: bundles.map((bundle) => ({
        id: bundle.name,
        entry: `modules/${bundle.name}/index.json`,
        summary: bundle.summary
      }))
    }, null, 2) + '\n';

    if (gate.wantsJson()) {
      files[`${K}/repository/json/files.json`] = JSON.stringify({
        files: repository.files ?? [],
        entrypoints: repository.entrypoints ?? [],
        buildTool: repository.buildTool,
        frameworkHint: repository.frameworkHint
      }, null, 2) + '\n';
      files[`${K}/repository/json/packages.json`] = JSON.stringify({ packages: repository.packages ?? [] }, null, 2) + '\n';
      files[`${K}/repository/json/symbols.json`] = JSON.stringify({ symbols: graph.symbols ?? [] }, null, 2) + '\n';
      files[`${K}/architecture/json/analysis.json`] = JSON.stringify(architecture, null, 2) + '\n';
      files[`${K}/dataflow/json/analysis.json`] = JSON.stringify(dataflow, null, 2) + '\n';
      files[`${K}/features/json/candidates.json`] = JSON.stringify(features, null, 2) + '\n';
      files[`${K}/business/json/candidates.json`] = JSON.stringify(business, null, 2) + '\n';
      files[`${K}/evidence/json/index.json`] = JSON.stringify({ evidence: collectEvidence(context) }, null, 2) + '\n';
      files[`${K}/relations/json/modules.json`] = JSON.stringify({ relations: relations.modules }, null, 2) + '\n';
      files[`${K}/relations/json/components.json`] = JSON.stringify({ relations: relations.components }, null, 2) + '\n';
      files[`${K}/relations/json/dataflow.json`] = JSON.stringify({
        relations: relations.dataflow,
        architectureFlows: relations.architectureFlows
      }, null, 2) + '\n';

      files[`${output}/modules/index.json`] = JSON.stringify({
        modules: bundles.map((bundle) => ({
          id: bundle.name,
          entry: `modules/${bundle.name}/index.json`,
          jsonDir: `modules/${bundle.name}/json/`,
          mmdDir: `modules/${bundle.name}/mmd/`,
          summary: bundle.summary,
          routes: bundle.routes.map((route) => route.path),
          dependencies: bundle.dependencies
        }))
      }, null, 2) + '\n';

      for (const bundle of bundles) {
        const modRoot = `${output}/modules/${bundle.name}`;
        const jsonDir = `${modRoot}/json`;

        files[`${modRoot}/index.json`] = JSON.stringify({
          id: bundle.name,
          summary: bundle.summary,
          paths: {
            routes: 'json/routes.json',
            architecture: 'json/architecture.json',
            components: 'json/components.json',
            features: 'json/features.json',
            dataflow: 'json/dataflow.json',
            mmd: gate.wantsMmd() ? {
              routes: 'mmd/routes.mmd',
              architecture: 'mmd/architecture.mmd',
              components: 'mmd/components.mmd',
              dataflow: 'mmd/dataflow.mmd'
            } : null,
            readme: 'README.md'
          },
          routes: bundle.routes.map((route) => route.path),
          components: bundle.components.map((item) => item.name),
          dependencies: bundle.dependencies
        }, null, 2) + '\n';

        files[`${jsonDir}/routes.json`] = JSON.stringify({
          module: bundle.name,
          routes: bundle.routes,
          summary: `Module ${bundle.name} owns ${bundle.routes.length} routes`
        }, null, 2) + '\n';
        files[`${jsonDir}/architecture.json`] = JSON.stringify({
          module: bundle.name,
          architecture: bundle.architecture,
          dependencies: bundle.dependencies,
          signals: bundle.signals
        }, null, 2) + '\n';
        files[`${jsonDir}/components.json`] = JSON.stringify({
          module: bundle.name,
          components: bundle.components,
          relations: bundle.componentRelations
        }, null, 2) + '\n';
        files[`${jsonDir}/features.json`] = JSON.stringify({
          module: bundle.name,
          features: bundle.features
        }, null, 2) + '\n';
        files[`${jsonDir}/dataflow.json`] = JSON.stringify({
          module: bundle.name,
          dataflow: bundle.dataflow
        }, null, 2) + '\n';
      }
    }

    if (gate.wantsJsonl()) {
      files[`${K}/graph/jsonl/nodes.jsonl`] = toJsonl(graph.nodes ?? []);
      files[`${K}/graph/jsonl/edges.jsonl`] = toJsonl(graph.edges ?? []);
    }

    if (gate.wantsMmd()) {
      files[`${K}/architecture/mmd/overview.mmd`] = mermaidArchitectureOverview(
        architecture.modules ?? [],
        architecture.dependencies ?? []
      );
      files[`${K}/relations/mmd/modules.mmd`] = mermaidArchitectureOverview(
        architecture.modules ?? [],
        architecture.dependencies ?? []
      );
      files[`${K}/relations/mmd/components.mmd`] = mermaidComponentRelations(relations.components);
      files[`${K}/relations/mmd/dataflow.mmd`] = mermaidDataflow(
        (dataflow.flows ?? []).filter((flow) => flow.kind === 'application').slice(0, 30)
      );

      for (const bundle of bundles) {
        const mmdDir = `${output}/modules/${bundle.name}/mmd`;
        files[`${mmdDir}/routes.mmd`] = mermaidModuleRoutes(bundle);
        files[`${mmdDir}/architecture.mmd`] = mermaidModuleArchitecture(bundle);
        files[`${mmdDir}/components.mmd`] = mermaidComponentRelations(bundle.componentRelations);
        files[`${mmdDir}/dataflow.mmd`] = mermaidDataflow(bundle.dataflow);
      }
    }

    if (gate.wantsMd()) {
      files[`${K}/architecture/md/index.md`] = renderArchitectureMd(architecture, output, bundles);
      files[`${K}/dataflow/md/index.md`] = renderDataflowMd(dataflow, output);
      files[`${K}/features/md/index.md`] = renderFeaturesMd(features, output);
      files[`${K}/business/md/index.md`] = renderBusinessMd(business, output);
      files[`${K}/llm/md/README.md`] = renderLlmReadme();
      files[`${output}/modules/index.md`] = renderModulesIndex(bundles, output, gate);
      files[`${output}/README.md`] = renderRootReadme(context, output, gate, bundles);

      for (const bundle of bundles) {
        files[`${output}/modules/${bundle.name}/README.md`] = renderModuleReadme(bundle, output, gate);
      }
    }

    return files;
  }
}

/**
 * Force-refresh analyze output: drop stale facts from older layouts, then
 * the caller rewrites the current tree. `e2e/` and `runs/` stay put.
 *
 * @param {string} outAbs absolute analyze.output path
 * @returns {Promise<{ removed: string[] }>}
 */
export async function resetAnalyzeOutputForForce(outAbs) {
  let entries = [];
  try {
    entries = await readdir(outAbs, { withFileTypes: true });
  } catch {
    return { removed: [] };
  }

  const removed = [];
  for (const entry of entries) {
    if (PRESERVED_ANALYZE_OUTPUT_DIRS.includes(entry.name)) continue;
    await rm(path.join(outAbs, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { removed: removed.sort() };
}

async function cleanupLegacyRoot(outAbs) {
  for (const name of LEGACY_ROOT_DIRS) {
    const target = path.join(outAbs, name);
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function cleanupLegacyModuleFiles(outAbs, writtenRels) {
  const moduleIds = new Set();
  for (const rel of writtenRels) {
    const match = rel.match(/modules\/([^/]+)\//);
    if (match) moduleIds.add(match[1]);
  }
  for (const id of moduleIds) {
    if (id === 'index.json' || id === 'index.md') continue;
    const modDir = path.join(outAbs, 'modules', id);
    for (const name of LEGACY_MODULE_FILES) {
      try {
        await unlink(path.join(modDir, name));
      } catch {
        // ignore
      }
    }
  }
}

function collectEvidence(context) {
  const items = [];
  for (const result of Object.values(context.results ?? {})) {
    for (const evidence of result.evidence ?? []) items.push({ analyzer: result.analyzer, ...evidence });
  }
  return items.slice(0, 2000);
}

function toJsonl(items) {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
}

function renderRootReadme(context, output, gate, bundles) {
  const stats = context.runtime.stats;
  return `# AAFE Analysis Knowledge

Output: \`${output}\`
Formats: ${gate.list.join(', ')}

## Agent entry (read first)

1. \`${output}/manifest.json\`
2. \`${output}/index.json\`
3. \`${output}/modules/index.json\` → one \`modules/<id>/index.json\`

Do **not** scan the whole tree.

## Layout

\`\`\`text
${output}/
  manifest.json      # root entry
  index.json         # compact agent index
  README.md          # human entry
  knowledge/         # global domains (json / jsonl / mmd / md)
  modules/           # per-module slices
    <id>/
      index.json     # module agent entry
      json/          # agent
      mmd/           # human
\`\`\`

## Stats

- Files: ${stats.files}
- Modules: ${bundles.length}
- Symbols: ${stats.symbols}
- Dependencies: ${stats.dependencies}
- Data flows: ${stats.flows}
- Features: ${stats.features}
- Business candidates: ${stats.businessCandidates}
- LLM: ${context.config.llm?.enabled ? 'enabled' : 'disabled'}

## Modules

${bundles.slice(0, 40).map((bundle) => `- [\`${bundle.name}\`](modules/${bundle.name}/README.md) — routes ${bundle.summary.routes}, components ${bundle.summary.components}`).join('\n') || '- none'}
`;
}

function renderModulesIndex(bundles, output, gate) {
  return `# Modules Index

Agent entry: \`${output}/modules/index.json\`

${bundles.map((bundle) => {
    const links = [
      `entry: \`modules/${bundle.name}/index.json\``,
      gate.wantsJson() ? `json: \`modules/${bundle.name}/json/\`` : '',
      gate.wantsMmd() ? `mmd: \`modules/${bundle.name}/mmd/\`` : ''
    ].filter(Boolean).join(' · ');
    return `- \`${bundle.name}\` — routes ${bundle.summary.routes}, components ${bundle.summary.components}, features ${bundle.summary.features} (${links})`;
  }).join('\n') || '- none'}
`;
}

function renderModuleReadme(bundle, output, gate) {
  return `# Module · ${bundle.name}

Agent entry: \`${output}/modules/${bundle.name}/index.json\`

## Routes

${bundle.routes.length ? bundle.routes.map((route) => `- \`${route.path}\` → \`${route.file}\``).join('\n') : '- none'}

## Components

${bundle.components.length ? bundle.components.map((item) => `- \`${item.name}\` (${item.kind}) — \`${item.file}\``).join('\n') : '- none'}

## Features (candidates)

${bundle.features.length ? bundle.features.map((item) => `- \`${item.name}\` confidence=${item.confidence}`).join('\n') : '- none'}

## Paths

${gate.wantsJson() ? `- Agent JSON: \`${output}/modules/${bundle.name}/json/\`` : ''}
${gate.wantsMmd() ? `- Human MMD: \`${output}/modules/${bundle.name}/mmd/\`` : ''}

## Dependencies

${bundle.dependencies.length ? bundle.dependencies.map((dep) => `- ${dep}`).join('\n') : '- none'}
`;
}

function renderArchitectureMd(architecture, output, bundles) {
  return `# Architecture (static facts)

## Modules

${(architecture.modules ?? []).slice(0, 80).map((mod) => `- \`${mod.name}\` — ${mod.files} files`).join('\n') || '- none'}

## Per-module

${bundles.slice(0, 40).map((bundle) => `- \`modules/${bundle.name}/json/architecture.json\``).join('\n') || '- none'}

Overview: \`${output}/knowledge/architecture/json/analysis.json\`
`;
}

function renderDataflowMd(dataflow, output) {
  return `# Dataflow (static facts)

- Import flows: ${dataflow.levels?.import ?? 0}
- Call flows: ${dataflow.levels?.call ?? 0}
- Application flows: ${dataflow.levels?.application ?? 0}

Prefer \`modules/<id>/json/dataflow.json\` (+ \`mmd/\` for humans).
Overview: \`${output}/knowledge/dataflow/json/analysis.json\`
`;
}

function renderFeaturesMd(features, output) {
  const candidates = features.candidates ?? [];
  return `# Feature Candidates (static)

${candidates.slice(0, 80).map((item) => `- \`${item.name}\` (${item.id}) confidence=${item.confidence}`).join('\n') || '- none'}

Machine model: \`${output}/knowledge/features/json/candidates.json\`
`;
}

function renderBusinessMd(business, output) {
  const candidates = business.candidates ?? [];
  return `# Business Candidates (static)

${candidates.slice(0, 80).map((item) => `- \`${item.name}\` confidence=${item.confidence}`).join('\n') || '- none'}

Machine model: \`${output}/knowledge/business/json/candidates.json\`
`;
}

function renderLlmReadme() {
  return `# LLM Agents (Reserved)

Consume module \`index.json\` + evidence slices, never the whole repo.

\`\`\`json
{
  "analyze": {
    "output": ".aafe",
    "formats": ["json", "jsonl", "md", "mmd"]
  }
}
\`\`\`
`;
}

function sameContent(left, right) {
  return normalize(left) === normalize(right);
}

function normalize(content) {
  return String(content)
    .replace(/"timestamp"\s*:\s*\d+/g, '"timestamp":0')
    .replace(/"generatedAt"\s*:\s*"[^"]*"/g, '"generatedAt":"<t>"')
    .replace(/^Generated: .+$/gm, 'Generated: <t>')
    .replace(/\n+$/g, '\n');
}

async function directoryHasContent(dir) {
  try {
    await access(dir);
    return (await readdir(dir)).length > 0;
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
