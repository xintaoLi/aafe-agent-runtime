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
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withGithubGitAuthEnv } from '../src/cli/repoConfig.js';

const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-git-auth-'));
const token = 'fixture-github-token-not-a-real-secret';
const seen = [];
const pkt = (line) => (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line;
// Minimal Git smart HTTP discovery response; ls-remote does not fetch objects.
const advertisement = pkt('# service=git-upload-pack\n') + '0000'
  + pkt('a'.repeat(40) + ' refs/heads/master\0agent=aafe-test\n') + '0000';
const server = createServer((req, res) => {
  const authorization = req.headers.authorization ?? '';
  const basic = authorization.match(/^Basic (.+)$/i);
  // Verify decoded wire credentials independently of the implementation.
  const accepted = basic && Buffer.from(basic[1], 'base64').toString('utf8')
    === 'x-access-token:' + token;
  seen.push({ authorization, accepted: Boolean(accepted) });
  if (!accepted) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="AAFE fixture"' });
    res.end('Authentication required');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement' });
  res.end(advertisement);
});
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/fixture.git';
  const clean = {
    PATH: process.env.PATH, HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: ''
  };
  const generated = withGithubGitAuthEnv({ repo: { githubAccessToken: token } }, clean);
  const args = ['-c', 'credential.helper=', '-c', 'protocol.version=0',
    'ls-remote', '--exit-code', '--heads', url, 'master'];
  const probe = (env) => exec('git', args, { cwd: root, env, timeout: 10000 });

  // github.com-scoped credentials must never be sent to unrelated hosts.
  await assert.rejects(() => probe(generated));
  assert.ok(seen.length > 0);
  assert.ok(seen.every((request) => request.authorization === ''));

  // Point the generated config key only at our loopback fixture for the wire test.
  const scoped = { ...generated, GIT_CONFIG_KEY_0: 'http.' + url + '.extraheader' };
  const boundary = seen.length;
  const result = await probe(scoped);
  assert.match(result.stdout, /refs\/heads\/master/);
  assert.ok(seen.slice(boundary).every((request) => request.accepted));

  // The old Bearer implementation must fail the same Git endpoint.
  await assert.rejects(() => probe({ ...scoped, GIT_CONFIG_VALUE_0: 'AUTHORIZATION: bearer ' + token }));
  assert.ok(!seen.at(-1).accepted);
  assert.ok(!JSON.stringify(args).includes(token));
  assert.ok(!JSON.stringify(args).includes(Buffer.from('x-access-token:' + token).toString('base64')));
  assert.equal(generated.GIT_CONFIG_COUNT, '1');
  console.log('git HTTPS auth tests passed (real Git + loopback HTTP, fixture token only)');
} finally {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
}
