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

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAgentModeConfig } from './agentMode.js';
import { listAgentModels } from './agentModels.js';
import { normalizeMcpServers, resolveAgentMcpConfig } from './agentMcp.js';
import { resolveWorkflowModeConfig } from './workflowMode.js';
import { resolveSubmitConfig } from './submitConfig.js';
import { defaultTapdConfigTemplate } from './tapdConfig.js';
import { DEFAULT_E2E_CONFIG } from '../testing/e2e/config.js';

const CONFIG_FILE = '.aafe.config.json';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4318;
const HTML_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config-ui', 'index.html');

export async function runConfigUiCommand(root, args = []) {
  const options = parseConfigUiArgs(args);
  if (options.help) {
    printConfigUiHelp();
    return { status: 'pass', command: 'aafe config', help: true };
  }

  const server = await startConfigUiServer(root, options);
  const address = server.address();
  const url = `http://${options.host}:${address.port}/`;
  const result = {
    status: 'pass',
    command: 'aafe config',
    url,
    host: options.host,
    port: address.port,
    configFile: path.join(root, CONFIG_FILE),
    summary: `AAFE config UI listening at ${url}`
  };
  console.log(JSON.stringify(result, null, 2));
  if (options.open) openBrowser(url);
  if (!options.background) await new Promise(() => {});
  return { ...result, server };
}

export function parseConfigUiArgs(args = []) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    open: !args.includes('--no-open'),
    background: args.includes('--background'),
    help: args.includes('--help') || args.includes('-h')
  };
  for (const arg of args) {
    if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length) || DEFAULT_HOST;
    if (arg.startsWith('--port=')) options.port = Number.parseInt(arg.slice('--port='.length), 10) || DEFAULT_PORT;
  }
  return options;
}

