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
 * Renders an AgentContextPackage for consumption by an IDE agent.
 *
 * `ai` is the plain-text form from RFC §23 — the thing Cursor / Claude Code /
 * Codex actually read. `json` is the machine form from RFC §26. `md` is for
 * humans reviewing what the agent was told.
 */
export function renderContextPackage(pkg, format = 'ai') {
  if (format === 'json') return `${JSON.stringify(pkg, null, 2)}\n`;
  if (format === 'md') return renderMarkdown(pkg);
  return renderAi(pkg);
}

export const CONTEXT_FORMATS = Object.freeze(['ai', 'json', 'md']);

function renderAi(pkg) {
  const lines = ['AAFE Task Context', '=================', ''];

  lines.push('Task:', indent(pkg.task?.goal || '(no goal given)'), '');
  if (pkg.task?.requirement) lines.push('Requirement:', indent(pkg.task.requirement), '');
  if (pkg.task?.diffRef) lines.push('Diff:', indent(pkg.task.diffRef), '');

  lines.push(`Risk: ${pkg.risk ?? 'unknown'}   Confidence: ${pkg.confidence ?? 0}`, '');

  // The diagnosis goes above the impact map: when a test is failing, the
  // located root cause is the thing to act on, not the blast radius.
  if (pkg.failure) lines.push(...failureSection(pkg.failure));

  lines.push(...section('Affected Modules', (pkg.affectedModules ?? []).map(
    (item) => `${item.id}  (${item.score}) — ${item.why}`)));
  lines.push(...section('Affected Files', (pkg.affectedFiles ?? []).map((item) => item.label || item.id)));
  lines.push(...section('Affected Features', (pkg.affectedFeatures ?? []).map(
    (item) => `${item.label} — ${item.why}`)));

  const routes = (pkg.architecture?.modules ?? []).flatMap((mod) =>
    mod.routes.map((route) => `${mod.id}: ${route}`));
  lines.push(...section('Routes', routes));
  lines.push(...section('Module Dependencies', (pkg.architecture?.dependencies ?? []).map(
    (dep) => `${dep.from} -> ${dep.to}`)));
  lines.push(...section('Data Flows', (pkg.dataFlows ?? []).map((item) => `${item.id}: ${item.label}`)));
  lines.push(...section('Business Rules', (pkg.businessFlows ?? []).map((item) => `${item.label} — ${item.why}`)));

  lines.push(...section('Recommended Changes', (pkg.recommendedChanges ?? []).map(
    (change) => `${change.order}. [${change.action}] ${change.target} — ${change.why}`)));

  lines.push(...section('Relevant Tests', pkg.tests ?? []));
  if (pkg.testPlan) {
    lines.push(...section(`Test Plan (${pkg.testPlan.id}, risk ${pkg.testPlan.risk})`,
      (pkg.testPlan.scenarios ?? []).map((item) => `[${item.priority}] ${item.title}`)));
  }
  lines.push(...section('Verified Facts', (pkg.facts ?? []).map(formatFact)));
  lines.push(...section('Constraints', pkg.constraints ?? []));
  lines.push(...section('Evidence', (pkg.evidence ?? []).map(formatEvidence)));

  // Source last: it is the longest section, and an agent that stops reading
  // early should still have seen the reasoning that explains it.
  for (const snippet of pkg.codeSnippets ?? []) {
    lines.push(
      `Code — ${snippet.path}:${snippet.startLine}-${snippet.endLine}  (${snippet.why})`,
      indent(snippet.content),
      ''
    );
  }

  if ((pkg.truncated ?? []).length > 0) {
    lines.push(...section('Truncated To Fit Budget', pkg.truncated));
  }
  lines.push(`Token estimate: ${pkg.tokenEstimate ?? 0}`, '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function renderMarkdown(pkg) {
  const lines = ['# AAFE Task Context', ''];
  lines.push(`- **Goal**: ${pkg.task?.goal || '(none)'}`);
  if (pkg.task?.requirement) lines.push(`- **Requirement**: ${pkg.task.requirement}`);
  if (pkg.project?.name) lines.push(`- **Project**: ${pkg.project.name} @ ${pkg.project.commit ?? 'unknown commit'}`);
  lines.push(`- **Risk**: ${pkg.risk ?? 'unknown'}`, `- **Confidence**: ${pkg.confidence ?? 0}`, '');

  if (pkg.failure) {
    lines.push(`## Failure diagnosis (${pkg.failure.classification})`, '', pkg.failure.rootCause ?? '', '');
    lines.push(...mdList('Suspect frames', (pkg.failure.suspects ?? []).map(
      (item) => `\`${item.file}${item.line ? `:${item.line}` : ''}\`${item.inDiff ? ' **(changed in this diff)**' : ''} — ${item.test}`)));
    lines.push(...mdList('Fix direction', pkg.failure.fixSuggestions ?? []));
  }

  lines.push(...mdList('Affected modules', (pkg.affectedModules ?? []).map(
    (item) => `\`${item.id}\` (${item.score}) — ${item.why}`)));
  lines.push(...mdList('Affected files', (pkg.affectedFiles ?? []).map((item) => `\`${item.id}\``)));
  lines.push(...mdList('Affected features', (pkg.affectedFeatures ?? []).map((item) => `${item.label} — ${item.why}`)));
  lines.push(...mdList('Recommended changes', (pkg.recommendedChanges ?? []).map(
    (change) => `**${change.action}** \`${change.target}\` — ${change.why}`)));
  lines.push(...mdList('Relevant tests', (pkg.tests ?? []).map((test) => `\`${test}\``)));
  lines.push(...mdList('Verified facts', (pkg.facts ?? []).map(formatFact)));
  lines.push(...mdList('Relations', (pkg.relations ?? []).map(
    (relation) => `\`${relation.from}\` →(${relation.type})→ \`${relation.to}\``)));
  lines.push(...mdList('Constraints', pkg.constraints ?? []));
  lines.push(...mdList('Evidence', (pkg.evidence ?? []).map(formatEvidence)));

  for (const snippet of pkg.codeSnippets ?? []) {
    lines.push(
      `## \`${snippet.path}\` (${snippet.startLine}-${snippet.endLine})`,
      '',
      snippet.why ? `${snippet.why}` : '',
      '',
      '```' + (snippet.language || ''),
      snippet.content,
      '```',
      ''
    );
  }

  lines.push('', `_Token estimate: ${pkg.tokenEstimate ?? 0}_`, '');
  return lines.join('\n');
}

/**
 * Facts carry a `value` of any shape, so the renderer flattens rather than
 * assuming one.
 */
function formatFact(fact) {
  const value = typeof fact.value === 'object' && fact.value !== null
    ? Object.entries(fact.value).map(([key, item]) => `${key}=${Array.isArray(item) ? item.join('|') : item}`).join(' ')
    : String(fact.value);
  return `[${fact.kind}] ${value}${fact.source ? `  (${fact.source})` : ''}`;
}

function failureSection(failure) {
  const lines = [
    `Failure Diagnosis  [${failure.classification}]`,
    '-'.repeat(30),
    indent(failure.rootCause ?? '(no root cause derived)'),
    ''
  ];
  if (failure.totals) {
    lines.push(indent(`${failure.totals.failed} failed / ${failure.totals.total} total`), '');
  }
  lines.push(...section('Suspect Frames', (failure.suspects ?? []).map((item) =>
    `${item.file}${item.line ? `:${item.line}` : ''}${item.inDiff ? '  [changed in this diff]' : ''}\n    ${item.test}\n    ${item.message}`)));
  lines.push(...section('Fix Direction', failure.fixSuggestions ?? []));
  lines.push(...section('Tests To Re-run', failure.regressionTests ?? []));
  return lines;
}

function section(title, items) {
  if (!items || items.length === 0) return [];
  return [`${title}:`, ...items.map((item) => indent(item)), ''];
}

function mdList(title, items) {
  if (!items || items.length === 0) return [];
  return [`## ${title}`, '', ...items.map((item) => `- ${item}`), ''];
}

function formatEvidence(entry) {
  const location = entry.startLine ? `${entry.file}:${entry.startLine}` : entry.file;
  const detail = entry.symbol || entry.reason || '';
  return detail ? `${location} — ${detail}` : String(location);
}

function indent(text) {
  return `  ${String(text).replace(/\n/g, '\n  ')}`;
}
