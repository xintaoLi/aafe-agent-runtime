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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
import {
  buildGithubPrCreateArgs,
  expandRepoSecretRef,
  REPO_GITHUB_TOKEN_ENV,
  resolveRepoAccessToken,
  resolveRepoConfig,
  resolveRepoPrMeta
} from './repoConfig.js';

export function githubApiBase(host = 'github.com') {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

export function githubGitExtraHeader(token) {
  return `AUTHORIZATION: bearer ${token}`;
}

export function parseGitRemote(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const ssh = text.match(/^(?:ssh:\/\/)?git@([^:\/]+)[:\/](.+?)(?:\.git)?$/i);
  const https = text.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/i);
  const match = ssh || https;
  if (!match) return null;
  const host = match[1].toLowerCase();
  const projectPath = match[2].replace(/\/+$/, '');
  const parts = projectPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const isGithub = host === 'github.com' || host.endsWith('.github.com');
  return {
    host,
    owner: parts.slice(0, -1).join('/'),
    repo: parts.at(-1),
    projectPath,
    provider: isGithub ? 'github' : 'gongfeng'
  };
}

export function resolveGithubSubmitToken(projectConfig = {}, env = process.env) {
  for (const key of REPO_GITHUB_TOKEN_ENV) {
    const value = String(env[key] ?? '').trim();
    if (value) return { token: value, source: `env.${key}`, mode: 'token' };
  }
  const fromConfig = resolveRepoAccessToken(projectConfig, 'githubAccessToken', env);
  if (fromConfig) return { token: fromConfig, source: 'repo.githubAccessToken', mode: 'token' };
  const repo = resolveRepoConfig(projectConfig);
  const expanded = expandRepoSecretRef(repo.githubAccessToken, env);
  if (expanded) return { token: expanded, source: 'repo.githubAccessToken', mode: 'token' };
  return { token: null, source: 'none', mode: 'none' };
}

export function parseRepoPrArgs(argv = []) {
  const opts = {
    title: '',
    body: '',
    base: 'master',
    head: '',
    owner: '',
    repo: '',
    host: 'github.com',
    remote: '',
    dryRun: false
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--title=')) opts.title = arg.slice('--title='.length);
    else if (arg.startsWith('--body=')) opts.body = arg.slice('--body='.length);
    else if (arg.startsWith('--base=')) opts.base = arg.slice('--base='.length);
    else if (arg.startsWith('--head=')) opts.head = arg.slice('--head='.length);
    else if (arg.startsWith('--owner=')) opts.owner = arg.slice('--owner='.length);
    else if (arg.startsWith('--repo=')) opts.repo = arg.slice('--repo='.length);
    else if (arg.startsWith('--host=')) opts.host = arg.slice('--host='.length);
    else if (arg.startsWith('--remote=')) opts.remote = arg.slice('--remote='.length);
  }
  return opts;
}

export async function ensureGithubPullRequest({
  token,
  host = 'github.com',
  owner,
  repo,
  head,
  base = 'master',
  title,
  body = '',
  reviewers = [],
  labels = [],
  fetchImpl = fetch
} = {}) {
  if (!token) {
    throw Object.assign(new Error('未配置 GitHub Token：写入 repo.githubAccessToken 或环境变量 GITHUB_TOKEN，不要依赖 gh。'), { code: 'blocked' });
  }
  if (!owner || !repo || !head || !title) {
    throw Object.assign(new Error('创建 PR 需要 owner / repo / head / title。'), { code: 'blocked' });
  }

  const api = githubApiBase(host);
  const existing = await findOpenGithubPull({ api, token, owner, repo, head, base, fetchImpl });
  let pr = existing;
  let created = false;
  if (!pr) {
    const createdPr = await githubJson(`${api}/repos/${owner}/${repo}/pulls`, {
      token,
      method: 'POST',
      body: { title, head, base, body },
      fetchImpl
    });
    if (createdPr.status === 422 && /already exists/i.test(createdPr.message ?? '')) {
      pr = await findOpenGithubPull({ api, token, owner, repo, head, base, fetchImpl });
    } else if (!createdPr.ok) {
      throw Object.assign(new Error(`创建 GitHub PR 失败：${createdPr.message}`), { code: 'blocked', status: createdPr.status });
    } else {
      pr = createdPr.json;
      created = true;
    }
  }
  if (!pr?.number) {
    throw Object.assign(new Error('创建 GitHub PR 失败：未返回编号。'), { code: 'blocked' });
  }

  const warnings = [];
  if (reviewers.length) {
    const review = await githubJson(`${api}/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`, {
      token,
      method: 'POST',
      body: { reviewers },
      fetchImpl
    });
    if (!review.ok) warnings.push(`reviewers：${review.message}`);
  }
  if (labels.length) {
    const labelRes = await githubJson(`${api}/repos/${owner}/${repo}/issues/${pr.number}/labels`, {
      token,
      method: 'POST',
      body: { labels },
      fetchImpl
    });
    if (!labelRes.ok) warnings.push(`labels：${labelRes.message}`);
  }

  return {
    provider: 'github',
    number: pr.number,
    htmlUrl: String(pr.html_url ?? `https://${host}/${owner}/${repo}/pull/${pr.number}`),
    created,
    warnings
  };
}

