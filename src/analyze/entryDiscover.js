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

import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const COMMON_ENTRIES = [
  'src/main.ts',
  'src/main.tsx',
  'src/main.js',
  'src/main.jsx',
  'src/index.ts',
  'src/index.tsx',
  'src/index.js',
  'src/index.jsx',
  'src/App.vue',
  'src/app.js',
  'src/app.ts',
  'app/page.tsx',
  'app/page.ts',
  'app/page.jsx',
  'app/page.js',
  'pages/_app.tsx',
  'pages/_app.js',
  'pages/index.tsx',
  'pages/index.js',
  'index.js',
  'index.ts',
  'main.js',
  'main.ts'
];

/**
 * Discover project entry files from package.json + known build tools.
 * @param {string} root
 * @param {object} [options]
 */
export async function discoverProjectEntries(root, options = {}) {
  const pkg = await readJson(path.join(root, 'package.json'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const buildTool = detectBuildTool(root, pkg, deps, await listRootConfigFiles(root));
  const frameworkHint = detectFrameworkHint(deps, pkg, buildTool);
  const entries = [];
  const seen = new Set();

  const push = (file, source, kind = 'entry') => {
    if (!file) return;
    const normalized = normalizeRel(file);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ file: normalized, source, kind, exists: null });
  };

  collectPackageEntries(pkg, push);
  await collectBuildConfigEntries(root, buildTool, push);
  for (const candidate of COMMON_ENTRIES) push(candidate, 'convention', 'candidate');

  if (frameworkHint === 'next' || buildTool === 'next') {
    push('app/layout.tsx', 'next-app', 'framework-entry');
    push('app/layout.js', 'next-app', 'framework-entry');
    push('pages/_app.tsx', 'next-pages', 'framework-entry');
    push('pages/_app.js', 'next-pages', 'framework-entry');
  }

  const resolved = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.file);
    const exists = await pathExists(absolute);
    if (!exists && entry.kind === 'candidate') continue;
    if (!exists && entry.kind === 'framework-entry') continue;
    resolved.push({ ...entry, exists: Boolean(exists) });
  }

  // Prefer existing real entries; keep package/bin even if missing for visibility.
  const existing = resolved.filter((item) => item.exists);
  const primary = existing.filter((item) => item.kind === 'entry' || item.kind === 'framework-entry');
  const result = {
    buildTool,
    frameworkHint,
    packageName: pkg.name ?? path.basename(root),
    entries: (primary.length ? primary : existing).slice(0, options.maxEntries ?? 40),
    allCandidates: resolved.slice(0, 80),
    llmDetection: { status: 'reserved', enabled: false }
  };

  if (!result.entries.length && pkg.bin) {
    // Library/CLI projects: treat bin/main as logical entries even when already listed.
    collectPackageEntries(pkg, (file, source, kind) => {
      if (!result.entries.find((item) => item.file === normalizeRel(file))) {
        result.entries.push({ file: normalizeRel(file), source, kind, exists: false });
      }
    });
  }

  return result;
}

/**
 * Reserved hook for future LLM-assisted entry detection.
 * Deterministic discovery remains the source of truth until LLM is configured.
 */
export async function detectEntriesWithLlmStub(root, deterministicResult, _options = {}) {
  return {
    ...deterministicResult,
    llmDetection: {
      status: 'skipped',
      reason: 'llm-not-configured',
      message: 'LLM entry auto-detection is reserved. Configure analyze.llm when API is available.'
    }
  };
}

function collectPackageEntries(pkg, push) {
  if (pkg.main) push(stripDot(pkg.main), 'package.json#main');
  if (pkg.module) push(stripDot(pkg.module), 'package.json#module');
  if (pkg.browser && typeof pkg.browser === 'string') push(stripDot(pkg.browser), 'package.json#browser');
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') push(stripDot(pkg.bin), 'package.json#bin');
    else {
      for (const value of Object.values(pkg.bin)) push(stripDot(value), 'package.json#bin');
    }
  }
  if (pkg.exports) collectExports(pkg.exports, push);
  const scripts = pkg.scripts ?? {};
  for (const [name, script] of Object.entries(scripts)) {
    if (!/^(dev|start|serve|build)$/.test(name) && !name.includes('dev') && !name.includes('serve')) continue;
    const match = String(script).match(/(?:node|tsx|ts-node|vite|webpack)\s+([^\s]+\.(?:[cm]?[jt]sx?))/);
    if (match) push(stripDot(match[1]), `package.json#scripts.${name}`);
  }
}

