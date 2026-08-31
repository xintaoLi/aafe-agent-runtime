import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function detectProject(root) {
  const packageJson = await readJson(path.join(root, 'package.json'));
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };

  return {
    packageName: packageJson.name ?? path.basename(root),
    framework: detectFramework(deps, packageJson),
    editors: await detectEditors(root),
    scenarios: detectScenarios(deps, packageJson),
    packageManager: await detectPackageManager(root)
  };
}

function detectFramework(deps, packageJson) {
  if (deps.next) return 'next';
  if (deps.vue || deps.nuxt) return 'vue';
  if (deps.react || deps['react-dom']) return 'react';
  if (packageJson.workspaces) return 'monorepo';
  return 'generic';
}

async function detectEditors(root) {
  const checks = [
    ['cursor', '.cursor'],
    ['claude', 'CLAUDE.md'],
    ['codebuddy', '.codebuddy'],
    ['codex', '.codex'],
    ['trace', '.trace'],
    ['hermes', 'AGENTS.md'],
    ['openclaw', '.openclaw']
  ];
  const found = [];
  for (const [name, rel] of checks) {
    if (await exists(path.join(root, rel))) found.push(name);
  }
  // Auto-detect Hermes/OpenClaw runtime environments via env markers.
  const envEditors = detectEnvironmentEditors();
  for (const editor of envEditors) {
    if (!found.includes(editor)) found.push(editor);
  }
  return found.length ? found : ['cursor'];
}

/**
 * Detect Hermes and OpenClaw agent environments via environment variables
 * and marker files that are present when `aafe init`/`aafe update` runs
 * inside those agent runtimes.
 *
 * Hermes markers:
 *   - HERMES_AGENT env var (set by Hermes runtime)
 *   - /data/projects/.hermes/config.yaml (Hermes project config)
 *   - .hermes/ directory in workspace
 *
 * OpenClaw markers:
 *   - OPENCLAW_SPACE_ID env var (set by OpenClaw platform)
 *   - .openclaw/ directory in workspace
 */
function detectEnvironmentEditors() {
  const editors = [];
  if (process.env.HERMES_AGENT ||
      process.env.HERMES_PROFILE ||
      process.env.HERMES_SESSION_ID) {
    editors.push('hermes');
  }
  if (process.env.OPENCLAW_SPACE_ID ||
      process.env.OPENCLAW_AGENT) {
    editors.push('openclaw');
  }
  return editors;
}

function detectScenarios(deps, packageJson) {
  const text = JSON.stringify({ deps, scripts: packageJson.scripts ?? {}, keywords: packageJson.keywords ?? [] }).toLowerCase();
  const scenarios = ['complex'];
  if (/elkjs|reactflow|xyflow|dagre|graph|canvas/.test(text)) scenarios.push('graph');
  if (/admin|antd|element-plus/.test(text)) scenarios.push('admin');
  if (/dashboard|echarts|chart|recharts/.test(text)) scenarios.push('dashboard');
  if (/workflow|approval|bpmn/.test(text)) scenarios.push('workflow');
  return scenarios;
}

async function detectPackageManager(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}
