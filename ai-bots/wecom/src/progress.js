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

import { formatTaskFooter, formatTaskNotify } from './notify.js';

const TERMINAL = new Set(['task.finished', 'task.failed', 'task.cancelled']);
const STATUS = {
  'scheduler.queued': '排队中',
  'scheduler.started': '开始执行',
  'cursor.agent.created': '正在创建 Agent',
  'cursor.agent.resumed': '已接上 Agent',
  'cursor.run.started': 'Agent 输出中',
  'task.cursor.bound': '已绑定 Run',
  'cursor.run.recovered': '已恢复 Run',
  'cursor.run.completed': '本轮 Run 结束',
  'task.followup.queued': '已收到补充，当前轮结束后继续',
  'task.followup.pending': '补充已排队，即将开始下一轮',
  'task.blocked': '被阻塞',
  'task.failed': '失败',
  'task.cancelled': '已取消'
};
const MAX_BLOCKS = 80;
const MAX_BYTES = 18_000;
const PROCESS_VISIBLE = 5;
const CURRENT_LINE_MAX = 80;
const SUMMARY_MAX = 1200;
const TEXT_FLUSH_MS = 800;
const HEARTBEAT_MS = 45_000;
const DANCE_MS = 2_500;

/**
 * A WeCom stream reply is plain markdown text with no spinner element, so the
 * loading effect has to come from swapping characters between refreshes. Frames
 * stay ASCII plus one emoji so every client renders them instead of tofu.
 */
const DANCE_FRAMES = ['(>🐧)>', '^(🐧)^', '<(🐧<)', '^(🐧)^'];

export function danceFrame(tick = 0) {
  const frames = DANCE_FRAMES.length;
  const index = ((Math.trunc(Number(tick)) || 0) % frames + frames) % frames;
  return DANCE_FRAMES[index];
}

export function formatProgressEvent(event = {}) {
  const type = event.type;
  if (!type) return null;
  if (TERMINAL.has(type)) return { kind: 'terminal', type };
  if (STATUS[type]) return { kind: 'status', text: STATUS[type], extra: event.payload?.error ?? event.error ?? event.reason };
  if (type === 'cursor.message') return formatCursorMessage(event.payload);
  return null;
}

export function renderProgressView({
  header,
  transcript = [],
  footer = '',
  status = 'running',
  finished = false,
  tick = 0,
  taskId = ''
} = {}) {
  const process = [];
  let current = '';
  let lastAssistant = '';
  for (const block of transcript) {
    if (block.kind === 'tool' || block.kind === 'status') {
      const rendered = renderProcessLine(block);
      if (rendered) process.push(rendered);
      continue;
    }
    if (block.kind === 'assistant') {
      lastAssistant = String(block.text ?? '').trim();
      if (lastAssistant) current = clipHead(lastAssistant, CURRENT_LINE_MAX);
      continue;
    }
    if (block.kind === 'thinking' && !current) {
      const thinking = String(block.text ?? '').trim();
      if (thinking) current = clipHead(thinking, CURRENT_LINE_MAX);
    }
  }

  const hidden = Math.max(0, process.length - PROCESS_VISIBLE);
  const visible = process.slice(-PROCESS_VISIBLE);
  const parts = [];
  if (header) parts.push(finished ? header : danceOnTitle(header, tick));
  parts.push(`**Agent** · ${status}`);
  if (visible.length) {
    const title = process.length > PROCESS_VISIBLE
      ? `**过程** · ${process.length} 步`
      : '**过程**';
    const lines = [title, ...visible];
    if (hidden > 0) lines.push(`_… 另有 ${hidden} 步已收起_`);
    parts.push(lines.join('\n'));
  } else if (!finished) {
    parts.push('_等待 Agent 输出…_');
  }
  if (!finished && current) parts.push(`**正在**\n${current}`);
  if (finished) {
    const summary = [clipSummary(lastAssistant, SUMMARY_MAX), footer].filter(Boolean).join('\n\n');
    if (summary) parts.push(`---\n**结果**\n${summary}`);
    // The terminal footer already carries the id, so only add it when missing.
    if (!footer) appendTaskFooter(parts, taskId, false);
  } else {
    if (footer) parts.push(`---\n${footer}`);
    appendTaskFooter(parts, taskId, true);
  }
  return clipUtf8KeepEnds(parts.filter(Boolean).join('\n\n'), MAX_BYTES);
}

