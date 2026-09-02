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

import { expandSecretRef, readPrAccessTokenConfig } from './config.js';
import { pickRepoTokenField } from '../../cli/repoConfig.js';

export const INLINE_TOKEN_REJECTION = [
  '拒绝从命令行读取令牌：--token <值> 会被 ps、shell 历史、CI 日志和 Agent 对话记录留存。',
  '改为写入环境变量或 `.aafe.config.json` → repo（代码仓库配置）：',
  '  repo.githubAccessToken     # GitHub 提交/拉取/PR；也可用环境变量 GITHUB_TOKEN / ${GITHUB_TOKEN}',
  '  repo.gongfengAccessToken   # 工蜂 提交/拉取/MR；也可用环境变量 GIT_PRIVATE_TOKEN / ${GIT_PRIVATE_TOKEN}'
].join('\n');

const TOKEN_KEYS = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
  gongfeng: ['GIT_PRIVATE_TOKEN', 'PRIVATE_TOKEN', 'GITLAB_TOKEN', 'WOA_GIT_TOKEN', 'GIT_TOKEN']
};

export function parsePrUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('缺少 PR 链接。请提供 GitHub pull 或工蜂 merge_requests 完整 URL。'), { code: 'blocked' });
  }

  let url;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw Object.assign(new Error(`无效的 PR 链接：${trimmed}`), { code: 'blocked' });
  }

  const host = url.hostname.toLowerCase();
  const urlPath = url.pathname.replace(/\/+$/, '');

  const github = urlPath.match(/^\/([^/]+)\/([^/]+)\/pulls?\/(\d+)$/);
  if (github && isGitHubHost(host)) {
    const owner = github[1];
    const repo = github[2];
    const number = Number.parseInt(github[3], 10);
    return {
      provider: 'github',
      host,
      owner,
      repo,
      number,
      projectPath: `${owner}/${repo}`,
      htmlUrl: `https://${host}/${owner}/${repo}/pull/${number}`
    };
  }

  const mergeRequest = urlPath.match(/^\/(.+?)\/(?:-\/)?merge_requests?\/(\d+)$/);
  if (mergeRequest && !isGitHubHost(host)) {
    const projectPath = mergeRequest[1];
    const number = Number.parseInt(mergeRequest[2], 10);
    const parts = projectPath.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw Object.assign(new Error(`工蜂项目路径不完整：${projectPath}`), { code: 'blocked' });
    }
    return {
      provider: 'gongfeng',
      host,
      owner: parts.slice(0, -1).join('/'),
      repo: parts.at(-1),
      number,
      projectPath,
      htmlUrl: `https://${host}/${projectPath}/merge_requests/${number}`
    };
  }

  throw Object.assign(new Error(
    '无法识别 PR 链接。GitHub 使用 https://github.com/<owner>/<repo>/pull/<n> ；'
    + '工蜂使用 https://<host>/<group>/<repo>/merge_requests/<n>。'
  ), { code: 'blocked' });
}

export function isGitHubHost(host) {
  return host === 'github.com' || String(host).endsWith('.github.com');
}

export function resolvePrToken({ provider, inlineToken, env = process.env, config = null } = {}) {
  if (inlineToken !== undefined && inlineToken !== '') {
    throw Object.assign(new Error(INLINE_TOKEN_REJECTION), { code: 'blocked' });
  }
  const keys = TOKEN_KEYS[provider] ?? TOKEN_KEYS.github;
  for (const key of keys) {
    const value = String(env[key] ?? '').trim();
    if (value) return { key, token: value, source: 'shell' };
  }
  const field = provider === 'gongfeng' ? 'gongfengAccessToken' : 'githubAccessToken';
  const fromConfig = expandSecretRef(pickRepoTokenField(config, field), env);
  if (fromConfig) {
    const sourceKey = config?.repo?.[field] != null ? `repo.${field}` : (config?.e2e?.[field] != null ? `e2e.${field}` : field);
    return { key: sourceKey, token: fromConfig, source: 'config' };
  }
  return { source: 'none', token: null };
}

