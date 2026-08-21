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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAnalyzeConfig } from '../static-analysis/types/config.js';
import { createAnalyzeContext } from '../static-analysis/types/context.js';
import { AnalyzeOrchestrator } from '../static-analysis/orchestrator.js';
import {
  renderArchitectureOnDemandSkill,
  renderDataflowOnDemandSkill
} from '../static-analysis/renderSkills.js';

/**
 * CLI shell for the static Analyze Pipeline.
 * Facts are persisted under configurable `analyze.output` (default `.aafe`).
 */
export async function runAnalyzeCommand(root, args = []) {
  const payload = await executeAnalyze(root, args);
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Run the analyze pipeline and return the report without printing JSON.
 * `--force` overwrites facts and migrates leftover files from older layouts.
 */
export async function executeAnalyze(root, args = []) {
  const cliOptions = parseAnalyzeCliOptions(args);
  const projectConfig = await readProjectConfig(root);
  const config = resolveAnalyzeConfig(root, projectConfig, cliOptions);
  const packageInfo = await readPackageInfo(root);

  if (!cliOptions.json && !config.quiet) {
    console.error('AAFE Analyze\n');
  }

  const context = createAnalyzeContext({
    root,
    config,
    project: {
      name: packageInfo.name ?? path.basename(root),
      root,
      version: packageInfo.version ?? null
    },
    commit: await readGitHead(root)
  });

  const phaseRows = [];
  const orchestrator = new AnalyzeOrchestrator({
    onPhase: (phase) => {
      phaseRows.push(phase);
      if (!cliOptions.json && !config.quiet) {
        const seconds = (phase.durationMs / 1000).toFixed(1);
        console.error(`✓ ${phase.label.padEnd(24)} ${seconds}s`);
      }
    }
  });

  const resultContext = await orchestrator.run(context);

  if (config.write !== false && !config.dryRun) {
    await writeAgentSkillPointers(root, resultContext);
  }

  const report = toCompatReport(resultContext, packageInfo);

  if (!cliOptions.json && !config.quiet) {
    printHumanSummary(resultContext);
  }

  return {
    status: 'pass',
    command: 'aafe analyze',
    dryRun: Boolean(config.dryRun),
    summary: report.summary,
    output: config.output,
    formats: config.formats,
    counts: report.counts,
    phases: phaseRows,
    llm: {
      enabled: Boolean(config.llm?.enabled),
      status: config.llm?.enabled ? 'reserved' : 'disabled'
    },
    persist: resultContext.persistResult,
    cache: resultContext.cacheSummary ?? null,
    searchIndex: resultContext.searchIndex ?? null,
    outputs: report.outputs
  };
}

/**
 * Compatibility entry used by knowledge / knowledge-web.
 * Runs the same pipeline and returns a locator-friendly report.
 */
export async function analyzeProjectArchitecture(root, options = {}) {
  const projectConfig = await readProjectConfig(root);
  const config = resolveAnalyzeConfig(root, projectConfig, {
    ...options,
    write: options.write ?? false,
    quiet: true,
    dryRun: options.dryRun ?? true
  });
  // Knowledge consumers need architectureSources from project .docs — keep lightweight scan
  const packageInfo = await readPackageInfo(root);
  const context = createAnalyzeContext({
    root,
    config: { ...config, write: false, dryRun: true, quiet: true },
    project: {
      name: packageInfo.name ?? path.basename(root),
      root,
      version: packageInfo.version ?? null
    }
  });
  const orchestrator = new AnalyzeOrchestrator({ onPhase: () => {} });
  const resultContext = await orchestrator.run(context);
  const report = toCompatReport(resultContext, packageInfo);
  report.architectureSources = await findArchitectureSources(root, options.architectureDocs ?? config.architectureDocs ?? '.docs');
  report.components = [];
  report.designDocs = [];
  report.modules = (resultContext.architecture?.modules ?? []).map((mod) => ({
    name: mod.name,
    fileCount: mod.files
  }));
  report.routes = resultContext.graph?.routes ?? [];
  report.packageInfo = packageInfo;
  report.generatedAt = new Date().toISOString();
  report.root = root;
  report.projectName = packageInfo.name ?? path.basename(root);
  report.counts.architectureSources = report.architectureSources.length;
  report.counts.designDocs = 0;
  report.counts.components = 0;
  return report;
}

function toCompatReport(context, packageInfo) {
  const output = context.config.output;
  const modules = context.architecture?.modules ?? [];
  const routes = context.graph?.routes ?? [];
  const features = context.features?.candidates ?? [];
  const business = context.business?.candidates ?? [];
  return {
    summary: `Static analyze for ${context.project.name}: ${context.runtime.stats.files} files, ${modules.length} modules, ${routes.length} routes, ${features.length} feature candidates, ${business.length} business candidates → ${output}`,
    counts: {
      files: context.runtime.stats.files,
      modules: modules.length,
      routes: routes.length,
      components: 0,
      designDocs: 0,
      architectureSources: 0,
      symbols: context.runtime.stats.symbols,
      dependencies: context.runtime.stats.dependencies,
      flows: context.runtime.stats.flows,
      features: features.length,
      businessCandidates: business.length,
      entries: context.repository?.entrypoints?.length ?? 0,
      astVisited: context.graph?.visited?.length ?? 0
    },
    entryDiscovery: context.repository?.entryDiscovery,
    analyzedModules: modules,
    modules: modules.map((mod) => ({ name: mod.name, fileCount: mod.files })),
    routes,
    docsOut: output,
    outputs: {
      output,
      docsOut: output,
      skill: '.ai-agent/skills/project-architecture-locator.md',
      architectureOnDemand: '.ai-agent/skills/architecture-on-demand.md',
      dataflowOnDemand: '.ai-agent/skills/dataflow-on-demand.md',
      memory: '.ai-agent/memory/project-architecture.md'
    },
    packageInfo
  };
}

async function writeAgentSkillPointers(root, context) {
  const output = context.config.output;
  const skillsOut = context.config.skillsOut ?? '.ai-agent/skills';
  const generatedAt = new Date().toISOString();
  const modules = (context.architecture?.modules ?? []).map((mod) => ({
    id: mod.name,
    fileCount: mod.files,
    dataHints: mod.signals ?? []
  }));

  const locator = `# Skill: Project Architecture Locator

Generated: ${generatedAt}
Project: ${context.project.name}

## Purpose

Locate routes/modules quickly, then deep-dive via on-demand skills against \`${output}\`.

## Analysis output (configurable)

Outer Agent entry (read first):
- \`${output}/manifest.json\`
- \`${output}/index.json\`
- \`${output}/modules/index.json\`

Then one module:
- \`${output}/modules/<id>/index.json\`
- Agent: \`${output}/modules/<id>/json/\`
- Human: \`${output}/modules/<id>/mmd/\`

Global knowledge (on demand only): \`${output}/knowledge/\`

## Entries

${(context.repository?.entrypoints ?? []).map((entry) => `- \`${entry.path}\` (${entry.source})`).join('\n') || '- none'}

