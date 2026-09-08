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

import { redactDisplayText } from './logger.js';

export const TASK_RESULT_LABELS = Object.freeze({
  completed: '✅ 已完成',
  blocked: '⏸ 等待补充 / 确认',
  failed: '❌ 执行失败',
  cancelled: '⛔ 已终止'
});

/** Shared presentation of public output and persisted facts; no model calls. */
export function buildTaskPresentation(task = {}, event = {}) {
  const result = task.result ?? event.result ?? {};
  const outcome = result.outcome ?? result.execution?.outcome ?? {};
  const status = task.status ?? event.status
    ?? ({ 'task.failed': 'failed', 'task.blocked': 'blocked', 'task.cancelled': 'cancelled' }[event.type])
    ?? 'completed';
  const rawText = clean(result.text ?? result.execution?.text);
  const legacy = rawText.split(/\n\s*待处理[：:]\s*/);
  const summary = clean(outcome.summary) || legacy[0]?.trim() || '';
  const remaining = unique(outcome.remainingSteps ?? legacy[1]?.split('\n').map((line) => line.replace(/^\s*[-*•⦁]\s*/, '')) ?? []);
  const error = status === 'completed' ? '' : clean(
    result.deliveryVerification?.error ?? task.error ?? event.error ?? event.reason
  );
  // Blocked task.error often duplicates result.text. A different verification
  // failure must remain visible even if the Agent claimed success.
  const issue = error && error !== rawText && error !== summary ? error : '';
  const question = status === 'blocked'
    ? remaining.find((step) => /请提供|请补充|请确认|是否|需要你|please (?:provide|confirm)/i.test(step))
      || clean(task.delivery?.gates?.find((gate) => gate.gate === task.delivery?.pendingGate)?.reason)
      || summary.match(/(?:请提供|请补充|请确认)[^\n。！？]*[。！？]?/)?.[0]
      || issue || remaining[0] || '请补充阻塞条件的处理结果，或说明下一步如何处理。'
    : '';
  const git = result.execution?.git ?? result.git ?? {};
  return {
    taskId: String(task.id ?? event.taskId ?? ''),
    status,
    label: TASK_RESULT_LABELS[status] ?? status,
    requirement: requirementLink(task.requirement ?? task.goal),
    summary: (question ? summary.replace(question, '').trim() : summary) || (status === 'completed' ? '任务已完成，但 Agent 未给出文字说明。'
      : status === 'cancelled' ? '任务已终止。' : ''),
    question,
    issue,
    remaining: remaining.filter((step) => step !== question && !summary.includes(step)),
    evidence: unique(outcome.evidence ?? []),
    files: unique((Array.isArray(git.files ?? git.changedFiles ?? git.diffs) ? git.files ?? git.changedFiles ?? git.diffs : [])
      .map((file) => typeof file === 'string' ? file : file?.path ?? file?.filename)),
    pr: clean(task.pullRequest?.url ?? git.prUrl ?? git.pullRequestUrl ?? task.repository?.prUrl ?? git.prs?.[0]?.url)
  };
}

export function taskFeedbackRevision(task) {
  return JSON.stringify([task.updatedAt, task.checkpoint?.runId, task.result?.runId,
    task.delivery?.pendingGate, buildTaskPresentation(task).question]);
}

export function renderTaskPresentation(view, { expanded = false, includeSummary = true } = {}) {
  const parts = [`**${view.label}**`, view.requirement];
  if (view.question) parts.push(`**需要你反馈**\n${view.question}`);
  if (includeSummary && view.summary && view.summary !== view.question) {
    parts.push(expanded ? view.summary : clip(view.summary, 1600));
    if (!expanded && view.summary.length > 1600) parts.push('完整结果见「查看完整过程」。');
  }
  if (view.issue && view.issue !== view.question) parts.push(`${view.status === 'failed' ? '错误' : '阻塞原因'}：${view.issue}`);
  if (view.status === 'failed' && !view.summary && !view.issue) parts.push('任务失败，未返回详细原因。');
  if (view.remaining.length && view.status !== 'completed') {
    const steps = expanded ? view.remaining : view.remaining.slice(0, 3);
    parts.push(['**后续步骤**', ...steps.map((step) => `- ${step}`),
      !expanded && view.remaining.length > steps.length ? '其余步骤见「查看完整过程」。' : ''
    ].filter(Boolean).join('\n'));
  }
  if (expanded && view.evidence.length) parts.push(['**Agent 报告的验证记录**', ...view.evidence.map((item) => `- ${item}`)].join('\n'));
  if (view.files.length) {
    const files = expanded ? view.files : view.files.slice(0, 5);
    parts.push(`改动文件（${view.files.length}）：\n${files.map((file) => `- ${file}`).join('\n')}${files.length < view.files.length ? '\n其余文件见「查看完整过程」。' : ''}`);
  }
  if (view.pr) parts.push(`PR：${view.pr}`);
  if (view.status === 'blocked') parts.push('点击「补充信息」后回复；也可发送 `继续 <对话ID>：<反馈>`（替换为下方 ID）。');
  return parts.filter(Boolean).join('\n\n');
}

function requirementLink(value) {
  const text = clean(value);
  if (!text) return '';
  const markdown = text.match(/\[([^\n]+)\]\((https?:\/\/[^\s)]+)\)/);
  if (markdown) return `需求：[${clip(markdown[1], 90)}](${markdown[2]})`;
  const url = text.match(/https?:\/\/[^\s\])]+/);
  if (url) {
    const title = text.replace(url[0], '').replace(/^[\s【[]+|[\s】\]]+$/g, '').trim();
    return `需求：[${clip(title || '查看需求', 90)}](${url[0]})`;
  }
  return `需求：${clip(text, 120)}`;
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clean(value) {
  return redactDisplayText(typeof value === 'string' ? value : value?.message ?? '').trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}
