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
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlatformArgs } from '../src/cli/platform.js';
import { buildPlaywrightInstallCommand, inspectPlaywrightSetup, parseE2eSetupArgs, patchE2eConfig } from '../src/cli/e2eSetup.js';
import { parseTestReport } from '../src/testing/reportParser.js';
import { compileCaseToSpec } from '../src/testing/e2e/compile.js';
import { expandSecretRef, isE2eEnabled, loadE2eConfig, sanitizeBaseUrl } from '../src/testing/e2e/config.js';
import { buildInventoryPack, writeInventoryCases } from '../src/testing/e2e/inventory.js';
import { planTestLayers, shouldRouteToUnitChain } from '../src/testing/e2e/layers.js';
import { INLINE_TOKEN_REJECTION, parsePrUrl, resolvePrToken } from '../src/testing/e2e/pr.js';
import { buildReport, createRunId, writeUnifiedReport } from '../src/testing/e2e/report.js';
import { executeE2eCases } from '../src/testing/e2e/runner.js';
import { parseCaseYaml, renderSmokeCase, isRealRoute } from '../src/testing/e2e/yaml.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aafeBin = path.join(repoRoot, 'bin/aafe.js');

const unitLayers = planTestLayers(['src/store/user.js', 'src/utils/format.ts']);
assert.equal(unitLayers.primary, 'unit');
assert.equal(shouldRouteToUnitChain(unitLayers), true);

const e2eLayers = planTestLayers(['src/views/UserList.vue', 'src/router/index.js']);
assert.equal(e2eLayers.primary, 'e2e');
assert.equal(shouldRouteToUnitChain(e2eLayers), false);

assert.equal(sanitizeBaseUrl('http://localhost:8080'), null);
assert.equal(sanitizeBaseUrl('https://example.test'), 'https://example.test');
assert.equal(expandSecretRef('${MY_TOKEN}', { MY_TOKEN: 'abc' }), 'abc');
assert.equal(expandSecretRef('${MISSING}', {}), null);

const loadedTokens = await loadE2eConfig(process.cwd(), {
  e2e: { githubAccessToken: 'secret-token', gongfengAccessToken: '${MISSING}', baseUrl: 'https://app.example' }
});
assert.equal(loadedTokens.githubAccessToken, undefined);
assert.equal(loadedTokens.gongfengAccessToken, undefined);
assert.equal(loadedTokens.githubAccessTokenConfigured, true);
assert.equal(loadedTokens.baseUrl, 'https://app.example');

const yaml = renderSmokeCase('SMOKE-001', '/users', { sourcePath: 'src/views/UserList.vue' });
assert.match(yaml, /engine: playwright/);
assert.doesNotMatch(yaml, /\b(REPLACE_\w+|TODO|PLACEHOLDER)\b/);
const parsed = parseCaseYaml(yaml);
assert.equal(parsed.entry.path, '/users');
assert.equal(isRealRoute('/users'), true);
assert.equal(isRealRoute('src/views/UserList.vue'), false);
assert.equal(isRealRoute('/package.json'), false);
assert.equal(isRealRoute('.ai-agent/memory'), false);
assert.ok(parsed.steps.some((step) => step.action === 'navigate'));

const spec = compileCaseToSpec(parsed);
assert.match(spec, /page\.goto/);
assert.match(spec, /console-no-errors/);
assert.match(spec, /from '@playwright\/test'/);

const github = parsePrUrl('https://github.com/acme/app/pull/12');
assert.equal(github.provider, 'github');
assert.equal(github.number, 12);
assert.equal(github.projectPath, 'acme/app');

const gongfeng = parsePrUrl('https://git.woa.com/group/proj/merge_requests/9');
assert.equal(gongfeng.provider, 'gongfeng');
assert.equal(gongfeng.number, 9);

assert.throws(
  () => resolvePrToken({ provider: 'github', inlineToken: 'secret' }),
  (error) => error.code === 'blocked' && String(error.message).includes('拒绝从命令行读取令牌')
);
assert.match(INLINE_TOKEN_REJECTION, /githubAccessToken/);
assert.match(INLINE_TOKEN_REJECTION, /gongfengAccessToken/);

assert.equal(
  resolvePrToken({ provider: 'github', env: {}, config: { githubAccessToken: 'ghp_from_config' } }).source,
  'config'
);
assert.equal(
  resolvePrToken({
    provider: 'github',
    env: { GITHUB_TOKEN: 'from-env' },
    config: { githubAccessToken: 'from-config' }
  }).token,
  'from-env'
);
assert.equal(
  resolvePrToken({
    provider: 'gongfeng',
    env: { MY_GF_TOKEN: 'gf-1' },
    config: { gongfengAccessToken: '${MY_GF_TOKEN}' }
  }).token,
  'gf-1'
);
assert.equal(
  resolvePrToken({ provider: 'github', env: {}, config: { githubAccessToken: '${GITHUB_TOKEN}' } }).token,
  null
);

