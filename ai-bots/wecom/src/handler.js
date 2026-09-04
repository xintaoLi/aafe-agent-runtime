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

import {
  buildCancelledCard,
  buildWorkspacePickerCard,
  buildWorkspaceSwitchedCard,
  parseCardEvent
} from './cards.js';
import { HELP_TEXT, MEDIA_UNSUPPORTED_TEXT } from './help.js';
import { analyzeWeComIntent } from './intent.js';
import { describeWeComError, summarizeWeComFrame } from './logger.js';
import {
  formatAttachmentNote,
  materializeWeComMedia,
  mediaRequirement,
  parseWeComMedia,
  weComMediaDir
} from './media.js';
import { formatListReply, formatStatusReply, formatTaskFooter } from './notify.js';
import { listOpenTasks, resolveWeComAction } from './resolver.js';
import { sessionKeyFromSource, sourceFromFrame } from './session.js';
import { formatWorkspaceList } from './workspace.js';

export const UNDERSTANDING_TEXT = '正在理解分析中…';
const INTENT_ACK_GRACE_MS = 150;
const PENDING = Symbol('intent-pending');

const CONTROL_TYPES = new Set([
  'help',
  'list',
  'cancel',
  'implicit-cancel',
  'status',
  'implicit-status',
  'workspace-list',
  'workspace-pick'
]);
const TERMINAL_TASK = new Set(['completed', 'failed', 'cancelled']);

export async function handleWeComMessage(frame, {
  manager,
  replyAck,
  replyProgress,
  replyCard,
  progress,
  pending,
  workspaces,
  config,
  dedup,
  attachments = [],
  understanding = null,
  intentAckGraceMs = INTENT_ACK_GRACE_MS,
  logger = console
} = {}) {
  const msgid = frame?.body?.msgid;
  if (msgid && dedup && !dedup.accept(msgid)) {
    logger.event?.('message.skip', { msgid, reason: 'duplicate' });
    return { skipped: true, reason: 'duplicate' };
  }

  const source = sourceFromFrame(frame);
  const sessionKey = sessionKeyFromSource(source);
  logger.event?.('message.in', {
    ...summarizeWeComFrame(frame),
    conversationId: source.conversationId,
    userId: source.userId,
    sessionKey
  });
  const command = bindPendingCommand(
    analyzeWeComIntent(frame?.body?.text?.content),
    pending?.get(sessionKey)
  );
  // Control words ("状态"/"终止"/"列表") stay on the regex fast path: a model
  // round trip would cost seconds before a stop can even be attempted.
  const stream = createReplyStream({ frame, replyAck, replyProgress, logger });
  if (understanding && command.type === 'implicit-route') {
    const pending = analyzeIntent(command, {
      understanding,
      manager,
      source,
      attachments,
      logger
    });
    // Most messages are classified without a model, so announcing the analysis
    // would only flash a frame the user cannot read. Announce it once it is
    // clear the answer needs waiting for.
    const settled = await Promise.race([pending, waitFor(intentAckGraceMs, PENDING)]);
    if (settled === PENDING) await stream.push(UNDERSTANDING_TEXT);
    command.intent = settled === PENDING ? await pending : settled;
    if (command.intent) await stream.push(formatIntentStage(command.intent));
  }

  const action = await resolveWeComAction(command, buildActionContext({
    source,
    config,
    workspaces,
    attachments
  }), manager);

  if (action.type === 'need-workspace') {
    pending?.set(sessionKey, {
      type: 'need-workspace',
      requirement: action.requirement,
      intent: action.intent ?? null,
      source,
      attachments
    });
  } else if (action.type === 'created' || action.type === 'workspace-switched') {
    pending?.clear(sessionKey);
  }

  const reply = replyForAction(action, command, { workspaces, config, attachments });
  const keepOpen = action.type === 'created' || action.type === 'continue';
  const card = cardForAction(action, { workspaces: workspaces?.list?.() ?? config?.workspaces ?? [] });
  // The live view appends the footer itself, so the header it reuses stays clean.
  const ack = withTaskFooter(reply, action.task);
  const streamId = await stream.push(ack, { finish: !keepOpen });
  if (card) {
    try {
      await replyCard?.(frame, card);
    } catch (error) {
      logger.error?.(`wecom-reply-card-failed:${describeWeComError(error)}`);
    }
  }
  if (keepOpen && progress && action.task?.id) {
    progress.open({
      taskId: action.task.id,
      frame,
      streamId,
      header: reply
    });
  }

  if (action.type === 'created' && action.start) {
    void Promise.resolve(manager.start(action.task.id)).catch((error) => {
      logger.error?.(`wecom-task-start-failed:${action.task.id}:${error instanceof Error ? error.message : error}`);
      logger.event?.('task.start.failed', {
        taskId: action.task.id,
        error: error instanceof Error ? error.message : String(error)
      });
      void progress?.fail?.(action.task.id, error);
    });
  }
  if (action.type === 'continue') {
    const followUp = [action.message, formatAttachmentNote(attachments)].filter(Boolean).join('\n\n');
    void Promise.resolve(manager.continue(action.task.id, followUp)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/task-already-active/.test(message)) {
        logger.event?.('task.followup.queued', { taskId: action.task.id });
        return;
      }
      logger.error?.(`wecom-task-continue-failed:${action.task.id}:${message}`);
      logger.event?.('task.continue.failed', {
        taskId: action.task.id,
        error: message
      });
      void progress?.fail?.(action.task.id, error);
    });
  }

  logger.event?.('message.out', {
    msgid,
    conversationId: source.conversationId,
    command: command?.type ?? null,
    intent: command?.intent?.kind ?? null,
    action: action?.type ?? null,
    taskId: action?.task?.id ?? null,
    streamId
  });
  return { skipped: false, command, action, intent: command.intent ?? null, reply: ack };
}

