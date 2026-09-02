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
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlatformArgs } from '../src/cli/platform.js';
import {
  AAFE_TEST_FROM_PR_DESCRIPTION,
  aafeTestFromPrCursorSkill,
  aafeTestFromPrPointerRuleMdc,
  aafeTestFromPrSkillContent
} from '../src/cli/e2eFromPrRules.js';
import { collectUitestAdapterChanges, runMigrations } from '../src/cli/migrate.js';
import { buildPlaywrightInstallCommand, inspectPlaywrightSetup, parseE2eSetupArgs, patchE2eConfig } from '../src/cli/e2eSetup.js';
import { parseTestReport } from '../src/testing/reportParser.js';
import { compileCaseToSpec } from '../src/testing/e2e/compile.js';
import { expandSecretRef, isE2eEnabled, loadE2eConfig, sanitizeBaseUrl, combineEntryUrl, parseTestPageUrl, normalizeUrlRole, NEED_BASE_URL_CODE, NEED_BASE_URL_PROMPT, NEED_URL_ROLE_CODE } from '../src/testing/e2e/config.js';
import { normalizeAuthMode, resolveAuthStatePath, storageStateLooksValid, sessionLooksLoggedOut, accessAllowsSkipAuth, probeAnonymousAccess, prepareE2eAuth, NEED_AUTH_CODE } from '../src/testing/e2e/auth.js';
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

const hashPageUrl = 'http://appdev.paas3-dev.bktencent.com:8001/#/manage/clean-templates/list?bizId=2&spaceUid=bkcc__2';
assert.equal(sanitizeBaseUrl(hashPageUrl), hashPageUrl);
assert.equal(normalizeUrlRole('A'), 'target');
assert.equal(normalizeUrlRole('C'), 'template');
assert.equal(normalizeUrlRole('origin'), 'origin');
const parsedHash = parseTestPageUrl(hashPageUrl);
assert.equal(parsedHash.hashMode, true);
assert.equal(parsedHash.hashPath, '/manage/clean-templates/list');
assert.equal(parsedHash.query, 'bizId=2&spaceUid=bkcc__2');
assert.equal(parsedHash.appBase, 'http://appdev.paas3-dev.bktencent.com:8001');
assert.equal(parsedHash.looksLikeTarget, true);
assert.equal(
  combineEntryUrl(hashPageUrl, '/manage/clean-templates/create', { urlRole: 'template' }),
  'http://appdev.paas3-dev.bktencent.com:8001/#/manage/clean-templates/create?bizId=2&spaceUid=bkcc__2'
);
assert.equal(
  combineEntryUrl(hashPageUrl, '/manage/clean-templates/list', { urlRole: 'target' }),
  hashPageUrl
);
assert.equal(
  combineEntryUrl(hashPageUrl, '/manage-v2/client-log/list', { urlRole: 'origin' }),
  'http://appdev.paas3-dev.bktencent.com:8001/#/manage-v2/client-log/list'
);
assert.equal(
  combineEntryUrl('https://preview.example/app', '/users'),
  'https://preview.example/app/users'
);
assert.notEqual(
  combineEntryUrl(hashPageUrl, '/manage-v2/client-log/list', { urlRole: 'template' }),
  `${hashPageUrl}/manage-v2/client-log/list`
);

assert.equal(normalizeAuthMode('reuse-or-headed'), 'reuse-or-headed');
assert.equal(normalizeAuthMode('local'), 'reuse-or-headed');
assert.equal(normalizeAuthMode('headed'), 'headed');
assert.match(resolveAuthStatePath('/tmp/app', { stateDir: '.aafe/e2e/auth', env: 'dev' }), /dev\.json$/);
assert.equal(NEED_AUTH_CODE, 'need-auth');
assert.equal(sessionLooksLoggedOut('https://sso.example/login', 'https://app.example'), true);
assert.equal(sessionLooksLoggedOut('https://app.example/#/login', 'https://app.example'), true);
assert.equal(sessionLooksLoggedOut('https://app.example/#/manage/clean-templates/list', 'https://app.example'), false);
assert.equal(accessAllowsSkipAuth({
  status: 200,
  finalUrl: 'http://127.0.0.1:8001/#/manage/clean-templates/list',
  appOrigin: 'http://127.0.0.1:8001'
}), true);
assert.equal(accessAllowsSkipAuth({
  status: 200,
  finalUrl: 'https://sso.example/login',
  appOrigin: 'http://127.0.0.1:8001'
}), false);
assert.equal(accessAllowsSkipAuth({
  status: 502,
  finalUrl: 'http://127.0.0.1:8001/',
  appOrigin: 'http://127.0.0.1:8001'
}), false);
assert.equal(accessAllowsSkipAuth({
  status: 200,
  finalUrl: 'http://127.0.0.1:8001/#/login',
  appOrigin: 'http://127.0.0.1:8001'
}), false);

function listenStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