export function createWeComProgressHub({
  replyProgress,
  logger = console,
  now = () => Date.now(),
  textFlushMs = TEXT_FLUSH_MS,
  heartbeatMs = HEARTBEAT_MS,
  danceMs = DANCE_MS
} = {}) {
  const sessions = new Map();
  // The title animation needs its own cadence: without it the frame would only
  // advance when the Agent emits something, so a silent step looks frozen.
  const tickMs = danceMs > 0 ? Math.max(500, danceMs) : Math.min(heartbeatMs, 15_000);
  const timer = setInterval(() => { void tickAll(); }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();

  async function tickAll() {
    for (const session of [...sessions.values()]) {
      await flushSession(session, { heartbeat: true });
    }
  }

  async function flushSession(session, { finish = false, footer = '', heartbeat = false } = {}) {
    if (!session || session.finished) return false;
    const ts = now();
    if (heartbeat && !finish && !shouldTick(session, ts)) return false;
    session.updatedAt = ts;
    session.lastFlushAt = ts;
    const content = renderProgressView({
      header: session.header,
      transcript: session.transcript,
      status: session.status,
      footer,
      finished: finish,
      tick: session.tick,
      taskId: session.taskId
    });
    if (!finish) session.tick += 1;
    try {
      await replyProgress?.(session.frame, session.streamId, content, finish);
      if (finish) {
        session.finished = true;
        sessions.delete(session.taskId);
      }
      return true;
    } catch (error) {
      logger.error?.(`wecom-progress-failed:${session.taskId}:${error instanceof Error ? error.message : error}`);
      session.finished = true;
      sessions.delete(session.taskId);
      return false;
    }
  }

  function shouldTick(session, ts) {
    if (danceMs > 0 && ts - session.lastFlushAt >= danceMs) return true;
    return ts - session.updatedAt >= heartbeatMs;
  }

  return {
    open({ taskId, frame, streamId, header }) {
      if (!taskId || !frame || !streamId) return;
      sessions.set(taskId, {
        taskId,
        frame,
        streamId,
        header,
        transcript: [],
        status: '启动中',
        updatedAt: now(),
        lastFlushAt: 0,
        tick: 0,
        finished: false
      });
    },
    has(taskId) {
      return sessions.has(taskId);
    },
    async tick() {
      return tickAll();
    },
    async handle(event, { task } = {}) {
      const session = sessions.get(event?.taskId);
      if (!session || session.finished) return false;
      const item = formatProgressEvent(event);
      if (!item) return false;
      if (item.kind === 'terminal') {
        session.status = item.type === 'task.failed' ? '失败' : item.type === 'task.cancelled' ? '已取消' : '已完成';
        return flushSession(session, {
          finish: true,
          footer: formatTaskNotify(task ?? event.task ?? { id: event.taskId, status: event.status }, event)
        });
      }
      if (item.kind === 'status') {
        session.status = item.text;
        appendBlock(session, { kind: 'status', text: item.extra ? `${item.text}：${item.extra}` : item.text });
        return flushSession(session);
      }
      if (item.kind === 'tool') {
        appendBlock(session, item);
        return flushSession(session);
      }
      if (item.kind === 'thinking' || item.kind === 'assistant') {
        const last = session.transcript[session.transcript.length - 1];
        const same = last?.kind === item.kind;
        mergeTextBlock(session, item);
        session.updatedAt = now();
        if (!same || now() - session.lastFlushAt >= textFlushMs) return flushSession(session);
        return true;
      }
      return true;
    },
    async fail(taskId, error) {
      const session = sessions.get(taskId);
      if (!session) return false;
      session.status = '失败';
      appendBlock(session, { kind: 'status', text: `启动失败：${error instanceof Error ? error.message : error}` });
      return flushSession(session, {
        finish: true,
        footer: `任务 **${taskId}** 启动失败`
      });
    },
    async cancel(taskId) {
      const session = sessions.get(taskId);
      if (!session) return false;
      session.status = '已取消';
      return flushSession(session, {
        finish: true,
        footer: `任务 **${taskId}** 已终止`
      });
    },
    async close() {
      clearInterval(timer);
      for (const session of [...sessions.values()]) {
        await flushSession(session, { finish: true, footer: '进程退出，任务仍在后台。完成后如可推送会再通知。' });
      }
    }
  };
}

export function formatCursorMessage(payload = {}) {
  const tools = Array.isArray(payload.tools) && payload.tools.length
    ? payload.tools
    : extractToolsFromPayload(payload);
  if (tools.length) return { kind: 'tool', tools };
  const thinking = payload.thinking || extractThinkingFromPayload(payload);
  if (thinking && !payload.text) return { kind: 'thinking', text: thinking };
  const text = payload.text || extractTextFromPayload(payload);
  if (text) return { kind: 'assistant', text };
  return null;
}

function appendTaskFooter(parts, taskId, running) {
  const footer = formatTaskFooter(taskId, { running });
  if (footer) parts.push(`---\n${footer}`);
}

function danceOnTitle(header, tick) {
  const lines = String(header).split('\n');
  lines[0] = `${lines[0]} ${danceFrame(tick)}`.trim();
  return lines.join('\n');
}

function renderProcessLine(block) {
  if (!block) return '';
  if (block.kind === 'tool') {
    const tools = block.tools ?? [{ name: block.name, detail: block.detail }];
    return tools
      .map((tool) => `> ${tool.name}${tool.detail ? ` \`${clipHead(tool.detail, 48)}\`` : ''}`)
      .join('\n');
  }
  if (block.kind === 'status') return `> ${block.text}`;
  return '';
}

function clipHead(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function clipSummary(text, max) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `…${value.slice(-max)}`;
}

function appendBlock(session, block) {
  const last = session.transcript[session.transcript.length - 1];
  if (last && last.kind === block.kind && last.kind === 'status' && last.text === block.text) return;
  session.transcript.push(block);
  if (session.transcript.length > MAX_BLOCKS) {
    session.transcript = session.transcript.slice(-MAX_BLOCKS);
  }
}

function mergeTextBlock(session, block) {
  const last = session.transcript[session.transcript.length - 1];
  if (last && last.kind === block.kind) {
    last.text = mergeText(last.text, block.text);
    return;
  }
  session.transcript.push({ kind: block.kind, text: block.text });
}

function extractToolsFromPayload(payload) {
  const tools = [];
  if (/tool/i.test(String(payload?.type ?? ''))) {
    const raw = payload.toolCall ?? payload.tool_call ?? payload.message?.toolCall ?? payload.message?.tool_call ?? payload;
    const name = raw?.name ?? raw?.toolName ?? raw?.function?.name;
    if (name) tools.push({ name, detail: toolDetail(raw) });
  }
  const content = payload?.message?.content ?? payload?.message?.message?.content ?? [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!/tool/i.test(String(block?.type ?? ''))) continue;
      const name = block.name ?? block.toolName ?? block.toolCall?.name;
      if (name) tools.push({ name, detail: toolDetail(block) });
    }
  }
  return tools;
}

function extractThinkingFromPayload(payload) {
  const content = payload?.message?.content ?? [];
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => ['thinking', 'reasoning', 'thought'].includes(block?.type))
    .map((block) => block.thinking ?? block.text ?? '')
    .filter(Boolean)
    .join('');
}

function extractTextFromPayload(payload) {
  if (payload?.text) return String(payload.text);
  const content = payload?.message?.content ?? [];
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join('');
}

function toolDetail(tool) {
  const input = tool?.input ?? tool?.args ?? tool?.arguments ?? tool?.params ?? {};
  if (typeof input === 'string') return input.slice(0, 160);
  if (!input || typeof input !== 'object') return '';
  const file = input.path ?? input.file ?? input.filename ?? input.target_file;
  const query = input.query ?? input.pattern ?? input.grep;
  const command = input.command ?? input.cmd;
  if (file && query) return `${file} · ${query}`;
  return String(file ?? query ?? command ?? '').slice(0, 160);
}

function mergeText(previous, next) {
  const incoming = String(next ?? '');
  if (!incoming) return previous ?? '';
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  return `${previous}${incoming}`;
}

function clipUtf8KeepEnds(text, maxBytes) {
  const buffer = Buffer.from(String(text ?? ''), 'utf8');
  if (buffer.length <= maxBytes) return text;
  const head = buffer.subarray(0, 700).toString('utf8');
  const tail = buffer.subarray(buffer.length - (maxBytes - 900)).toString('utf8').replace(/^\uFFFD/, '');
  const headLines = head.split('\n').slice(0, 6).join('\n');
  return `${headLines}\n\n…\n\n${tail}`;
}
