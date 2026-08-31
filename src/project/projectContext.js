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

const RULE_DIRS = Object.freeze([
  '.aafe/rules',
  '.ai-agent/rules',
  '.cursor/rules'
]);

const SKILL_DIRS = Object.freeze([
  '.aafe/skills',
  '.ai-agent/project-skills',
  '.ai-agent/skills',
  '.cursor/skills'
]);

/**
 * Resolve the project that owns a command invocation and enumerate its
 * project-local AAFE rules and skills. The result is data only: loading this
 * manifest never executes a rule or skill.
 *
 * Search is nearest-first and stops at the first directory containing a
 * project marker. This prevents a monorepo child from accidentally inheriting
 * another sibling's rules. Workspace-level adapters remain visible as a
 * separate layer when the child has layered editor configuration.
 */
export async function discoverProjectContext(start = process.cwd(), options = {}) {
  const startDir = path.resolve(start);
  const root = options.root ? path.resolve(options.root) : await findProjectRoot(startDir);
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : await findWorkspaceRoot(root);
  const layers = [];

  for (const base of uniquePaths([root, workspaceRoot])) {
    const layer = await discoverLayer(base, root, options);
    if (layer.rules.length || layer.skills.length || layer.configFiles.length) layers.push(layer);
  }

  return {
    cwd: startDir,
    root,
    workspaceRoot,
    projectName: await projectName(root),
    layers,
    rules: flattenEntries(layers, 'rules'),
    skills: flattenEntries(layers, 'skills'),
    configFiles: [...new Set(layers.flatMap((layer) => layer.configFiles))],
    precedence: 'project > workspace; within a layer .aafe > .ai-agent > editor'
  };
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
      found.push({
        id: path.relative(dir, file).replaceAll(path.sep, '/'),
        kind,
        source: relativeSafe(projectRoot, file),
        absolutePath: file,
        directory: relativeDir,
        scope: base === projectRoot ? 'project' : 'workspace',
        metadata: await readFrontmatter(file)
      });
    }
  }
  return dedupeBySource(found);
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
  } catch {
    return {};
  }
}

async function projectName(root) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return packageJson.name ?? path.basename(root);
  } catch {
    return path.basename(root);
  }
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

function dedupeBySource(entries) {
  return [...new Map(entries.map((entry) => [entry.source, entry])).values()];
}

function uniquePaths(values) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function relativeSafe(root, file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}
