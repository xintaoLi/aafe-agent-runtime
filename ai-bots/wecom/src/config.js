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

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAgentModeConfig } from '../../../src/cli/agentMode.js';
import { resolveWeComLogConfig, normalizeLogValue } from './logger.js';
import { DEFAULT_TASK_MODEL, mergeModelRules, validateModelRules } from './models.js';
import { parseWorkspaces } from './workspace.js';

const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com';

export const WECOM_LOCAL_CONFIG_NAMES = Object.freeze([
  'ai-bots/wecom/wecom.local.json',
  'ai-bots/wecom/.env',
  'wecom.local.json',
  '.aafe/wecom.local.json'
]);

export async function loadWeComBotConfig({
  root = process.cwd(),
  env = process.env,
  readConfig = readProjectConfig,
  localConfigPath = null,
  readLocalConfig = readLocalWeComConfig
} = {}) {
  const projectRoot = path.resolve(root);
  const projectConfig = await readConfig(projectRoot);
  const agent = resolveAgentModeConfig(projectConfig);
  const explicitPath = localConfigPath ?? env.AAFE_WECOM_CONFIG ?? null;
  const local = await readLocalConfig(projectRoot, { extraPath: explicitPath });
  const apiKeyEnv = agent.apiKeyEnv ?? 'CURSOR_API_KEY';

  const botId = firstNonEmpty(env.WECOM_BOT_ID, local.botId);
  const secret = firstNonEmpty(env.WECOM_BOT_SECRET, local.secret);
  if (!botId || !secret) {
    throw new Error(
      'wecom-bot-credentials-missing: set WECOM_BOT_ID/WECOM_BOT_SECRET or ai-bots/wecom/wecom.local.json'
    );
  }

  const apiKey = firstNonEmpty(env[apiKeyEnv], env.CURSOR_API_KEY, agent.apiKey, local.apiKey);
  const model = firstNonEmpty(env.AAFE_WECOM_MODEL, env.WECOM_MODEL, local.model) ?? agent.model ?? null;
  const repository = firstNonEmpty(env.AAFE_WECOM_REPOSITORY, local.repository) ?? agent.repository ?? null;
  const baseBranch = firstNonEmpty(env.AAFE_WECOM_BASE_BRANCH, local.baseBranch) ?? 'main';
  const workspaces = parseWorkspaces(local.workspaces ?? agent.workspaces, {
    root: projectRoot,
    repository,
    baseBranch
  });
  return {
    root: projectRoot,
    botId,
    secret,
    apiKey,
    wsUrl: firstNonEmpty(env.WECOM_WS_URL, local.wsUrl) ?? DEFAULT_WS_URL,
    repository,
    baseBranch,
    workspaces,
    currentWorkspace: firstNonEmpty(local.currentWorkspace, env.AAFE_WECOM_WORKSPACE) ?? workspaces[0]?.id ?? null,
    // WeCom already only pushes group messages that mention the bot, so the
    // in-process check is off by default: enable it when a group must never act
    // on anything but an explicit @.
    requireGroupMention: parseBoolean(
      env.AAFE_WECOM_REQUIRE_GROUP_MENTION ?? local.requireGroupMention,
      false
    ),
    localConfigPath: local.path ?? null,
    log: resolveWeComLogConfig({ env, local, root: projectRoot }),
    intent: resolveWeComIntentConfig({ env, local, apiKey }),
    models: resolveWeComModelConfig({ env, local, model }),
    tapd: resolveWeComTapdConfig({ env, local, project: projectConfig }),
    repo: resolveWeComRepoConfig({ env, local }),
    agent: {
      ...agent,
      apiKey: apiKey ?? agent.apiKey ?? null,
      model: model ?? agent.model ?? null
    }
  };
}

/**
 * WeCom TAPD is on by default and overrides the target project's tapd.enabled.
 * Other project tapd fields (pr_field, status maps) still inherit unless WeCom
 * sets the same key.
 */
export function resolveWeComTapdConfig({ env = {}, local = {}, project = {} } = {}) {
  const projectTapd = isPlainObject(project.tapd) ? { ...project.tapd } : {};
  const localTapd = isPlainObject(local.tapd) ? { ...local.tapd } : {};
  const enabled = parseBoolean(
    env.AAFE_WECOM_TAPD_ENABLED ?? localTapd.enabled,
    true
  );
  return {
    ...projectTapd,
    ...localTapd,
    enabled,
    projectEnabled: projectTapd.enabled === true
  };
}