export async function startConfigUiServer(root, options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const html = await readFile(HTML_FILE, 'utf8');
  const server = createServer((request, response) => {
    handleConfigUiRequest(request, response, {
      root,
      html,
      listModels: options.listModels,
      env: options.env
    }).catch((error) => {
      if (response.headersSent) return;
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

export async function handleConfigUiRequest(request, response, { root, html, listModels = null, env = process.env }) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  if (method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, { ok: true });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/config') {
    const existing = await readProjectConfigFile(root);
    json(response, 200, {
      file: CONFIG_FILE,
      exists: existing.exists,
      form: buildConfigForm(existing.config),
      preview: managedPreview(existing.config)
    });
    return;
  }
  if ((method === 'PUT' || method === 'POST') && url.pathname === '/api/config') {
    const body = await readJsonBody(request);
    const existing = await readProjectConfigFile(root);
    const next = applyConfigForm(existing.config, body.form ?? body);
    await writeProjectConfigFile(root, next);
    json(response, 200, {
      status: 'saved',
      file: CONFIG_FILE,
      form: buildConfigForm(next),
      preview: managedPreview(next)
    });
    return;
  }
  if ((method === 'GET' || method === 'POST') && url.pathname === '/api/models') {
    const body = method === 'POST' ? await readJsonBody(request) : {};
    const existing = await readProjectConfigFile(root);
    const agent = resolveAgentModeConfig(existing.config);
    const listed = await (listModels ?? listAgentModels)({
      apiKey: emptyToNull(body.apiKey) ?? agent.apiKey,
      apiKeyEnv: emptyToNull(body.apiKeyEnv) ?? agent.apiKeyEnv,
      current: emptyToNull(body.current) ?? agent.model,
      env
    });
    json(response, 200, listed);
    return;
  }

  json(response, 404, { error: 'not-found' });
}

export function buildConfigForm(projectConfig = {}) {
  const agent = resolveAgentModeConfig(projectConfig);
  const mcp = agent.mcp ?? {};
  const tapd = projectConfig.tapd && typeof projectConfig.tapd === 'object' ? projectConfig.tapd : {};
  const e2e = { ...DEFAULT_E2E_CONFIG, ...(projectConfig.e2e ?? {}) };
  return {
    workflow: resolveWorkflowModeConfig(projectConfig).workflow,
    submitCli: resolveSubmitConfig(projectConfig).cli,
    agent: {
      enabled: agent.enabled === true,
      provider: agent.provider ?? 'cursor',
      mode: agent.mode ?? 'local',
      model: agent.model ?? 'composer-2.5',
      apiKeyEnv: agent.apiKeyEnv ?? 'CURSOR_API_KEY',
      apiKey: agent.apiKey ?? '',
      repository: agent.repository ?? '',
      autoCreatePR: agent.autoCreatePR === true,
      skipReviewerRequest: agent.skipReviewerRequest !== false
    },
    mcp: {
      enabled: mcp.enabled !== false,
      config: mcp.config ?? '',
      settingSources: Array.isArray(mcp.settingSources) ? [...mcp.settingSources] : [],
      servers: serversToRows(mcp.servers)
    },
    tapd: {
      enabled: tapd.enabled === true,
      username: tapd.username ?? '',
      api_password: tapd.api_password ?? '',
      workspace_id: tapd.workspace_id ?? ''
    },
    e2e: {
      enabled: e2e.enabled !== false,
      baseUrlEnv: e2e.baseUrlEnv ?? DEFAULT_E2E_CONFIG.baseUrlEnv,
      baseUrl: e2e.baseUrl ?? ''
    }
  };
}

export function applyConfigForm(existing = {}, form = {}) {
  const next = { ...existing };
  next.mode = resolveWorkflowModeConfig(existing, { workflow: form.workflow });
  next.submit = resolveSubmitConfig(existing, { cli: form.submitCli ?? form.submit?.cli });

  const agentForm = form.agent ?? {};
  const mcpForm = form.mcp ?? {};
  next.agent = resolveAgentModeConfig(existing, {
    enabled: agentForm.enabled,
    provider: agentForm.provider,
    mode: agentForm.mode,
    model: agentForm.model,
    apiKeyEnv: agentForm.apiKeyEnv,
    apiKey: emptyToNull(agentForm.apiKey),
    repository: emptyToNull(agentForm.repository),
    autoCreatePR: agentForm.autoCreatePR,
    skipReviewerRequest: agentForm.skipReviewerRequest
  });
  next.agent.mcp = resolveAgentMcpConfig({}, {
    enabled: mcpForm.enabled,
    config: mcpForm.config,
    settingSources: mcpForm.settingSources,
    servers: rowsToServers(mcpForm.servers)
  });

  if (form.tapd?.enabled) {
    next.tapd = {
      ...defaultTapdConfigTemplate(),
      ...(existing.tapd ?? {}),
      enabled: true,
      username: String(form.tapd.username ?? ''),
      api_password: String(form.tapd.api_password ?? ''),
      workspace_id: String(form.tapd.workspace_id ?? '')
    };
  } else if (existing.tapd) {
    next.tapd = { ...existing.tapd, enabled: false };
  }

  next.e2e = {
    ...DEFAULT_E2E_CONFIG,
    ...(existing.e2e ?? {}),
    enabled: form.e2e?.enabled !== false,
    baseUrlEnv: String(form.e2e?.baseUrlEnv ?? existing.e2e?.baseUrlEnv ?? DEFAULT_E2E_CONFIG.baseUrlEnv),
    baseUrl: emptyToNull(form.e2e?.baseUrl ?? existing.e2e?.baseUrl)
  };
  return next;
}

export async function readProjectConfigFile(root) {
  const file = path.join(root, CONFIG_FILE);
  try {
    const config = JSON.parse(await readFile(file, 'utf8'));
    return { exists: true, config: config && typeof config === 'object' ? config : {} };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, config: {} };
    throw error;
  }
}

export async function writeProjectConfigFile(root, config) {
  const file = path.join(root, CONFIG_FILE);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

function managedPreview(config) {
  return {
    mode: config.mode ?? null,
    submit: config.submit ?? null,
    agent: config.agent ?? null,
    tapd: config.tapd ?? null,
    e2e: config.e2e
      ? { enabled: config.e2e.enabled, baseUrlEnv: config.e2e.baseUrlEnv, baseUrl: config.e2e.baseUrl }
      : null
  };
}

function rowsToServers(rows) {
  if (!rows) return {};
  if (!Array.isArray(rows)) return rows;
  return rows
    .map((row) => ({
      name: row.name,
      type: row.type,
      command: row.command,
      args: typeof row.args === 'string' ? splitArgs(row.args) : row.args,
      url: row.url,
      env: typeof row.env === 'string' ? parseEnvLines(row.env) : row.env
    }))
    .filter((row) => row.name && (row.command || row.url));
}

function splitArgs(value) {
  return String(value ?? '').trim().split(/\s+/).filter(Boolean);
}

function parseEnvLines(value) {
  const env = {};
  for (const line of String(value ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

function serversToRows(servers) {
  const normalized = normalizeMcpServers(servers);
  return Object.entries(normalized).map(([name, server]) => ({
    name,
    type: server.type ?? (server.url ? 'http' : 'stdio'),
    command: server.command ?? '',
    args: Array.isArray(server.args) ? server.args.join(' ') : '',
    url: server.url ?? '',
    env: server.env && typeof server.env === 'object'
      ? Object.entries(server.env).map(([key, value]) => `${key}=${value}`).join('\n')
      : ''
  }));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid-json');
  return parsed;
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function openBrowser(url) {
  try {
    const command = process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
    spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Opening a browser is convenience only.
  }
}

function emptyToNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function printConfigUiHelp() {
  console.log(`aafe config

Start a local visual UI for AAFE CLI config (.aafe.config.json).

  aafe config
  aafe ui
  aafe config --port=4318 --host=127.0.0.1
  aafe config --no-open
  aafe config --background

Default bind is 127.0.0.1. The page writes workflow / agent / MCP / submit / TAPD / E2E.
`);
}