export async function fetchPullRequest(prUrl, { token, fetchImpl = fetch, root, config } = {}) {
  const parsed = parsePrUrl(prUrl);
  let resolved = token;
  if (!resolved) {
    const tokenConfig = config ?? (root ? await readPrAccessTokenConfig(root) : null);
    resolved = resolvePrToken({ provider: parsed.provider, config: tokenConfig }).token ?? undefined;
  }
  if (parsed.provider === 'github') return fetchGitHub(parsed, resolved, fetchImpl);
  return fetchGongfeng(parsed, resolved, fetchImpl);
}

async function fetchGitHub(parsed, token, fetchImpl) {
  const apiBase = parsed.host === 'github.com' ? 'https://api.github.com' : `https://${parsed.host}/api/v3`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aafe-from-pr'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const prJson = await getJson(fetchImpl, `${apiBase}/repos/${parsed.projectPath}/pulls/${parsed.number}`, headers);
  const filesJson = await getJson(fetchImpl, `${apiBase}/repos/${parsed.projectPath}/pulls/${parsed.number}/files?per_page=100`, headers);
  const files = (Array.isArray(filesJson) ? filesJson : []).slice(0, 80).map((item) => ({
    path: String(item.filename ?? ''),
    status: String(item.status ?? 'modified'),
    patch: String(item.patch ?? '').slice(0, 12000)
  }));

  return {
    provider: 'github',
    number: parsed.number,
    htmlUrl: String(prJson.html_url ?? parsed.htmlUrl),
    title: String(prJson.title ?? ''),
    sourceBranch: String(prJson.head?.ref ?? ''),
    targetBranch: String(prJson.base?.ref ?? ''),
    files
  };
}

async function fetchGongfeng(parsed, token, fetchImpl) {
  const apiBase = `https://${parsed.host}/api/v4`;
  const headers = { 'User-Agent': 'aafe-from-pr' };
  if (token) headers['PRIVATE-TOKEN'] = token;
  const encoded = encodeURIComponent(parsed.projectPath);
  const prJson = await getJson(fetchImpl, `${apiBase}/projects/${encoded}/merge_requests/${parsed.number}`, headers);
  const filesJson = await getJson(fetchImpl, `${apiBase}/projects/${encoded}/merge_requests/${parsed.number}/changes`, headers);
  const changes = Array.isArray(filesJson?.changes) ? filesJson.changes : [];
  const files = changes.slice(0, 80).map((item) => ({
    path: String(item.new_path ?? item.old_path ?? ''),
    status: item.deleted_file ? 'deleted' : item.new_file ? 'added' : 'modified',
    patch: String(item.diff ?? '').slice(0, 12000)
  }));
  return {
    provider: 'gongfeng',
    number: parsed.number,
    htmlUrl: parsed.htmlUrl,
    title: String(prJson.title ?? ''),
    sourceBranch: String(prJson.source_branch ?? ''),
    targetBranch: String(prJson.target_branch ?? ''),
    files
  };
}

async function getJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? '鉴权失败：在 `.aafe.config.json` 的 repo.githubAccessToken / repo.gongfengAccessToken 或环境变量 GITHUB_TOKEN / GIT_PRIVATE_TOKEN 写入令牌后重试，不要把令牌拼进命令。'
      : `HTTP ${response.status}`;
    throw Object.assign(new Error(`拉取 PR 失败：${hint}`), { code: 'blocked', status: response.status });
  }
  return response.json();
}

export function redactSecrets(text, secrets = []) {
  let next = String(text ?? '');
  for (const secret of secrets.filter(Boolean)) {
    if (!secret) continue;
    next = next.split(secret).join('***');
  }
  return next.replace(/\b(ghp_|github_pat_|glpat-)[A-Za-z0-9_]+/g, '***');
}
