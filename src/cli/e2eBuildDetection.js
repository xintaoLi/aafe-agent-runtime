import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

async function exists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Inspect manifest and file names only: initialization must not execute builds/config JS.
export async function detectE2eBuild(root, { tool, configFile } = {}) {
  let pkg = {};
  try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (tool && !['vite', 'webpack', 'custom'].includes(tool)) throw new Error('e2e-build-tool-invalid');
  const scripts = Object.values(pkg.scripts ?? {}).join('\n');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const vueRouterVersion = String(deps['vue-router'] ?? '').match(/\d+/)?.[0];
  const routerMode = vueRouterVersion && Number(vueRouterVersion) < 4 ? 'hash' : null;
  const files = {};
  for (const engine of ['vite', 'webpack']) {
    files[engine] = [];
    for (const ext of (engine === 'vite' ? ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'] : ['js', 'cjs', 'mjs'])) {
      const name = `${engine}.config.${ext}`;
      if (await exists(path.join(root, name))) files[engine].push(name);
    }
  }
  let selected = tool;
  if (!selected && /\bbkmonitor-cli\b/.test(scripts)) selected = 'custom';
  const candidates = ['vite', 'webpack'].filter((engine) => files[engine].length || deps[engine] || new RegExp('\\b' + engine + '(?:\\s|$)').test(scripts));
  if (!selected && candidates.length === 1) selected = candidates[0];
  if (!selected) return { tool: null, candidates, routerMode, reason: candidates.length ? 'ambiguous-build-tool' : 'unknown-build-tool' };
  if (!configFile && selected !== 'custom') {
    const scripted = new Set();
    for (const name of ['dev:e2e', 'dev', 'start', 'serve']) {
      const script = pkg.scripts?.[name] ?? '';
      if (!new RegExp('\\b' + selected + '\\b').test(script)) continue;
      const match = /(?:--config|-c)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(script);
      if (match) scripted.add(match[1] ?? match[2] ?? match[3]);
    }
    if (scripted.size > 1) throw new Error('e2e-build-config-ambiguous: specify --build-config');
    configFile = [...scripted][0];
  }
  if (configFile && (path.isAbsolute(configFile) || path.relative(root, path.resolve(root, configFile)).startsWith('..'))) {
    throw new Error('e2e-build-config-must-be-project-relative');
  }
  if (configFile && !await exists(path.join(root, configFile))) throw new Error('e2e-build-config-not-found');
  if (!configFile && files[selected]?.length > 1) throw new Error('e2e-build-config-ambiguous: specify --build-config');
  const entry = configFile ?? files[selected]?.[0] ?? null;
  const customCommand = pkg.scripts?.['dev:e2e'] ? ['npm', 'run', 'dev:e2e'] : [];
  return { tool: selected, configFile: entry, routerMode,
    command: selected === 'custom' ? customCommand : selected === 'vite'
      ? ['npx', '--no-install', 'vite', '--config', 'aafe.e2e.vite.mjs']
      : ['npx', '--no-install', 'webpack', 'serve', '--config', 'aafe.e2e.webpack.cjs'],
    warnings: selected === 'custom' ? ['Custom build: wire local.settings.e2e.aafe.cjs and AAFE_E2E_PORT into the existing dev:e2e script before enabling.'] : [] };
}
