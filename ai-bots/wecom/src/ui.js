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
 * WeCom Agent UI Protocol: Stream presents public progress and task results;
 * Template Card provides controls. Show three recent activities by default,
 * not private reasoning or an inferred count of completed work.
 */

import { renderTaskPresentation } from './presentation.js';
import { redactDisplayText } from './logger.js';

export const THINKING_PREVIEW_LIMIT = 3;
export const RESULT_HEADING = '✅ 最终结论';

export const AGENT_UI_STATUS = Object.freeze({
  created: { id: 'created', label: '准备任务' },
  thinking: { id: 'thinking', label: '⌛ 思考中' },
  planning: { id: 'planning', label: '🧠 制定方案' },
  executing: { id: 'executing', label: '⚙️ 执行中' },
  completed: { id: 'completed', label: '✅ 已完成' },
  canceling: { id: 'canceling', label: '⏹ 正在终止' },
  canceled: { id: 'canceled', label: '⛔ 已终止' },
  failed: { id: 'failed', label: '❌ 执行失败' },
  blocked: { id: 'blocked', label: '⏸ 等待补充 / 确认' }
});

const TOOL_SUMMARY = Object.freeze({
  read: '正在读取文件',
  write: '正在修改代码',
  strreplace: '正在修改代码',
  delete: '正在修改代码',
  grep: '正在搜索代码',
  glob: '正在搜索代码',
  shell: '正在执行命令',
  command: '正在执行命令',
  task: '正在启动子任务',
  websearch: '正在检索资料',
  webfetch: '正在读取网页',
  editnotebook: '正在修改笔记'
});

const ALIAS = Object.freeze({
  created: 'created',
  queued: 'created',
  '启动中…': 'created',
  thinking: 'thinking',
  planning: 'planning',
  executing: 'executing',
  'agent 输出中': 'thinking',
  completed: 'completed',
  已完成: 'completed',
  canceling: 'canceling',
  正在终止: 'canceling',
  canceled: 'canceled',
  cancelled: 'canceled',
  已取消: 'canceled',
  failed: 'failed',
  失败: 'failed',
  已超时: 'failed',
  blocked: 'blocked',
  被阻塞: 'blocked'
});

export function getThinkingPreview(steps = [], limit = THINKING_PREVIEW_LIMIT) {
  return steps.slice(-limit);
}

export function resolveAgentUiStatus({ status, transcript = [], finished = false } = {}) {
  const raw = String(status ?? '').trim();
  const aliased = ALIAS[raw] ?? ALIAS[raw.toLowerCase()] ?? null;
  if (aliased === 'canceling') return 'canceling';
  if (finished || isTerminalUiStatus(aliased)) {
    if (aliased === 'canceled') return 'canceled';
    if (aliased === 'failed') return 'failed';
    if (aliased === 'blocked') return 'blocked';
    if (aliased === 'completed') return 'completed';
    if (aliased === 'canceling') return 'canceling';
    return aliased && isTerminalUiStatus(aliased) ? aliased : 'completed';
  }
  if (aliased === 'executing' || hasToolStep(transcript)) return 'executing';
  if (aliased === 'planning') return 'planning';
  if (aliased === 'created') return 'created';
  if (aliased === 'thinking') return 'thinking';
  if (hasToolStep(transcript)) return 'executing';
  return 'thinking';
}

export function buildAgentUIState({
  header = '',
  transcript = [],
  footer = '',
  status = 'thinking',
  finished = false,
  expanded = false,
  taskId = '',
  presentation = null
} = {}) {
  const uiStatus = resolveAgentUiStatus({ status, transcript, finished });
  // The last assistant text appears as the live update or final result, not
  // twice in the work log. Earlier public commentary remains readable.
  const lastAssistant = transcript.findLastIndex((item) => item.kind === 'assistant');
  const lastText = String(transcript[lastAssistant]?.text ?? '').trim();
  const omitLast = finished ? !presentation || presentation.summary.includes(lastText) : !expanded;
  const activity = transcript.filter((block, index) => !omitLast || index !== lastAssistant);
  const steps = collectThinkingSteps(activity, { expanded });
  const preview = getThinkingPreview(steps.map((step) => step.summary));
  return {
    taskId: String(taskId ?? ''),
    presentation,
    status: uiStatus,
    label: AGENT_UI_STATUS[uiStatus].label,
    thinking: {
      preview,
      full: steps,
      expanded: Boolean(expanded),
      total: steps.length
    },
    current: finished || expanded || uiStatus === 'canceling' ? '' : lastAssistantClip(transcript),
    result: finished && uiStatus !== 'canceled'
      ? buildResult({ uiStatus, transcript, footer, taskId })
      : null,
    header: header || '',
    footer: finished ? stripDuplicateConclusion(footer) : footer,
    finished: Boolean(finished)
  };
}

