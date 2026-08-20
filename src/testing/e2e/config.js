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

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PLACEHOLDER_BASE_URLS = new Set([
  '',
  'http://localhost:8080',
  'https://localhost:8080',
  'http://127.0.0.1:8080'
]);

export const DEFAULT_E2E_CONFIG = Object.freeze({
  casesDir: 'tests/ui-ai/cases',
  reportDir: '.aafe/e2e/reports',
  specsDir: '.aafe/e2e/specs',
  impactDir: '.aafe/e2e/impact',
  baseUrlEnv: 'AAFE_E2E_BASE_URL',
  baseUrl: null,
  enabled: false,
  githubAccessToken: null,
  gongfengAccessToken: null
});

/**
 * @param {string} root
 * @param {object} [projectConfig]
 */
export async function loadE2eConfig(root, projectConfig = null) {
  const config = projectConfig ?? (await readProjectConfig(root));
  const e2e = { ...DEFAULT_E2E_CONFIG, ...(config.e2e ?? {}) };
  const envName = e2e.baseUrlEnv || DEFAULT_E2E_CONFIG.baseUrlEnv;
  const fromEnv = String(process.env[envName] ?? '').trim();
  const fromConfig = String(e2e.baseUrl ?? '').trim();
  const baseUrl = sanitizeBaseUrl(fromEnv || fromConfig);
  const { githubAccessToken, gongfengAccessToken, ...publicE2e } = e2e;
  return {
    ...publicE2e,
    root,
    casesDirAbs: path.join(root, e2e.casesDir),
    reportDirAbs: path.join(root, e2e.reportDir),
    specsDirAbs: path.join(root, e2e.specsDir),
    impactDirAbs: path.join(root, e2e.impactDir),
    baseUrl,
    baseUrlConfigured: Boolean(baseUrl),
    enabled: isE2eEnabled(e2e),
    githubAccessTokenConfigured: Boolean(String(githubAccessToken ?? '').trim()),
    gongfengAccessTokenConfigured: Boolean(String(gongfengAccessToken ?? '').trim())
  };
}

export function isE2eEnabled(e2e = {}) {
  return e2e?.enabled === true;
}

export function sanitizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || PLACEHOLDER_BASE_URLS.has(trimmed)) return null;
  return trimmed;
}

export function combineEntryUrl(baseUrl, entryPath) {
  if (!entryPath) return baseUrl ?? '';
  if (/^https?:\/\//i.test(entryPath)) return entryPath;
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const suffix = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
  return `${base}${suffix}`;
}

/**
 * Expand `${ENV_NAME}` in a secret field. Unresolved refs become empty so a
 * committed `"${GITHUB_TOKEN}"` placeholder is never treated as a real token.
 */
export function expandSecretRef(value, env = process.env) {
  if (typeof value !== 'string') return null;
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => String(env[name] ?? ''));
  const trimmed = expanded.trim();
  return trimmed || null;
}

export async function readPrAccessTokenConfig(root) {
  const config = await readProjectConfig(root);
  return {
    githubAccessToken: config.e2e?.githubAccessToken ?? null,
    gongfengAccessToken: config.e2e?.gongfengAccessToken ?? null
  };
}

export async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}