const openApp = await listenStub((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>ok</body></html>');
});
try {
  const anonymousOk = await probeAnonymousAccess({
    baseUrl: `${openApp.origin}/#/manage/clean-templates/list`,
    auth: { verifyTimeoutMs: 3000 }
  });
  assert.equal(anonymousOk.skipAuth, true);
  assert.equal(anonymousOk.status, 200);
  const skipped = await prepareE2eAuth({
    config: {
      authMode: 'reuse-or-headed',
      baseUrl: `${openApp.origin}/#/manage/clean-templates/list`,
      authStatePath: path.join(os.tmpdir(), 'aafe-missing-auth.json'),
      auth: { verifyTimeoutMs: 3000 }
    },
    interactive: false
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.storageState, null);
  assert.notEqual(skipped.needInput, 'auth');
} finally {
  await new Promise((resolve) => openApp.server.close(resolve));
}

const ssoApp = await listenStub((_req, res) => {
  res.writeHead(302, { Location: 'https://sso.example/login' });
  res.end();
});
try {
  const anonymousSso = await probeAnonymousAccess({
    baseUrl: `${ssoApp.origin}/#/manage/clean-templates/list`,
    auth: { verifyTimeoutMs: 3000 }
  });
  assert.equal(anonymousSso.skipAuth, false);
  assert.equal(anonymousSso.reason, 'login-redirect');
} finally {
  await new Promise((resolve) => ssoApp.server.close(resolve));
}

const loadedTokens = await loadE2eConfig(process.cwd(), {
  e2e: { githubAccessToken: 'secret-token', gongfengAccessToken: '${MISSING}', baseUrl: 'https://app.example' }
});
assert.equal(loadedTokens.githubAccessToken, undefined);
assert.equal(loadedTokens.gongfengAccessToken, undefined);
assert.equal(loadedTokens.githubAccessTokenConfigured, true);

const repoTokens = await loadE2eConfig(process.cwd(), {
  repo: { githubAccessToken: 'from-repo', gongfengAccessToken: '${MISSING}' },
  e2e: { baseUrl: 'https://app.example' }
});
assert.equal(repoTokens.githubAccessTokenConfigured, true);
assert.equal(repoTokens.gongfengAccessTokenConfigured, true);
assert.equal(loadedTokens.baseUrl, 'https://app.example');

const once = await loadE2eConfig(process.cwd(), { e2e: { baseUrl: null } }, { baseUrl: 'https://preview.example/app' });
assert.equal(once.baseUrl, 'https://preview.example/app');
assert.equal(once.baseUrlConfigured, true);
const rejectedOnce = await loadE2eConfig(process.cwd(), { e2e: {} }, { baseUrl: 'http://localhost:8080' });
assert.equal(rejectedOnce.baseUrlConfigured, false);

const baseUrlFlag = parsePlatformArgs(['--run', '--base-url=https://once.example']);
assert.equal(baseUrlFlag.run, true);
assert.equal(baseUrlFlag.baseUrl, 'https://once.example');
const urlRoleFlag = parsePlatformArgs(['--run', `--base-url=${hashPageUrl}`, '--url-role=C']);
assert.equal(urlRoleFlag.baseUrl, hashPageUrl);
assert.equal(urlRoleFlag.urlRole, 'C');
const authModeFlag = parsePlatformArgs(['--run', '--auth-mode=reuse-or-headed']);
assert.equal(authModeFlag.authMode, 'reuse-or-headed');

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
  resolvePrToken({ provider: 'github', env: {}, config: { repo: { githubAccessToken: 'ghp_from_repo' } } }).source,
  'config'
);
assert.equal(
  resolvePrToken({ provider: 'github', env: {}, config: { githubAccessToken: 'ghp_from_config' } }).source,
  'config'
);
assert.equal(
  resolvePrToken({
    provider: 'github',
    env: {},
    config: { repo: { githubAccessToken: 'from-repo' }, e2e: { githubAccessToken: 'from-e2e' } }
  }).token,
  'from-repo'
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
  assert.equal(blockedRun.needInput, 'baseUrl');
  assert.equal(blockedRun.askUser, true);
  assert.equal(blockedRun.persistBaseUrl, false);
  assert.match(blockedRun.prompt, /本次被测页面/);

  const blockedBeforeMatch = await executeE2eCases({
    root: tmp,
    caseIds: ['MISSING-001'],
    dryRun: false
  });
  assert.equal(blockedBeforeMatch.needInput, 'baseUrl');
  assert.equal(blockedBeforeMatch.askUser, true);
  assert.notEqual(blockedBeforeMatch.report?.statusReason, 'no-matching-cases');
  assert.match(blockedRun.reportDir, /\.aafe\/e2e\/reports\//);
  assert.doesNotMatch(blockedRun.reportDir, /playwright-report|test-results|test\/ui/);

  const defaultAuth = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: 'https://preview.example/app',
    interactive: false
  });
  assert.notEqual(defaultAuth.needInput, 'baseUrl');
  if (defaultAuth.needInput) assert.equal(defaultAuth.needInput, 'auth');

  const withUrl = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: 'https://preview.example/app',
    authMode: 'none'
  });
  assert.notEqual(withUrl.needInput, 'baseUrl');
  assert.notEqual(withUrl.needInput, 'auth');

  const hashNeedsRole = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: hashPageUrl
  });
  assert.equal(hashNeedsRole.needInput, 'urlRole');
  assert.equal(hashNeedsRole.askUser, true);
  assert.match(hashNeedsRole.prompt, /A\. 是目标页面/);
  assert.equal(NEED_URL_ROLE_CODE, 'need-url-role');

  const hashWithRole = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: hashPageUrl,
    urlRole: 'C',
    authMode: 'none',
    dryRun: true
  });
  assert.notEqual(hashWithRole.needInput, 'urlRole');
  assert.notEqual(hashWithRole.needInput, 'baseUrl');

  const authMissing = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: 'https://preview.example/app',
    authMode: 'reuse',
    interactive: false
  });
  assert.equal(authMissing.needInput, 'auth');
  assert.equal(authMissing.askUser, true);

  const authFile = path.join(tmp, '.aafe/e2e/auth/default.json');
  await mkdir(path.dirname(authFile), { recursive: true });
  await writeFile(authFile, JSON.stringify({ cookies: [{ name: 'sid', value: '1', domain: 'preview.example', path: '/' }], origins: [] }));
  assert.equal(await storageStateLooksValid(authFile), true);
  const authReuse = await executeE2eCases({
    root: tmp,
    cases: [parsed],
    baseUrl: 'https://preview.example/app',
    authMode: 'reuse',
    interactive: false,
    dryRun: true
  });
  assert.notEqual(authReuse.needInput, 'auth');

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

