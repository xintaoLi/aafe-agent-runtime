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

import assert from 'node:assert/strict';

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  defaultAgentModeConfig,
  defaultAgentManagerConfig,
  isAgentModeEnabled,
  normalizeAgentEnabled,
  normalizeCursorMode,
  resolveAgentModeConfig
} from '../src/cli/agentMode.js';
import {
  defaultAgentMcpConfig,
  normalizeMcpServers,
  resolveAgentMcpConfig,
  resolveCursorMcpForRun,
  toCursorMcpServers
} from '../src/cli/agentMcp.js';
import { resolveAgentsConfig } from '../src/agent-platform/config/agentsConfig.js';
import { parsePlatformArgs } from '../src/cli/platform.js';
import { FALLBACK_AGENT_MODELS, listAgentModels, resolveModelChoice } from '../src/cli/agentModels.js';

assert.deepEqual(defaultAgentModeConfig(), {
  enabled: false,
  provider: 'cursor',
  mode: 'local',
  model: 'composer-2.5',
  apiKeyEnv: 'CURSOR_API_KEY',
  apiKey: null,
  repository: null,
  autoCreatePR: false,
  skipReviewerRequest: true,
  mcp: defaultAgentMcpConfig(),
  manager: defaultAgentManagerConfig()
});

assert.equal(normalizeAgentEnabled('on'), true);
assert.equal(normalizeAgentEnabled('开启'), true);
assert.equal(normalizeAgentEnabled('off'), false);
assert.equal(normalizeAgentEnabled(undefined, true), true);
assert.equal(normalizeCursorMode('cloud'), 'cloud');
assert.equal(normalizeCursorMode('unknown'), 'local');
assert.equal(isAgentModeEnabled({ enabled: 'yes' }), true);
assert.deepEqual(defaultAgentManagerConfig(), {
  enabled: false,
  maxConcurrentTasks: 4,
  output: '.aafe',
  validateProjectRuntime: true,
  recoverOnStart: true
});

assert.deepEqual(resolveAgentModeConfig({}), defaultAgentModeConfig());
assert.deepEqual(resolveAgentModeConfig({
  agent: {
    enabled: true,
    model: 'auto',
    apiKeyEnv: 'AAFE_CURSOR_KEY',
    repository: 'owner/repo'
  }
}), {
  ...defaultAgentModeConfig(),
  enabled: true,
  model: 'auto',
  apiKeyEnv: 'AAFE_CURSOR_KEY',
  repository: 'owner/repo'
});

assert.equal(resolveAgentModeConfig({ agent: { enabled: true } }, { enabled: false }).enabled, false);
assert.equal(resolveAgentModeConfig({}, { agentMode: 'enabled' }).enabled, true);
assert.deepEqual(resolveAgentModeConfig({
  agent: {
    manager: {
      enabled: true,
      maxConcurrentTasks: 7,
      output: '.tasks'
    }
  }
}).manager, {
  ...defaultAgentManagerConfig(),
  enabled: true,
  maxConcurrentTasks: 7,
  output: '.tasks'
});

const disabled = resolveAgentsConfig({}, { agent: { enabled: false } });
assert.equal(disabled.config.developer.provider, 'ide');
assert.equal(disabled.config.policies.allowNetwork, false);
assert.equal(disabled.config.ideAgent.enabled, true);
assert.equal(disabled.config.agent.enabled, false);

const enabled = resolveAgentsConfig({}, {
  agent: {
    enabled: true,
    provider: 'cursor',
    mode: 'local',
    model: 'auto',
    apiKeyEnv: 'AAFE_CURSOR_KEY',
    apiKey: 'cursor_test',
    repository: 'owner/repo'
  }
});
assert.equal(enabled.config.agent.enabled, true);
assert.equal(enabled.config.agent.provider, 'cursor');
assert.equal(enabled.config.agent.mode, 'local');
assert.equal(enabled.config.agent.model, 'auto');
assert.equal(enabled.config.agent.apiKeyEnv, 'AAFE_CURSOR_KEY');
assert.equal(enabled.config.agent.apiKey, 'cursor_test');
assert.equal(enabled.config.agent.repository, 'owner/repo');
assert.equal(enabled.config.developer.provider, 'ide', 'agent mode must not rewrite the IDE developer role');
assert.equal(enabled.config.policies.allowNetwork, false, 'agent mode must not widen planner network policy');
assert.equal(enabled.config.ideAgent.enabled, true, 'agent mode must keep IDE fallback for unserved capabilities');
assert.equal(enabled.config.agent.mcp.enabled, true);
assert.deepEqual(enabled.config.agent.mcp.servers, {});

