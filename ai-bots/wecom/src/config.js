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
    localConfigPath: local.path ?? null,
    log: resolveWeComLogConfig({ env, local, root: projectRoot }),
    agent: {
      ...agent,
      apiKey: apiKey ?? agent.apiKey ?? null,
      model: model ?? agent.model ?? null
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
    model: raw.model ?? raw.AAFE_WECOM_MODEL ?? raw.WECOM_MODEL,
    workspaces: raw.workspaces,
    log: normalizeLogValue(raw.log ?? raw.WECOM_LOG)
  });
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
