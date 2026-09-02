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
import { BUILTIN_AGENTS, SCHEMA_MODES, defaultSchemaMode } from '../registry/definition.js';

export const AGENTS_CONFIG_FILE = '.aafe.agents.json';

/**
 * Config strings may reference the environment (`${AAFE_IMPACT_ENDPOINT}`), so
 * an endpoint or a key never has to be committed. Only these fields are
 * expanded; expanding everything would make a prompt containing `${...}`
 * silently disappear.
 */
const ENV_EXPANDED_FIELDS = Object.freeze(['endpoint', 'ref', 'model', 'prompt', 'inputSchema', 'outputSchema', 'runtime', 'repository', 'repo', 'cwd']);

export function expandEnvRefs(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => env[name] ?? match);
}

function expandAgentEnv(agent, env, id, warnings) {
  const next = { ...agent };
  for (const field of ENV_EXPANDED_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    const expanded = expandEnvRefs(next[field], env);
    if (expanded === next[field]) continue;
    if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(expanded)) {
      warnings.push(`agent "${id}" ${field} still contains an unresolved \${...} reference after env expansion`);
    }
    next[field] = expanded;
  }
  // An unresolved placeholder left verbatim would be sent to the network as if
  // it were a URL; say so instead of letting the request fail obscurely.
  for (const field of ENV_EXPANDED_FIELDS) {
    if (typeof next[field] === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(next[field])) {
      warnings.push(`agent "${id}" ${field} references an environment variable that is not set: ${next[field]}`);
      next[field] = null;
    }
  }
  return next;
}

/**
 * Agent wiring lives in its own file so growing to 20 agents never pollutes
 * `.aafe.config.json` (RFC §30).
 */
export function defaultAgentsConfig() {
  const agents = {};
  for (const [id, builtin] of Object.entries(BUILTIN_AGENTS)) {
    agents[id] = {
      enabled: builtin.enabled,
      provider: 'local',
      ref: `builtin:${id}`,
      capabilities: [...builtin.capabilities]
    };
  }
  return {
    version: 1,
    planner: {
      provider: 'rule',
      maxSteps: 12,
      llm: {
        endpoint: null,
        model: null,
        apiKeyEnv: 'AAFE_LLM_API_KEY',
        temperature: 0
      }
    },
    agents,
    developer: { provider: 'ide', mode: 'current' },
    /**
     * Whether a capability nobody else serves falls through to the IDE agent
     * already running this session.
     *
     * On by default: the alternative is a run that stops at
     * `no-agent-provides-capability` while a perfectly capable agent sits idle
     * in the editor. Off means such a capability stays unserved and is reported
     * as such — a deliberate choice for projects that want every step to be
     * deterministic and reproducible, e.g. in CI.
     */
    ideAgent: { enabled: true, mode: 'current', capabilities: [] },
    policies: {
      timeoutMs: 120000,
      maxRetries: 1,
      maxParallel: 4,
      allowNetwork: false,
      // Spawning the project's own suite is a side effect the caller must own,
      // so it is off until `aafe test --run` or the project opts in.
      allowTestExecution: false,
      // Per-agent context size vs. run-wide spend cap: see ExecutionPolicy.
      tokenBudget: 12000,
      maxTokens: null,
      maxCost: null
    }
  };
}

/**
 * Merge user config over defaults. Unknown agent ids are kept (they may be
 * third-party HTTP agents) as long as they declare capabilities.
 *
 * @param {object} raw          Parsed `.aafe.agents.json`.
 * @param {object} projectConfig Parsed `.aafe.config.json`, for deprecated keys.
 * @returns {{ config: object, warnings: string[] }}
 */
export const AGENT_PROVIDERS = Object.freeze(['local', 'http', 'cli', 'mcp', 'ide', 'cursor']);

/**
 * A `ref` that the provider cannot parse only fails at invocation time, deep
 * inside a run. Catching the shape here lets `aafe doctor` say so up front.
 */
