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

import { defaultAgentMcpConfig, resolveAgentMcpConfig } from './agentMcp.js';

export const AGENT_PROVIDER_CURSOR = 'cursor';
export const AGENT_MODE_LOCAL = 'local';
export const AGENT_MODE_CLOUD = 'cloud';
export const DEFAULT_CURSOR_MODEL = 'composer-2.5';
export const DEFAULT_CURSOR_API_KEY_ENV = 'CURSOR_API_KEY';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled', 'agent', 'cursor', '开启', '启用']);
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disable', 'disabled', 'none', '关闭', '禁用']);

export function defaultAgentModeConfig() {
  return {
    enabled: false,
    provider: AGENT_PROVIDER_CURSOR,
    mode: AGENT_MODE_LOCAL,
    model: DEFAULT_CURSOR_MODEL,
    apiKeyEnv: DEFAULT_CURSOR_API_KEY_ENV,
    apiKey: null,
    repository: null,
    autoCreatePR: false,
    skipReviewerRequest: true,
    mcp: defaultAgentMcpConfig(),
    manager: defaultAgentManagerConfig()
  };
}

export function defaultAgentManagerConfig() {
  return {
    enabled: false,
    maxConcurrentTasks: 4,
    output: '.aafe',
    validateProjectRuntime: true,
    recoverOnStart: true
  };
}

export function normalizeAgentEnabled(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const compact = raw.replace(/[_-\s]/g, '');
  if (ENABLED_VALUES.has(raw) || ENABLED_VALUES.has(compact)) return true;
  if (DISABLED_VALUES.has(raw) || DISABLED_VALUES.has(compact)) return false;
  return fallback;
}

export function normalizeCursorMode(value) {
  const raw = String(value ?? AGENT_MODE_LOCAL).trim().toLowerCase();
  return raw === AGENT_MODE_CLOUD ? AGENT_MODE_CLOUD : AGENT_MODE_LOCAL;
}

export function resolveAgentModeConfig(projectConfig = {}, overrides = {}) {
  const fromConfig = projectConfig.agent && typeof projectConfig.agent === 'object'
    ? projectConfig.agent
    : {};
  const defaults = defaultAgentModeConfig();
  const enabled = normalizeAgentEnabled(
    overrides.enabled
      ?? overrides.agentMode
      ?? fromConfig.enabled
      ?? projectConfig.agentMode,
    defaults.enabled
  );

  return {
    ...defaults,
    ...fromConfig,
    enabled,
    provider: String(overrides.provider ?? fromConfig.provider ?? defaults.provider).trim().toLowerCase() || defaults.provider,
    mode: normalizeCursorMode(overrides.mode ?? overrides.runtime ?? fromConfig.mode ?? fromConfig.runtime ?? defaults.mode),
    model: nonEmpty(overrides.model ?? fromConfig.model) ?? defaults.model,
    apiKeyEnv: nonEmpty(overrides.apiKeyEnv ?? fromConfig.apiKeyEnv) ?? defaults.apiKeyEnv,
    apiKey: overrides.apiKey ?? fromConfig.apiKey ?? defaults.apiKey,
    repository: overrides.repository ?? overrides.repo ?? fromConfig.repository ?? fromConfig.repositories ?? fromConfig.repo ?? defaults.repository,
    autoCreatePR: normalizeAgentEnabled(overrides.autoCreatePR ?? fromConfig.autoCreatePR, defaults.autoCreatePR),
    skipReviewerRequest: normalizeAgentEnabled(overrides.skipReviewerRequest ?? fromConfig.skipReviewerRequest, defaults.skipReviewerRequest),
    mcp: resolveAgentMcpConfig(fromConfig.mcp, overrides.mcp ?? {
      enabled: overrides.mcpEnabled,
      config: overrides.mcpConfig,
      settingSources: overrides.mcpSettingSources,
      servers: overrides.mcpServers ?? overrides.servers
    }),
    manager: resolveAgentManagerConfig(fromConfig.manager, overrides.manager ?? {
      enabled: overrides.managerEnabled,
      maxConcurrentTasks: overrides.maxConcurrentTasks,
      output: overrides.taskOutput,
      validateProjectRuntime: overrides.validateProjectRuntime,
      recoverOnStart: overrides.recoverOnStart
    })
  };
}

export function resolveAgentManagerConfig(raw = {}, overrides = {}) {
  const fromConfig = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultAgentManagerConfig();
  return {
    ...defaults,
    ...fromConfig,
    enabled: normalizeAgentEnabled(overrides.enabled ?? fromConfig.enabled, defaults.enabled),
    maxConcurrentTasks: positiveInteger(
      overrides.maxConcurrentTasks ?? fromConfig.maxConcurrentTasks,
      defaults.maxConcurrentTasks
    ),
    output: nonEmpty(overrides.output ?? fromConfig.output) ?? defaults.output,
    validateProjectRuntime: normalizeAgentEnabled(
      overrides.validateProjectRuntime ?? fromConfig.validateProjectRuntime,
      defaults.validateProjectRuntime
    ),
    recoverOnStart: normalizeAgentEnabled(
      overrides.recoverOnStart ?? fromConfig.recoverOnStart,
      defaults.recoverOnStart
    )
  };
}

export function buildAgentModeConfigFromAnswers(answers = {}, existing = null) {
  return resolveAgentModeConfig({ agent: existing ?? {} }, answers);
}

export function isAgentModeEnabled(configOrMode) {
  if (typeof configOrMode === 'string' || typeof configOrMode === 'boolean') {
    return normalizeAgentEnabled(configOrMode);
  }
  return normalizeAgentEnabled(configOrMode?.enabled);
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
