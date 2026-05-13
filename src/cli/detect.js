import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function detectProject(root) {
  const packageJson = await readJson(path.join(root, 'package.json'));
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };

  return {
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
    ['trace', '.trace']
  ];
  const found = [];
  for (const [name, rel] of checks) {
    if (await exists(path.join(root, rel))) found.push(name);
  }
  return found.length ? found : ['cursor'];
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
