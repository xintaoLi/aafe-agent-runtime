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

import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { discoverProjectEntries } from '../entryDiscover.js';
import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue']);
const CONFIG_NAMES = /^(package\.json|tsconfig.*\.json|jsconfig\.json|vite\.config\.|webpack\.|vue\.config\.|next\.config\.|nuxt\.config\.|babel\.config\.|eslint\.|prettier\.)/;
const TEST_RE = /(\/__tests__\/|\.test\.|\.spec\.|\/tests?\/)/i;

export class RepositoryAnalyzer {
  id = 'repository';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    const root = context.config.root;
    const exclude = new Set(context.config.exclude ?? []);
    const files = [];
    const configs = [];
    const diagnostics = [];

    const fileBudget = { remaining: context.config.maxFiles ?? 6000 };
    await walk(root, root, exclude, fileBudget, async (rel, abs, st) => {
      const ext = path.extname(rel).toLowerCase();
      const base = path.basename(rel);
      const language = detectLanguage(ext);
      const kind = detectKind(rel, base, ext);
      const content = kind === 'source' || kind === 'config' || kind === 'test'
        ? await safeRead(abs)
        : '';
      const hash = content
        ? createHash('sha1').update(content).digest('hex').slice(0, 16)
        : `size:${st.size}`;
      const file = {
        id: `file:${rel}`,
        path: rel,
        language,
        size: st.size,
        hash,
        kind
      };
      files.push(file);
      context.cache.fileHashes.set(rel, hash);
      if (kind === 'config') {
        configs.push({
          id: `config:${rel}`,
          path: rel,
          name: base
        });
      }
    });

    const entriesDiscovery = await discoverProjectEntries(root, { maxEntries: 40 });
    const packages = await collectPackages(root);
    const data = {
      root,
      files,
      packages,
      configs,
      entrypoints: (entriesDiscovery.entries ?? []).map((entry) => ({
        id: `entry:${entry.file}`,
        path: entry.file,
        source: entry.source,
        kind: entry.kind,
        exists: entry.exists
      })),
      buildTool: entriesDiscovery.buildTool,
      frameworkHint: entriesDiscovery.frameworkHint,
      entryDiscovery: entriesDiscovery
    };

    return createAnalysisResult(this.id, this.version, data, {
      evidence: data.entrypoints.slice(0, 20).map((entry) => createEvidence({
        type: 'config',
        file: entry.path,
        reason: `entrypoint via ${entry.source}`
      })),
      diagnostics,
      stats: {
        scannedFiles: files.length,
        durationMs: Date.now() - started
      }
    });
  }
}

async function walk(root, dir, exclude, budget, onFile) {
  if (budget.remaining <= 0) return;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.remaining <= 0) return;
    if (exclude.has(entry.name)) continue;
    if (entry.name.startsWith('.') && !['.docs'].includes(entry.name)) {
      if (['.git', '.ai-agent', '.aafe', '.cursor', '.next', '.nuxt'].includes(entry.name)) continue;
    }
    const abs = path.join(dir, entry.name);
    const rel = normalize(path.relative(root, abs));
    if (entry.isDirectory()) {
      await walk(root, abs, exclude, budget, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    const st = await stat(abs);
    await onFile(rel, abs, st);
    budget.remaining -= 1;
  }
}

function detectLanguage(ext) {
  if (ext === '.vue') return 'vue';
  if (ext === '.ts' || ext === '.tsx') return 'ts';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.mdx') return 'markdown';
  return 'unknown';
}

function detectKind(rel, base, ext) {
  if (CONFIG_NAMES.test(base) || CONFIG_NAMES.test(rel)) return 'config';
  if (TEST_RE.test(rel)) return 'test';
  if (SOURCE_EXTS.has(ext)) return 'source';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2'].includes(ext)) return 'asset';
  return 'unknown';
}

async function collectPackages(root) {
  const packages = [];
  const pkgPath = path.join(root, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      packages.push({
        id: 'package:root',
        name: pkg.name ?? path.basename(root),
        version: pkg.version ?? null,
        path: 'package.json',
        private: Boolean(pkg.private)
      });
    } catch {
      // ignore
    }
  }
  return packages;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
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

function normalize(value) {
  return value.split(path.sep).join('/');
}
