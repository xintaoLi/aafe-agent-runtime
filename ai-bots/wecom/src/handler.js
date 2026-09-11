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
  buildTaskCard,
  buildCancelledCard,
  buildWorkspacePickerCard,
  buildWorkspaceSwitchedCard,
  parseCardEvent
} from './cards.js';
import { HELP_TEXT, IDENTITY_TEXT, MEDIA_UNSUPPORTED_TEXT, UNCLEAR_TEXT, greetingText } from './help.js';
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
import { parseWeComQuote } from './quote.js';
import { buildTaskPresentation, taskFeedbackRevision } from './presentation.js';
import { renderStoredProcess } from './progress.js';
import { splitWeComMarkdown } from './markdown.js';
import { canAccessTask, canControlTask, listOpenTasks, listOwnerContinuable, resolvePendingGateReply, resolveWeComAction } from './resolver.js';
import { sessionKeyFromSource, sourceFromFrame } from './session.js';
import { pickSmalltalkReply } from './smalltalk.js';
import { fastIntent } from './understand.js';
import { extractWorkspaceTargets, formatWorkspaceList } from './workspace.js';

export const UNDERSTANDING_TEXT = '正在理解分析中…';
export const REUSE_ANALYSIS_TEXT = '这是对上一轮结论的后续指令。请直接复用已有分析与上下文执行，不要重新从零分析，除非结论已过时或本次明确要求重做。';
const INTENT_ACK_GRACE_MS = 150;
const PENDING = Symbol('intent-pending');

export const THINKING_TEXT = '让我想想…';

