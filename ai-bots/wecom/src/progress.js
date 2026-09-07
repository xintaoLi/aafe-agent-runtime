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

import { describeWeComError } from './logger.js';
import { formatTaskNotify } from './notify.js';
import { notifyTargetFromSource, sourceFromFrame } from './session.js';
import {
  buildAgentUIState,
  lastThinkingActivity,
  mergeText,
  renderAgentUI
} from './ui.js';

const TERMINAL = new Set(['task.finished', 'task.failed', 'task.cancelled']);
/**
 * Bringing an agent up is five events the user cannot act on, and listing them
 * as "过程" made the boot sequence look like the work. They now only move the
 * one-line status, and everything before the first token reads as 准备任务. Only
 * events worth interrupting for are logged into the process list.
 */
const STATUS = {
  'scheduler.queued': { status: 'created' },
  'scheduler.started': { status: 'created' },
  'cursor.agent.created': { status: 'created' },
  'cursor.agent.resumed': { status: 'created' },
  'task.cursor.bound': { status: 'created' },
  'cursor.run.started': { status: 'thinking' },
  'cursor.run.recovered': { status: 'thinking' },
  'cursor.run.completed': { status: 'thinking' },
  'task.followup.queued': { status: 'thinking', log: '已收到补充' },
  'task.followup.pending': { status: 'thinking', log: '即将开始下一轮' },
  'task.blocked': { status: 'failed', log: '被阻塞' },
  'task.failed': { status: 'failed', log: '失败' },
  'task.cancelled': { status: 'canceled', log: '已取消' }
};
const MAX_BLOCKS = 80;
const MAX_BYTES = 18_000;
const ARCHIVE_LIMIT = 80;
const TEXT_FLUSH_MS = 800;
const HEARTBEAT_MS = 45_000;
const DANCE_MS = 2_500;
const STALL_MS = 15 * 60_000;

/**
 * WeCom stops accepting updates 10 minutes after the message that opened the
 * stream, and a code task routinely outlives that. The stream is closed one
 * minute early on purpose: hitting 846608 costs the frame that carried it, so
 * the last thing the user sees would be a view with no explanation in it.
 * After that the progress keeps flowing as pushed messages, which is the only
 * channel a bot can still write to on its own.
 */
const STREAM_TTL_MS = 9 * 60_000;
const PUSH_INTERVAL_MS = 3 * 60_000;
// A pushed message is a normal markdown message, far tighter than a stream.
const PUSH_MAX_BYTES = 3_000;
const STREAM_EXPIRED_ERRCODE = 846608;

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
  const status = STATUS[type];
  if (status) {
    return {
      kind: 'status',
      text: status.status ?? status.text,
      log: status.log || false,
      extra: event.payload?.error ?? event.error ?? event.reason
    };
  }
  if (type === 'cursor.message') return formatCursorMessage(event.payload);
  return null;
}

export function renderProgressView({
  header,
  transcript = [],
  footer = '',
  status = 'thinking',
  finished = false,
  tick = 0,
  taskId = '',
  // A pushed message never refreshes, so an animation frame would freeze there
  // as a stray character instead of reading as motion.
  animate = true,
  expanded = false,
  maxBytes = MAX_BYTES
} = {}) {
  const dancing = animate && !finished && status !== 'canceling' && status !== 'canceled'
    && status !== 'completed' && status !== 'failed';
  return clipUtf8KeepEnds(renderAgentUI(buildAgentUIState({
    header: header && dancing ? danceOnTitle(header, tick) : header,
    transcript,
    footer,
    status,
    finished,
    expanded,
    taskId
  })), maxBytes);
}

