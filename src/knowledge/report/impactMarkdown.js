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

/**
 * Human-readable rendering of an ImpactReport, for `aafe impact --format=md`.
 *
 * The JSON form is for machines; this one is meant to be pasted into a review,
 * a TAPD comment or a PR description, so every claim carries its evidence and
 * the report says plainly that it is a prediction, not a test result.
 */

const SECTIONS = Object.freeze([
  ['affectedModules', '模块'],
  ['affectedFeatures', '功能'],
  ['affectedFiles', '文件'],
  ['affectedDataFlows', '数据流'],
  ['affectedBusinessFlows', '业务流程']
]);

const RISK_LABEL = Object.freeze({ low: '低', medium: '中', high: '高' });

/**
 * @param {object} task     The task the report answers.
 * @param {object} impact   ImpactReport.
 * @param {object} [options]
 * @param {number} [options.limit] Max items rendered per section.
 * @returns {string} Markdown, newline-terminated.
 */
export function renderImpactMarkdown(task = {}, impact = {}, { limit = 20 } = {}) {
  const lines = [];
  const risk = impact.risk ?? 'low';

  lines.push('# 影响分析');
  lines.push('');
  lines.push(`- 任务：${task.goal ?? task.requirement ?? '(未指定)'}`);
  lines.push(`- 来源：${impact.source ?? task.kind ?? 'requirement'}${task.diffRef ? ` (${task.diffRef})` : ''}`);
  lines.push(`- 风险：${RISK_LABEL[risk] ?? risk} (${risk})`);
  lines.push(`- 置信度：${formatConfidence(impact.confidence)}`);
  lines.push('');

  const totals = SECTIONS
    .map(([key, label]) => `${label} ${(impact[key] ?? []).length}`)
    .join(' · ');
  lines.push(`> 影响面：${totals}`);
  lines.push('');

  for (const [key, label] of SECTIONS) {
    const items = impact[key] ?? [];
    if (items.length === 0) continue;
    lines.push(`## 受影响${label} (${items.length})`);
    lines.push('');
    for (const item of items.slice(0, limit)) {
      lines.push(renderItem(item));
    }
    if (items.length > limit) lines.push(`- …其余 ${items.length - limit} 项见 JSON 输出`);
    lines.push('');
  }

  const tests = impact.affectedTests ?? [];
  lines.push(`## 关联测试 (${tests.length})`);
  lines.push('');
  if (tests.length === 0) {
    lines.push('- 未在知识库中找到覆盖上述范围的既有测试，需要新增。');
  } else {
    for (const test of tests.slice(0, limit)) lines.push(`- \`${test}\``);
    if (tests.length > limit) lines.push(`- …其余 ${tests.length - limit} 项见 JSON 输出`);
  }
  lines.push('');

  if (Array.isArray(impact.rejected) && impact.rejected.length > 0) {
    lines.push(`## 已被校验驳回 (${impact.rejected.length})`);
    lines.push('');
    for (const item of impact.rejected.slice(0, limit)) {
      lines.push(`- ${item.id ?? item.label ?? '(未知)'}：${item.reason ?? '证据不足'}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('本报告是基于静态知识库的**预测基线**，不代表测试已执行或通过。落地后需按实际 diff 复核。');
  lines.push('');
  return lines.join('\n');
}

function renderItem(item) {
  const head = `- **${item.label ?? item.id ?? '(未命名)'}**`;
  const score = Number.isFinite(item.score) ? ` \`${item.score}\`` : '';
  const why = item.why ? ` — ${item.why}` : '';
  const evidence = formatEvidence(item.evidence);
  return `${head}${score}${why}${evidence}`;
}

/**
 * Evidence is inlined rather than footnoted: an impact claim the reader cannot
 * check in place is one they will either trust blindly or ignore.
 */
function formatEvidence(evidence) {
  const refs = (Array.isArray(evidence) ? evidence : [])
    .map(evidenceRef)
    .filter(Boolean)
    .slice(0, 3);
  return refs.length === 0 ? '' : `\n  - 证据：${refs.join('；')}`;
}

function evidenceRef(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const location = entry.location ?? entry;
  const file = location.file ?? location.path ?? null;
  if (!file) return entry.detail ?? entry.symbol ?? null;
  const line = location.startLine ?? location.line ?? null;
  const symbol = location.symbol ?? entry.symbol ?? null;
  return `\`${file}${line ? `:${line}` : ''}\`${symbol ? ` (${symbol})` : ''}`;
}

function formatConfidence(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '未知';
}