/**
 * Intent classification runs before any task exists, so it needs its own
 * endpoint. Without one it falls back to the Cursor key the bot already holds.
 * `cursorModel` stays null unless set on purpose, so the `intent` stage rule in
 * `models.rules` is what normally picks the classifier model.
 */
export function resolveWeComIntentConfig({ env = {}, local = {}, apiKey = null } = {}) {
  const raw = local.intent ?? {};
  const enabled = parseBoolean(env.AAFE_WECOM_INTENT_ENABLED ?? raw.enabled, true);
  const timeout = Number(env.AAFE_WECOM_INTENT_TIMEOUT_MS ?? raw.timeoutMs);
  const endpoint = firstNonEmpty(env.AAFE_WECOM_INTENT_ENDPOINT, raw.endpoint);
  return {
    enabled,
    endpoint,
    model: firstNonEmpty(env.AAFE_WECOM_INTENT_MODEL, raw.model),
    apiKey: firstNonEmpty(env.AAFE_WECOM_INTENT_API_KEY, raw.apiKey),
    apiKeyEnv: firstNonEmpty(raw.apiKeyEnv) ?? 'AAFE_LLM_API_KEY',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : null,
    cursorApiKey: apiKey,
    cursorModel: firstNonEmpty(env.AAFE_WECOM_INTENT_CURSOR_MODEL, raw.cursorModel)
  };
}

/**
 * Model routing is a rule table, not a switch in code: the shipped defaults and
 * a project's own rules are the same shape and go through one matcher. Project
 * rules are evaluated first and may replace a built-in by reusing its id.
 */
export function resolveWeComModelConfig({ env = {}, local = {}, model = null } = {}) {
  const raw = local.models ?? {};
  const fallback = firstNonEmpty(env.AAFE_WECOM_MODEL_DEFAULT, raw.default, model) ?? DEFAULT_TASK_MODEL;
  const { rules, errors } = validateModelRules(raw.rules ?? []);
  return { default: fallback, rules: mergeModelRules(rules), configErrors: errors };
}

/**
 * WeCom `repo` overlay only. Missing tokens fall through at task start:
 * WeCom → current AAFE `.aafe.config.json` → workspace project config.
 */
export function resolveWeComRepoConfig({ env = {}, local = {} } = {}) {
  const localRepo = isPlainObject(local.repo) ? local.repo : {};
  return {
    githubAccessToken: firstNonEmpty(
      env.AAFE_WECOM_GITHUB_TOKEN,
      env.WECOM_GITHUB_TOKEN,
      localRepo.githubAccessToken
    ),
    gongfengAccessToken: firstNonEmpty(
      env.AAFE_WECOM_GONGFENG_TOKEN,
      env.WECOM_GONGFENG_TOKEN,
      localRepo.gongfengAccessToken
    ),
    reviewers: Array.isArray(localRepo.reviewers) ? localRepo.reviewers : undefined,
    labels: Array.isArray(localRepo.labels) ? localRepo.labels : undefined
  };
}

export function wecomRepoOverrideConfig(repo) {
  if (!isPlainObject(repo)) return null;
  const github = String(repo.githubAccessToken ?? '').trim();
  const gongfeng = String(repo.gongfengAccessToken ?? '').trim();
  if (!github && !gongfeng) return null;
  return {
    repo: {
      githubAccessToken: github || null,
      gongfengAccessToken: gongfeng || null,
      ...(Array.isArray(repo.reviewers) ? { reviewers: repo.reviewers } : {}),
      ...(Array.isArray(repo.labels) ? { labels: repo.labels } : {})
    }
  };
}