export function renderAgentUI(state) {
  if (state.finished && state.presentation) {
    return [
      renderTaskPresentation(state.presentation, { expanded: state.thinking.expanded }),
      renderThinkingSection(state),
      state.taskId ? '对话 ID：`' + state.taskId + '`' : ''
    ].filter(Boolean).join('\n\n');
  }
  const parts = [];
  if (state.header) parts.push(state.header);
  if (shouldShowStatusLine(state)) parts.push(`**${state.label}**`);
  if (state.status === 'canceling') {
    parts.push('正在停止当前任务...');
    appendTaskMeta(parts, state, { running: false });
    return parts.filter(Boolean).join('\n\n');
  }
  const thinking = renderThinkingSection(state);
  if (thinking) parts.push(thinking);
  if (state.current) parts.push(state.current);
  if (state.finished && state.result) {
    const body = [state.result.content, state.footer].filter(Boolean).join('\n\n');
    parts.push(`---\n**${state.status === 'completed' ? RESULT_HEADING : '本轮结果'}**\n${body}`);
    if (!state.footer) appendTaskMeta(parts, state, { running: false });
  } else {
    if (state.finished && state.footer) parts.push(`---\n${state.footer}`);
    else appendTaskMeta(parts, state, { running: !state.finished });
  }
  return parts.filter(Boolean).join('\n\n');
}

export function lastThinkingActivity(transcript = []) {
  const steps = collectThinkingSteps(transcript, { expanded: false });
  return steps.at(-1)?.summary ?? lastAssistantClip(transcript);
}

export function collectThinkingSteps(transcript = [], { expanded = false } = {}) {
  const lines = [];
  for (const group of buildProcessTree(transcript)) {
    if (group.type === 'tool') {
      const summary = summarizeTool(group.name);
      if (expanded) {
        lines.push({
          summary: group.items.length > 1 ? `**${group.name}** · ${group.items.length} 次` : `**${group.name}**`,
          kind: 'tool',
          name: group.name
        });
        for (const item of group.items) {
          lines.push({
            summary: item ? `· \`${clipHead(item, 48)}\`` : `· ${group.name}`,
            kind: 'tool-item',
            name: group.name
          });
        }
      } else {
        for (const item of group.items) {
          lines.push({
            summary: item ? `${summary} \`${clipHead(item, 48)}\`` : summary,
            kind: 'tool',
            name: group.name
          });
        }
      }
      continue;
    }
    if (['status', 'assistant'].includes(group.type) && group.text) {
      lines.push({ summary: expanded ? group.text : clipHead(group.text, 240), kind: group.type });
      continue;
    }
    if (group.type === 'thinking') {
      lines.push({ summary: '正在分析…', kind: 'thinking' });
    }
  }
  return lines;
}

export function buildProcessTree(transcript = []) {
  const groups = [];
  for (const block of transcript) {
    if (block?.kind === 'tool') {
      const tools = block.tools ?? [{ name: block.name, detail: block.detail }];
      for (const tool of tools) {
        const name = String(tool?.name ?? '').trim() || 'tool';
        const last = groups[groups.length - 1];
        if (last?.type === 'tool' && last.name === name) {
          last.items.push(redactDisplayText(tool.detail ?? ''));
        } else {
          groups.push({ type: 'tool', name, items: [redactDisplayText(tool.detail ?? '')] });
        }
      }
      continue;
    }
    if (['status', 'assistant'].includes(block?.kind) && block.text) {
      groups.push({ type: block.kind, text: redactDisplayText(block.text) });
      continue;
    }
    if (block?.kind === 'thinking') {
      const text = String(block.text ?? '').trim();
      if (!text) continue;
      const last = groups[groups.length - 1];
      if (last?.type === 'thinking') last.text = mergeText(last.text, text);
      else groups.push({ type: 'thinking', text });
    }
  }
  return groups;
}

