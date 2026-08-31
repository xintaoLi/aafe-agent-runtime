import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_MARKERS = Object.freeze([
  '.aafe.config.json',
  '.aafe.agents.json',
  '.aafe',
  '.ai-agent',
  'package.json',
  '.git'
]);

const RULE_DIRS = Object.freeze(['.aafe/rules', '.ai-agent/rules', '.cursor/rules', '.codebuddy/rules']);
const SKILL_DIRS = Object.freeze(['.aafe/skills', '.ai-agent/project-skills', '.ai-agent/skills', '.cursor/skills', '.codebuddy/skills']);
const HOSTS = Object.freeze(['cursor', 'codebuddy', 'openclaw', 'hermes', 'cli']);
const MAX_INSTRUCTION_CHARS = 12000;

/**
 * Resolve a project and its AAFE capability sources. Markdown rules and skills
 * are instructions, not executable plugins. Editor hosts delegate activation
 * to the editor; headless hosts receive a bounded instruction package instead.
 */
export async function discoverProjectContext(start = process.cwd(), options = {}) {
  const startDir = path.resolve(start);
  const root = options.root ? path.resolve(options.root) : await findProjectRoot(startDir);
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : await findWorkspaceRoot(root);
  const host = resolveProjectHost(options.host);
  const layers = [];

  for (const base of uniquePaths([root, workspaceRoot])) {
    const layer = await discoverLayer(base, root, options);
    if (layer.rules.length || layer.skills.length || layer.configFiles.length) layers.push(layer);
  }

  const context = {
    cwd: startDir,
    root,
    workspaceRoot,
    projectName: await projectName(root),
    host,
    activationMode: isEditorHost(host) ? 'editor-managed' : 'runtime-managed',
    layers,
    rules: flattenEntries(layers, 'rules'),
    skills: flattenEntries(layers, 'skills'),
    configFiles: [...new Set(layers.flatMap((layer) => layer.configFiles))],
    precedence: 'project > workspace; within a layer .aafe > .ai-agent > editor'
  };

  context.activation = buildActivation(context);
  if (context.activationMode === 'runtime-managed') {
    context.instructions = await loadInstructions([...context.rules, ...context.skills], options);
  } else {
    context.instructions = [];
  }
  return context;
}

export function resolveProjectHost(host) {
  const explicit = String(host ?? '').trim().toLowerCase();
  if (HOSTS.includes(explicit)) return explicit;
  if (process.env.AAFE_HOST && HOSTS.includes(process.env.AAFE_HOST.toLowerCase())) return process.env.AAFE_HOST.toLowerCase();
  if (process.env.OPENCLAW_RUNTIME || process.env.OPENCLAW_WORKSPACE) return 'openclaw';
  if (process.env.HERMES_RUNTIME || process.env.HERMES_SESSION_ID) return 'hermes';
  if (process.env.CODEBUDDY_SESSION || process.env.CODEBUDDY_PROJECT) return 'codebuddy';
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_PROJECT_DIR) return 'cursor';
  return 'cli';
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  const initial = current;
  while (true) {
    if (await hasAnyMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return initial;
}

async function findWorkspaceRoot(root) {
  let current = root;
  while (true) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return root;
    current = parent;
  }
}

async function discoverLayer(base, projectRoot, options) {
  const rules = await discoverEntries(base, RULE_DIRS, 'rule', projectRoot, options);
  const skills = await discoverEntries(base, SKILL_DIRS, 'skill', projectRoot, options);
  const configFiles = [];
  for (const file of ['.aafe.config.json', '.aafe.agents.json']) {
    const absolute = path.join(base, file);
    if (await exists(absolute)) configFiles.push(relativeSafe(projectRoot, absolute));
  }
  return { root: base, scope: base === projectRoot ? 'project' : 'workspace', rules, skills, configFiles };
}

async function discoverEntries(base, dirs, kind, projectRoot, options) {
  const found = [];
  for (const relativeDir of dirs) {
    const dir = path.join(base, relativeDir);
    if (!(await exists(dir))) continue;
    const files = await walk(dir, options.maxFiles ?? 500);
    for (const file of files) {
      const name = path.basename(file);
      const isRule = kind === 'rule' && /\.(md|mdc|markdown)$/i.test(name);
      const isSkill = kind === 'skill' && (name === 'SKILL.md' || /\.(md|markdown)$/i.test(name));
      if (!isRule && !isSkill) continue;
      found.push({ id: path.relative(dir, file).replaceAll(path.sep, '/'), kind, source: relativeSafe(projectRoot, file), absolutePath: file, directory: relativeDir, scope: base === projectRoot ? 'project' : 'workspace', metadata: await readFrontmatter(file) });
    }
  }
  return dedupeBySource(found);
}

function buildActivation(context) {
  return {
    host: context.host,
    mode: context.activationMode,
    delegatedToEditor: context.activationMode === 'editor-managed',
    rules: context.rules.map((entry) => ({ source: entry.source, scope: entry.scope, trigger: context.activationMode })),
    skills: context.skills.map((entry) => ({ source: entry.source, scope: entry.scope, trigger: context.activationMode }))
  };
}

async function loadInstructions(entries, options) {
  const limit = options.maxInstructionChars ?? MAX_INSTRUCTION_CHARS;
  const instructions = [];
  let size = 0;
  for (const entry of entries) {
    if (size >= limit) break;
    try {
      const content = await readFile(entry.absolutePath, 'utf8');
      const remaining = limit - size;
      instructions.push({ ...entry, content: content.slice(0, remaining) });
      size += Math.min(content.length, remaining);
    } catch { /* deleted or unreadable instruction files are ignored */ }
  }
  return instructions;
}

async function walk(dir, limit) {
  const output = [];
  async function visit(current) {
    if (output.length >= limit) return;
    let entries = [];
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else output.push(target);
      if (output.length >= limit) return;
    }
  }
  await visit(dir);
  return output;
}

async function readFrontmatter(file) {
  try {
    const text = await readFile(file, 'utf8');
    if (!text.startsWith('---')) return {};
    const end = text.indexOf('\n---', 3);
    if (end < 0) return {};
    const metadata = {};
    for (const line of text.slice(3, end).split('\n')) {
      const match = line.match(/^([\w-]+):\s*(.*?)\s*$/);
      if (match) metadata[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
    return metadata;
  } catch { return {}; }
}

async function projectName(root) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return packageJson.name ?? path.basename(root);
  } catch { return path.basename(root); }
}

async function hasAnyMarker(dir) {
  for (const marker of PROJECT_MARKERS) if (await exists(path.join(dir, marker))) return true;
  return false;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function flattenEntries(layers, key) {
  return layers.flatMap((layer) => layer[key]).sort((a, b) => `${a.scope}:${a.directory}:${a.id}`.localeCompare(`${b.scope}:${b.directory}:${b.id}`));
}
function dedupeBySource(entries) { return [...new Map(entries.map((entry) => [entry.source, entry])).values()]; }
function uniquePaths(values) { return [...new Set(values.map((value) => path.resolve(value)))]; }
function relativeSafe(root, file) { return path.relative(root, file).replaceAll(path.sep, '/'); }
function isEditorHost(host) { return host === 'cursor' || host === 'codebuddy'; }
