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
import { DEFAULT_E2E_AUTH, normalizeAuthMode, resolveAuthStatePath } from './auth.js';
import { resolveRepoConfig, repoTokenConfigured } from '../../cli/repoConfig.js';

export const PLACEHOLDER_BASE_URLS = new Set([
  '',
  'http://localhost:8080',
  'https://localhost:8080',
  'http://127.0.0.1:8080'
]);

export const NEED_BASE_URL_CODE = 'need-base-url';
export const NEED_BASE_URL_PROMPT = '请提供本次被测页面的完整 URL（含协议与环境）。测试地址每次可能不同，不要写入固定 e2e.baseUrl，不要猜，不要用 http://localhost:8080。含 # 的地址必须用引号包住，避免 shell 把 hash 当注释丢掉。提供后加上 --base-url=<url> 再 --run。';

export const NEED_URL_ROLE_CODE = 'need-url-role';
export const NEED_URL_ROLE_PROMPT = [
  '你提供的地址包含页面路径或查询参数。请确认它是不是本次目标页：',
  'A. 是目标页面。与该路径匹配的用例打开这个完整地址；其它用例复用同一主机、hash/history 模式和查询参数。',
  'B. 不是，只是环境根地址。丢弃 # 后的路径和业务参数（若地址里有 #/ 则仍按 hash 路由拼接各用例 path）。',
  'C. 需要根据此地址分析变更（推荐）。提取协议/主机、是否 hash 路由、以及 bizId 等查询参数，拼到本次变更的各条路由上。',
  '请回复 A / B / C，或加 --url-role=target|origin|template 后重跑。',
  '完整地址请用引号包住，避免 shell 把 # 当成注释丢掉。'
].join('\n');

export const DEFAULT_E2E_CONFIG = Object.freeze({
  casesDir: 'tests/ui-ai/cases',
  reportDir: '.aafe/e2e/reports',
  specsDir: '.aafe/e2e/specs',
  impactDir: '.aafe/e2e/impact',
  baseUrlEnv: 'AAFE_E2E_BASE_URL',
  baseUrl: null,
  enabled: true,
  auth: DEFAULT_E2E_AUTH
});

/**
 * @param {string} root
 * @param {object} [projectConfig]
 * @param {{ baseUrl?: string|null, urlRole?: string|null, authMode?: string|null, authEnv?: string|null, storageState?: string|null }} [runtime] one-shot override; not persisted
 */
export async function loadE2eConfig(root, projectConfig = null, runtime = {}) {
  const config = projectConfig ?? (await readProjectConfig(root));
  const e2e = { ...DEFAULT_E2E_CONFIG, ...(config.e2e ?? {}) };
  const auth = { ...DEFAULT_E2E_AUTH, ...(e2e.auth ?? {}) };
  const envName = e2e.baseUrlEnv || DEFAULT_E2E_CONFIG.baseUrlEnv;
  const fromCli = sanitizeBaseUrl(runtime.baseUrl);
  const fromEnv = String(process.env[envName] ?? '').trim();
  const fromConfig = String(e2e.baseUrl ?? '').trim();
  const baseUrl = fromCli || sanitizeBaseUrl(fromEnv || fromConfig);
  const urlRole = normalizeUrlRole(runtime.urlRole);
  const authMode = normalizeAuthMode(runtime.authMode ?? process.env.AAFE_E2E_AUTH_MODE ?? auth.mode) ?? 'reuse-or-headed';
  const { githubAccessToken: _github, gongfengAccessToken: _gongfeng, ...publicE2e } = e2e;
  const repo = resolveRepoConfig(config);
  return {
    ...publicE2e,
    auth,
    root,
    casesDirAbs: path.join(root, e2e.casesDir),
    reportDirAbs: path.join(root, e2e.reportDir),
    specsDirAbs: path.join(root, e2e.specsDir),
    impactDirAbs: path.join(root, e2e.impactDir),
    baseUrl,
    baseUrlConfigured: Boolean(baseUrl),
    urlRole,
    parsedPageUrl: parseTestPageUrl(baseUrl),
    authMode,
    authEnv: runtime.authEnv ?? process.env.AAFE_E2E_ENV ?? auth.env,
    authStatePath: resolveAuthStatePath(root, auth, runtime),
    enabled: isE2eEnabled(e2e),
    githubAccessTokenConfigured: repoTokenConfigured({ repo, e2e }, 'githubAccessToken'),
    gongfengAccessTokenConfigured: repoTokenConfigured({ repo, e2e }, 'gongfengAccessToken')
  };
}

