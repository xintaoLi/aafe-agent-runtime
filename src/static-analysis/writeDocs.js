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

import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Write analyze artifacts under docsOut with merge / force / skip-existing semantics.
 */
export async function writeAnalyzeDocs(root, payload, options = {}) {
  const docsOut = options.docsOut ?? '.ai-agent/.docs';
  const docsAbs = path.join(root, docsOut);
  const writes = {};

  const existing = await directoryHasContent(docsAbs);
  if (options.skipExisting && existing) {
    return { mode: 'skip-existing', skipped: true, docsOut, writes };
  }

  if (existing && process.stderr.isTTY && !options.force && !options.skipExisting && !options.quiet) {
    console.error(`[aafe analyze] ${docsOut} already exists; using merge (unchanged files skipped). Use --force to overwrite or --skip-existing to skip.`);
  }

  const files = buildFileMap(payload, docsOut);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    const previous = await safeRead(abs);
    if (!options.force && previous && sameGeneratedContent(previous, content)) {
      writes[rel] = 'unchanged';
      continue;
    }
    if (!options.force && previous === content) {
      writes[rel] = 'unchanged';
      continue;
    }
    await writeFile(abs, content);
    writes[rel] = previous ? 'updated' : 'created';
  }

  return { mode: options.force ? 'force' : 'merge', skipped: false, docsOut, writes };
}

function buildFileMap(payload, docsOut) {
  const {
    generatedAt,
    projectName,
    entryDiscovery,
    architecture,
    dataflow,
    routeGraph,
    llm
  } = payload;

  const files = {};
  files[`${docsOut}/index.md`] = renderDocsIndex({ generatedAt, projectName, entryDiscovery, architecture, dataflow, docsOut });
  files[`${docsOut}/entries.json`] = JSON.stringify({
    generatedAt,
    projectName,
    buildTool: entryDiscovery.buildTool,
    frameworkHint: entryDiscovery.frameworkHint,
    entries: entryDiscovery.entries,
    llmDetection: entryDiscovery.llmDetection,
    llm
  }, null, 2) + '\n';

  files[`${docsOut}/architecture/index.md`] = architecture.indexMarkdown;
  for (const mod of architecture.modules) {
    files[`${docsOut}/architecture/modules/${mod.id}.md`] = mod.markdown;
  }

  files[`${docsOut}/dataflow/index.md`] = dataflow.indexMarkdown;
  for (const mod of dataflow.modules) {
    files[`${docsOut}/dataflow/modules/${mod.id}.md`] = mod.markdown;
  }

  files[`${docsOut}/facts/graph.json`] = JSON.stringify({
    generatedAt,
    visited: routeGraph.visited,
    edges: routeGraph.edges,
    routes: routeGraph.routes,
    dataflow: dataflow.graph
  }, null, 2) + '\n';

  for (const mod of architecture.modules) {
    const data = dataflow.modules.find((item) => item.id === mod.id);
    files[`${docsOut}/facts/modules/${mod.id}.json`] = JSON.stringify({
      architecture: mod.facts,
      dataflow: data?.facts ?? null
    }, null, 2) + '\n';
  }

  files[`${docsOut}/llm/README.md`] = renderLlmReadme();
  files[`${docsOut}/llm/prompts/analyze-module.md`] = renderLlmPrompt();

  return files;
}

function renderDocsIndex({ generatedAt, projectName, entryDiscovery, architecture, dataflow, docsOut }) {
  return `# AAFE Analyze Docs

Generated: ${generatedAt}
Project: ${projectName}

This directory is produced by \`aafe analyze\`. It stores entry discovery, AST-derived architecture and dataflow facts for **on-demand** agent loading.

## Entry

- Build tool: \`${entryDiscovery.buildTool}\`
- Framework: \`${entryDiscovery.frameworkHint}\`
- Details: [\`entries.json\`](entries.json)

## Indexes

- Architecture: [\`architecture/index.md\`](architecture/index.md) (${architecture.modules.length} modules)
- Dataflow: [\`dataflow/index.md\`](dataflow/index.md)
- Facts graph: [\`facts/graph.json\`](facts/graph.json)
- LLM reserved: [\`llm/README.md\`](llm/README.md)

## On-demand skills

- \`.ai-agent/skills/architecture-on-demand.md\`
- \`.ai-agent/skills/dataflow-on-demand.md\`

Do not eagerly read every file under \`${docsOut}/architecture/modules\` or \`${docsOut}/dataflow/modules\`.
`;
}

function renderLlmReadme() {
  return `# LLM Enrichment (Reserved)

Deterministic AST facts under \`facts/\` are the source of truth today.

When an LLM API is configured via \`.aafe.config.json\`:

\`\`\`json
{
  "analyze": {
    "llm": { "enabled": true, "provider": "openai-compatible", "baseUrl": "", "model": "" }
  }
}
\`\`\`

or env \`AAFE_ANALYZE_LLM_PROVIDER\` + \`AAFE_ANALYZE_LLM_API_KEY\`, \`aafe analyze --llm\` may enrich module narratives.

Contract:

1. Input: \`facts/modules/<id>.json\`
2. Prompt: \`prompts/analyze-module.md\`
3. Output: optional markdown sections appended to architecture/dataflow module docs (never overwrite raw facts JSON)

Until configured, \`analyzeModuleWithLlm\` returns \`skipped: llm-not-configured\`.
`;
}

function renderLlmPrompt() {
  return `# Analyze Module Prompt (Reserved)

You are enriching AAFE module analysis. Given JSON facts for one module:

- Summarize responsibilities in 3-5 bullets
- List likely data dependencies (API/store/hooks)
- List impact risks for changes
- Do not invent files not present in facts

Return markdown only.
`;
}

function sameGeneratedContent(left, right) {
  return normalizeGenerated(left) === normalizeGenerated(right);
}

function normalizeGenerated(content) {
  return String(content)
    .replace(/^Generated: .+$/gm, 'Generated: <generated-at>')
    .replace(/"generatedAt"\s*:\s*"[^"]*"/g, '"generatedAt":"<generated-at>"')
    .replace(/\n+$/g, '\n');
}

async function directoryHasContent(dir) {
  try {
    await access(dir);
    const entries = await readdir(dir);
    return entries.length > 0;
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
