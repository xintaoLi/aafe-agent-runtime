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

export const REPO_GITHUB_TOKEN_ENV = Object.freeze(['GITHUB_TOKEN', 'GH_TOKEN']);
export const REPO_GONGFENG_TOKEN_ENV = Object.freeze([
  'GIT_PRIVATE_TOKEN',
  'PRIVATE_TOKEN',
  'GITLAB_TOKEN',
  'WOA_GIT_TOKEN',
  'GIT_TOKEN'
]);

export function defaultRepoConfig() {
  return {
    githubAccessToken: null,
    gongfengAccessToken: null,
    reviewers: [],
    labels: []
  };
}

export function normalizeRepoStringList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,;]+/)
      : [];
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
  }
  return list;
}

/**
 * Root `.aafe.config.json` → `repo` (代码仓库配置).
 * Legacy `e2e.githubAccessToken` / `e2e.gongfengAccessToken` are still read.
 */
export function resolveRepoConfig(projectConfig = {}, overrides = {}) {
  const fromRepo = projectConfig.repo && typeof projectConfig.repo === 'object'
    ? projectConfig.repo
    : {};
  const fromE2e = projectConfig.e2e && typeof projectConfig.e2e === 'object'
    ? projectConfig.e2e
    : {};
  return {
    githubAccessToken: emptyToNull(
      overrides.githubAccessToken ?? fromRepo.githubAccessToken ?? fromE2e.githubAccessToken
    ),
    gongfengAccessToken: emptyToNull(
      overrides.gongfengAccessToken ?? fromRepo.gongfengAccessToken ?? fromE2e.gongfengAccessToken
    ),
    reviewers: normalizeRepoStringList(overrides.reviewers ?? fromRepo.reviewers),
    labels: normalizeRepoStringList(overrides.labels ?? fromRepo.labels)
  };
}

/** Reviewers / labels to attach when creating a GitHub PR or Gongfeng MR. */
export function resolveRepoPrMeta(projectConfig = {}, overrides = {}) {
  const repo = resolveRepoConfig(projectConfig, overrides);
  return {
    reviewers: repo.reviewers,
    labels: repo.labels
  };
}

export function buildGithubPrCreateArgs(meta = {}) {
  const reviewers = normalizeRepoStringList(meta.reviewers);
  const labels = normalizeRepoStringList(meta.labels);
  const args = [];
  if (reviewers.length) args.push('--reviewer', reviewers.join(','));
  if (labels.length) args.push('--label', labels.join(','));
  return args;
}

export function buildGithubPrEditArgs(meta = {}) {
  const args = [];
  for (const reviewer of normalizeRepoStringList(meta.reviewers)) {
    args.push('--add-reviewer', reviewer);
  }
  for (const label of normalizeRepoStringList(meta.labels)) {
    args.push('--add-label', label);
  }
  return args;
}

export function splitRepoReviewerRefs(reviewers = []) {
  const ids = [];
  const usernames = [];
  for (const item of normalizeRepoStringList(reviewers)) {
    if (/^\d+$/.test(item)) ids.push(item);
    else usernames.push(item);
  }
  return { ids, usernames };
}

/** Gongfeng MR create/update body: labels + reviewer ids / usernames to resolve. */
export function buildGongfengMrMeta(meta = {}) {
  const labels = normalizeRepoStringList(meta.labels);
  const { ids, usernames } = splitRepoReviewerRefs(meta.reviewers);
  return {
    labels: labels.length ? labels.join(',') : '',
    reviewerIds: ids,
    reviewerUsernames: usernames
  };
}

export function repoPrApplySkillSection(agentPrefix = '.ai-agent') {
  const prefix = String(agentPrefix ?? '.ai-agent').replace(/\/+$/, '') || '.ai-agent';
  return `创建 / 拉取 / PR / MR 前 Read \`${prefix}/skills/repo-submit.md\`。

已配置 \`repo.githubAccessToken\` 或 \`GITHUB_TOKEN\` → **必须用该 Token 调 GitHub API**（\`aafe repo pr\`），**不依赖项目内是否安装 \`gh\`**。未配置 Token 且本机有 \`gh\` 才允许 \`gh pr create\`。

先读 \`repo.reviewers\` / \`repo.labels\`（字符串数组，缺省 \`[]\`）。非空则创建或补写时必须带上；空数组省略。不要猜测人员或标签。

| 字段 | 用途 |
| --- | --- |
| \`repo.reviewers\` | PR/MR Reviewers（GitHub login / 工蜂 username 或数字 id） |
| \`repo.labels\` | PR/MR Labels |

**工蜂**（\`submit.cli=gtm\` 或远程 merge_requests）：\`gtm pr\` 之后用工蜂 API 写入 \`labels\` 与 \`reviewer_ids\`（username 先查用户 id）。鉴权用 \`repo.gongfengAccessToken\` / \`GIT_PRIVATE_TOKEN\`。`;
}

export function stripLegacyE2eRepoTokens(e2e) {
  if (!e2e || typeof e2e !== 'object') return e2e;
  const { githubAccessToken: _github, gongfengAccessToken: _gongfeng, ...rest } = e2e;
  return rest;
}

export function pickRepoTokenField(config, field) {
  if (!config || typeof config !== 'object') return null;
  if (config.repo && typeof config.repo === 'object' && config.repo[field] != null) {
    return config.repo[field];
  }
  if (config.e2e && typeof config.e2e === 'object' && config.e2e[field] != null) {
    return config.e2e[field];
  }
  return config[field] ?? null;
}

export function resolveRepoAccessToken(config, field, env = process.env) {
  return expandRepoSecretRef(pickRepoTokenField(config, field), env);
}

export function repoTokenConfigured(config, field) {
  return Boolean(String(pickRepoTokenField(config, field) ?? '').trim());
}

/**
 * Inject configured repo tokens into env for git / gh / gtm.
 * Existing shell values win so a one-shot export still overrides config.
 */
export function withRepoTokenEnv(projectConfig = {}, env = process.env) {
  const repo = resolveRepoConfig(projectConfig);
  const next = { ...env };
  const github = expandRepoSecretRef(repo.githubAccessToken, env);
  const gongfeng = expandRepoSecretRef(repo.gongfengAccessToken, env);
  if (github) {
    for (const key of REPO_GITHUB_TOKEN_ENV) {
      if (!String(next[key] ?? '').trim()) next[key] = github;
    }
  }
  if (gongfeng) {
    for (const key of REPO_GONGFENG_TOKEN_ENV) {
      if (!String(next[key] ?? '').trim()) next[key] = gongfeng;
    }
  }
  return next;
}

export function expandRepoSecretRef(value, env = process.env) {
  if (typeof value !== 'string') return null;
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => String(env[name] ?? ''));
  const trimmed = expanded.trim();
  return trimmed || null;
}

function emptyToNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