export function isE2eEnabled(e2e = {}) {
  return e2e?.enabled !== false;
}

export function sanitizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const parsed = parseTestPageUrl(trimmed);
  const comparable = parsed ? parsed.appBase : trimmed.replace(/\/+$/, '');
  if (PLACEHOLDER_BASE_URLS.has(comparable)) return null;
  return trimmed.replace(/\/+$/, '') === comparable && !parsed?.hashMode && !parsed?.query
    ? comparable
    : trimmed;
}

export function normalizeUrlRole(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['a', 'target', 'page', 'yes', '是'].includes(raw)) return 'target';
  if (['b', 'origin', 'root', 'no', '否'].includes(raw)) return 'origin';
  if (['c', 'template', 'analyze', 'params'].includes(raw)) return 'template';
  return null;
}

/**
 * Split a user-supplied page URL into origin/app base, hash-router path, and query.
 * Vue hash URLs keep biz params inside the fragment: `#/path?bizId=1`.
 */
export function parseTestPageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hashBody = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashMode = url.hash === '#' || hashBody.startsWith('/');
  let hashPath = '';
  let hashQuery = '';
  if (hashBody) {
    const q = hashBody.indexOf('?');
    hashPath = q >= 0 ? hashBody.slice(0, q) : hashBody;
    hashQuery = q >= 0 ? hashBody.slice(q + 1) : '';
    if (hashPath && !hashPath.startsWith('/')) hashPath = `/${hashPath}`;
  }
  const search = url.search.replace(/^\?/, '');
  const query = hashQuery || search;
  const appBase = `${url.origin}${url.pathname}`.replace(/\/+$/, '') || url.origin;
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const looksLikeTarget = (Boolean(hashPath) && hashPath !== '/') || Boolean(query) || pathSegments.length >= 2;
  return {
    raw,
    origin: url.origin,
    appBase,
    pathname: url.pathname,
    hashMode,
    hashPath,
    query,
    looksLikeTarget
  };
}

export function pathKey(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '/') return '/';
  return text.replace(/\/+$/, '') || '/';
}

export function pathsMatch(left, right) {
  return pathKey(left) === pathKey(right);
}

export function combineEntryUrl(baseUrl, entryPath, options = {}) {
  if (!entryPath) {
    const parsedOnly = parseTestPageUrl(baseUrl);
    return parsedOnly?.raw ?? String(baseUrl ?? '');
  }
  if (/^https?:\/\//i.test(entryPath)) return entryPath;
  const suffix = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
  const parsed = parseTestPageUrl(baseUrl);
  if (!parsed) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    return `${base}${suffix}`;
  }
  const role = normalizeUrlRole(options.urlRole) ?? 'template';
  const pagePath = parsed.hashMode ? parsed.hashPath : parsed.pathname;
  if (role === 'target' && pagePath && pathsMatch(pagePath, suffix)) {
    return parsed.raw;
  }
  const query = role === 'origin' ? '' : parsed.query;
  const qs = query ? `?${query}` : '';
  if (parsed.hashMode) return `${parsed.appBase}/#${suffix}${qs}`;
  return `${parsed.appBase}${suffix}${qs}`;
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
  return resolveRepoConfig(config);
}

export async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}