export function clipHead(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function mergeText(previous, next) {
  const incoming = String(next ?? '');
  if (!incoming) return previous ?? '';
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  return `${previous}${incoming}`;
}

function renderThinkingSection(state) {
  const { thinking, status } = state;
  if (status === 'canceled') return renderCanceledSteps(thinking);
  if (!thinking.total) return '';
  const lines = thinking.expanded ? thinking.full.map((step) => step.summary) : thinking.preview;
  const hidden = thinking.expanded ? 0 : Math.max(0, thinking.total - THINKING_PREVIEW_LIMIT);
  const title = thinking.expanded ? '**工作记录**（最近一轮，最多 80 条；工具调用不代表验证通过）' : '**最近进展**';
  const quoted = lines.map((line) => line.split('\n').map((part) => `> ${part}`).join('\n'));
  if (hidden > 0) quoted.push(`> 另有 ${hidden} 步，点下方「查看完整过程」`);
  return [title, ...quoted].filter(Boolean).join('\n');
}

function renderCanceledSteps(thinking) {
  if (!thinking.total) return '任务已被用户终止。';
  const done = getThinkingPreview(thinking.full.map((step) => step.summary), thinking.expanded ? thinking.total : 8)
    .map((line) => `- ${line}`);
  return ['任务已被用户终止。', '已记录活动（不代表完成）：', ...done].join('\n');
}

function buildResult({ uiStatus, transcript, footer, taskId }) {
  return {
    title: '最终结论',
    content: synthesizeConclusion({
      lastAssistant: lastAssistantText(transcript),
      uiStatus,
      taskId,
      transcript,
      footer
    })
  };
}

function synthesizeConclusion({ lastAssistant, uiStatus, taskId, transcript = [], footer = '' } = {}) {
  const detail = lastStatusDetail(transcript) || errorFromFooter(footer);
  const id = String(taskId ?? '').trim();
  if (uiStatus === 'failed' && isStall(detail, footer)) {
    return detail || (id
      ? `任务长时间无新输出，已停止等待。发送 \`继续 ${id}\` 可重试。`
      : '任务长时间无新输出，已停止等待。');
  }
  const text = String(lastAssistant ?? '').trim();
  if (text) return clipSummary(text, 1200);
  if (uiStatus === 'failed') return detail || '任务失败，未返回详细原因。';
  if (uiStatus === 'canceled') return detail || '任务已终止。';
  if (uiStatus === 'completed') return '任务已完成，但 Agent 未给出文字说明。';
  return detail || '任务已结束，未返回文字结论。';
}

function shouldShowStatusLine(state) {
  if (!state.finished) return true;
  return state.status !== 'completed';
}

function appendTaskMeta(parts, state, { running = false } = {}) {
  if (state.footer && !state.finished) {
    parts.push(`---\n${state.footer}`);
  }
  if (state.finished && state.footer) return;
  if (!state.taskId) return;
  const lines = [`对话 ID：\`${state.taskId}\``];
  if (running) {
    lines.push('展开或停止请点消息下方按钮；也可发送 `终止 ' + state.taskId + '`');
  }
  parts.push(`---\n${lines.join('\n')}`);
}

function summarizeTool(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return TOOL_SUMMARY[key] || (name ? `正在使用 ${name}` : '正在执行工具');
}

function lastAssistantClip(transcript) {
  const text = lastAssistantText(transcript);
  return text ? clipSummary(text, 1000) : '';
}

function lastAssistantText(transcript = []) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index]?.kind === 'assistant' && transcript[index].text) {
      return redactDisplayText(transcript[index].text).trim();
    }
  }
  return '';
}

function lastStatusDetail(transcript) {
  for (let index = (transcript?.length ?? 0) - 1; index >= 0; index -= 1) {
    const block = transcript[index];
    if (block?.kind === 'status' && block.text) return String(block.text).trim();
  }
  return '';
}

function errorFromFooter(footer) {
  const match = String(footer ?? '').match(/错误：\s*(.+)/);
  return match ? match[1].trim() : '';
}

function isStall(detail, footer) {
  return /超时|长时间无新输出/.test(`${detail ?? ''}\n${footer ?? ''}`);
}

function isTerminalUiStatus(status) {
  return status === 'completed' || status === 'canceled' || status === 'failed' || status === 'blocked';
}

function hasToolStep(transcript = []) {
  return transcript.some((block) => block?.kind === 'tool');
}

function stripDuplicateConclusion(footer) {
  const value = String(footer ?? '').trim();
  if (!value) return '';
  return value.replace(/^\*\*✅? ?最终结论\*\*\n?/m, '').replace(/^\*\*结论\*\*\n?/m, '').trim();
}

function clipSummary(text, max) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
