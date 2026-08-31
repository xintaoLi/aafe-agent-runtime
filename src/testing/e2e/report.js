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

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EXIT_CODE = Object.freeze({
  passed: 0,
  failed: 2,
  blocked: 3,
  uncertain: 4
});

export function createRunId(prefix = 'e2e') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function worstStatus(statuses) {
  const rank = { blocked: 3, failed: 2, uncertain: 1, passed: 0 };
  return statuses.reduce((worst, status) => (rank[status] > rank[worst] ? status : worst), 'passed');
}

export async function writeUnifiedReport(reportDir, report) {
  await mkdir(reportDir, { recursive: true });
  await mkdir(path.join(reportDir, 'artifacts'), { recursive: true });
  const jsonPath = path.join(reportDir, 'report.json');
  const htmlPath = path.join(reportDir, 'index.html');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderReportHtml(report), 'utf8');
  return { jsonPath, htmlPath, reportDir };
}

export function buildReport({
  runId,
  status,
  cases = [],
  startedAt,
  finishedAt = new Date().toISOString(),
  e2eExecuted = false,
  reason = null,
  artifacts = []
} = {}) {
  const totals = {
    total: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    blocked: cases.filter((item) => item.status === 'blocked').length,
    skipped: cases.filter((item) => item.status === 'uncertain' || item.status === 'skipped').length
  };
  const verdict = status ?? worstStatus(cases.map((item) => item.status).filter(Boolean));
  return {
    reportId: runId,
    verdict,
    status: verdict,
    statusReason: reason,
    executionKind: e2eExecuted ? 'e2e' : 'plan',
    e2eExecuted,
    e2ePassed: e2eExecuted && verdict === 'passed',
    startedAt: startedAt ?? finishedAt,
    finishedAt,
    totals,
    cases,
    artifacts,
    reportDir: null
  };
}

export function renderReportHtml(report) {
  const rows = (report.cases ?? []).map((item) => `<tr>
  <td>${escapeHtml(item.id)}</td>
  <td>${escapeHtml(item.title ?? '')}</td>
  <td>${escapeHtml(item.status)}</td>
  <td>${escapeHtml(item.message ?? '')}</td>
</tr>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>AAFE E2E ${escapeHtml(report.reportId)}</title>
  <style>
    body { font-family: sans-serif; margin: 24px; }
    .verdict { font-size: 1.4rem; font-weight: 700; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <p class="verdict">${escapeHtml(report.verdict)}</p>
  <p>${escapeHtml(report.statusReason ?? '')}</p>
  <p>executed=${report.e2eExecuted} passed=${report.totals?.passed ?? 0}/${report.totals?.total ?? 0}</p>
  <table>
    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Message</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
