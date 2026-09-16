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
export const RESULT_HEADING = '最终结果';

export const AGENT_UI_STATUS = Object.freeze({
  created: { id: 'created', label: '准备任务' },
  thinking: { id: 'thinking', label: '思考中' },
  planning: { id: 'planning', label: '制定方案' },
  executing: { id: 'executing', label: '执行中' },
  completed: { id: 'completed', label: '已完成' },
  canceling: { id: 'canceling', label: '正在终止' },
  canceled: { id: 'canceled', label: '已终止' },
  failed: { id: 'failed', label: '执行失败' },
  blocked: { id: 'blocked', label: '等待补充 / 确认' },
  waiting_user: { id: 'waiting_user', label: '等待补充信息' },
  waiting_approval: { id: 'waiting_approval', label: '等待操作授权' },
  partially_blocked: { id: 'partially_blocked', label: '部分受阻，继续执行' },
  running_with_assumptions: { id: 'running_with_assumptions', label: '使用安全默认值执行' }
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
  被阻塞: 'blocked',
  waiting_user: 'waiting_user',
  waiting_approval: 'waiting_approval',
  partially_blocked: 'partially_blocked',
  running_with_assumptions: 'running_with_assumptions'
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
    if (['blocked', 'waiting_user', 'waiting_approval'].includes(aliased)) return aliased;
    if (aliased === 'completed') return 'completed';
    if (aliased === 'canceling') return 'canceling';
    return aliased && isTerminalUiStatus(aliased) ? aliased : 'completed';
  }
  if (['partially_blocked', 'running_with_assumptions'].includes(aliased)) return aliased;
  if (aliased === 'executing' || hasToolStep(transcript)) return 'executing';
  if (aliased === 'planning') return 'planning';
  if (aliased === 'created') return 'created';
  if (aliased === 'thinking') return 'thinking';
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
  presentation = null,
  supportsTemplateCards = true,
  // Streaming views drive WeCom's native `<think>` block, which is where the
  // provider's real reasoning belongs. Without this the block only ever held
  // tool names, because the reasoning was filtered out before rendering.
  thinkTag = false
} = {}) {
  const uiStatus = resolveAgentUiStatus({ status, transcript, finished });
  // The last assistant text appears as the live update or final result, not
  // twice in the work log. Earlier public commentary remains readable.
  const lastAssistant = transcript.findLastIndex((item) => item.kind === 'assistant');
  const lastText = String(transcript[lastAssistant]?.text ?? '').trim();
  const duplicatesResult = Boolean(presentation?.summary)
    && (presentation.summary.includes(lastText) || lastText.includes(presentation.summary));
  const omitLast = finished ? !presentation || duplicatesResult : !expanded;
  const activity = transcript.filter((block, index) => !omitLast || index !== lastAssistant);
  const steps = collectThinkingSteps(activity, {
    expanded,
    includeProviderThinking: thinkTag,
    fullText: thinkTag
  });
  const preview = getThinkingPreview(steps.map((step) => step.summary));
  return {
    taskId: String(taskId ?? ''),
    presentation,
    status: uiStatus,
    label: AGENT_UI_STATUS[uiStatus].label,
    thinking: {
      preview,
      full: steps,
      supportsTemplateCards: Boolean(supportsTemplateCards),
      expanded: Boolean(expanded),
      total: steps.length
    },
    current: finished || expanded || uiStatus === 'canceling' ? '' : lastAssistantClip(transcript),
    result: finished && uiStatus !== 'canceled'
      ? buildResult({ uiStatus, transcript, footer, taskId })
      : null,
    header: header || '',
    footer: finished ? stripDuplicateConclusion(footer) : footer,
    transcript,
    finished: Boolean(finished)
  };
}

export function renderAgentUI(state, { thinkTag = false } = {}) {
  const parts = [];
  if (shouldShowStatusLine(state)) parts.push(`**${state.label}**`);

  const thinking = renderThinkingSection(state, { thinkTag });
  if (thinking) parts.push(thinking);
  if (state.current) parts.push(state.current);

  if (state.finished && state.status !== 'canceled') {
    const result = state.presentation
      ? renderTaskPresentation(state.presentation, { expanded: state.thinking.expanded })
      : [state.label ? `**${state.label}**` : '', state.result?.content].filter(Boolean).join('\n');
    if (result) parts.push(`---\n**${RESULT_HEADING}**\n${result}`);
  }
  if (state.status === 'canceled' && !thinking) parts.push('任务已被用户终止。');
  appendTaskMeta(parts, state, { running: !state.finished });
  return parts.filter(Boolean).join('\n\n') || (state.finished ? '' : '正在处理…');
}

