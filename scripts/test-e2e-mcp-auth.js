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
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadE2eConfig } from '../src/testing/e2e/config.js';
import { resolveTokenMcp, extractLoginCookie, getLoginCookie, prepareTokenAuth } from '../src/testing/e2e/mcpAuth.js';
import { executeE2eCases } from '../src/testing/e2e/runner.js';
import { withE2eConfigRoots } from '../src/testing/e2e/configContext.js';
import { prepareE2eAuth, saveAuthState } from '../src/testing/e2e/auth.js';
import { buildE2ePromptSection } from '../src/agent-platform/tasks/TaskManager.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-mcp-auth-'));
const cookie = 'fake%24token%3D_exact';
let calls = 0, rejectCookie = false, publicPage = false, toolError = false;
const server = http.createServer(async (req, res) => {
  if (req.url === '/mcp' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    assert.equal(req.headers['x-cookie-provider-token'], 'fake-provider');
    let result;
    if (message.method === 'initialize') result = {
      protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'test', version: '1' }
    };
    if (message.method === 'tools/list') result = {
      tools: [{ name: 'get_login_cookie', inputSchema: { type: 'object', properties: {} } }]
    };
    if (message.method === 'tools/call') {
      calls++;
      assert.deepEqual(message.params, { name: 'get_login_cookie', arguments: {} });
      result = toolError ? { isError: true, content: [{ type: 'text', text: cookie }] }
        : { structuredContent: { cookies: { bk_token: cookie } }, content: [] };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    return;
  }
  if (req.url === '/mcp') { res.writeHead(405).end(); return; }
  const authorized = publicPage || (!rejectCookie && req.headers.cookie === 'bk_token=' + cookie);
  if (!authorized) {
    if (req.url === '/login') res.writeHead(200, { 'content-type': 'text/html' }).end('login');
    else res.writeHead(302, { location: '/login' }).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end('<div id="ready">Authenticated</div>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const project = {
  agent: { mcp: { enabled: true, servers: {
    git_code_get_token: { url: origin + '/mcp', headers: { 'X-Cookie-Provider-Token': 'fake-provider' } }
  } } },
  e2e: { auth: { readySelector: '#ready', verifyTimeoutMs: 1000 } }
};
const save = () => writeFile(path.join(root, '.aafe.config.json'), JSON.stringify(project));
try {
  await save();
  const config = await loadE2eConfig(root, null, { baseUrl: origin + '/app', urlRole: 'target' });
  const selected = await resolveTokenMcp(config);
  assert.ok(selected);
  assert.equal(await getLoginCookie(selected, root), cookie);
  assert.equal(calls, 1);
  assert.equal(extractLoginCookie({ content: [{ type: 'text', text: JSON.stringify({ cookies: { bk_token: cookie } }) }] }), cookie);
  assert.throws(() => extractLoginCookie({ structuredContent: { cookies: { bk_token: 'bad\n' } } }));
  const noCheck = await prepareTokenAuth({ ...config, auth: {} }, selected, {
    acquire: async () => cookie,
    verify: async () => true
  });
  assert.equal(noCheck.mode, 'mcp');
  assert.equal(noCheck.verified, true);
  project.agent.mcp.servers.git_code_get_token.enabled = false;
  await save();
  assert.equal(await resolveTokenMcp(config), null);
  project.agent.mcp.servers.git_code_get_token.enabled = true;
  project.agent.mcp.enabled = false;
  await save();
  assert.equal(await resolveTokenMcp(config), null);
  project.agent.mcp.enabled = true;
  await save();

  const worktree = path.join(root, 'worktree');
  await mkdir(worktree);
  const configArgs = ['--config-root=' + root, '--mcp-config-root=' + root];
  await Promise.all([withE2eConfigRoots(worktree, configArgs, async () => {
    const isolated = await loadE2eConfig(worktree);
    assert.equal(isolated.configRoot, root);
    assert.equal(isolated.casesDirAbs, path.join(worktree, 'tests/ui-ai/cases'));
    assert.equal(isolated.authStatePath, config.authStatePath);
    assert.ok(await resolveTokenMcp(isolated));
  }), withE2eConfigRoots(worktree, [], async () => {
    const isolated = await loadE2eConfig(worktree);
    assert.equal(await resolveTokenMcp(isolated), null, 'parallel scopes do not share config');
  })]);
  await withE2eConfigRoots(worktree, ['--mcp-config-root=' + root], async () => {
    assert.ok(await resolveTokenMcp(await loadE2eConfig(worktree)), 'Bot MCP fallback works without worktree config');
  });
  const prompt = buildE2ePromptSection({ workspace: { cwd: root } }, { mode: 'local' }, root, { cwd: worktree });
  assert.ok(prompt.includes('--config-root=' + root));
  assert.ok(prompt.includes('--mcp-config-root=' + root));
  assert.ok(prompt.includes('bin/aafe.js'));
  assert.ok(prompt.includes('task worktree still needs an AAFE wrapper'));
  assert.ok(prompt.includes('must not become a waiting-user approval'));
  assert.equal(buildE2ePromptSection({ workspace: {} }, { mode: 'cloud' }, root, { cwd: worktree }), '');

  // Presence of a local cache must not preempt a configured MCP.
  const state = (value) => ({ cookies: [{ name: 'bk_token', value, domain: '127.0.0.1', path: '/',
    expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] });
  await saveAuthState({ storageState: async () => state('old-cookie') }, config.authStatePath);

  const cases = ['ONE', 'TWO'].map((id) => ({
    id, title: id, entry: { path: '/app' },
    steps: [{ action: 'navigate', target: 'entry' }],
    assertions: [{ id: 'network', check: 'network-no-http-errors' }]
  }));
  const run = (extra = {}) => executeE2eCases({
    root, cases, baseUrl: origin + '/app', urlRole: 'target', interactive: false, ...extra
  });
  calls = 0;
  const success = await run();
  assert.equal(success.report.verdict, 'passed');
  assert.equal(success.report.totals.passed, 2);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(success).includes(cookie));
  publicPage = true;
  await run();
  assert.equal(calls, 2, 'configured Get Token MCP remains authoritative for a local HTTP 200 shell');
  publicPage = false;
  const dry = await run({ dryRun: true });
  assert.equal(dry.report.e2eExecuted, false);
  assert.equal(calls, 2, 'dry-run never calls GetToken');
  rejectCookie = true;
  const failed = await run();
  assert.equal(failed.needInput, 'auth');
  assert.equal(failed.report.e2eExecuted, false);
  assert.equal(calls, 3, 'failed verification does not retry');
  rejectCookie = false;
  toolError = true;
  const error = await run();
  assert.equal(error.needInput, 'auth');
  assert.ok(!JSON.stringify(error).includes(cookie));
  assert.equal(calls, 4, 'tool error does not retry');
  const inspectFiles = async (dir) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await inspectFiles(file);
      else assert.ok(!(await readFile(file, 'utf8')).includes(cookie), 'Cookie persisted to ' + file);
    }
  };
  await inspectFiles(root);

  // Without MCP, use a verified local cache. Expiry requests authorization in
  // a headless Bot; saving authorized state is atomic and owner-readable only.
  project.agent.mcp.servers = {};
  await save();
  await saveAuthState({ storageState: async () => state(cookie) }, config.authStatePath);
  assert.equal((await stat(config.authStatePath)).mode & 0o777, 0o600);
  const reused = await prepareE2eAuth({ config, interactive: false });
  assert.equal(reused.reused, true);
  assert.equal(calls, 4);
  rejectCookie = true;
  const expired = await prepareE2eAuth({ config, interactive: false });
  assert.equal(expired.needInput, 'auth');
  assert.equal(calls, 4);
  assert.equal((await stat(config.authStatePath)).mode & 0o777, 0o600);
  console.log('MCP E2E authentication passed: local MCP + real Chromium, single acquisition, verification, isolation and no Cookie persistence');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