function validateProvider(id, agent) {
  const warnings = [];
  const provider = agent.provider ?? 'local';
  if (!AGENT_PROVIDERS.includes(provider)) {
    warnings.push(`agent "${id}" uses unknown provider "${provider}" (expected one of ${AGENT_PROVIDERS.join(', ')})`);
    return warnings;
  }

  const ref = String(agent.ref ?? agent.endpoint ?? '');
  if (provider === 'http' && !/^https?:\/\//.test(ref)) {
    warnings.push(`agent "${id}" is an http agent but its ref is not a URL: "${ref}"`);
  }
  if (provider === 'mcp' && !/^\S.*#\S+$/.test(ref)) {
    warnings.push(`agent "${id}" is an mcp agent; ref must be "<command and args>#<toolName>", got "${ref}"`);
  }
  if (provider === 'cli' && !ref.trim()) {
    warnings.push(`agent "${id}" is a cli agent but declares no ref (command to run)`);
  }
  if (provider === 'cursor' && agent.model === null) {
    warnings.push(`agent "${id}" is a cursor agent without an explicit model; the provider will use composer-2.5`);
  }
  if (agent.schemaMode !== undefined && !SCHEMA_MODES.includes(agent.schemaMode)) {
    warnings.push(`agent "${id}" has an unknown schemaMode "${agent.schemaMode}"; falling back to "${defaultSchemaMode(provider)}"`);
  }
  if (agent.tools !== undefined && !Array.isArray(agent.tools)) {
    warnings.push(`agent "${id}" declares "tools" but it is not an array; ignoring it`);
  }
  return warnings;
}

export function resolveAgentsConfig(raw = {}, projectConfig = {}, { env = process.env } = {}) {
  const defaults = defaultAgentsConfig();
  const warnings = [];
  const globalAgent = resolveGlobalAgentConfig(projectConfig.agent ?? projectConfig.agentMode);

  const agents = { ...defaults.agents };
  for (const [id, entry] of Object.entries(raw.agents ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    const base = agents[id] ?? { provider: 'local', ref: `builtin:${id}`, capabilities: [] };
    const merged = expandAgentEnv({
      ...base,
      ...entry,
      capabilities: entry.capabilities ?? base.capabilities ?? []
    }, env, id, warnings);

    // Declaring only one address is the common case; keep them in sync so the
    // provider and `aafe doctor` never disagree about where the agent lives.
    if (merged.endpoint && !entry.ref) merged.ref = merged.endpoint;
    if (!merged.endpoint && entry.ref && merged.provider !== 'local') merged.endpoint = merged.ref;
    if (merged.tools !== undefined && !Array.isArray(merged.tools)) delete merged.tools;
    if (merged.schemaMode !== undefined && !SCHEMA_MODES.includes(merged.schemaMode)) {
      merged.schemaMode = defaultSchemaMode(merged.provider ?? 'local');
    }

    agents[id] = merged;
    if (!BUILTIN_AGENTS[id] && agents[id].capabilities.length === 0) {
      warnings.push(`agent "${id}" declares no capabilities and can never be selected by the planner`);
    }
    warnings.push(...validateProvider(id, { ...agents[id], schemaMode: entry.schemaMode, tools: entry.tools }));
  }

  applyDeprecatedLlmAgents(projectConfig, agents, warnings);

  const planner = { ...defaults.planner, ...(raw.planner ?? {}) };
  planner.llm = { ...defaults.planner.llm, ...(raw.planner?.llm ?? {}) };
  // `.aafe.agents.json` may declare the planner model at the top level
  // (AGENTS.SCHEMA §11); fold it into the llm block so there is one shape.
  for (const field of ['endpoint', 'model', 'temperature']) {
    if (raw.planner?.[field] !== undefined && planner.llm[field] == null) planner.llm[field] = raw.planner[field];
  }
  planner.llm.endpoint = nullIfUnresolved(expandEnvRefs(planner.llm.endpoint, env));
  planner.llm.model = nullIfUnresolved(expandEnvRefs(planner.llm.model, env));
  planner.prompt = planner.prompt ?? 'builtin:planner';
  planner.outputSchema = planner.outputSchema ?? 'builtin:planner';

  if (planner.provider !== 'rule' && planner.provider !== 'llm') {
    warnings.push(`unknown planner.provider "${planner.provider}", falling back to "rule"`);
    planner.provider = 'rule';
  }
  if (planner.provider === 'llm' && !planner.llm.endpoint) {
    warnings.push('planner.provider is "llm" but planner.llm.endpoint is not set; the planner will fall back to rules');
  }

  // Agent mode is an overlay on `aafe run` only. It must not rewrite developer /
  // ideAgent / allowNetwork, or context / impact / plan / IDE fallback change.
  const developer = { ...defaults.developer, ...(raw.developer ?? {}) };

  return {
    config: {
      version: raw.version ?? defaults.version,
      planner,
      agents,
      developer,
      agent: globalAgent,
      ideAgent: resolveIdeAgent(raw, defaults, developer, env, warnings),
      policies: { ...defaults.policies, ...(raw.policies ?? {}) }
    },
    warnings
  };
}

function resolveGlobalAgentConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const enabled = normalizeBoolean(config.enabled ?? (typeof raw === 'boolean' || typeof raw === 'string' ? raw : false), false);
  return {
    enabled,
    provider: String(config.provider ?? 'cursor').trim().toLowerCase(),
    mode: String(config.mode ?? config.runtime ?? 'local').trim().toLowerCase() === 'cloud' ? 'cloud' : 'local',
    model: nonEmpty(config.model) ?? 'composer-2.5',
    apiKeyEnv: nonEmpty(config.apiKeyEnv) ?? 'CURSOR_API_KEY',
    apiKey: config.apiKey ?? null,
    repository: config.repository ?? config.repositories ?? config.repo ?? null,
    repositories: config.repositories ?? null,
    repo: config.repo ?? null,
    autoCreatePR: normalizeBoolean(config.autoCreatePR, false),
    skipReviewerRequest: normalizeBoolean(config.skipReviewerRequest, true),
    mcp: resolveOverlayMcp(config.mcp)
  };
}