async function analyzeIntent(command, { understanding, manager, source, attachments, logger }) {
  let hasOpenTask = false;
  try {
    hasOpenTask = (await listOpenTasks(manager, source, { match: 'owner' })).length > 0;
  } catch {
    // A listing failure must not block classification; assume a fresh request.
  }
  let intent;
  try {
    intent = await understanding.analyze({ text: command.text, attachments, hasOpenTask });
  } catch (error) {
    // Routing by keyword is still better than dropping the turn.
    logger.error?.(`wecom-intent-failed:${error instanceof Error ? error.message : error}`);
    return null;
  }
  logger.event?.('intent.resolved', {
    conversationId: source.conversationId,
    kind: intent.kind,
    needsCode: intent.needsCode,
    confidence: intent.confidence,
    intentSource: intent.source,
    reason: intent.reason ?? null
  });
  return intent;
}

function waitFor(ms, value) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(value), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

export function formatIntentStage(intent) {
  if (!intent) return UNDERSTANDING_TEXT;
  const head = `这是一个**${intent.label}**任务，正在进一步解析中…`;
  return intent.summary ? `${head}\n> ${intent.summary}` : head;
}

/**
 * One WeCom stream carries every stage of a turn: the first push opens it, the
 * rest refresh it in place so the user sees one message that keeps evolving.
 */
function createReplyStream({ frame, replyAck, replyProgress, logger = console }) {
  let streamId = null;
  return {
    get id() {
      return streamId;
    },
    async push(content, { finish = false } = {}) {
      if (!streamId) {
        streamId = await replyAck?.(frame, content, { finish });
        return streamId;
      }
      if (!replyProgress) return streamId;
      try {
        await replyProgress(frame, streamId, content, finish, { blocking: true });
      } catch (error) {
        logger.error?.(`wecom-stream-update-failed:${describeWeComError(error)}`);
      }
      return streamId;
    }
  };
}

