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
import { resolveRepoAccessToken, withGithubGitAuthEnv } from '../../cli/repoConfig.js';

const CONFIG_FILE = '.aafe.config.json';

/**
 * `.aafe.config.json` often lives in an install subdirectory and is gitignored,
 * so a task worktree will not contain it. Prefer the original workspace cwd
 * (the WeCom / CLI checkout) over the leased worktree root.
 */
export function workspaceConfigDirs(task, lease = null) {
  const dirs = [];
  const seen = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  };
  add(task?.workspace?.cwd);
  add(lease?.cwd);
  add(task?.execution?.cwd);
  const repoRoot = lease?.repoRoot ?? task?.execution?.repoRoot;
  const install = task?.workspace?.cwd;
  const worktree = lease?.cwd ?? task?.execution?.cwd;
  if (repoRoot && install && worktree) {
    const rel = path.relative(path.resolve(repoRoot), path.resolve(install));
    if (rel && rel !== '.' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      add(path.join(worktree, rel));
    }
  }
  return dirs;
}

export async function readWorkspaceProjectConfig(task, lease = null, options = {}) {
  const readConfig = options.readConfig ?? defaultReadConfig;
  for (const dir of workspaceConfigDirs(task, lease)) {
    const config = await readConfig(dir);
    if (config && typeof config === 'object' && Object.keys(config).length) return config;
  }
  return {};
}

/**
 * Only the keys we actually filled from config, never a dump of process.env.
 *
 * Token source cascade (first configured token wins):
 * 1. `options.overrideConfig` — WeCom `wecom.local.json` → `repo` / env overlay
 * 2. `options.aafeRoot` / `options.aafeConfig` — the AAFE process `.aafe.config.json`
 * 3. the task workspace / project `.aafe.config.json`
 */
export async function resolveWorkspaceRepoEnv(task, lease = null, env = process.env, options = {}) {
  const auth = await resolveWorkspaceRepoAuth(task, lease, env, options);
  return auth.envVars;
}

export async function resolveWorkspaceRepoAuth(task, lease = null, env = process.env, options = {}) {
  const readConfig = options.readConfig ?? defaultReadConfig;
  const sources = [];
  if (options.overrideConfig) {
    sources.push({ source: 'wecom', config: options.overrideConfig });
  }
  if (options.aafeConfig) {
    sources.push({ source: 'aafe', config: options.aafeConfig });
  } else if (options.aafeRoot) {
    sources.push({ source: 'aafe', config: await readConfig(path.resolve(options.aafeRoot)) });
  }
  sources.push({
    source: 'workspace',
    config: await readWorkspaceProjectConfig(task, lease, { ...options, readConfig })
  });

  for (const item of sources) {
    if (!configHasRepoToken(item.config, env)) continue;
    return {
      source: item.source,
      envVars: diffEnv(env, withGithubGitAuthEnv(item.config, env))
    };
  }
  return { source: 'none', envVars: {} };
}

export function hasGithubAuthEnv(envVars) {
  return Boolean(String(envVars?.GITHUB_TOKEN ?? envVars?.GH_TOKEN ?? '').trim());
}

export function cloudSafeEnvVars(envVars = {}) {
  const out = {};
  for (const [key, value] of Object.entries(envVars ?? {})) {
    if (!key || key.startsWith('CURSOR_') || key.startsWith('GIT_CONFIG_')) continue;
    if (value == null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

export function buildRepoAuthPromptSection(envVars) {
  if (!hasGithubAuthEnv(envVars)) return [];
  return [
    '',
    'GitHub auth is already in this process environment (GITHUB_TOKEN / GH_TOKEN).',
    'Do not print the token, put it in a remote URL, or ask the user for another one.',
    'git fetch/pull/push to github.com already send http.extraheader from the environment.',
    'Create or update a GitHub PR with `aafe repo pr --title= --body= --base= --head=` (use node_modules/.bin/aafe if needed).'
  ];
}

async function defaultReadConfig(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, CONFIG_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function configHasRepoToken(config, env) {
  if (!config || typeof config !== 'object') return false;
  return Boolean(
    resolveRepoAccessToken(config, 'githubAccessToken', env)
    || resolveRepoAccessToken(config, 'gongfengAccessToken', env)
  );
}

function diffEnv(base, next) {
  const out = {};
  for (const [key, value] of Object.entries(next)) {
    if (base[key] === value) continue;
    if (value == null || value === '') continue;
    out[key] = value;
  }
  return out;
}
