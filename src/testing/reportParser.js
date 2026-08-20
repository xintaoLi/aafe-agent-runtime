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

/**
 * Normalizes test output from the runners AAFE knows about into one shape, so
 * A4 can diagnose a failure without caring which runner produced it.
 *
 * Plain console output is supported as the fallback because that is what a
 * developer actually has on hand when a CI job fails; requiring a JSON
 * reporter to be configured first would make diagnosis useless exactly when
 * it is needed.
 *
 * @typedef NormalizedFailure
 * @property {string} title
 * @property {string} [file]
 * @property {string} [suite]
 * @property {string} message
 * @property {string} [stack]
 * @property {number} [durationMs]
 * @property {{trace?:string,screenshot?:string,video?:string}} [artifacts]
 *
 * @typedef NormalizedReport
 * @property {'playwright'|'jest'|'vitest'|'text'|'unknown'} format
 * @property {'passed'|'failed'|'unknown'} status
 * @property {{total:number,passed:number,failed:number,skipped:number}} totals
 * @property {NormalizedFailure[]} failures
 */

export async function parseReportFile(file) {
  const text = await readFile(file, 'utf8');
  return { ...parseTestReport(text), source: file };
}

/**
 * @param {string} text raw stdout, or the contents of a JSON report
 * @returns {NormalizedReport}
 */
export function parseTestReport(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return emptyReport('unknown');

  const json = tryJson(raw);
  if (json) {
    if (json.verdict && (json.reportId || json.cases)) return parseAafeE2e(json);
    if (Array.isArray(json.suites) || json.config?.projects) return parsePlaywright(json);
    if (Array.isArray(json.testResults)) return parseJest(json);
    if (json.testResults || json.numTotalTests !== undefined) return parseJest(json);
  }
  return parseText(raw);
}

function parseAafeE2e(json) {
  const cases = json.cases ?? [];
  const failures = cases
    .filter((item) => item.status === 'failed')
    .map((item) => ({
      title: item.title ?? item.id,
      message: item.message ?? item.status,
      artifacts: item.artifacts ? { screenshot: item.artifacts.find((art) => art.kind === 'screenshot')?.path } : undefined
    }));
  const totals = json.totals ?? {
    total: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: failures.length,
    skipped: cases.filter((item) => item.status === 'blocked' || item.status === 'uncertain').length
  };
  return {
    format: 'playwright',
    status: json.verdict === 'passed' ? 'passed' : 'failed',
    totals,
    failures
  };
}

/* ------------------------------------------------------------------ */
/* Playwright JSON reporter                                            */
/* ------------------------------------------------------------------ */

function parsePlaywright(json) {
  const failures = [];
  const totals = { total: 0, passed: 0, failed: 0, skipped: 0 };

  const walk = (suite, trail) => {
    const path = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      totals.total += 1;
      const failedTest = (spec.tests ?? []).find((test) => test.status !== 'expected' && test.status !== 'skipped');
      if ((spec.tests ?? []).every((test) => test.status === 'skipped')) {
        totals.skipped += 1;
        continue;
      }
      if (!failedTest || spec.ok) {
        totals.passed += 1;
        continue;
      }
      totals.failed += 1;

      const result = (failedTest.results ?? []).at(-1) ?? {};
      failures.push({
        title: [...path, spec.title].filter(Boolean).join(' › '),
        file: spec.file ?? suite.file,
        suite: path.join(' › ') || undefined,
        message: cleanAnsi(result.error?.message ?? failedTest.status ?? 'failed'),
        stack: cleanAnsi(result.error?.stack ?? ''),
        durationMs: result.duration,
        artifacts: collectPlaywrightArtifacts(result)
      });
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };

  for (const suite of json.suites ?? []) walk(suite, []);

  return {
    format: 'playwright',
    status: totals.failed > 0 ? 'failed' : 'passed',
    totals,
    failures
  };
}

function collectPlaywrightArtifacts(result) {
  const artifacts = {};
  for (const attachment of result.attachments ?? []) {
    if (!attachment?.path) continue;
    if (attachment.name === 'trace') artifacts.trace = attachment.path;
    else if (attachment.name === 'screenshot') artifacts.screenshot = attachment.path;
    else if (attachment.name === 'video') artifacts.video = attachment.path;
  }
  return Object.keys(artifacts).length > 0 ? artifacts : undefined;
}

/* ------------------------------------------------------------------ */
/* Jest / Vitest JSON reporter (same schema)                           */
/* ------------------------------------------------------------------ */