function resolveOverlayMcp(raw) {
  const mcp = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: normalizeBoolean(mcp.enabled, true),
    config: nonEmpty(mcp.config) ?? null,
    settingSources: Array.isArray(mcp.settingSources)
      ? mcp.settingSources.map((item) => String(item).trim()).filter(Boolean)
      : [],
    servers: mcp.servers ?? mcp.mcpServers ?? {}
  };
}

function normalizeBoolean(value, fallback) {
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

/** Values that read as "off" for the environment switch. */
const OFF = /^(0|false|off|no)$/i;

/**
 * Resolves the global IDE-agent switch.
 *
 * Three levels, narrowest wins, so there is always a way out without editing a
 * committed file: `AAFE_IDE_AGENT=0` for one command or a CI job, then
 * `ideAgent.enabled` for the project, then the default.
 *
 * `developer.provider` is honoured for back-compat — a project that already
 * pointed the developer role somewhere other than the IDE was saying it does
 * not want IDE handoffs, and should not silently acquire them on upgrade.
 */
function resolveIdeAgent(raw, defaults, developer, env, warnings) {
  const ideAgent = { ...defaults.ideAgent, ...(raw.ideAgent ?? {}) };

  if (raw.ideAgent?.mode === undefined && developer.mode) ideAgent.mode = developer.mode;
  if (raw.ideAgent?.enabled === undefined && developer.provider !== 'ide') ideAgent.enabled = false;

  const override = env.AAFE_IDE_AGENT;
  if (override !== undefined && String(override).trim() !== '') {
    ideAgent.enabled = !OFF.test(String(override).trim());
  }

  ideAgent.enabled = ideAgent.enabled !== false;
  if (!Array.isArray(ideAgent.capabilities)) {
    if (raw.ideAgent?.capabilities !== undefined) {
      warnings.push('ideAgent.capabilities must be an array of capability names; ignoring it');
    }
    ideAgent.capabilities = [];
  }
  return ideAgent;
}

/**
 * Load and resolve agent config for a project root.
 * @returns {Promise<{ config: object, warnings: string[], exists: boolean }>}
 */
export async function loadAgentsConfig(root, projectConfig = null, { env = process.env } = {}) {
  const raw = await readJson(path.join(root, AGENTS_CONFIG_FILE));
  const project = projectConfig ?? (await readJson(path.join(root, '.aafe.config.json'))) ?? {};
  const { config, warnings } = resolveAgentsConfig(raw ?? {}, project, { env });
  return { config, warnings, exists: raw !== null };
}

function nullIfUnresolved(value) {
  if (typeof value !== 'string') return value ?? null;
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ? null : value;
}

/**
 * `analyze.llm.agents` used to gate per-domain LLM enrichment. It now lives in
 * `.aafe.agents.json`; honour it during migration instead of dropping it silently.
 */
function applyDeprecatedLlmAgents(projectConfig, agents, warnings) {
  const legacy = projectConfig?.analyze?.llm?.agents;
  if (!legacy || typeof legacy !== 'object') return;

  const enabledDomains = Object.entries(legacy)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  if (enabledDomains.length === 0) return;

  warnings.push(
    `.aafe.config.json → analyze.llm.agents is deprecated; move agent wiring to ${AGENTS_CONFIG_FILE} (found: ${enabledDomains.join(', ')})`
  );

  if (enabledDomains.includes('testing') && agents['test-agent']) {
    agents['test-agent'] = { ...agents['test-agent'], enabled: true };
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