export function lastThinkingActivity(transcript = []) {
  const steps = collectThinkingSteps(transcript, { expanded: false });
  return steps.at(-1)?.summary ?? lastAssistantClip(transcript);
}

export function collectThinkingSteps(transcript = [], {
  expanded = false,
  includeProviderThinking = false,
  fullText = false
} = {}) {
  const lines = [];
  for (const group of buildProcessTree(transcript)) {
    if (group.type === 'tool') {
      const summary = summarizeTool(group.name);
      lines.push({
        summary: expanded && group.items.length > 1 ? `${summary}（${group.items.length} 次）` : summary,
        kind: 'tool',
        name: group.name
      });
      continue;
    }
    if (['status', 'assistant'].includes(group.type) && group.text) {
      lines.push({ summary: expanded ? group.text : clipHead(group.text, 240), kind: group.type });
      continue;
    }
    if (includeProviderThinking && group.type === 'thinking' && group.text) {
      // A collapsed `<think>` block costs no screen space, so it carries the
      // reasoning in full; only the always-visible quoted form gets clipped.
      const text = redactDisplayText(group.text);
      lines.push({ summary: expanded || fullText ? text : clipHead(text, 240), kind: 'thinking' });
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

function renderThinkingSection(state, { thinkTag = false } = {}) {
  const { thinking, status } = state;
  if (status === 'canceled') return renderCanceledSteps(thinking, { thinkTag });
  if (!thinking.total) return '';
  // A collapsible block costs no screen space while closed, so it carries the
  // whole log — that is what makes "expand" worth having. Only the quoted
  // fallback, which is always visible, has to stay short.
  const expandAll = thinkTag || thinking.expanded;
  const lines = expandAll ? thinking.full.map((step) => step.summary) : thinking.preview;
  const hidden = expandAll ? 0 : Math.max(0, thinking.total - THINKING_PREVIEW_LIMIT);
  if (hidden > 0) {
    // `查看完整过程` is the command `commands.js` actually parses; anything else
    // here becomes a dead end the user has to discover the hard way.
    lines.push(`另有 ${hidden} 步，发送 \`查看完整过程 ${state.taskId || '<TaskID>'}\` 查看`);
  }
  const body = lines.filter(Boolean).join('\n');
  if (!body) return '';
  // WeCom renders a `<think>…</think>` block inside a streaming message as its
  // own collapsible "思考过程" area. That is the only real expand/collapse WeCom
  // offers: standard markdown has no fold syntax and `<details>` is not parsed.
  // It must be spelled exactly `<think>` — the similar `<thinking>` is not
  // recognised and its content is dropped by the client.
  return thinkTag ? `<think>\n${body}\n</think>` : asQuotedSection(body, thinking.expanded);
}

/** Pushed markdown messages are not stream replies; keep the quoted form there. */
function asQuotedSection(body, expanded) {
  const title = expanded ? '**思考过程（已展开）**' : '**思考过程**';
  const quoted = body.split('\n').map((line) => `> ${line}`);
  return [title, ...quoted].filter(Boolean).join('\n');
}

function renderCanceledSteps(thinking, { thinkTag = false } = {}) {
  if (!thinking.total) return '任务已被用户终止。';
  const done = getThinkingPreview(thinking.full.map((step) => step.summary), thinking.expanded ? thinking.total : 8);
  if (thinkTag) {
    return ['任务已被用户终止。', `<think>\n${done.join('\n')}\n</think>`, '已记录活动（不代表完成）。'].join('\n\n');
  }
  return ['任务已被用户终止。', '已记录活动（不代表完成）：', ...done.map((line) => `- ${line}`)].join('\n');
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
  return !state.finished;
}

/**
 * The task id stays on every view. `supportsTemplateCards` only says the bot
 * believes the card capability is up — it cannot know whether this particular
 * message actually rendered its buttons, and a view that promises controls the
 * user cannot see is worse than one line of copyable fallback.
 */
function appendTaskMeta(parts, state, { running = false } = {}) {
  if (state.footer && !state.finished) {
    parts.push(`---\n${state.footer}`);
  }
  if (state.finished && state.footer) return;
  if (!state.taskId) return;
  const id = state.taskId;
  const lines = [`对话 ID：\`${id}\``];
  if (running) {
    lines.push(state.thinking?.supportsTemplateCards
      ? '展开或停止请点消息下方按钮；也可发送 `终止 ' + id + '`'
      : '任务执行中：发送 `终止 ' + id + '` 可中止任务；发送 `查看完整过程 ' + id + '` 查看进展。');
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
  return ['completed', 'canceled', 'failed', 'blocked', 'waiting_user', 'waiting_approval'].includes(status);
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