export async function runRepoPrCommand(root, argv = [], {
  env = process.env,
  fetchImpl = fetch,
  readConfig = readProjectConfig,
  resolveRemote = defaultResolveRemote,
  resolveHead = defaultResolveHead
} = {}) {
  const opts = parseRepoPrArgs(argv);
  const projectConfig = await readConfig(root);
  const auth = resolveGithubSubmitToken(projectConfig, env);
  const remote = parseGitRemote(opts.remote) ?? await resolveRemote(root);
  const owner = opts.owner || remote?.owner;
  const repo = opts.repo || remote?.repo;
  const host = opts.host || remote?.host || 'github.com';
  const head = opts.head || await resolveHead(root);
  const meta = resolveRepoPrMeta(projectConfig);
  const fallbackContext = { opts: { ...opts, head }, meta, env };
  if (auth.mode !== 'token') {
    const warning = '未解析到 repo.githubAccessToken / GITHUB_TOKEN，降级使用 gh pr create。若 gh 未登录会失败。';
    if (opts.dryRun) {
      return {
        dryRun: true,
        mode: 'gh-fallback',
        warning,
        owner,
        repo,
        host,
        head,
        base: opts.base,
        title: opts.title,
        reviewers: meta.reviewers,
        labels: meta.labels
      };
    }
    return runGhPrCreateFallback(root, fallbackContext, warning);
  }
  const payload = {
    token: auth.token,
    host,
    owner,
    repo,
    head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
    reviewers: meta.reviewers,
    labels: meta.labels
  };
  if (opts.dryRun) {
    return {
      dryRun: true,
      source: auth.source,
      extraHeader: 'AUTHORIZATION: bearer $GITHUB_TOKEN',
      owner,
      repo,
      host,
      head,
      base: opts.base,
      title: opts.title,
      reviewers: meta.reviewers,
      labels: meta.labels
    };
  }
  try {
    return await ensureGithubPullRequest({ ...payload, fetchImpl });
  } catch (error) {
    if (opts.noGhFallback === true) throw error;
    const warning = `GitHub Token API 创建 PR 失败，降级使用 gh pr create。原因：${error?.message ?? error}`;
    return runGhPrCreateFallback(root, fallbackContext, warning);
  }
}

async function runGhPrCreateFallback(root, { opts, meta, env }, warning) {
  const args = ['pr', 'create'];
  if (opts.title) args.push('--title', opts.title);
  if (opts.body) args.push('--body', opts.body);
  if (opts.base) args.push('--base', opts.base);
  if (opts.head) args.push('--head', opts.head);
  args.push(...buildGithubPrCreateArgs(meta));
  try {
    const { stdout, stderr } = await execFileAsync('gh', args, { cwd: root, env });
    const output = `${stdout ?? ''}\n${stderr ?? ''}`;
    const url = output.match(/https:\/\/\S+\/pull\/\d+/)?.[0] ?? '';
    return {
      provider: 'github',
      mode: 'gh-fallback',
      warning,
      htmlUrl: url,
      output: output.trim()
    };
  } catch (error) {
    const message = String(error?.stderr || error?.stdout || error?.message || error);
    throw Object.assign(new Error(`${warning}\n降级 gh 失败：${message.trim()}`), {
      code: 'blocked',
      cause: error
    });
  }
}

async function findOpenGithubPull({ api, token, owner, repo, head, base, fetchImpl }) {
  const headRef = head.includes(':') ? head : `${owner}:${head}`;
  const query = new URLSearchParams({ state: 'open', head: headRef, base });
  const listed = await githubJson(`${api}/repos/${owner}/${repo}/pulls?${query}`, { token, fetchImpl });
  if (!listed.ok || !Array.isArray(listed.json)) return null;
  return listed.json[0] ?? null;
}

async function githubJson(url, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aafe-repo-submit',
    Authorization: `Bearer ${token}`
  };
  if (body != null) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const message = String(json?.message ?? `HTTP ${response.status}`);
  return { ok: response.ok, status: response.status, json, message };
}

async function defaultResolveRemote(root) {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: root });
    return parseGitRemote(stdout);
  } catch {
    return null;
  }
}

async function defaultResolveHead(root) {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: root });
    return String(stdout ?? '').trim();
  } catch {
    return '';
  }
}

async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}