assert.equal(isE2eEnabled({}), true);
assert.equal(isE2eEnabled({ enabled: true }), true);
assert.equal(isE2eEnabled({ enabled: false }), false);
assert.equal(parseE2eSetupArgs(['enable', '--yes']).subcommand, 'enable');
assert.equal(parseE2eSetupArgs(['enable', '--yes']).options.yes, true);
assert.equal(parseE2eSetupArgs(['auth', '--base-url=https://x.example']).subcommand, 'auth');
assert.deepEqual(buildPlaywrightInstallCommand('npm').args.slice(0, 2), ['install', '-D']);
const inspected = await inspectPlaywrightSetup(repoRoot);
assert.equal(typeof inspected.missing, 'boolean');

const e2eStatus = spawnSync(process.execPath, [aafeBin, 'e2e', 'status'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(e2eStatus.status, 0);
assert.match(e2eStatus.stdout, /"enabled": true/);

assert.match(AAFE_TEST_FROM_PR_DESCRIPTION, /分析此PR/);
assert.match(AAFE_TEST_FROM_PR_DESCRIPTION, /aafe test --pr/);
assert.match(AAFE_TEST_FROM_PR_DESCRIPTION, /禁止安装或调用 uitest/);
const fromPrSkill = aafeTestFromPrSkillContent('.ai-agent');
assert.match(fromPrSkill, /等待用户输入本次测试地址/);
assert.match(fromPrSkill, /url-role/);
assert.match(fromPrSkill, /needInput: "urlRole"/);
assert.match(fromPrSkill, /aafe e2e auth/);
assert.match(fromPrSkill, /needInput: "auth"/);
assert.match(aafeTestFromPrCursorSkill(), /wait/);
assert.match(NEED_BASE_URL_PROMPT, /--base-url=/);
assert.equal(NEED_BASE_URL_CODE, 'need-base-url');
assert.doesNotMatch(fromPrSkill, /npm i(?:nstall)?[^\n]*uitest|请安装 uitest/);
assert.match(aafeTestFromPrCursorSkill(), /name: aafe-test-from-pr/);
assert.match(aafeTestFromPrCursorSkill(), /禁止安装或调用 uitest/);
assert.match(aafeTestFromPrPointerRuleMdc(), /alwaysApply: false/);
assert.doesNotMatch(aafeTestFromPrPointerRuleMdc(), /请安装 uitest|npm i(?:nstall)?[^\n]*uitest/);

const leftoverRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-uitest-'));
try {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.join(leftoverRoot, '.cursor/skills/bklog-web/ai-ui-test'), { recursive: true });
  await writeFile(path.join(leftoverRoot, '.cursor/skills/bklog-web/ai-ui-test/SKILL.md'), 'npx uitest from-pr\n');
  await mkdir(path.join(leftoverRoot, '.cursor/rules/bklog-web'), { recursive: true });
  await writeFile(path.join(leftoverRoot, '.cursor/rules/bklog-web/uitest-from-pr.mdc'), 'npx uitest from-pr\n');
  const leftovers = await collectUitestAdapterChanges(leftoverRoot);
  assert.equal(leftovers.length, 2);
  const migrated = await runMigrations(leftoverRoot);
  assert.ok(migrated.migrations.some((entry) => entry.id === 'retire-uitest-cursor-adapters'));
  assert.equal((await collectUitestAdapterChanges(leftoverRoot)).length, 0);
} finally {
  await rm(leftoverRoot, { recursive: true, force: true });
}

console.log('e2e platform tests passed');