export function createWeComProgressHub({
  replyProgress,
  pushMessage,
  logger = console,
  now = () => Date.now(),
  textFlushMs = TEXT_FLUSH_MS,
  heartbeatMs = HEARTBEAT_MS,
  danceMs = DANCE_MS,
  streamTtlMs = STREAM_TTL_MS,
  pushIntervalMs = PUSH_INTERVAL_MS,
  stallMs = STALL_MS,
  onStall = null
} = {}) {
  const sessions = new Map();
  const archives = new Map();
  // The title animation needs its own cadence: without it the frame would only
  // advance when the Agent emits something, so a silent step looks frozen.
  const tickMs = danceMs > 0 ? Math.max(500, danceMs) : Math.min(heartbeatMs, 15_000);
  const timer = setInterval(() => { void tickAll(); }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();

  async function tickAll() {
    for (const session of [...sessions.values()]) {
      if (session.finished) continue;
      if (stallMs > 0 && now() - session.lastEventAt >= stallMs) {
        await stallSession(session);
        continue;
      }
      await flushSession(session, { heartbeat: true });
    }
  }

  /**
   * @param handoff true when the notifier will send its own terminal message,
   * so a session already on the pushed channel must not send a second one.
   */
  async function flushSession(session, { finish = false, footer = '', heartbeat = false, handoff = false } = {}) {
    if (!session || session.finished) return false;
    if (heartbeat && !finish && !shouldTick(session, now())) return false;
    if (session.mode === 'stream' && !finish && streamAged(session, now())) {
      await closeAgedStream(session);
      if (session.finished) return false;
    }
    return session.mode === 'push'
      ? pushSession(session, { finish, footer, handoff })
      : streamSession(session, { finish, footer, handoff });
  }

  async function streamSession(session, { finish, footer, handoff }) {
    const ts = now();
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
    capture(session, { finished: finish });
    if (!finish) session.tick += 1;
    try {
      await replyProgress?.(session.frame, session.streamId, content, finish);
      if (finish) {
        session.finished = true;
        sessions.delete(session.taskId);
      }
      return true;
    } catch (error) {
      // The frame that hit the expiry is lost, so the pushed channel has to
      // resend it rather than wait out an interval.
      if (isStreamExpired(error) && canPush(session)) {
        logger.event?.('progress.degraded', { taskId: session.taskId, reason: 'expired', to: 'push' });
        session.mode = 'push';
        session.pushedAt = 0;
        session.dirty = false;
        return pushSession(session, { finish, footer, handoff });
      }
      const reason = describeWeComError(error);
      logger.error?.(`wecom-progress-failed:${session.taskId}:${reason}`);
      logger.event?.('progress.failed', { taskId: session.taskId, error: reason });
      session.finished = true;
      sessions.delete(session.taskId);
      return false;
    }
  }

  async function pushSession(session, { finish, footer, handoff }) {
    const ts = now();
    if (finish) {
      session.finished = true;
      capture(session, { finished: true });
      sessions.delete(session.taskId);
      if (handoff || !canPush(session)) return false;
    } else if (session.pushedAt && ts - session.pushedAt < pushIntervalMs) {
      session.dirty = true;
      return true;
    }
    const content = renderProgressView({
      header: session.header,
      transcript: session.transcript,
      status: session.status,
      footer: footer || (finish ? '' : RUNNING_NOTICE),
      finished: finish,
      animate: false,
      taskId: session.taskId,
      maxBytes: PUSH_MAX_BYTES
    });
    capture(session, { finished: finish });
    session.updatedAt = ts;
    session.lastFlushAt = ts;
    session.pushedAt = ts;
    session.dirty = false;
    try {
      await pushMessage?.(session.target, content);
      logger.event?.('progress.push', { taskId: session.taskId, finish });
      return true;
    } catch (error) {
      const reason = describeWeComError(error);
      logger.error?.(`wecom-progress-push-failed:${session.taskId}:${reason}`);
      logger.event?.('progress.push.failed', { taskId: session.taskId, error: reason });
      session.finished = true;
      sessions.delete(session.taskId);
      return false;
    }
  }

  /**
   * Closing the stream ourselves keeps the explanation visible: the frame still
   * lands, so the user reads why the live view stopped instead of watching it
   * freeze mid-task.
   */
  async function closeAgedStream(session) {
    const handoff = canPush(session);
    const content = renderProgressView({
      header: session.header,
      transcript: session.transcript,
      status: session.status,
      footer: handoff ? handoffNotice(pushIntervalMs) : STREAM_STOP_NOTICE,
      // The task is still running, so this is a closed stream, not a result.
      finished: false,
      animate: false,
      taskId: session.taskId
    });
    capture(session, { finished: false });
    try {
      await replyProgress?.(session.frame, session.streamId, content, true);
    } catch (error) {
      logger.event?.('progress.stream.close.failed', {
        taskId: session.taskId,
        error: describeWeComError(error)
      });
    }
    logger.event?.('progress.degraded', { taskId: session.taskId, reason: 'ttl', to: handoff ? 'push' : 'none' });
    if (!handoff) {
      session.finished = true;
      sessions.delete(session.taskId);
      return;
    }
    session.mode = 'push';
    // The frame just sent carries the current view, so the first pushed update
    // waits a full interval instead of repeating it.
    session.pushedAt = now();
    session.dirty = false;
  }

  function canPush(session) {
    return Boolean(pushMessage && session.target);
  }

  function streamAged(session, ts) {
    return streamTtlMs > 0 && ts - session.openedAt >= streamTtlMs;
  }

  function shouldTick(session, ts) {
    if (session.mode === 'push') return ts - session.pushedAt >= pushIntervalMs;
    if (streamAged(session, ts)) return true;
    if (danceMs > 0 && ts - session.lastFlushAt >= danceMs) return true;
    return ts - session.updatedAt >= heartbeatMs;
  }

  async function stallSession(session) {
    if (!session || session.finished) return false;
    session.status = 'failed';
    const current = lastActivity(session);
    appendBlock(session, { kind: 'status', text: '长时间无新输出' });
    const extra = current
      ? `最后进展：${current}`
      : '期间没有任何新的过程输出';
    logger.event?.('progress.stalled', { taskId: session.taskId });
    const flushed = await flushSession(session, {
      finish: true,
      footer: `${extra}。发送 \`继续 ${session.taskId}\` 可重试。`
    });
    try {
      await onStall?.(session.taskId);
    } catch (error) {
      logger.error?.(`wecom-progress-stall-failed:${session.taskId}:${describeWeComError(error)}`);
    }
    return flushed;
  }

  function capture(session, extra = {}) {
    if (!session?.taskId) return;
    archives.set(session.taskId, {
      header: session.header,
      transcript: session.transcript.slice(),
      status: extra.status ?? session.status,
      finished: extra.finished ?? session.finished,
      taskId: session.taskId
    });
    if (archives.size <= ARCHIVE_LIMIT) return;
    const oldest = archives.keys().next().value;
    archives.delete(oldest);
  }

  return {
    open({ taskId, frame, streamId, header, source }) {
      if (!taskId || !frame || !streamId) return;
      sessions.set(taskId, {
        taskId,
        frame,
        streamId,
        header,
        // Where progress goes once the stream expires. A conversation we cannot
        // address actively simply loses the live view at that point.
        target: notifyTargetFromSource(source ?? sourceFromFrame(frame)),
        mode: 'stream',
        transcript: [],
        status: 'created',
        openedAt: now(),
        updatedAt: now(),
        lastEventAt: now(),
        lastFlushAt: 0,
        pushedAt: 0,
        dirty: false,
        tick: 0,
        finished: false
      });
    },
    has(taskId) {
      return sessions.has(taskId);
    },
    renderProcess(taskId) {
      const snap = sessions.get(taskId) ?? archives.get(taskId);
      if (!snap) return '';
      return renderProgressView({
        header: snap.header,
        transcript: snap.transcript,
        status: snap.status,
        finished: snap.finished,
        expanded: true,
        animate: false,
        taskId: snap.taskId,
        maxBytes: MAX_BYTES
      });
    },
    async tick() {
      return tickAll();
    },
    async handle(event, { task } = {}) {
      const session = sessions.get(event?.taskId);
      if (!session || session.finished) return false;
      const item = formatProgressEvent(event);
      if (!item) return false;
      session.lastEventAt = now();
      if (item.kind === 'terminal') {
        session.status = item.type === 'task.failed' ? 'failed' : item.type === 'task.cancelled' ? 'canceled' : 'completed';
        return flushSession(session, {
          finish: true,
          // On the pushed channel the notifier already owns the terminal
          // message, and it carries the files, PR and media this view does not.
          handoff: true,
          footer: formatTaskNotify(task ?? event.task ?? { id: event.taskId, status: event.status }, event, {
            includeConclusion: false
          })
        });
      }
      if (item.kind === 'status') {
        session.status = item.text;
        if (item.log || item.extra) {
          const line = typeof item.log === 'string' ? item.log : item.text;
          appendBlock(session, { kind: 'status', text: item.extra ? `${line}：${item.extra}` : line });
        }
        return flushSession(session);
      }
      if (item.kind === 'tool') {
        if (session.status === 'created' || session.status === 'thinking') session.status = 'executing';
        appendBlock(session, item);
        return flushSession(session);
      }
      if (item.kind === 'thinking' || item.kind === 'assistant') {
        if (session.status === 'created') session.status = 'thinking';
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
      session.status = 'failed';
      appendBlock(session, { kind: 'status', text: `启动失败：${error instanceof Error ? error.message : error}` });
      return flushSession(session, {
        finish: true,
        footer: `任务 **${taskId}** 启动失败`
      });
    },
    async beginCancel(taskId) {
      const session = sessions.get(taskId);
      if (!session || session.finished) return false;
      session.status = 'canceling';
      return flushSession(session, { finish: false });
    },
    async cancel(taskId) {
      const session = sessions.get(taskId);
      if (!session) return false;
      session.status = 'canceled';
      return flushSession(session, {
        finish: true,
        footer: `任务 **${taskId}** 已终止`
      });
    },
    async close() {
      clearInterval(timer);
      for (const session of [...sessions.values()]) {
        await flushSession(session, {
          finish: true,
          footer: `机器人进程退出，本轮未完成。重启后会标记为中断，发送 \`继续 ${session.taskId}\` 可恢复。`
        });
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

const STREAM_STOP_NOTICE = '实时进度已到企微 10 分钟上限，且无法继续推送。请发送 `状态` 查询；完成后如可推送会再通知。';
const RUNNING_NOTICE = '任务仍在执行，尚无结果。';

function handoffNotice(pushIntervalMs) {
  const minutes = Math.max(1, Math.round(pushIntervalMs / 60_000));
  return `实时进度已到企微 10 分钟上限，任务仍在后台运行。\n后续进度改为每约 ${minutes} 分钟单独发一条，完成后推送结果。`;
}

export function isStreamExpired(error) {
  const code = Number(error?.errcode ?? error?.errCode);
  if (code === STREAM_EXPIRED_ERRCODE) return true;
  const message = String(error?.errmsg ?? error?.errMsg ?? error?.message ?? '');
  return /stream message update expired/i.test(message);
}

function danceOnTitle(header, tick) {
  const lines = String(header).split('\n');
  lines[0] = `${lines[0]} ${danceFrame(tick)}`.trim();
  return lines.join('\n');
}

function lastActivity(session) {
  return lastThinkingActivity(session?.transcript ?? []);
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

function clipUtf8KeepEnds(text, maxBytes) {
  const buffer = Buffer.from(String(text ?? ''), 'utf8');
  if (buffer.length <= maxBytes) return text;
  const head = buffer.subarray(0, 700).toString('utf8');
  const tail = buffer.subarray(buffer.length - (maxBytes - 900)).toString('utf8').replace(/^\uFFFD/, '');
  const headLines = head.split('\n').slice(0, 6).join('\n');
  return `${headLines}\n\n…\n\n${tail}`;
}
