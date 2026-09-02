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
import os from 'node:os';
import path from 'node:path';

const SETTING_SOURCE_ALIASES = Object.freeze({
  project: 'project',
  user: 'user',
  plugins: 'plugins',
  all: 'all',
  team: 'team'
});

export function defaultAgentMcpConfig() {
  return {
    enabled: true,
    config: null,
    settingSources: [],
    servers: {}
  };
}

export function resolveAgentMcpConfig(raw = {}, overrides = {}) {
  const fromConfig = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultAgentMcpConfig();
  const enabled = normalizeEnabled(
    overrides.enabled ?? fromConfig.enabled,
    defaults.enabled
  );
  return {
    ...defaults,
    ...fromConfig,
    enabled,
    config: nonEmpty(overrides.config ?? fromConfig.config) ?? defaults.config,
    settingSources: normalizeSettingSources(overrides.settingSources ?? fromConfig.settingSources),
    servers: {
      ...normalizeMcpServers(fromConfig.servers ?? fromConfig.mcpServers),
      ...normalizeMcpServers(overrides.servers)
    }
  };
}

/**
 * Materialize Cursor SDK `mcpServers` for one `aafe run`.
 * Inline servers win over files. Empty result means "do not pass mcpServers".
 */
export async function resolveCursorMcpForRun(mcpConfig = {}, {
  root = process.cwd(),
  env = process.env,
  enabled: enabledOverride,
  config: configOverride = null,
  settingSources: settingSourcesOverride = null
} = {}) {
  const mcp = resolveAgentMcpConfig(mcpConfig, {
    enabled: enabledOverride,
    config: configOverride,
    settingSources: settingSourcesOverride
  });
  if (!mcp.enabled) {
    return { enabled: false, servers: {}, settingSources: [], warnings: [] };
  }

  const warnings = [];
  const servers = {};
  const sources = mcp.settingSources;

  // Ambient files first, then an explicit config path, then inline servers.
  const filePaths = [];
  if (sources.includes('user') || sources.includes('all')) {
    filePaths.push(path.join(os.homedir(), '.cursor', 'mcp.json'));
  }
  if (sources.includes('project') || sources.includes('all')) {
    filePaths.push(path.join(root, '.cursor', 'mcp.json'));
  }
  if (mcp.config) filePaths.push(resolveMcpPath(mcp.config, root));

  for (const file of unique(filePaths)) {
    const loaded = await readMcpServersFile(file);
    if (loaded.error && loaded.error !== 'missing') {
      warnings.push(`mcp config unreadable (${file}): ${loaded.error}`);
    }
    Object.assign(servers, loaded.servers);
  }

  Object.assign(servers, mcp.servers);
  const expanded = expandMcpServers(servers, env);
  return {
    enabled: true,
    servers: expanded,
    settingSources: sources,
    warnings
  };
}

export function normalizeMcpServers(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .map((entry) => normalizeNamedServer(entry))
      .filter(Boolean));
  }
  if (typeof value !== 'object') return {};
  if (value.mcpServers && typeof value.mcpServers === 'object') {
    return normalizeMcpServers(value.mcpServers);
  }
  const servers = {};
  for (const [name, entry] of Object.entries(value)) {
    const server = normalizeServerEntry(entry);
    if (server) servers[name] = server;
  }
  return servers;
}

export function toCursorMcpServers(servers = {}) {
  return Object.keys(servers).length > 0 ? servers : null;
}

function normalizeNamedServer(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = String(entry.name ?? entry.id ?? '').trim();
  const server = normalizeServerEntry(entry);
  return name && server ? [name, server] : null;
}

function normalizeServerEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const url = nonEmpty(entry.url ?? entry.endpoint);
  const command = nonEmpty(entry.command);
  if (!url && !command) return null;

  const type = String(entry.type ?? (url ? 'http' : 'stdio')).trim().toLowerCase();
  if (url || type === 'http' || type === 'sse') {
    const server = { type: 'http', url };
    if (entry.headers && typeof entry.headers === 'object') server.headers = { ...entry.headers };
    if (entry.auth && typeof entry.auth === 'object') server.auth = { ...entry.auth };
    return server;
  }

  const server = {
    type: 'stdio',
    command,
    args: Array.isArray(entry.args) ? entry.args.map((item) => String(item)) : []
  };
  if (entry.env && typeof entry.env === 'object') server.env = { ...entry.env };
  if (nonEmpty(entry.cwd)) server.cwd = entry.cwd;
  return server;
}

function normalizeSettingSources(value) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value)
    ? value
    : String(value).split(',').map((item) => item.trim()).filter(Boolean);
  const sources = [];
  for (const item of items) {
    const key = String(item).trim().toLowerCase();
    const mapped = SETTING_SOURCE_ALIASES[key];
    if (mapped && !sources.includes(mapped)) sources.push(mapped);
  }
  return sources;
}

function expandMcpServers(servers, env) {
  const next = {};
  for (const [name, server] of Object.entries(servers)) {
    next[name] = expandDeep(server, env);
  }
  return next;
}

function expandEnvRefs(value, env) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => env[name] ?? match);
}

function expandDeep(value, env) {
  if (typeof value === 'string') return expandEnvRefs(value, env);
  if (Array.isArray(value)) return value.map((item) => expandDeep(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandDeep(item, env)]));
  }
  return value;
}

async function readMcpServersFile(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { servers: normalizeMcpServers(parsed.mcpServers ?? parsed.servers ?? parsed), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { servers: {}, error: 'missing' };
    return { servers: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveMcpPath(value, root) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeEnabled(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (/^(1|true|yes|y|on|enable|enabled|开启|启用)$/.test(raw)) return true;
  if (/^(0|false|no|n|off|disable|disabled|关闭|禁用)$/.test(raw)) return false;
  return fallback;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}
