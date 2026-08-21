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

import { createRequire } from 'node:module';
import path from 'node:path';
import {
  combineEntryUrl,
  loadE2eConfig,
  NEED_BASE_URL_CODE,
  NEED_BASE_URL_PROMPT,
  NEED_URL_ROLE_CODE,
  NEED_URL_ROLE_PROMPT,
  pathsMatch
} from './config.js';
import { writeCompiledSpecs } from './compile.js';
import { buildReport, createRunId, writeUnifiedReport, EXIT_CODE } from './report.js';
import { listCases, parseCaseYaml } from './yaml.js';
import { readFile } from 'node:fs/promises';
import { NEED_AUTH_CODE, NEED_AUTH_PROMPT, prepareE2eAuth } from './auth.js';

const require = createRequire(import.meta.url);

export function detectPlaywright(root) {
  const roots = [root, process.cwd()];
  for (const base of roots) {
    for (const name of ['playwright', '@playwright/test']) {
      try {
        return { id: name, path: require.resolve(name, { paths: [base] }) };
      } catch {
        // continue
      }
    }
  }
  return null;
}

export async function executeE2eCases({
  root,
  cases = null,
  caseIds = null,
  dryRun = false,
  timeoutMs = 30000,
  baseUrl = null,
  urlRole = null,
  authMode = null,
  authEnv = null,
  storageState = null,
  interactive = Boolean(process.stdin.isTTY)
} = {}) {
  const config = await loadE2eConfig(root, null, { baseUrl, urlRole, authMode, authEnv, storageState });
  const runId = createRunId();
  const reportDir = path.join(config.reportDirAbs, runId);
  const startedAt = new Date().toISOString();

  if (!config.enabled) {
    const report = buildReport({
      runId,
      status: 'blocked',
      cases: [],
      startedAt,
      e2eExecuted: false,
      reason: 'E2E 未启用。运行 `aafe e2e enable`，或在 `aafe init` / `aafe update` 时选择启用。'
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return { ...paths, report: { ...report, reportDir }, exitCode: EXIT_CODE.blocked, config };
  }

  // One-shot URL: ask before matching cases or Playwright. Do not persist.
  if (!config.baseUrlConfigured) {
    const pending = cases ?? [];
    const report = buildReport({
      runId,
      status: 'blocked',
      cases: pending.map((item) => ({ id: item.id, title: item.title, status: 'blocked', message: NEED_BASE_URL_CODE })),
      startedAt,
      e2eExecuted: false,
      reason: NEED_BASE_URL_PROMPT,
      needInput: 'baseUrl',
      askUser: true,
      persistBaseUrl: false
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return {
      ...paths,
      report: { ...report, reportDir },
      exitCode: EXIT_CODE.blocked,
      config,
      needInput: 'baseUrl',
      askUser: true,
      prompt: NEED_BASE_URL_PROMPT,
      persistBaseUrl: false
    };
  }

  if (config.parsedPageUrl?.looksLikeTarget && !config.urlRole) {
    const pending = cases ?? [];
    const report = buildReport({
      runId,
      status: 'blocked',
      cases: pending.map((item) => ({ id: item.id, title: item.title, status: 'blocked', message: NEED_URL_ROLE_CODE })),
      startedAt,
      e2eExecuted: false,
      reason: NEED_URL_ROLE_PROMPT,
      needInput: 'urlRole',
      askUser: true,
      persistBaseUrl: false
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return {
      ...paths,
      report: { ...report, reportDir },
      exitCode: EXIT_CODE.blocked,
      config,
      needInput: 'urlRole',
      askUser: true,
      prompt: NEED_URL_ROLE_PROMPT,
      persistBaseUrl: false
    };
  }

  const loaded = selectCasesForUrlRole(
    cases ?? await loadSelectedCases(config.casesDirAbs, caseIds),
    config.parsedPageUrl,
    config.urlRole
  );
  await writeCompiledSpecs(config.specsDirAbs, loaded, {
    baseUrlEnv: config.baseUrlEnv,
    baseUrl: config.baseUrl,
    urlRole: config.urlRole,
    storageState: config.authStatePath
  });

  if (caseIds && Array.isArray(caseIds) && loaded.length === 0) {
    const report = buildReport({
      runId,
      status: 'uncertain',
      cases: [],
      startedAt,
      e2eExecuted: false,
      reason: 'no-matching-cases'
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return { ...paths, report: { ...report, reportDir }, exitCode: EXIT_CODE.uncertain, config };
  }

  const authEarly = await prepareE2eAuth({ config, interactive: false, probeOnly: true });
  if (authEarly.needInput && (config.authMode === 'reuse' || !interactive)) {
    return writeAuthBlocked(reportDir, {
      runId,
      startedAt,
      cases: loaded,
      config,
      prompt: authEarly.prompt
    });
  }

  if (dryRun) {
    const report = buildReport({
      runId,
      status: 'uncertain',
      cases: loaded.map((item) => ({ id: item.id, title: item.title, status: 'uncertain', message: 'dry-run' })),
      startedAt,
      e2eExecuted: false,
      reason: 'dry-run'
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return { ...paths, report: { ...report, reportDir }, exitCode: EXIT_CODE.uncertain, config };
  }

  const detected = detectPlaywright(root);
  if (!detected) {
    const report = buildReport({
      runId,
      status: 'blocked',
      cases: loaded.map((item) => ({ id: item.id, title: item.title, status: 'blocked', message: 'playwright-not-installed' })),
      startedAt,
      e2eExecuted: false,
      reason: '未检测到 playwright。请在项目中安装 playwright 或 @playwright/test 后再 --run。'
    });
    const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
    return { ...paths, report: { ...report, reportDir }, exitCode: EXIT_CODE.blocked, config };
  }

  if (config.authMode !== 'none') {
    const authPrep = await prepareE2eAuth({ config, interactive });
    if (authPrep.needInput) {
      return writeAuthBlocked(reportDir, {
        runId,
        startedAt,
        cases: loaded,
        config,
        prompt: authPrep.prompt
      });
    }
    config.storageState = authPrep.storageState ?? null;
  }

  const results = [];
  for (const testCase of loaded) {
    results.push(await runOneCase(testCase, { root, config, reportDir, timeoutMs }));
  }

  const report = buildReport({
    runId,
    cases: results,
    startedAt,
    e2eExecuted: true,
    artifacts: results.flatMap((item) => item.artifacts ?? [])
  });
  const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
  return { ...paths, report: { ...report, reportDir }, exitCode: EXIT_CODE[report.verdict] ?? 0, config };
}

async function loadSelectedCases(casesDir, caseIds) {
  const all = await listCases(casesDir);
  const wanted = caseIds?.length ? new Set(caseIds) : null;
  const selected = wanted ? all.filter((item) => wanted.has(item.id)) : all;
  const loaded = [];
  for (const item of selected) {
    if (item.steps?.length) {
      loaded.push(item);
      continue;
    }
    loaded.push(parseCaseYaml(await readFile(item.file, 'utf8')));
  }
  return loaded;
}

function selectCasesForUrlRole(cases, parsed, urlRole) {
  if (urlRole !== 'target' || !parsed) return cases;
  const targetPath = parsed.hashMode ? parsed.hashPath : parsed.pathname;
  if (!targetPath || targetPath === '/') return cases;
  const matched = cases.filter((item) => pathsMatch(item.entry?.path, targetPath));
  return matched.length ? matched : cases;
}

async function writeAuthBlocked(reportDir, { runId, startedAt, cases, config, prompt }) {
  const report = buildReport({
    runId,
    status: 'blocked',
    cases: cases.map((item) => ({ id: item.id, title: item.title, status: 'blocked', message: NEED_AUTH_CODE })),
    startedAt,
    e2eExecuted: false,
    reason: prompt ?? NEED_AUTH_PROMPT,
    needInput: 'auth',
    askUser: true,
    persistBaseUrl: false
  });
  const paths = await writeUnifiedReport(reportDir, { ...report, reportDir });
  return {
    ...paths,
    report: { ...report, reportDir },
    exitCode: EXIT_CODE.blocked,
    config,
    needInput: 'auth',
    askUser: true,
    prompt: prompt ?? NEED_AUTH_PROMPT,
    persistBaseUrl: false
  };
}

async function runOneCase(testCase, { config, reportDir, timeoutMs }) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { id: testCase.id, title: testCase.title, status: 'blocked', message: 'playwright-import-failed' };
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext(
    config.storageState ? { storageState: config.storageState } : {}
  );
  const page = await context.newPage();
  const consoleErrors = [];
  const httpErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    page.setDefaultTimeout(timeoutMs);
    for (const step of testCase.steps ?? []) {
      await runStep(page, step, testCase, config.baseUrl, config.urlRole);
    }
    const assertionResults = [];
    for (const assertion of testCase.assertions ?? []) {
      assertionResults.push(await evalAssertion(assertion, { consoleErrors, httpErrors, page }));
    }
    const failed = assertionResults.filter((item) => item.status !== 'passed');
    if (failed.some((item) => item.status === 'failed')) {
      const shot = path.join(reportDir, 'artifacts', `${testCase.id}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      return {
        id: testCase.id,
        title: testCase.title,
        status: 'failed',
        message: failed.map((item) => item.message).join('; '),
        assertionResults,
        artifacts: [{ kind: 'screenshot', path: shot }]
      };
    }
    return {
      id: testCase.id,
      title: testCase.title,
      status: 'passed',
      message: 'ok',
      assertionResults
    };
  } catch (error) {
    const shot = path.join(reportDir, 'artifacts', `${testCase.id}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return {
      id: testCase.id,
      title: testCase.title,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      artifacts: [{ kind: 'screenshot', path: shot }]
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function runStep(page, step, testCase, baseUrl, urlRole = null) {
  if (step.action === 'navigate') {
    const target = step.target === 'entry' || !step.target
      ? combineEntryUrl(baseUrl, testCase.entry?.path, { urlRole })
      : /^https?:\/\//i.test(step.target)
        ? step.target
        : combineEntryUrl(baseUrl, step.target, { urlRole });
    await page.goto(target, { waitUntil: 'load' });
    return;
  }
  if (step.action === 'wait') {
    if (step.target === 'visible' || step.target === 'hidden') {
      await page.locator(step.value || 'body').waitFor({ state: step.target });
      return;
    }
    const state = ['load', 'domcontentloaded', 'networkidle'].includes(step.target) ? step.target : 'load';
    await page.waitForLoadState(state);
    return;
  }
  if (step.action === 'tap') {
    await page.click(step.target);
    return;
  }
  if (step.action === 'input') {
    await page.fill(step.target, step.value ?? '');
  }
}

async function evalAssertion(assertion, { consoleErrors, httpErrors, page }) {
  if (assertion.check === 'console-no-errors') {
    const leftover = (assertion.tolerate ?? []).length
      ? consoleErrors.filter((item) => !(assertion.tolerate ?? []).some((pattern) => item.includes(pattern)))
      : consoleErrors;
    return leftover.length === 0
      ? { id: assertion.id, check: assertion.check, status: 'passed', message: 'ok' }
      : { id: assertion.id, check: assertion.check, status: 'failed', message: leftover.join('; ') };
  }
  if (assertion.check === 'network-no-http-errors') {
    const leftover = (assertion.tolerate ?? []).length
      ? httpErrors.filter((item) => !(assertion.tolerate ?? []).some((pattern) => item.includes(pattern)))
      : httpErrors;
    return leftover.length === 0
      ? { id: assertion.id, check: assertion.check, status: 'passed', message: 'ok' }
      : { id: assertion.id, check: assertion.check, status: 'failed', message: leftover.join('; ') };
  }
  if (assertion.check === 'dom-exists') {
    const selector = assertion.selector || 'body';
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    return visible
      ? { id: assertion.id, check: assertion.check, status: 'passed', message: 'ok' }
      : { id: assertion.id, check: assertion.check, status: 'failed', message: `missing ${selector}` };
  }
  return { id: assertion.id, check: assertion.check, status: 'uncertain', message: `unsupported-check:${assertion.check}` };
}