## Modules

${(context.moduleAnalysis?.bundles ?? modules).slice(0, 40).map((mod) => {
    const id = mod.name || mod.id;
    const fileCount = mod.files ?? mod.fileCount ?? 0;
    const routes = mod.summary?.routes ?? 0;
    return `- \`${id}\` (${fileCount} files, ${routes} routes) → \`modules/${id}/index.json\``;
  }).join('\n') || '- none'}

## Context rules

1. Read outer entry files first (\`manifest\` / \`index\`).
2. Load only one matched \`modules/<id>/index.json\` then its \`json/\` slice.
3. Prefer JSON/JSONL for Agent; open \`mmd/\` only for humans.
4. Never eagerly read \`knowledge/graph/jsonl/\`.
5. Re-run \`aafe analyze\` after major structure changes.
`;

  const archSkill = renderArchitectureOnDemandSkill({
    generatedAt,
    projectName: context.project.name,
    docsOut: output,
    modules
  }).replaceAll('.ai-agent/.docs', output);

  const dataflowSkill = renderDataflowOnDemandSkill({
    generatedAt,
    projectName: context.project.name,
    docsOut: output,
    modules
  }).replaceAll('.ai-agent/.docs', output);

  const memory = `# Project Architecture Index

Generated: ${generatedAt}
Project: ${context.project.name}

Primary knowledge: \`${output}/\`
Formats: ${(context.config.formats ?? []).join(', ')}

Agent entry:
- \`${output}/manifest.json\`
- \`${output}/index.json\`
- \`${output}/modules/<id>/index.json\` → \`json/\`

Human diagrams: \`modules/<id>/mmd/\`
Global: \`knowledge/\` (on demand)

Use on-demand skills; load one module slice only.
`;

  const targets = [
    [path.join(root, skillsOut, 'project-architecture-locator.md'), locator],
    [path.join(root, skillsOut, 'architecture-on-demand.md'), archSkill],
    [path.join(root, skillsOut, 'dataflow-on-demand.md'), dataflowSkill],
    [path.join(root, '.ai-agent/memory/project-architecture.md'), memory]
  ];

  for (const [filePath, content] of targets) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

function printHumanSummary(context) {
  const stats = context.runtime.stats;
  console.error('\n────────────────────────────────────\n');
  console.error(`Files                     ${stats.files}`);
  console.error(`Symbols                   ${stats.symbols}`);
  console.error(`Modules                   ${stats.modules}`);
  console.error(`Dependencies              ${stats.dependencies}`);
  console.error(`Data flows                ${stats.flows}`);
  console.error(`Features                  ${stats.features}`);
  console.error(`Business candidates       ${stats.businessCandidates}`);
  console.error(`Formats                   ${(context.config.formats ?? []).join(',')}`);
  console.error(`\nLLM                       ${context.config.llm?.enabled ? 'enabled' : 'disabled'}`);
  console.error('\nAnalysis completed.\n');
  console.error(`Output:\n${context.config.output}/\n`);
}

function parseAnalyzeCliOptions(args) {
  const options = {
    dryRun: args.includes('--dry-run'),
    write: !args.includes('--no-write'),
    force: args.includes('--force'),
    skipExisting: args.includes('--skip-existing'),
    quiet: args.includes('--quiet'),
    json: args.includes('--json'),
    llm: args.includes('--llm')
  };
  for (const arg of args) {
    if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    if (arg.startsWith('--docs-out=')) options.docsOut = arg.slice('--docs-out='.length);
    if (arg.startsWith('--max-depth=')) options.maxDepth = Number.parseInt(arg.slice('--max-depth='.length), 10);
    if (arg.startsWith('--max-files=')) options.maxFiles = Number.parseInt(arg.slice('--max-files='.length), 10);
    if (arg.startsWith('--architecture-docs=')) options.architectureDocs = arg.slice('--architecture-docs='.length);
    if (arg.startsWith('--formats=')) {
      options.formats = arg.slice('--formats='.length).split(/[,+\s]+/).filter(Boolean);
    }
  }
  if (args.includes('--mmd')) {
    options.formats = [...new Set([...(options.formats ?? ['json', 'jsonl', 'md', 'mmd']), 'mmd'])];
  }
  if (options.llm) {
    options._llmRequested = true;
  }
  return options;
}

async function findArchitectureSources(root, configured = '.docs') {
  const directory = path.isAbsolute(configured) ? configured : path.join(root, configured);
  const sources = [];
  async function walk(current) {
    let entries = [];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.md', '.mdx', '.mmd'].includes(ext)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      const content = await safeRead(full);
      sources.push({
        file: rel,
        kind: ext === '.mmd' ? 'diagram' : 'architecture-doc',
        title: content.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(rel),
        headings: [...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 12),
        size: content.length
      });
    }
  }
  await walk(directory);
  return sources.sort((a, b) => a.file.localeCompare(b.file));
}

async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function readPackageInfo(root) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return { name: pkg.name, version: pkg.version };
  } catch {
    return {};
  }
}

async function readGitHead(root) {
  try {
    const head = (await readFile(path.join(root, '.git/HEAD'), 'utf8')).trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      return (await readFile(path.join(root, '.git', ref), 'utf8')).trim().slice(0, 12);
    }
    return head.slice(0, 12);
  } catch {
    return null;
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
