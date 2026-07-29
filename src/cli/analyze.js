import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.vue', '.tsx', '.ts', '.jsx', '.js', '.md', '.mdx']);
const CODE_EXTENSIONS = new Set(['.vue', '.tsx', '.ts', '.jsx', '.js']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx']);
const KNOWLEDGE_DOC_EXTENSIONS = new Set(['.md', '.mdx', '.mmd']);
const IGNORE_DIRS = new Set([
  '.git',
  '.ai-agent',
  '.cursor',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  'output',
  'tmp',
  'temp'
]);

export async function runAnalyzeCommand(root, args = []) {
  const options = parseAnalyzeOptions(args);
  const report = await analyzeProjectArchitecture(root, options);

  if (options.dryRun) {
    console.log(JSON.stringify({
      status: 'pass',
      dryRun: true,
      command: 'aafe analyze',
      summary: report.summary,
      planned: report.outputs,
      counts: report.counts
    }, null, 2));
    return;
  }

  if (options.write !== false) {
    await writeArchitectureArtifacts(root, report, options);
  }

  console.log(JSON.stringify({
    status: 'pass',
    command: 'aafe analyze',
    summary: report.summary,
    counts: report.counts,
    outputs: report.outputs
  }, null, 2));
}

export async function analyzeProjectArchitecture(root, options = {}) {
  const files = await collectFiles(root, options);
  const packageInfo = await readPackageInfo(root);
  const routes = await findRoutes(root, files);
  const components = await findComponents(root, files);
  const designDocs = await findDesignDocs(root, files);
  const architectureSources = await findArchitectureSources(root, options);
  const modules = inferModules(files);
  const generatedAt = new Date().toISOString();
  const projectName = packageInfo.name ?? path.basename(root);

  const report = {
    generatedAt,
    root,
    projectName,
    packageInfo,
    modules,
    routes,
    components,
    designDocs,
    architectureSources,
    counts: {
      files: files.length,
      modules: modules.length,
      routes: routes.length,
      components: components.length,
      designDocs: designDocs.length,
      architectureSources: architectureSources.length
    },
    outputs: {
      skill: '.ai-agent/skills/project-architecture-locator.md',
      memory: '.ai-agent/memory/project-architecture.md',
      knowledge: '.ai-agent/memory/knowledge-center-architecture.md',
      knowledgeSkill: '.ai-agent/skills/knowledge-center-architecture.md'
    }
  };
  report.summary = `Project architecture index generated for ${projectName}: ${routes.length} route entries, ${components.length} component entries, ${designDocs.length} design docs.`;
  return report;
}

async function writeArchitectureArtifacts(root, report, options) {
  const skillPath = path.join(root, report.outputs.skill);
  const memoryPath = path.join(root, report.outputs.memory);
  const knowledgePath = path.join(root, report.outputs.knowledge);
  const knowledgeSkillPath = path.join(root, report.outputs.knowledgeSkill);
  await mkdir(path.dirname(skillPath), { recursive: true });
  await mkdir(path.dirname(memoryPath), { recursive: true });

  const skillResult = await writeGeneratedArchitectureFile(skillPath, renderLocatorSkill(report));
  const memoryResult = await writeGeneratedArchitectureFile(memoryPath, renderArchitectureMemory(report));
  const knowledgeResult = await writeGeneratedArchitectureFile(knowledgePath, renderKnowledgeArchitectureMemory(report));
  const knowledgeSkillResult = await writeGeneratedArchitectureFile(knowledgeSkillPath, renderKnowledgeArchitectureSkill(report));
  report.outputs.writes = {
    skill: skillResult,
    memory: memoryResult,
    knowledge: knowledgeResult,
    knowledgeSkill: knowledgeSkillResult
  };
}

async function writeGeneratedArchitectureFile(filePath, content) {
  const previous = await safeRead(filePath);
  if (previous && sameArchitectureContent(previous, content)) {
    return 'unchanged';
  }
  if (previous === content) {
    return 'unchanged';
  }
  await writeFile(filePath, content);
  return previous ? 'updated' : 'created';
}

function sameArchitectureContent(left, right) {
  return normalizeGeneratedArchitectureContent(left) === normalizeGeneratedArchitectureContent(right);
}

function normalizeGeneratedArchitectureContent(content) {
  return content
    .replace(/^Generated: .+$/m, 'Generated: <generated-at>')
    .replace(/\n+$/g, '\n');
}

function parseAnalyzeOptions(args) {
  const options = {
    dryRun: args.includes('--dry-run'),
    write: !args.includes('--no-write'),
    maxFiles: 6000,
    maxEntries: 120
  };
  for (const arg of args) {
    if (arg.startsWith('--max-files=')) options.maxFiles = Number.parseInt(arg.slice('--max-files='.length), 10) || options.maxFiles;
    if (arg.startsWith('--max-entries=')) options.maxEntries = Number.parseInt(arg.slice('--max-entries='.length), 10) || options.maxEntries;
    if (arg.startsWith('--architecture-docs=')) options.architectureDocs = arg.slice('--architecture-docs='.length);
  }
  return options;
}

async function collectFiles(root, options) {
  const results = [];
  async function walk(dir) {
    if (results.length >= options.maxFiles) return;
    const entries = await safeReaddir(dir);
    for (const entry of entries) {
      if (results.length >= options.maxFiles) return;
      if (entry.name.startsWith('.') && IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = normalizePath(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      results.push(rel);
    }
  }
  await walk(root);
  return results.sort();
}

async function findRoutes(root, files) {
  const routeCandidates = files.filter((file) => {
    const normalized = file.toLowerCase();
    if (!CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
    return /(^|\/)(router|routes|pages|views|app)(\/|\.|$)/.test(normalized)
      || normalized.includes('createrouter')
      || normalized.endsWith('router.ts')
      || normalized.endsWith('router.js');
  });

  const routes = [];
  for (const file of routeCandidates) {
    const content = await safeRead(path.join(root, file));
    const routeEntries = extractRouteEntries(content);
    if (routeEntries.length) {
      for (const entry of routeEntries) routes.push({ ...entry, file });
      continue;
    }
    if (isFileBasedRoute(file)) {
      routes.push({ path: inferRoutePath(file), name: inferName(file), component: file, file, source: 'file' });
    }
  }
  return uniqueBy(routes, (item) => `${item.path}|${item.file}|${item.component ?? ''}`).slice(0, 160);
}

function extractRouteEntries(content) {
  const entries = [];
  const routeObjectRegex = /path\s*:\s*['"`]([^'"`]+)['"`][\s\S]{0,500}?(?:name\s*:\s*['"`]([^'"`]+)['"`])?[\s\S]{0,500}?(?:component\s*:\s*([^,}\n]+))?/g;
  let match;
  while ((match = routeObjectRegex.exec(content))) {
    entries.push({
      path: match[1],
      name: match[2] ?? '',
      component: cleanComponent(match[3] ?? ''),
      source: 'config'
    });
  }
  return entries;
}

async function findComponents(root, files) {
  const components = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.vue', '.tsx', '.jsx'].includes(ext)) continue;
    if (!isComponentPath(file)) continue;
    const content = await safeRead(path.join(root, file));
    components.push({
      name: extractComponentName(content, file),
      file,
      kind: inferComponentKind(file),
      props: extractProps(content).slice(0, 12),
      emits: extractEmits(content).slice(0, 12)
    });
  }
  return uniqueBy(components, (item) => item.file).slice(0, 180);
}

async function findArchitectureSources(root, options = {}) {
  const configured = options.architectureDocs ?? '.docs';
  const directory = path.isAbsolute(configured) ? configured : path.join(root, configured);
  const sources = [];

  async function walk(current) {
    for (const entry of await safeReaddir(current)) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !KNOWLEDGE_DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const relative = path.relative(root, fullPath);
      const content = await safeRead(fullPath);
      sources.push({
        file: normalizePath(relative),
        kind: path.extname(entry.name).toLowerCase() === '.mmd' ? 'diagram' : 'architecture-doc',
        title: extractTitle(content, relative),
        headings: extractHeadings(content).slice(0, 12),
        size: content.length
      });
    }
  }

  await walk(directory);
  return sources.sort((left, right) => left.file.localeCompare(right.file));
}

async function findDesignDocs(root, files) {
  const docs = [];
  for (const file of files) {
    if (!DOC_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const lower = file.toLowerCase();
    const isDesignDoc = lower === 'readme.md'
      || lower.includes('architecture')
      || lower.includes('design')
      || lower.includes('adr')
      || lower.includes('plan')
      || lower.includes('方案')
      || lower.includes('设计')
      || lower.includes('架构')
      || lower.startsWith('docs/');
    if (!isDesignDoc) continue;
    const content = await safeRead(path.join(root, file));
    docs.push({
      file,
      title: extractTitle(content, file),
      headings: extractHeadings(content).slice(0, 8)
    });
  }
  return docs.slice(0, 80);
}

function inferModules(files) {
  const candidates = new Map();
  for (const file of files) {
    const parts = file.split('/');
    const index = parts.findIndex((part) => ['src', 'packages', 'modules', 'apps'].includes(part));
    if (index < 0 || !parts[index + 1]) continue;
    const modulePath = parts.slice(0, Math.min(parts.length - 1, index + 3)).join('/');
    if (!modulePath) continue;
    candidates.set(modulePath, (candidates.get(modulePath) ?? 0) + 1);
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([name, fileCount]) => ({ name, fileCount }));
}

async function readPackageInfo(root) {
  const text = await safeRead(path.join(root, 'package.json'));
  if (!text) return {};
  try {
    const pkg = JSON.parse(text);
    return {
      name: pkg.name,
      version: pkg.version,
      scripts: Object.keys(pkg.scripts ?? {}).slice(0, 20),
      dependencies: Object.keys(pkg.dependencies ?? {}).slice(0, 30),
      devDependencies: Object.keys(pkg.devDependencies ?? {}).slice(0, 30)
    };
  } catch {
    return {};
  }
}

function renderLocatorSkill(report) {
  return `# Skill: Project Architecture Locator

Generated: ${report.generatedAt}
Project: ${report.projectName}
Root: ${report.root}

## Purpose

Use this project-specific skill before reading large source files. It provides a compact map of the main routes, components, modules and design documents so AI agents can locate the right context quickly and avoid wasting context window.

## How to Use

1. Match the user's request to route/module/component keywords below.
2. Read only the listed files that are directly relevant.
3. Use design documents first when the request is architecture or requirement related.
4. Re-run \`aafe analyze\` after major route, component or architecture changes.

## Project Summary

- Package: ${report.packageInfo.name ?? report.projectName}
- Version: ${report.packageInfo.version ?? 'unknown'}
- Files scanned: ${report.counts.files}
- Route entries: ${report.counts.routes}
- Component entries: ${report.counts.components}
- Design docs: ${report.counts.designDocs}

## Main Routes

${renderRoutes(report.routes)}

## Main Components

${renderComponents(report.components)}

## Main Modules

${renderModules(report.modules)}

## Design Documents

${renderDesignDocs(report.designDocs)}

## Context Budget Rules

- Prefer this locator before broad grep/search.
- Read route config first for page-level tasks.
- Read component files only after identifying the owning route/module.
- For design questions, read the listed design docs before implementation files.
`;
}

function renderKnowledgeArchitectureSkill(report) {
  return `# Skill: Knowledge Center Architecture Context

Generated: ${report.generatedAt}
Project: ${report.projectName}

## Purpose

Use the existing architecture documents and Mermaid diagrams as the first context for AI project management. Do not build a separate deep documentation site or invent domain entities not present in the project.

## Sources

${report.architectureSources.length ? report.architectureSources.map((source) => `- \`${source.file}\` [${source.kind}] ${source.title}`).join('\n') : '- No architecture sources found; run `aafe analyze --architecture-docs=<path>`.'}

## Execution Rules

1. Read the relevant source document and diagram before planning a task.
2. Map requested changes to modules, routes, stores, APIs, workers, storage and tests.
3. Use architecture diagrams as relationship and flow evidence.
4. Prefer current code when documentation conflicts and record the conflict.
5. Before publishing knowledge, include source paths, commit/version, confidence and review status.
6. For changes to streaming, parsing, pagination, cancellation, cache or IndexedDB, calculate downstream impact and minimum verification paths.
`;
}

function renderKnowledgeArchitectureMemory(report) {
  const sources = report.architectureSources.length
    ? report.architectureSources.map((source) => `- \`${source.file}\` [${source.kind}] ${source.title}${source.headings.length ? ` — ${source.headings.join(' > ')}` : ''}`).join('\n')
    : '- No configured architecture sources found.';
  return `# Knowledge Center Architecture Sources

Generated: ${report.generatedAt}
Project: ${report.projectName}

This generated memory is the primary architecture context for Knowledge Center and AI project management. Prefer these sources before broad code search. The source documents and Mermaid diagrams are authoritative project context; do not invent a CRM domain model when the project describes another domain.

## Architecture Sources

${sources}

## Operating Rules

- Read the relevant architecture document and diagram before planning changes.
- Treat Mermaid diagrams as relationship and flow evidence, not as executable code.
- Prefer current source code when documentation conflicts, and record the conflict for review.
- Use \`aafe analyze --architecture-docs=<path>\` after architecture documents change.
- Use the architecture sources to guide AI task planning, impact analysis, test selection and knowledge updates.
`;
}

function renderArchitectureMemory(report) {
  return `# Project Architecture Index

Generated: ${report.generatedAt}
Project: ${report.projectName}

This file is generated by \`aafe analyze\`. It is intended as compact project memory for AI agents.

## Main Routes

${renderRoutes(report.routes)}

## Main Components

${renderComponents(report.components)}

## Main Modules

${renderModules(report.modules)}

## Design Documents

${renderDesignDocs(report.designDocs)}
`;
}

function renderRoutes(routes) {
  if (!routes.length) return '- No route entries detected.';
  return routes.map((route) => `- \`${route.path || '(unknown)'}\`${route.name ? ` (${route.name})` : ''}: ${route.component || route.file} — ${route.file}`).join('\n');
}

function renderComponents(components) {
  if (!components.length) return '- No component entries detected.';
  return components.map((component) => {
    const contract = [
      component.props.length ? `props: ${component.props.join(', ')}` : '',
      component.emits.length ? `emits: ${component.emits.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    return `- ${component.kind} \`${component.name}\`: ${component.file}${contract ? ` (${contract})` : ''}`;
  }).join('\n');
}

function renderModules(modules) {
  if (!modules.length) return '- No module entries detected.';
  return modules.map((module) => `- \`${module.name}\` (${module.fileCount} files)`).join('\n');
}

function renderDesignDocs(docs) {
  if (!docs.length) return '- No design documents detected.';
  return docs.map((doc) => {
    const headings = doc.headings.length ? ` — ${doc.headings.join(' > ')}` : '';
    return `- \`${doc.file}\`: ${doc.title}${headings}`;
  }).join('\n');
}

function isFileBasedRoute(file) {
  return /(^|\/)(pages|views|app)\//.test(file) && CODE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function inferRoutePath(file) {
  const withoutExt = file.replace(/\.[^.]+$/, '');
  const routeRoot = withoutExt.replace(/^.*\/(pages|views|app)\//, '/');
  return `/${routeRoot}`
    .replace(/\/index$/, '/')
    .replace(/\[(.+?)\]/g, ':$1')
    .replace(/\/+/g, '/');
}

function isComponentPath(file) {
  const base = path.basename(file, path.extname(file));
  return /(^|\/)(components|views|pages|modules|packages|src)\//.test(file)
    && (/^[A-Z]/.test(base) || file.endsWith('.vue') || file.includes('/components/'));
}

function inferComponentKind(file) {
  if (file.includes('/pages/') || file.includes('/views/')) return 'page';
  if (file.includes('/components/')) return 'component';
  if (file.includes('/packages/')) return 'package-component';
  return 'component';
}

function extractComponentName(content, file) {
  const nameMatch = content.match(/name\s*:\s*['"`]([^'"`]+)['"`]/) || content.match(/defineOptions\s*\(\s*\{[\s\S]*?name\s*:\s*['"`]([^'"`]+)['"`]/);
  return nameMatch?.[1] ?? inferName(file);
}

function extractProps(content) {
  const names = new Set();
  for (const match of content.matchAll(/defineProps\s*<\s*\{([\s\S]*?)\}\s*>/g)) {
    for (const prop of match[1].matchAll(/([A-Za-z_$][\w$]*)\??\s*:/g)) names.add(prop[1]);
  }
  for (const match of content.matchAll(/props\s*:\s*\{([\s\S]*?)\}/g)) {
    for (const prop of match[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) names.add(prop[1]);
  }
  return [...names];
}

function extractEmits(content) {
  const names = new Set();
  for (const match of content.matchAll(/defineEmits\s*<[^>]*>\s*\(\s*\)/g)) {
    if (match[0]) names.add('typed-emits');
  }
  for (const match of content.matchAll(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const event of match[1].matchAll(/['"`]([^'"`]+)['"`]/g)) names.add(event[1]);
  }
  for (const match of content.matchAll(/emits\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const event of match[1].matchAll(/['"`]([^'"`]+)['"`]/g)) names.add(event[1]);
  }
  return [...names];
}

function extractTitle(content, file) {
  const title = content.match(/^#\s+(.+)$/m)?.[1];
  return title ?? inferName(file);
}

function extractHeadings(content) {
  return [...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim());
}

function cleanComponent(value) {
  return String(value).trim().replace(/\s+/g, ' ').slice(0, 120);
}

function inferName(file) {
  return path.basename(file, path.extname(file));
}

function uniqueBy(items, getKey) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}
