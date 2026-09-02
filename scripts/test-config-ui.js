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
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyConfigForm,
  buildConfigForm,
  parseConfigUiArgs,
  startConfigUiServer
} from '../src/cli/configUi.js';

assert.equal(parseConfigUiArgs([]).port, 4318);
assert.equal(parseConfigUiArgs([]).host, '127.0.0.1');
assert.equal(parseConfigUiArgs(['--no-open']).open, false);
assert.equal(parseConfigUiArgs(['--port=4400']).port, 4400);

const existing = {
  analyze: { output: '.aafe' },
  mode: { workflow: 'ask' },
  submit: { cli: 'git' },
  agent: {
    enabled: false,
    mcp: {
      enabled: true,
      servers: { old: { command: 'old-mcp' } }
    }
  }
};

const next = applyConfigForm(existing, {
  workflow: 'autonomous',
  submitCli: 'gtm',
  agent: {
    enabled: true,
    mode: 'local',
    model: 'auto',
    apiKeyEnv: 'AAFE_CURSOR_KEY',
    apiKey: '',
    repository: 'owner/repo',
    autoCreatePR: false,
    skipReviewerRequest: true
  },
  mcp: {
    enabled: true,
    config: '.cursor/mcp.json',
    settingSources: ['project'],
    servers: [
      { name: 'tapd', type: 'stdio', command: 'npx', args: '-y tapd-mcp', env: 'TOKEN=${TAPD_TOKEN}' }
    ]
  },
  tapd: { enabled: false },
  e2e: { enabled: true, baseUrlEnv: 'AAFE_E2E_BASE_URL', baseUrl: '' }
});

assert.equal(next.analyze.output, '.aafe', 'must not rewrite unrelated config');
assert.equal(next.mode.workflow, 'autonomous');
assert.equal(next.submit.cli, 'gtm');
assert.equal(next.agent.enabled, true);
assert.equal(next.agent.model, 'auto');
assert.equal(next.agent.apiKey, null);
assert.equal(next.agent.mcp.config, '.cursor/mcp.json');
assert.deepEqual(next.agent.mcp.settingSources, ['project']);
assert.equal(next.agent.mcp.servers.tapd.command, 'npx');
assert.deepEqual(next.agent.mcp.servers.tapd.args, ['-y', 'tapd-mcp']);
assert.equal(next.agent.mcp.servers.old, undefined, 'deleted MCP servers must not be merged back');
assert.equal(next.e2e.enabled, true);

const form = buildConfigForm(next);
assert.equal(form.workflow, 'autonomous');
assert.equal(form.agent.enabled, true);
assert.equal(form.mcp.servers[0].name, 'tapd');
assert.equal(form.mcp.servers[0].args, '-y tapd-mcp');

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-config-ui-'));
await writeFile(path.join(tmp, '.aafe.config.json'), JSON.stringify({
  analyze: { output: '.keep' },
  agent: { enabled: false }
}, null, 2));

const server = await startConfigUiServer(tmp, {
  host: '127.0.0.1',
  port: 0,
  open: false,
  listModels: async ({ current }) => ({
    models: [
      { id: 'auto', displayName: 'Auto' },
      { id: 'composer-2.5', displayName: 'Composer 2.5' },
      { id: 'grok-4.5', displayName: 'Grok 4.5' }
    ],
    source: 'cursor',
    current: current ?? 'composer-2.5',
    warnings: []
  })
});
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const loaded = await fetch(`${base}/api/config`).then((res) => res.json());
assert.equal(loaded.exists, true);
assert.equal(loaded.form.agent.enabled, false);

const saved = await fetch(`${base}/api/config`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    form: {
      ...loaded.form,
      workflow: 'ask',
      agent: { ...loaded.form.agent, enabled: true, model: 'composer-2.5' },
      mcp: {
        enabled: true,
        config: '',
        settingSources: [],
        servers: [{ name: 'docs', type: 'http', url: 'https://mcp.example/docs', command: '', args: '', env: '' }]
      }
    }
  })
}).then((res) => res.json());
assert.equal(saved.status, 'saved');
assert.equal(saved.form.agent.enabled, true);
assert.equal(saved.form.mcp.servers[0].url, 'https://mcp.example/docs');

const written = JSON.parse(await readFile(path.join(tmp, '.aafe.config.json'), 'utf8'));
assert.equal(written.analyze.output, '.keep');
assert.equal(written.agent.enabled, true);
assert.equal(written.agent.mcp.servers.docs.type, 'http');

const switched = await fetch(`${base}/api/config`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    form: {
      ...saved.form,
      agent: { ...saved.form.agent, model: 'grok-4.5' }
    }
  })
}).then((res) => res.json());
assert.equal(switched.form.agent.model, 'grok-4.5');

const models = await fetch(`${base}/api/models`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ current: 'grok-4.5' })
}).then((res) => res.json());
assert.equal(models.source, 'cursor');
assert.ok(models.models.some((item) => item.id === 'grok-4.5'));

const page = await fetch(`${base}/`).then((res) => res.text());
assert.match(page, /AAFE 配置/);
assert.match(page, /刷新列表/);

server.close();
console.log('config ui tests passed');