export async function handleWeComCard(frame, {
  manager,
  sendText,
  updateCard,
  progress,
  pending,
  workspaces,
  config,
  logger = console
} = {}) {
  const parsed = parseCardEvent(frame);
  const source = sourceFromFrame(frame);
  const sessionKey = sessionKeyFromSource(source);
  const waiting = pending?.get(sessionKey);
  const attachments = waiting?.attachments ?? [];
  logger.event?.('card.in', {
    ...summarizeWeComFrame(frame),
    conversationId: source.conversationId,
    action: parsed.action,
    value: parsed.value ?? null
  });

  if (parsed.action === 'cancel' && parsed.value) {
    if (updateCard) {
      try {
        await updateCard(frame, buildCancelledCard(parsed.value, parsed.cardTaskId));
      } catch (error) {
        logger.error?.(`wecom-card-update-failed:${parsed.value}:${describeWeComError(error)}`);
      }
    }
    void progress?.cancel?.(parsed.value);
    try {
      await manager.cancel(parsed.value);
    } catch (error) {
      logger.error?.(`wecom-card-cancel-failed:${parsed.value}:${describeWeComError(error)}`);
    }
    if (!updateCard) {
      await pushText(sendText, source, `已取消任务 **${parsed.value}**`, logger);
    }
    return { skipped: false, command: { type: 'cancel', taskId: parsed.value }, action: { type: 'cancelled' } };
  }

  if (parsed.action === 'ws') {
    const command = waiting?.type === 'need-workspace'
      ? {
        type: 'workspace-choice',
        target: parsed.value,
        requirement: waiting.requirement,
        intent: waiting.intent ?? null
      }
      : { type: 'workspace-switch', target: parsed.value };
    const action = await resolveWeComAction(command, buildActionContext({
      source,
      config,
      workspaces,
      attachments
    }), manager);
    if (action.type === 'created') pending?.clear(sessionKey);
    const reply = replyForAction(action, command, { workspaces, config, attachments });
    if (updateCard) {
      try {
        const workspace = action.workspace ?? action.task?.workspace ?? null;
        await updateCard(frame, buildWorkspaceSwitchedCard(workspace, parsed.cardTaskId));
      } catch (error) {
        logger.error?.(`wecom-card-update-failed:${parsed.value}:${describeWeComError(error)}`);
      }
    }
    // No live stream here: a card click cannot open one, so the task reports
    // through the terminal notify instead.
    const ack = withTaskFooter(reply, action.task);
    await pushText(sendText, source, ack, logger);
    if (action.type === 'created' && action.task?.id) {
      void Promise.resolve(manager.start(action.task.id)).catch((error) => {
        logger.error?.(`wecom-task-start-failed:${action.task.id}:${error instanceof Error ? error.message : error}`);
        logger.event?.('task.start.failed', {
          taskId: action.task.id,
          error: error instanceof Error ? error.message : String(error)
        });
        void progress?.fail?.(action.task.id, error);
      });
    }
    logger.event?.('card.out', {
      conversationId: source.conversationId,
      command: command?.type ?? null,
      action: action?.type ?? null,
      taskId: action?.task?.id ?? null
    });
    return { skipped: false, command, action, reply: ack };
  }

  logger.warn?.(`wecom-card-event-unknown:${parsed.action ?? 'none'}`);
  return { skipped: true, reason: 'unknown-card-event' };
}

async function pushText(sendText, source, content, logger) {
  if (!sendText) return false;
  try {
    await sendText(content, source);
    return true;
  } catch (error) {
    logger.error?.(`wecom-card-reply-failed:${describeWeComError(error)}`);
    return false;
  }
}

export async function handleWeComMedia(frame, deps = {}) {
  const {
    replyAck,
    dedup,
    downloadFile,
    config,
    logger = console
  } = deps;
  const msgid = frame?.body?.msgid;
  if (msgid && dedup && !dedup.accept(msgid)) {
    logger.event?.('message.skip', { msgid, reason: 'duplicate' });
    return { skipped: true, reason: 'duplicate' };
  }

  const parsed = parseWeComMedia(frame);
  logger.event?.('message.media', {
    ...summarizeWeComFrame(frame),
    mediaType: parsed.type,
    assets: parsed.assets.length
  });
  if (parsed.type === 'unknown') {
    await replyAck?.(frame, MEDIA_UNSUPPORTED_TEXT, { finish: true });
    return { skipped: false, command: { type: 'media' }, parsed };
  }

  let attachments = [];
  try {
    attachments = await materializeWeComMedia(parsed, {
      downloadFile,
      dir: weComMediaDir(config, frame)
    });
  } catch (error) {
    logger.error?.(`wecom-media-download-failed:${error instanceof Error ? error.message : error}`);
    await replyAck?.(frame, '媒体下载失败，请稍后重试或改发文本。', { finish: true });
    return { skipped: false, command: { type: 'media' }, parsed, error };
  }

  const text = mediaRequirement(parsed, attachments);
  const synthetic = {
    ...frame,
    body: {
      ...frame.body,
      msgtype: 'text',
      text: { content: text }
    }
  };
  return handleWeComMessage(synthetic, {
    ...deps,
    attachments,
    dedup: null
  });
}