const pendingPr = parsePlatformArgs(['--pr']);
assert.equal(pendingPr.prPending, true);
assert.equal(pendingPr.prUrl, undefined);

const tokenFlag = parsePlatformArgs(['--token=abc']);
assert.equal(tokenFlag.inlineToken, 'abc');

const fixture = {
  async exists() { return true; },
  async modulesIndex() { return [{ id: 'user' }]; },
  async getModule() {
    return {
      id: 'user',
      files: ['src/views/UserList.vue'],
      routes: [{ path: '/users', file: 'src/views/UserList.vue' }],
      features: [{ id: 'user-search', name: '用户搜索', entrypoints: ['/users'] }]
    };
  },
  async features() { return []; }
};

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-e2e-'));
try {
  const casesDir = path.join(tmp, 'tests/ui-ai/cases');
  const pack = await buildInventoryPack({ knowledge: fixture, root: tmp, casesDir });
  assert.equal(pack.ok, true);
  assert.ok(pack.routes.some((item) => item.path === '/users'));
  assert.ok(pack.suggestedChains.some((item) => item.kind === 'route' && item.entryHints[0] === '/users'));
  assert.ok(pack.suggestedChains.some((item) => item.kind === 'feature'));

  const written = await writeInventoryCases(pack, { casesDir, force: true });
  assert.ok(written.written.some((item) => item.id === 'SMOKE-001'));
  const onDisk = await readFile(path.join(casesDir, 'SMOKE-001.yaml'), 'utf8');
  assert.match(onDisk, /path: "\/users"/);

  const reportRoot = path.join(tmp, '.aafe/e2e/reports');
  const firstId = createRunId('e2e');
  const secondId = createRunId('e2e');
  assert.notEqual(firstId, secondId);
  const firstDir = path.join(reportRoot, firstId);
  const secondDir = path.join(reportRoot, secondId);
  const report = buildReport({
    runId: firstId,
    status: 'passed',
    cases: [{ id: 'SMOKE-001', title: '冒烟', status: 'passed' }],
    e2eExecuted: true
  });
  const first = await writeUnifiedReport(firstDir, { ...report, reportDir: firstDir });
  const second = await writeUnifiedReport(secondDir, {
    ...buildReport({ runId: secondId, status: 'blocked', cases: [{ id: 'SMOKE-001', status: 'blocked' }] }),
    reportDir: secondDir
  });
  assert.match(first.reportDir, /\.aafe\/e2e\/reports\//);
  assert.match(second.htmlPath, /index\.html$/);
  assert.notEqual(first.reportDir, second.reportDir);
  const parsedReport = parseTestReport(await readFile(first.jsonPath, 'utf8'));
  assert.ok(parsedReport.totals.total >= 1);

  const blockedRun = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    dryRun: false
  });
  assert.equal(blockedRun.report.verdict, 'blocked');
  assert.match(blockedRun.reportDir, /\.aafe\/e2e\/reports\//);
  assert.doesNotMatch(blockedRun.reportDir, /playwright-report|test-results|test\/ui/);

  const patched = await patchE2eConfig(tmp, { enabled: true });
  assert.equal(patched.enabled, true);
  const reloaded = await loadE2eConfig(tmp);
  assert.equal(reloaded.enabled, true);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const missingPr = spawnSync(process.execPath, [aafeBin, 'test', '--pr'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(missingPr.status, 3);
assert.match(missingPr.stderr, /缺少 PR 链接/);

const inlineToken = spawnSync(process.execPath, [aafeBin, 'test', '--token=should-not-leak'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(inlineToken.status, 3);
assert.match(inlineToken.stderr, /不要使用 --token/);
assert.doesNotMatch(inlineToken.stderr, /should-not-leak/);
assert.match(inlineToken.stderr, /githubAccessToken/);

assert.equal(isE2eEnabled({}), false);
assert.equal(isE2eEnabled({ enabled: true }), true);
assert.equal(parseE2eSetupArgs(['enable', '--yes']).subcommand, 'enable');
assert.equal(parseE2eSetupArgs(['enable', '--yes']).options.yes, true);
assert.deepEqual(buildPlaywrightInstallCommand('npm').args.slice(0, 2), ['install', '-D']);
const inspected = await inspectPlaywrightSetup(repoRoot);
assert.equal(typeof inspected.missing, 'boolean');

const e2eStatus = spawnSync(process.execPath, [aafeBin, 'e2e', 'status'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(e2eStatus.status, 0);
assert.match(e2eStatus.stdout, /"enabled": false/);

console.log('e2e platform tests passed');