const CONTROL_TYPES = new Set([
  'help',
  'smalltalk',
  'list',
  'cancel',
  'implicit-cancel',
  'status',
  'implicit-status',
  'workspace-list',
  'workspace-pick'
]);
const TERMINAL_TASK = new Set(['completed', 'failed', 'cancelled', 'blocked']);

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
  models = null,
  attachments = [],
  understanding = null,
  chat = null,
  random = Math.random,
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
  let quote = parseWeComQuote(frame);
  logger.event?.('message.in', {
    ...summarizeWeComFrame(frame),
    conversationId: source.conversationId,
    userId: source.userId,
    sessionKey,
    quoted: quote.present
  });

  // WeCom only pushes group messages that @ the bot, so this is a second line
  // of defence rather than the gate. It logs by default instead of dropping,
  // because a mixed message can carry the mention outside the text items and
  // silently swallowing a real request is worse than handling a stray one.
  if (source.chattype === 'group' && !mentionsAnyone(frame)) {
    logger.event?.('message.skip', {
      msgid,
      reason: 'group-no-mention',
      enforced: Boolean(config?.requireGroupMention)
    });
    if (config?.requireGroupMention) return { skipped: true, reason: 'group-no-mention' };
  }

  const waiting = pending?.get(sessionKey);
  const parsed = analyzeWeComIntent(frame?.body?.text?.content);
  const gateReply = !waiting && !quote.present && ['ack', 'implicit-route'].includes(parsed.type)
    ? await resolvePendingGateReply(parsed.text, source, manager) : null;
  const command = gateReply ?? bindPendingCommand(parsed.type === 'ack' && quote.present
    ? { ...parsed, type: 'implicit-route', prefer: 'follow' } : parsed, waiting);
  if (command.clarification) {
    if (!quote.present && waiting?.quote?.present) quote = waiting.quote;
    attachments = [...(waiting?.attachments ?? []), ...attachments]
      .filter((item, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);
  }
  // Control words ("状态"/"终止"/"列表") stay on the regex fast path: a model
  // round trip would cost seconds before a stop can even be attempted.
  const stream = createReplyStream({ frame, replyAck, replyProgress, logger });
  if (command.feedbackTask) {
    const target = await manager.get(command.taskId).catch(() => null);
    if (!target || !canControlTask(target, source) || target.status !== 'blocked'
      || command.feedbackRevision !== taskFeedbackRevision(target)) {
      pending?.clear(sessionKey);
      const reply = '原任务状态或操作权限已变化。请先查询状态，再明确要继续的任务。';
      await stream.push(reply, { finish: true });
      return { skipped: true, reason: 'feedback-task-changed', reply };
    }
  }
  if (waiting?.type === 'task-feedback' && command.type === 'implicit-cancel') {
    pending?.clear(sessionKey);
    const reply = '已退出补充信息，原任务仍保留。';
    await stream.push(reply, { finish: true });
    return { skipped: false, action: { type: 'feedback-cancelled' }, reply };
  }
  if (waiting?.type === 'need-intent' && command.type === 'implicit-cancel') {
    pending?.clear(sessionKey);
    const reply = '已取消待澄清请求，未执行任务。';
    await stream.push(reply, { finish: true });
    return { skipped: false, command, action: { type: 'clarification-cancelled' }, reply };
  }

  // Saying hello is a conversation, not a command. Dumping the manual here is
  // what made the bot feel mechanical, so these get a real answer instead.
  if (command.type === 'smalltalk') {
    const answer = await smalltalkReply(command, { manager, source, random, logger });
    const streamId = await stream.push(answer, { finish: true });
    const action = { type: 'smalltalk', kind: command.kind };
    logger.event?.('message.out', {
      msgid,
      conversationId: source.conversationId,
      command: command.type,
      intent: command.kind,
      action: action.type,
      taskId: null,
      streamId
    });
    return { skipped: false, command, action, intent: null, reply: answer };
  }

  if ((understanding || config?.workflow) && command.type === 'implicit-route') {
    const analysis = analyzeIntent(command, {
      understanding: understanding ?? { analyze: (input) => fastIntent(input.text, input) },
      manager,
      source,
      attachments,
      quote,
      logger
    });
    // Most messages are classified without a model, so announcing the analysis
    // would only flash a frame the user cannot read. Announce it once it is
    // clear the answer needs waiting for.
    const settled = await Promise.race([analysis, waitFor(intentAckGraceMs, PENDING)]);
    if (settled === PENDING) await stream.push(UNDERSTANDING_TEXT);
    command.intent = settled === PENDING ? await analysis : settled;
    if (!['code', 'analysis', 'question', 'followup'].includes(command.intent?.kind)
      || !Number.isFinite(command.intent?.confidence)
      || command.intent.confidence > 1
      || command.intent.confidence < (config?.workflow?.intentConfidence ?? 0.7)
      || (command.intent.kind === 'code' && command.intent.needsCode === false)) {
      const reply = command.clarification
        ? '已保留原请求和补充，但还缺一个明确的预期结果（ask）。请说明“要解决什么问题、做到什么程度”；已提供的 PR、仓库和附件无需重复发送。也可回复“仅分析，不修改”或“修改实现”。'
        : '还需要确认这次要完成的具体结果（ask）：是仅分析原因，还是修改实现并验证？已提供的 PR、仓库和附件会保留，确认前不执行。';
      pending?.set(sessionKey, { type: 'need-intent',
        text: command.clarification?.request ?? command.text,
        feedback: command.clarification?.feedback ?? [], attachments, quote });
      await stream.push(reply, { finish: true });
      return { skipped: false, command, action: { type: 'clarify' }, intent: command.intent, reply };
    }
    if (understanding && command.intent) await stream.push(formatIntentStage(command.intent));

    // A question that needs no repository is answered here and now. Spinning up
    // an agent, a branch and a task record to say one paragraph is theatre.
    if (chat && ['question', 'analysis'].includes(command.intent?.kind) && command.intent.needsCode === false) {
      const answer = await Promise.resolve().then(() => chat?.reply(command.text)).catch(() => null)
        || '暂时无法回答这个问题，请稍后重试。';
      if (answer) {
        pending?.clear(sessionKey);
        const streamId = await stream.push(answer, { finish: true });
        const action = { type: 'answer' };
        logger.event?.('message.out', {
          msgid,
          conversationId: source.conversationId,
          command: command.type,
          intent: command.intent.kind,
          action: action.type,
          taskId: null,
          streamId
        });
        return { skipped: false, command, action, intent: command.intent, reply: answer };
      }
    }
  }

  // Without the analyzer, preserve the explicit command router's task anchors.
  if (!understanding && !config?.workflow && command.type === 'implicit-route') delete command.intent;
  const action = await resolveWeComAction(command, buildActionContext({
    source,
    config,
    workspaces,
    attachments,
    models,
    quote,
    requestTexts: command.clarification
      ? [command.clarification.request, ...command.clarification.feedback]
      : [command.text ?? command.requirement ?? '']
  }), manager);

  if (action.type === 'need-workspace') {
    pending?.set(sessionKey, {
      type: 'need-workspace',
      requirement: action.requirement,
      intent: action.intent ?? null,
      provider: action.provider ?? command.provider ?? null,
      source,
      attachments
    });
  } else if (['created', 'continue', 'cancelled'].includes(action.type)
    || (action.type === 'workspace-switched' && waiting?.type !== 'need-intent')) {
    pending?.clear(sessionKey);
  }

  const reply = replyForAction(action, command, { workspaces, config, attachments });
  const keepOpen = action.type === 'created' || action.type === 'continue';
  const pickerCard = cardForAction(action, { workspaces: workspaces?.list?.() ?? config?.workspaces ?? [] });
  const taskCard = keepOpen && action.task?.id ? buildTaskCard(
    action.type === 'continue' ? { ...action.task, status: 'queued' } : action.task
  ) : null;
  // The live view appends the footer itself, so the header it reuses stays clean.
  const ack = withTaskFooter(reply, action.task);
  const streamId = await stream.push(ack, {
    finish: !keepOpen
  });
  if (pickerCard) {
    try {
      await replyCard?.(frame, pickerCard);
    } catch (error) {
      logger.error?.(`wecom-reply-card-failed:${describeWeComError(error)}`);
    }
  }
  if (taskCard) {
    try {
      await replyCard?.(frame, taskCard);
    } catch (error) {
      logger.error?.(`wecom-task-card-failed:${describeWeComError(error)}`);
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
    const followUp = [
      TERMINAL_TASK.has(action.task?.status) ? REUSE_ANALYSIS_TEXT : null,
      action.message,
      formatAttachmentNote(attachments)
    ].filter(Boolean).join('\n\n');
    // Who said it travels with the text: the agent has to know whether this is
    // the task owner changing the requirement or a bystander adding detail.
    const author = { userId: source.userId ?? null, role: action.actorRole ?? 'owner' };
    const nextIntent = fastIntent(action.message, { hasActiveTask: true });
    const executionIntent = nextIntent?.kind === 'code' || ['apply', 'ship'].includes(nextIntent?.action)
      ? { ...nextIntent, kind: 'code', needsCode: true } : nextIntent;
    const nextModel = action.task.provider !== 'codex' && ['code', 'analysis', 'question'].includes(executionIntent?.kind) && author.role === 'owner'
      ? models?.select?.({ stage: 'task', intent: executionIntent, text: action.message })?.model : null;
    void Promise.resolve(manager.continue(action.task.id, followUp, { author, intent: executionIntent, ...(nextModel ? { model: nextModel } : {}), messageId: msgid })).catch((error) => {
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
    // Which evidence bound the message, so a wrong target is explainable from
    // the log rather than reconstructed from the conversation.
    anchor: action?.anchor ?? null,
    anchorVia: action?.via ?? null,
    anchorConfidence: action?.confidence ?? null,
    streamId
  });
  return { skipped: false, command, action, intent: command.intent ?? null, reply: ack };
}

async function analyzeIntent(command, { understanding, manager, source, attachments, quote, logger }) {
  let hasActiveTask = false;
  let hasRecentTask = false;
  try {
    const hints = await listOwnerContinuable(manager, source);
    hasActiveTask = hints.hasActiveTask;
    hasRecentTask = hints.hasRecentTask;
  } catch {
    // A listing failure must not block classification; assume a fresh request.
  }
  let intent;
  try {
    intent = await understanding.analyze({
      text: command.intentText ?? command.text,
      clarification: command.clarification ?? null,
      attachments,
      hasActiveTask,
      hasRecentTask,
      quote
    });
  } catch (error) {
    // Classification failure must ask instead of dispatching unknown work.
    logger.error?.(`wecom-intent-failed:${error instanceof Error ? error.message : error}`);
    return null;
  }
  logger.event?.('intent.resolved', {
    conversationId: source.conversationId,
    kind: intent?.kind,
    needsCode: intent?.needsCode,
    confidence: intent?.confidence,
    intentSource: intent?.source,
    intentBackend: understanding.backend ?? 'custom',
    reason: intent?.reason ?? null
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
  // A question is about to be answered, not turned into a task; calling it one
  // sets the wrong expectation for the message that follows.
  if (['question', 'analysis'].includes(intent.kind) && intent.needsCode === false) return THINKING_TEXT;
  const head = `这是一个**${intent.label}**任务，正在进一步解析中…`;
  return intent.summary ? `${head}\n> ${intent.summary}` : head;
}

/**
 * Greetings, identity and gibberish are answered from local text: the bot
 * already knows what it is, and a model round trip would make the cheapest
 * messages the slowest ones. Only open questions are worth the call.
 */
async function smalltalkReply(command, { manager, source, random, logger }) {
  if (command.kind === 'identity') return IDENTITY_TEXT;
  const canned = pickSmalltalkReply(command.kind, { random });
  if (canned) return canned;
  if (command.kind === 'greeting') {
    const open = await listOpenTasks(manager, source).catch((error) => {
      logger?.warn?.(`wecom-open-tasks-failed:${error instanceof Error ? error.message : error}`);
      return [];
    });
    return greetingText(open);
  }
  return UNCLEAR_TEXT;
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
        const ack = unwrapStreamAck(await replyAck?.(frame, content, { finish }));
        streamId = ack.streamId;
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

function unwrapStreamAck(result) {
  if (!result) return { streamId: null };
  if (typeof result === 'string') return { streamId: result };
  return {
    streamId: result.streamId ?? result.id ?? null
  };
}

export async function handleWeComCard(frame, {
  manager,
  sendText,
  models,
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
  if (['status', 'process', 'cancel', 'feedback'].includes(parsed.action) && parsed.value) {
    const task = await manager.get(parsed.value).catch(() => null);
    if (!task || !canAccessTask(task, source)) {
      await pushText(sendText, source, `找不到任务 ${parsed.value}`, logger);
      return { skipped: true, reason: 'task-inaccessible' };
    }
  }
  logger.event?.('card.in', {
    ...summarizeWeComFrame(frame),
    conversationId: source.conversationId,
    action: parsed.action,
    value: parsed.value ?? null
  });

  // Reading is open to the whole conversation, so this needs no owner check —
  // and it must not disturb the card, which still belongs to the running task.
  if (parsed.action === 'status' && parsed.value) {
    const task = await manager.get(parsed.value).catch(() => null);
    const text = task
      ? formatStatusReply(task, manager.stats?.() ?? null)
      : `找不到任务 ${parsed.value}`;
    await pushText(sendText, source, text, logger);
    logger.event?.('card.out', {
      conversationId: source.conversationId,
      command: 'status',
      action: task ? 'status' : 'error',
      taskId: parsed.value
    });
    return { skipped: false, command: { type: 'status', taskId: parsed.value }, action: { type: 'status', task }, reply: text };
  }

  if (parsed.action === 'process' && parsed.value) {
    const task = await manager.get(parsed.value).catch(() => null);
    const cached = progress?.renderProcess?.(parsed.value);
    const events = cached ? [] : await manager.events?.(parsed.value).catch(() => []);
    const text = cached || (task && renderStoredProcess(task, events))
      || `找不到任务 ${parsed.value} 的过程记录。任务结束后过程会保留一段时间，也可发送 \`状态 ${parsed.value}\`。`;
    await pushText(sendText, source, text, logger);
    logger.event?.('card.out', {
      conversationId: source.conversationId,
      command: 'process',
      action: 'process',
      taskId: parsed.value
    });
    return { skipped: false, command: { type: 'process', taskId: parsed.value }, action: { type: 'process' }, reply: text };
  }

  if (parsed.action === 'feedback' && parsed.value) {
    const task = await manager.get(parsed.value).catch(() => null);
    if (!task || !canControlTask(task, source)) {
      await pushText(sendText, source, '只有任务发起人可以通过此入口补充执行指令。', logger);
      return { skipped: true, reason: 'not-task-owner' };
    }
    if (task.status !== 'blocked') {
      await pushText(sendText, source, '任务状态已变化，请点击「查看状态」。', logger);
      return { skipped: true, reason: 'task-not-blocked' };
    }
    const view = buildTaskPresentation(task);
    if (pending) pending.set(sessionKey, { type: 'task-feedback', taskId: task.id, revision: taskFeedbackRevision(task) });
    const text = [view.question, pending
      ? '请直接回复补充内容，将续接下方任务；发送「取消」退出补充。点击本按钮不会执行或批准提交。'
      : '请发送 `继续 <对话ID>：<反馈>` 续接任务。', formatTaskFooter(task.id)].join('\n\n');
    await pushText(sendText, source, text, logger);
    return { skipped: false, action: { type: 'need-feedback', task }, reply: text };
  }

  if (parsed.action === 'cancel' && parsed.value) {
    // The card is visible to the whole group, so the button has to answer to
    // the same owner check the typed command does; otherwise the permission
    // gate is one tap wide.
    const target = await manager.get(parsed.value).catch(() => null);
    if (target && !canControlTask(target, source)) {
      logger.event?.('card.denied', { taskId: parsed.value, userId: source.userId ?? null });
      await pushText(sendText, source, `任务 **${parsed.value}** 由 ${target.source?.userId ?? '其他人'} 发起，只有发起人能终止。`, logger);
      return { skipped: true, reason: 'not-task-owner' };
    }
    try {
      await manager.cancel(parsed.value);
    } catch (error) {
      logger.error?.(`wecom-card-cancel-failed:${parsed.value}:${describeWeComError(error)}`);
      await pushText(sendText, source, `任务 ${parsed.value} 取消未成功，请查询状态后重试。`, logger);
      return { skipped: false, action: { type: 'error' }, error };
    }
    if (updateCard) {
      try {
        await updateCard(frame, buildCancelledCard(parsed.value, parsed.cardTaskId));
      } catch (error) {
        logger.error?.(`wecom-card-update-failed:${parsed.value}:${describeWeComError(error)}`);
      }
    }
    await progress?.cancel?.(parsed.value);
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
        intent: waiting.intent ?? null,
        provider: waiting.provider ?? null
      }
      : { type: 'workspace-switch', target: parsed.value };
    const action = await resolveWeComAction(command, buildActionContext({
      source,
      config,
      workspaces,
      attachments,
      models
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
    for (const page of splitWeComMarkdown(content)) await sendText(page, source);
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
  if (waiting?.type === 'task-feedback' && ['implicit-route', 'ack'].includes(command.type)
    && command.prefer !== 'new') {
    return { type: 'continue', taskId: waiting.taskId, message: command.text,
      feedbackTask: true, feedbackRevision: waiting.revision };
  }
  if (waiting?.type === 'need-intent' && ['implicit-route', 'ack'].includes(command.type)) {
    const feedback = [...(waiting.feedback ?? []), command.text].slice(-4);
    return { ...command, type: 'implicit-route', intentText: command.text,
      text: `此前待澄清的请求：${waiting.text}\n用户补充（以后面的明确限制为准）：\n${feedback.join('\n')}`,
      clarification: { request: waiting.text, feedback } };
  }
  if (waiting?.type !== 'need-workspace') return command;
  if (CONTROL_TYPES.has(command.type)) return command;
  if (command.type === 'create' || command.type === 'continue') return command;
  const text = command.target
    ?? command.text
    ?? command.requirement
    ?? '';
  const targets = extractWorkspaceTargets(text);
  if (targets.length > 1) return { type: 'error', message: '本条消息指定了多个目标仓库，请明确本次使用哪个仓库。' };
  const target = targets[0] ?? text;
  const clarification = { request: waiting.requirement, feedback: [text] };
  return {
    type: 'workspace-choice',
    text,
    target,
    requirement: targets.length ? waiting.requirement + '\n用户补充：\n' + text : waiting.requirement,
    intent: fastIntent(text, { clarification }) ?? waiting.intent ?? null,
    provider: waiting.provider ?? command.provider ?? null
  };
}

function buildActionContext({ source, config, workspaces, attachments = [], models = null, quote = null, requestTexts = null }) {
  const sessionKey = sessionKeyFromSource(source);
  return {
    source,
    requestTexts,
    repository: config?.repository ?? null,
    baseBranch: config?.baseBranch ?? 'main',
    botRoot: config?.root ?? process.cwd(),
    workspaces: workspaces?.list?.() ?? config?.workspaces ?? [],
    workspace: workspaces?.getActive?.(sessionKey) ?? null,
    currentWorkspace: config?.currentWorkspace ?? null,
    requireWorkspace: workspaces ? !workspaces.hasConfigured() : !config?.repository,
    switchWorkspace: (target) => workspaces?.switchTo?.(target, { conversationId: sessionKey }),
    rememberWorkspace: (_conversationId, workspace) => workspaces?.remember?.(sessionKey, workspace),
    selectModel: models ? (input) => models.select({ ...input, attachments }) : null,
    codexModel: config?.codex?.model ?? null,
    attachments,
    quote,
    tapd: config?.tapd ?? { enabled: true },
    provider: config?.agent?.provider ?? 'cursor'
  };
}

/**
 * The mention is plain text in the body, not a structured field, so this is all
 * there is to look at. Mixed messages are flattened first because the `@` may
 * sit in a different item than the request.
 */
function mentionsAnyone(frame) {
  const body = frame?.body ?? {};
  const parts = [body.text?.content ?? ''];
  for (const item of body.mixed?.msg_item ?? []) {
    if (item?.text?.content) parts.push(item.text.content);
  }
  const raw = parts.join(' ').trim();
  return raw.length === 0 || raw.includes('@');
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
    const model = action.task?.model ? ` · ${action.task.model}` : '';
    const engine = action.task?.provider === 'codex' || action.provider === 'codex' ? ' · Codex' : '';
    return withAttachments(
      `**${action.task.id}**${kind}${model}${engine}\n${action.task.requirement}\n${where}`,
      extras.attachments
    );
  }
  if (action.type === 'continue') {
    return withAttachments(
      [`**${action.task.id}** 继续`, action.message, continueNote(action)]
        .filter(Boolean)
        .join('\n'),
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

/**
 * An implicit binding is a guess, so it is stated out loud with the way out of
 * it in the same line: the user sees the wrong target on the next message
 * instead of discovering it in the agent's report.
 */
function continueNote(action) {
  const notes = [];
  if (action.anchor === 'active') {
    notes.push('已追加到你最近活跃的任务。要换目标请引用那条任务消息，或发送「继续 <TaskID>：<补充>」。');
  } else if (action.anchor === 'recent') {
    notes.push('已接着刚完成的任务继续，会复用上一轮分析结论。要换目标请引用那条任务消息，或发送「继续 <TaskID>：<补充>」。');
  } else if (action.via === 'requirement-match') {
    notes.push('按引用内容匹配到该任务。');
  } else if (action.via === 'tapd-story') {
    notes.push('按引用里的 TAPD 单号匹配到该任务。');
  } else if (action.via === 'task-suffix') {
    notes.push('按 Task ID 后缀匹配到该任务。');
  }
  if (action.actorRole === 'participant' && action.ownerId) {
    notes.push(`已作为 ${action.ownerId} 任务的补充记录。`);
  }
  return notes.length ? `_${notes.join(' ')}_` : null;
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