function bindPendingCommand(command, waiting) {
  if (waiting?.type !== 'need-workspace') return command;
  if (CONTROL_TYPES.has(command.type)) return command;
  const text = command.target
    ?? command.text
    ?? command.requirement
    ?? '';
  return {
    type: 'workspace-choice',
    text,
    target: text,
    requirement: waiting.requirement,
    intent: waiting.intent ?? null
  };
}

function buildActionContext({ source, config, workspaces, attachments = [] }) {
  const sessionKey = sessionKeyFromSource(source);
  return {
    source,
    repository: config?.repository ?? null,
    baseBranch: config?.baseBranch ?? 'main',
    botRoot: config?.root ?? process.cwd(),
    workspaces: workspaces?.list?.() ?? config?.workspaces ?? [],
    workspace: workspaces?.getActive?.(sessionKey) ?? null,
    currentWorkspace: config?.currentWorkspace ?? null,
    requireWorkspace: workspaces ? !workspaces.hasConfigured() : !config?.repository,
    switchWorkspace: (target) => workspaces?.switchTo?.(target, { conversationId: sessionKey }),
    rememberWorkspace: (_conversationId, workspace) => workspaces?.remember?.(sessionKey, workspace),
    attachments
  };
}

function withTaskFooter(text, task) {
  const footer = formatTaskFooter(task?.id, { running: task ? !TERMINAL_TASK.has(task.status) : false });
  return footer ? `${text}\n\n${footer}` : text;
}

function cardForAction(action, extras = {}) {
  if (action.type === 'need-workspace' || action.type === 'workspace-pick') {
    return buildWorkspacePickerCard(extras.workspaces ?? []);
  }
  return null;
}

function replyForAction(action, command, extras = {}) {
  if (action.type === 'created') {
    const where = describeTaskWorkspace(action.workspace ?? action.task?.workspace);
    const kind = action.intent?.label ? ` · ${action.intent.label}` : '';
    return withAttachments(
      `**${action.task.id}**${kind}\n${action.task.requirement}\n${where}`,
      extras.attachments
    );
  }
  if (action.type === 'continue') {
    return withAttachments(
      `**${action.task.id}** 继续\n${action.message}`,
      extras.attachments
    );
  }
  if (action.type === 'status') {
    return formatStatusReply(action.task, action.scheduler);
  }
  if (action.type === 'cancelled') {
    return `已取消任务 **${action.task.id}**`;
  }
  if (action.type === 'list') {
    return formatListReply(action.tasks);
  }
  if (action.type === 'need-workspace' || action.type === 'workspace-list' || action.type === 'workspace-pick') {
    return action.message;
  }
  if (action.type === 'workspace-switched') {
    return `已切换到 **${action.workspace.name}**\n${action.workspace.repository ?? action.workspace.cwd}`;
  }
  if (action.type === 'error' || action.type === 'ack') {
    return action.message;
  }
  if (command?.type === 'workspace-list') {
    return formatWorkspaceList(extras.workspaces?.list?.() ?? [], extras.workspaces?.getActive?.()?.id);
  }
  return HELP_TEXT;
}

function describeTaskWorkspace(workspace) {
  if (!workspace) return '未指定（将询问或使用运行目录）';
  if (workspace.repository) return `${workspace.repository}（Cloud / AAFE git）`;
  return `${workspace.cwd}（本地 / AAFE git）`;
}

function withAttachments(text, attachments) {
  if (!attachments?.length) return text;
  return `${text}\n${formatAttachmentNote(attachments)}`;
}
