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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBotArgs } from '../src/cli/bot.js';

assert.deepEqual(parseBotArgs(['start', '--wecom', '--root=/tmp/project', '--config=/tmp/bot.json', '--no-recover']), {
  bot: 'wecom', args: ['--root=/tmp/project', '--config=/tmp/bot.json', '--no-recover']
});
assert.deepEqual(parseBotArgs(['start', '--wecom', '--help']), { help: true });
for (const args of [['start'], ['stop', '--wecom'], ['start', '--slack'],
  ['start', '--wecom', '--slack'], ['start', '--wecom', '--wecom'], ['start', '--wecom', '--typo']]) {
  assert.throws(() => parseBotArgs(args));
}

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'aafe-cli-package-'));
try {
  // Test the actual publish artifact, not the source checkout where ai-bots
  // exists and hides eager imports. Never run publish/install lifecycle hooks.
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts',
    '--pack-destination', temp, '--cache', path.join(temp, 'npm-cache')], {
    cwd: root, timeout: 120000, maxBuffer: 12 * 1024 * 1024
  });
  const [pack] = JSON.parse(stdout);
  assert.ok(pack.files.some((file) => file.path === 'bin/aafe.js'));
  assert.ok(!pack.files.some((file) => file.path.startsWith('ai-bots/')));
  assert.ok(!pack.files.some((file) => /wecom\.local\.json|wecom\/logs/.test(file.path)));
  const project = path.join(temp, 'project');
  const installed = path.join(project, 'node_modules/@aafe/agent-runtime');
  await mkdir(installed, { recursive: true });
  await exec('tar', ['-xzf', path.join(temp, pack.filename), '--strip-components=1', '-C', installed]);
  await assert.rejects(access(path.join(installed, 'ai-bots')), { code: 'ENOENT' });
  // Reuse already-installed ordinary dependencies; no network install and no
  // symlink to the source package itself (that would hide missing Bot files).
  await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  const cli = path.join(installed, 'bin/aafe.js');
  const run = (args) => exec(process.execPath, [cli, ...args], {
    cwd: project, timeout: 30000, maxBuffer: 2 * 1024 * 1024
  });
  assert.match((await run(['help'])).stdout, /update\s+Refresh installed project/);
  assert.match((await run(['bot', '--help'])).stdout, /aafe bot start --wecom/);
  assert.match((await run(['bot', 'start', '--wecom', '--help'])).stdout, /可用 Bot/);
  const update = JSON.parse((await run(['update', '--dry-run', '--no-analyze'])).stdout);
  assert.equal(update.status, 'pass');
  assert.equal(update.mode, 'project-runtime');
  assert.equal(update.dryRun, true);
  assert.doesNotMatch((await run(['detect'])).stderr, /ERR_MODULE_NOT_FOUND/);
  const adapter = pathToFileURL(path.join(installed, 'src/cli/wecom.js')).href;
  await exec(process.execPath, ['--input-type=module', '-e',
    'const m = await import(' + JSON.stringify(adapter) + '); if (!m.parseWeComArgs(["--offline"]).offline) process.exit(1);'
  ], { cwd: project, timeout: 30000 });
  for (const args of [['wecom'], ['wecom', '--check-models', '--offline'],
    ['bot', 'start', '--wecom'], ['bot', 'start', '--wecom', '--check-models', '--offline']]) {
    await assert.rejects(run(args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /wecom-not-installed/);
      assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND|node:internal/);
      return true;
    });
  }
  console.log('CLI publish package isolation passed (actual npm pack, no WeCom, offline smoke tests)');
} finally {
  await rm(temp, { recursive: true, force: true });
}