function collectExports(exportsField, push, prefix = 'package.json#exports') {
  if (typeof exportsField === 'string') {
    push(stripDot(exportsField), prefix);
    return;
  }
  if (!exportsField || typeof exportsField !== 'object') return;
  for (const [key, value] of Object.entries(exportsField)) {
    if (typeof value === 'string') push(stripDot(value), `${prefix}${key}`);
    else if (value && typeof value === 'object') {
      for (const cond of ['import', 'require', 'default', 'module', 'browser']) {
        if (typeof value[cond] === 'string') push(stripDot(value[cond]), `${prefix}${key}.${cond}`);
      }
    }
  }
}

async function collectBuildConfigEntries(root, buildTool, push) {
  if (buildTool === 'vite') {
    const config = await findFirst(root, ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']);
    if (config) {
      push(config, 'vite-config', 'config');
      const content = await safeRead(path.join(root, config));
      for (const match of content.matchAll(/(?:input|entry)\s*:\s*['"`]([^'"`]+)['"`]/g)) {
        push(stripDot(match[1]), 'vite.config');
      }
      // Vite default SPA root index.html -> script
      const html = await safeRead(path.join(root, 'index.html'));
      for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
        push(stripDot(match[1].replace(/^\//, '')), 'index.html');
      }
    }
  }

  if (buildTool === 'webpack') {
    const config = await findFirst(root, ['webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs', 'webpack.dev.js']);
    if (config) {
      push(config, 'webpack-config', 'config');
      const content = await safeRead(path.join(root, config));
      for (const match of content.matchAll(/entry\s*:\s*['"`]([^'"`]+)['"`]/g)) {
        push(stripDot(match[1]), 'webpack.config');
      }
      for (const match of content.matchAll(/entry\s*:\s*\{([\s\S]*?)\}/g)) {
        for (const inner of match[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
          if (/\.[cm]?[jt]sx?$/.test(inner[1]) || inner[1].includes('src/')) push(stripDot(inner[1]), 'webpack.config');
        }
      }
    }
  }

  if (buildTool === 'vue-cli') {
    const config = await findFirst(root, ['vue.config.js', 'vue.config.ts']);
    if (config) push(config, 'vue-cli-config', 'config');
    push('src/main.js', 'vue-cli-default');
    push('src/main.ts', 'vue-cli-default');
  }

  if (buildTool === 'cra') {
    push('src/index.js', 'cra-default');
    push('src/index.tsx', 'cra-default');
  }

  if (buildTool === 'nuxt') {
    const config = await findFirst(root, ['nuxt.config.ts', 'nuxt.config.js']);
    if (config) push(config, 'nuxt-config', 'config');
    push('app.vue', 'nuxt-default');
    push('pages/index.vue', 'nuxt-default');
  }

  if (buildTool === 'next') {
    const config = await findFirst(root, ['next.config.js', 'next.config.mjs', 'next.config.ts']);
    if (config) push(config, 'next-config', 'config');
  }
}

function detectBuildTool(root, pkg, deps, configFiles) {
  const scripts = JSON.stringify(pkg.scripts ?? {});
  if (deps.next || configFiles.some((f) => f.startsWith('next.config'))) return 'next';
  if (deps.nuxt || configFiles.some((f) => f.startsWith('nuxt.config'))) return 'nuxt';
  if (deps.vite || configFiles.some((f) => f.startsWith('vite.config'))) return 'vite';
  if (deps['@vue/cli-service'] || configFiles.some((f) => f.startsWith('vue.config'))) return 'vue-cli';
  if (deps['react-scripts'] || /react-scripts/.test(scripts)) return 'cra';
  if (deps.webpack || configFiles.some((f) => f.startsWith('webpack'))) return 'webpack';
  if (pkg.bin || pkg.main || pkg.exports) return 'node-package';
  return 'unknown';
}

function detectFrameworkHint(deps, pkg, buildTool) {
  if (deps.next || buildTool === 'next') return 'next';
  if (deps.nuxt || buildTool === 'nuxt') return 'nuxt';
  if (deps.vue) {
    const version = String(deps.vue);
    if (version.startsWith('2') || version.startsWith('^2') || version.startsWith('~2')) return 'vue2';
    return 'vue3';
  }
  if (deps.react || deps['react-dom']) return 'react';
  if (pkg.bin || (!deps.react && !deps.vue && !deps.next)) return 'node';
  return 'generic';
}

async function listRootConfigFiles(root) {
  try {
    const entries = await readdir(root);
    return entries.filter((name) => /^(vite|webpack|vue|next|nuxt)\.config\./.test(name) || name.startsWith('webpack.'));
  } catch {
    return [];
  }
}

async function findFirst(root, names) {
  for (const name of names) {
    if (await pathExists(path.join(root, name))) return name;
  }
  return null;
}

function stripDot(value) {
  return String(value).replace(/^\.\//, '');
}

function normalizeRel(value) {
  return stripDot(value).split(path.sep).join('/');
}

async function pathExists(filePath) {
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

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