function parseJest(json) {
  const failures = [];
  for (const suite of json.testResults ?? []) {
    const file = suite.name ?? suite.testFilePath;
    // A suite that dies while loading has no assertion results at all.
    if (suite.status === 'failed' && (suite.assertionResults ?? []).length === 0 && suite.message) {
      failures.push({
        title: file ?? 'suite',
        file,
        message: cleanAnsi(firstLine(suite.message)),
        stack: cleanAnsi(suite.message)
      });
    }
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      const detail = (assertion.failureMessages ?? []).join('\n');
      failures.push({
        title: assertion.fullName ?? assertion.title,
        file,
        suite: (assertion.ancestorTitles ?? []).join(' › ') || undefined,
        message: cleanAnsi(firstLine(detail) || assertion.title),
        stack: cleanAnsi(detail),
        durationMs: assertion.duration ?? undefined
      });
    }
  }

  const totals = {
    total: json.numTotalTests ?? failures.length,
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? failures.length,
    skipped: json.numPendingTests ?? 0
  };

  return {
    format: json.testResults?.[0]?.assertionResults ? 'jest' : 'vitest',
    status: totals.failed > 0 ? 'failed' : 'passed',
    totals,
    failures
  };
}

/* ------------------------------------------------------------------ */
/* Plain console output                                                */
/* ------------------------------------------------------------------ */

const FAILURE_LINE = /^\s*(?:[✕✗×]|FAIL|●|✘|not ok\b|\d+\)\s)/;
// `FAIL src/cart.test.js` is a file banner, not a failing case: the cases
// themselves follow on their own lines and would otherwise be double counted.
const FILE_BANNER = /^\s*FAIL\s+(\S+\.(?:js|jsx|ts|tsx|vue|mjs|cjs|svelte))\s*$/;
const SUMMARY = /Tests?:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+total)?/i;

function parseText(raw) {
  const lines = raw.split(/\r?\n/);
  const failures = [];
  let currentFile = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanAnsi(lines[index]);

    const banner = line.match(FILE_BANNER);
    if (banner) {
      currentFile = banner[1];
      continue;
    }
    if (!FAILURE_LINE.test(line)) continue;

    // Keep the following lines until the next blank-separated block; that is
    // where runners put the assertion diff and the stack.
    const block = [];
    for (let cursor = index + 1; cursor < lines.length && block.length < 30; cursor += 1) {
      const next = cleanAnsi(lines[cursor]);
      if (FAILURE_LINE.test(next)) break;
      block.push(next);
    }

    const title = line.replace(FAILURE_LINE, '').trim();
    const stack = block.filter((item) => /\s+at\s|\.(js|ts|jsx|tsx|vue|mjs|cjs):\d+/.test(item)).join('\n');
    failures.push({
      title: title || 'unnamed failure',
      file: firstFileRef(line) ?? currentFile ?? firstFileRef(block.join('\n')) ?? undefined,
      message: block.find((item) => item.trim()) ?? title,
      stack: stack || undefined
    });
  }

  const summary = raw.match(SUMMARY);
  const totals = summary
    ? {
      total: Number(summary[4] ?? 0) || failures.length,
      passed: Number(summary[2] ?? 0),
      failed: Number(summary[1] ?? 0) || failures.length,
      skipped: Number(summary[3] ?? 0)
    }
    : { total: failures.length, passed: 0, failed: failures.length, skipped: 0 };

  return {
    format: 'text',
    status: failures.length > 0 || totals.failed > 0 ? 'failed' : 'passed',
    totals,
    failures
  };
}

/* ------------------------------------------------------------------ */

const FILE_REF = /(?:^|[\s(])((?:[.\w-]+\/)*[\w.-]+\.(?:js|jsx|ts|tsx|vue|mjs|cjs|svelte))(?::(\d+))?(?::(\d+))?/;

export function firstFileRef(text) {
  const match = String(text ?? '').match(FILE_REF);
  return match ? match[1] : null;
}

/**
 * All file references in a stack, in order, deduplicated. Order matters: the
 * frame closest to the throw site is the best root-cause candidate.
 */
export function stackFileRefs(text) {
  const seen = new Set();
  const refs = [];
  const pattern = new RegExp(FILE_REF.source, 'g');
  for (const match of String(text ?? '').matchAll(pattern)) {
    const file = match[1];
    if (seen.has(file)) continue;
    seen.add(file);
    refs.push({ file, line: match[2] ? Number(match[2]) : null });
  }
  return refs;
}

function emptyReport(format) {
  return { format, status: 'unknown', totals: { total: 0, passed: 0, failed: 0, skipped: 0 }, failures: [] };
}

function tryJson(raw) {
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

function cleanAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

function firstLine(text) {
  return String(text ?? '').split(/\r?\n/).find((line) => line.trim()) ?? '';
}
