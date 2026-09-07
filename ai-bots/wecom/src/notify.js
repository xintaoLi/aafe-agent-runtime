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
import path from 'node:path';
import { inferMediaType } from './media.js';
import { notifyTargetFromSource } from './session.js';

const NOTIFY_EVENTS = new Set(['task.finished', 'task.failed', 'task.cancelled']);

export function createRateLimiter({ maxPerMinute = 30, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    allow(key) {
      const ts = now();
      const recent = (buckets.get(key) ?? []).filter((item) => ts - item < 60_000);
      if (recent.length >= maxPerMinute) {
        buckets.set(key, recent);
        return false;
      }
      recent.push(ts);
      buckets.set(key, recent);
      return true;
    }
  };
}

export function formatTaskNotify(task, event = {}, { includeConclusion = true } = {}) {
  const status = event.status ?? task.status;
  const lines = [
    `任务 **${task.id}** ${statusLabel(status)}`,
    '',
    `需求：${task.requirement ?? task.goal ?? '-'}`
  ];
  if (includeConclusion) {
    const conclusion = extractTaskConclusion(task, event);
    if (conclusion) {
      lines.push('', '**✅ 最终结论**', conclusion);
    }
  }
  const files = extractChangedFiles(task);
  if (files.length) {
    lines.push('', '改动文件：', ...files.slice(0, 20).map((file) => `- ${file}`));
  }
  const pr = extractPr(task);
  if (pr) lines.push('', `PR：${pr}`);
  // A retry that succeeded must not carry the previous attempt's error.
  const error = status === 'completed' ? null : (task.error ?? event.error ?? null);
  if (error) lines.push('', `错误：${error}`);
  const footer = formatTaskFooter(task.id);
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

/**
 * Inline code is the only copy-friendly affordance in WeCom markdown, so the
 * id sits alone on its own line for a clean long-press select.
 */
export function formatTaskFooter(taskId, { running = false } = {}) {
  const id = String(taskId ?? '').trim();
  if (!id) return '';
  const lines = [`对话 ID：\`${id}\``];
  // Stream markdown cannot host a callback. The clickable controls are the
  // template-card buttons under the message; the typed command is the fallback
  // when the combined stream+card frame was rejected.
  if (running) {
    lines.push(`展开或停止请点消息下方按钮；也可发送 \`终止 ${id}\``);
  }
  return lines.join('\n');
}

export function formatStatusReply(task, scheduler = null) {
  const lines = [
    `任务 **${task.id}**`,
    `状态：${task.status}`,
    `需求：${task.requirement ?? task.goal ?? '-'}`
  ];
  if (task.cursor?.agentId) lines.push(`Cursor Agent：${task.cursor.agentId}`);
  if (task.cursor?.activeRunId) lines.push(`当前 Run：${task.cursor.activeRunId}`);
  if (scheduler?.runningTaskIds?.includes(task.id)) lines.push('调度：running');
  return lines.join('\n');
}

export function formatListReply(tasks) {
  if (!tasks.length) return '当前没有未结束的任务。';
  return ['未结束任务：', ...tasks.map((task) => {
    const owner = task.source?.userId ? ` · ${task.source.userId}` : '';
    const goal = task.goal ? ` ${task.goal}` : '';
    return `- ${task.id}（${task.status}${owner}）${goal}`;
  })].join('\n');
}

export function attachWeComNotifier({
  manager,
  sendMessage,
  sendMedia,
  uploadMedia,
  progress,
  limiter = createRateLimiter(),
  logger = console
} = {}) {
  if (!manager?.subscribe) return () => {};
  return manager.subscribe(async (event) => {
    let task = event?.task ?? null;
    if (!task && event?.taskId && manager.get) {
      try { task = await manager.get(event.taskId); } catch { /* notify must not throw */ }
    }
    if (progress && event?.taskId && (task?.source?.type === 'wecom' || progress.has?.(event.taskId))) {
      try {
        const streamed = await progress.handle(event, { task });
        if (streamed && NOTIFY_EVENTS.has(event.type)) return;
      } catch (error) {
        logger.error?.(`wecom-progress-handle-failed:${event.taskId}:${error instanceof Error ? error.message : error}`);
      }
    }
    if (!NOTIFY_EVENTS.has(event?.type)) return;
    if (!task || task.source?.type !== 'wecom') return;
    const target = notifyTargetFromSource(task.source);
    if (!target) return;
    if (!limiter.allow(target.chatid)) {
      logger.warn?.(`wecom-notify-rate-limited:${target.chatid}`);
      logger.event?.('notify.skip', { taskId: task.id, type: event.type, reason: 'rate-limited' });
      return;
    }
    const content = formatTaskNotify(task, event);
    try {
      await sendMessage(target.chatid, {
        msgtype: 'markdown',
        markdown: { content },
        chat_type: target.chatType
      });
      logger.event?.('notify.out', { taskId: task.id, type: event.type, chatid: target.chatid });
      await sendResultMedia(task, { sendMedia, uploadMedia, logger, chatid: target.chatid });
    } catch (error) {
      logger.error?.(`wecom-notify-failed:${task.id}:${error instanceof Error ? error.message : error}`);
      logger.event?.('notify.failed', {
        taskId: task.id,
        type: event.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function statusLabel(status) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status ?? '已更新';
}

function extractTaskConclusion(task, event = {}) {
  const status = event.status ?? task.status;
  const text = String(
    task?.result?.text
    ?? task?.result?.execution?.text
    ?? ''
  ).trim();
  if (status === 'failed' || event.type === 'task.failed') {
    return text || task.error || event.error || '任务失败，未返回详细原因。';
  }
  if (status === 'cancelled' || event.type === 'task.cancelled') {
    return text || '任务已终止。';
  }
  if (text) return text;
  if (status === 'completed') return '任务已完成，但 Agent 未给出文字说明。';
  return '任务已结束，未返回文字结论。';
}

function extractChangedFiles(task) {
  const git = task.result?.execution?.git ?? task.result?.git ?? null;
  const files = git?.files ?? git?.changedFiles ?? git?.diffs ?? [];
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => (typeof file === 'string' ? file : file?.path ?? file?.filename ?? null))
    .filter(Boolean);
}

/**
 * The task carries its PR since the manager started lifting it out of the run
 * result; the dig through `result` stays for tasks written before that.
 */
function extractPr(task) {
  if (task.pullRequest?.url) return task.pullRequest.url;
  const git = task.result?.execution?.git ?? task.result?.git ?? null;
  return git?.prUrl
    ?? git?.pullRequestUrl
    ?? task.repository?.prUrl
    ?? (Array.isArray(git?.prs) ? git.prs[0]?.url : null)
    ?? null;
}

async function sendResultMedia(task, {
  sendMedia,
  uploadMedia,
  logger = console,
  chatid,
  read = readFile
} = {}) {
  const items = task?.result?.media ?? task?.result?.wecomMedia ?? [];
  if (!items.length || !sendMedia || !uploadMedia || !chatid) return;
  for (const item of items.slice(0, 5)) {
    try {
      const buffer = item.buffer ?? await read(item.path);
      const filename = item.filename ?? path.basename(item.path ?? 'file');
      const type = item.type ?? inferMediaType(filename);
      const uploaded = await uploadMedia(buffer, { type, filename });
      await sendMedia(chatid, type, uploaded.media_id, item.videoOptions);
      logger.event?.('notify.media', { taskId: task.id, type, filename });
    } catch (error) {
      logger.error?.(`wecom-send-media-failed:${task.id}:${error instanceof Error ? error.message : error}`);
    }
  }
}