export function createTaskManagerOptions(config, extra = {}) {
  const agent = config.agent ?? {};
  const manager = agent.manager ?? {};
  const active = extra.workspace
    ?? config.workspaces?.find((item) => item.id === config.currentWorkspace)
    ?? config.workspaces?.[0]
    ?? null;
  const repository = extra.repository
    ?? active?.repository
    ?? config.repository
    ?? agent.repository
    ?? null;
  const useCloud = Boolean(repository);
  return {
    root: config.root,
    output: manager.output ?? '.aafe',
    maxConcurrentTasks: manager.maxConcurrentTasks ?? 4,
    validateProjectRuntime: extra.validateProjectRuntime
      ?? (useCloud ? manager.validateProjectRuntime ?? true : false),
    recoverOnStart: extra.recoverOnStart ?? manager.recoverOnStart ?? true,
    // One git worktree per task, so several people's tasks can run against one
    // local repository at once. `worktrees: false` falls back to a lock on the
    // shared checkout, which serialises them instead.
    workspaceOptions: {
      ...(manager.worktrees === undefined ? {} : { worktrees: manager.worktrees }),
      ...(manager.portRange ? { portRange: manager.portRange } : {}),
      ...(manager.shareIntoWorktree ? { share: manager.shareIntoWorktree } : {})
    },
    repoAuth: {
      overrideConfig: wecomRepoOverrideConfig(config.repo),
      aafeRoot: extra.aafeRoot ?? config.root
    },
    runtimeOptions: {
      apiKey: extra.apiKey ?? config.apiKey ?? agent.apiKey,
      apiKeyEnv: agent.apiKeyEnv,
      model: extra.model ?? agent.model,
      repository,
      cwd: extra.cwd ?? active?.cwd ?? config.root,
      mode: useCloud ? 'cloud' : 'local',
      autoCreatePR: agent.autoCreatePR,
      skipReviewerRequest: agent.skipReviewerRequest,
      ...(extra.mcpServers ? { mcpServers: extra.mcpServers } : {})
    }
  };
}

export async function readLocalWeComConfig(root, { extraPath = null } = {}) {
  const files = [];
  if (extraPath) files.push(path.isAbsolute(extraPath) ? extraPath : path.join(root, extraPath));
  for (const relative of WECOM_LOCAL_CONFIG_NAMES) {
    files.push(path.join(root, relative));
  }

  let merged = { path: null };
  for (const file of files.reverse()) {
    const parsed = await parseLocalWeComFile(file);
    if (!parsed) continue;
    merged = { ...merged, ...omitEmpty(parsed), path: file };
  }
  return merged;
}

async function parseLocalWeComFile(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (path.basename(file) === '.env' || file.endsWith('.env')) {
    return normalizeLocalWeComValues(parseDotEnv(trimmed));
  }
  try {
    return normalizeLocalWeComValues(JSON.parse(trimmed));
  } catch {
    return normalizeLocalWeComValues(parseDotEnv(trimmed));
  }
}

export function parseDotEnv(text) {
  const values = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

export function normalizeLocalWeComValues(raw = {}) {
  return omitEmpty({
    botId: raw.botId ?? raw.WECOM_BOT_ID ?? raw.bot_id,
    secret: raw.secret ?? raw.WECOM_BOT_SECRET,
    apiKey: raw.apiKey ?? raw.CURSOR_API_KEY ?? raw.cursorApiKey,
    wsUrl: raw.wsUrl ?? raw.WECOM_WS_URL,
    repository: raw.repository ?? raw.AAFE_WECOM_REPOSITORY,
    baseBranch: raw.baseBranch ?? raw.AAFE_WECOM_BASE_BRANCH,
    currentWorkspace: raw.currentWorkspace ?? raw.AAFE_WECOM_WORKSPACE,
    requireGroupMention: raw.requireGroupMention ?? raw.AAFE_WECOM_REQUIRE_GROUP_MENTION,
    model: raw.model ?? raw.AAFE_WECOM_MODEL ?? raw.WECOM_MODEL,
    workspaces: raw.workspaces,
    log: normalizeLogValue(raw.log ?? raw.WECOM_LOG),
    intent: raw.intent,
    models: raw.models,
    tapd: raw.tapd,
    repo: isPlainObject(raw.repo) ? raw.repo : undefined
  });
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !/^(?:0|false|off|no)$/i.test(String(value).trim());
}

export async function persistCurrentWorkspace(configPath, workspaceId) {
  if (!configPath || !workspaceId || !configPath.endsWith('.json')) return false;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return false;
  }
  parsed.currentWorkspace = workspaceId;
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return true;
}

async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = nonEmpty(value);
    if (text) return text;
  }
  return null;
}

function omitEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => nonEmpty(item) != null)
  );
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}