assert.deepEqual(normalizeMcpServers({
  tapd: { command: 'npx', args: ['-y', 'tapd-mcp'], env: { TOKEN: '${TAPD_TOKEN}' } },
  docs: { url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer ${DOC_TOKEN}' } }
}), {
  tapd: { type: 'stdio', command: 'npx', args: ['-y', 'tapd-mcp'], env: { TOKEN: '${TAPD_TOKEN}' } },
  docs: { type: 'http', url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer ${DOC_TOKEN}' } }
});

assert.deepEqual(normalizeMcpServers([
  { name: 'search', command: 'uvx', args: ['mcp-search'] }
]), {
  search: { type: 'stdio', command: 'uvx', args: ['mcp-search'] }
});

const mergedMcp = resolveAgentMcpConfig({
  servers: { tapd: { command: 'npx', args: ['old'] } }
}, {
  config: '.aafe/mcp.json',
  settingSources: 'project,user',
  servers: { tapd: { command: 'npx', args: ['new'] }, git: { command: 'git-mcp' } }
});
assert.equal(mergedMcp.config, '.aafe/mcp.json');
assert.deepEqual(mergedMcp.settingSources, ['project', 'user']);
assert.deepEqual(mergedMcp.servers.tapd.args, ['new']);
assert.equal(mergedMcp.servers.git.command, 'git-mcp');

const disabledMcp = await resolveCursorMcpForRun({ enabled: false, servers: { tapd: { command: 'npx' } } });
assert.equal(disabledMcp.enabled, false);
assert.equal(toCursorMcpServers(disabledMcp.servers), null);

const emptyMcp = await resolveCursorMcpForRun({});
assert.equal(emptyMcp.enabled, true);
assert.equal(toCursorMcpServers(emptyMcp.servers), null);

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-mcp-'));
await mkdir(path.join(tmp, '.cursor'), { recursive: true });
await writeFile(path.join(tmp, '.cursor', 'mcp.json'), JSON.stringify({
  mcpServers: {
    project: { command: 'project-mcp', args: [] },
    shared: { command: 'from-project' }
  }
}));
await writeFile(path.join(tmp, 'extra.mcp.json'), JSON.stringify({
  mcpServers: {
    extra: { command: 'extra-mcp' },
    shared: { command: 'from-file' }
  }
}));

const loaded = await resolveCursorMcpForRun({
  config: 'extra.mcp.json',
  settingSources: ['project'],
  servers: {
    inline: { command: 'inline-mcp', env: { KEY: '${AAFE_MCP_KEY}' } },
    shared: { command: 'from-inline' }
  }
}, {
  root: tmp,
  env: { AAFE_MCP_KEY: 'secret' }
});
assert.equal(loaded.servers.project.command, 'project-mcp');
assert.equal(loaded.servers.extra.command, 'extra-mcp');
assert.equal(loaded.servers.shared.command, 'from-inline');
assert.equal(loaded.servers.inline.env.KEY, 'secret');
assert.deepEqual(Object.keys(loaded.servers).sort(), ['extra', 'inline', 'project', 'shared']);

const noAmbient = await resolveCursorMcpForRun({}, { root: tmp });
assert.deepEqual(noAmbient.servers, {}, 'must not silently load .cursor/mcp.json');

const withMcp = resolveAgentsConfig({}, {
  agent: {
    enabled: true,
    mcp: {
      config: '.aafe/mcp.json',
      servers: { tapd: { command: 'npx', args: ['tapd-mcp'] } }
    }
  }
});
assert.equal(withMcp.config.developer.provider, 'ide');
assert.equal(withMcp.config.policies.allowNetwork, false);
assert.equal(withMcp.config.agent.mcp.config, '.aafe/mcp.json');
assert.equal(withMcp.config.agent.mcp.servers.tapd.command, 'npx');

const runFlags = parsePlatformArgs([
  '--agent=cursor',
  '--mcp-config=.cursor/mcp.json',
  '--mcp-setting-sources=project,user',
  '--no-mcp'
]);
assert.equal(runFlags.agent, 'cursor');
assert.equal(runFlags.mcpConfig, '.cursor/mcp.json');
assert.equal(runFlags.mcpSettingSources, 'project,user');
assert.equal(runFlags.mcp, false);

const cursorModelFlag = parsePlatformArgs(['--cursor-model=auto']);
assert.equal(cursorModelFlag.model, 'auto');

const missingKeyModels = await listAgentModels({ env: {}, current: 'composer-2.5' });
assert.equal(missingKeyModels.source, 'fallback');
assert.ok(missingKeyModels.models.some((item) => item.id === 'auto'));
assert.ok(missingKeyModels.models.some((item) => item.id === 'composer-2.5'));

const liveModels = await listAgentModels({
  apiKey: 'cursor_test',
  current: 'my-model',
  importSdk: async () => ({
    Cursor: {
      models: {
        list: async () => [
          { id: 'composer-2.5', displayName: 'Composer 2.5' },
          { id: 'grok-4.5', displayName: 'Grok 4.5' }
        ]
      }
    }
  })
});
assert.equal(liveModels.source, 'cursor');
assert.ok(liveModels.models.some((item) => item.id === 'grok-4.5'));
assert.ok(liveModels.models.some((item) => item.id === 'my-model'));
assert.equal(resolveModelChoice('2', FALLBACK_AGENT_MODELS), FALLBACK_AGENT_MODELS[1].id);
assert.equal(resolveModelChoice('auto', FALLBACK_AGENT_MODELS), 'auto');

console.log('agent mode tests passed');
