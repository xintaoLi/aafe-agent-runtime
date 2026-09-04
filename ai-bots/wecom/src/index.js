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

import { pathToFileURL } from 'node:url';
import { createTaskManager } from '../../../src/agent-platform/tasks/index.js';
import { resolveCursorMcpForRun, toCursorMcpServers } from '../../../src/cli/agentMcp.js';
import { createTaskManagerOptions, loadWeComBotConfig, persistCurrentWorkspace } from './config.js';
import { createWeComLogger, describeWeComError, resolveWeComLogConfig } from './logger.js';
import { createMessageDedup } from './dedup.js';
import { createWeComGateway } from './gateway.js';
import { handleWeComCard, handleWeComMedia, handleWeComMessage } from './handler.js';
import { attachWeComNotifier } from './notify.js';
import { createPendingStore } from './pending.js';
import { createWeComProgressHub } from './progress.js';
import { createIntentAnalyzer } from './understand.js';
import { createWorkspaceStore } from './workspace.js';

export { loadWeComBotConfig, createTaskManagerOptions } from './config.js';
export { parseWeComCommand, stripMentions } from './commands.js';
export { analyzeWeComIntent } from './intent.js';
export { createMessageDedup } from './dedup.js';
export { resolveWeComAction } from './resolver.js';
export { attachWeComNotifier, formatTaskNotify } from './notify.js';
export { createWeComProgressHub, formatProgressEvent, renderProgressView } from './progress.js';
export { handleWeComMessage, handleWeComCard, handleWeComMedia } from './handler.js';
export { createWeComGateway } from './gateway.js';
export { createWorkspaceStore, classifyWorkspaceTarget } from './workspace.js';
export { parseCardEvent, buildCancelledCard } from './cards.js';
export { createWeComLogger, resolveWeComLogConfig } from './logger.js';
export { parseWeComMedia, mediaRequirement, inferMediaType } from './media.js';
export { createIntentAnalyzer, classifyIntentByRules, parseIntent } from './understand.js';

/**
 * Resident WeCom process. Must not reuse `aafe task`'s manager.close() on idle.
 */
export async function startWeComBot(options = {}) {
  const config = options.config ?? await loadWeComBotConfig(options);
  const logConfig = config.log ?? resolveWeComLogConfig({
    env: options.env ?? process.env,
    root: config.root
  });
  const logger = options.logger ?? createWeComLogger({
    ...logConfig,
    sink: console
  });
  const mcp = options.mcpServers
    ? { servers: options.mcpServers }
    : await resolveCursorMcpForRun(config.agent?.mcp, {
      root: config.root,
      env: options.env ?? process.env
    });

  const manager = options.manager ?? createTaskManager(createTaskManagerOptions(config, {
    mcpServers: toCursorMcpServers(mcp.servers)
  }));
  if (options.recoverOnStart !== false) {
    await manager.initialize();
  }

  const sdk = options.sdk ?? (options.WSClient ? {} : await loadWeComSdk());
  const WSClient = options.WSClient ?? sdk.default?.WSClient ?? sdk.WSClient ?? sdk.AiBot?.WSClient;
  const generateReqId = options.generateReqId ?? sdk.generateReqId;
  const gateway = options.gateway ?? createWeComGateway({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl,
    WSClient,
    generateReqId,
    logger
  });

  const dedup = options.dedup ?? createMessageDedup();
  const pending = options.pending ?? createPendingStore();
  const workspaces = options.workspaces ?? createWorkspaceStore(config, {
    persistCurrent: (id) => persistCurrentWorkspace(config.localConfigPath, id)
  });
  const replyAck = (frame, content, extra) => gateway.replyAck(frame, content, extra);
  const replyProgress = (frame, streamId, content, finish, extra) =>
    gateway.replyProgress(frame, streamId, content, finish, extra);
  const replyCard = (frame, card) => gateway.replyCard(frame, card);
  const understanding = options.understanding ?? createIntentAnalyzer({
    settings: config.intent ?? {},
    env: options.env ?? process.env,
    logger
  });
  const progress = options.progress ?? createWeComProgressHub({
    replyProgress: (frame, streamId, content, finish) => gateway.replyProgress(frame, streamId, content, finish),
    logger
  });
  attachWeComNotifier({
    manager,
    sendMessage: (chatid, body) => gateway.sendMessage(chatid, body),
    sendMedia: (chatid, type, mediaId, extra) => gateway.sendMedia(chatid, type, mediaId, extra),
    uploadMedia: (buffer, options) => gateway.uploadMedia(buffer, options),
    progress,
    logger
  });

  // A rejected handler must never reach the process: Node would exit the bot.
  const guard = (what, work) => {
    void Promise.resolve()
      .then(work)
      .catch((error) => {
        logger.error?.(`wecom-${what}-failed:${describeWeComError(error)}`);
        logger.event?.(`${what}.failed`, { error: describeWeComError(error) });
      });
  };

  gateway.onText((frame) => guard('message', () => handleWeComMessage(frame, {
    manager, replyAck, replyProgress, replyCard, progress, pending, workspaces, config, dedup,
    understanding, logger
  })));
  gateway.onCard?.((frame) => guard('card', () => handleWeComCard(frame, {
    manager,
    sendText: (content, source) => gateway.sendMarkdown(source, content),
    updateCard: (cardFrame, card) => gateway.updateCard(cardFrame, card),
    progress,
    pending,
    workspaces,
    config,
    logger
  })));
  gateway.onMedia((frame) => guard('media', () => handleWeComMedia(frame, {
    manager,
    replyAck,
    replyProgress,
    replyCard,
    understanding,
    progress,
    pending,
    workspaces,
    config,
    dedup,
    logger,
    downloadFile: (url, aeskey) => gateway.downloadFile(url, aeskey)
  })));
  gateway.onEnterChat((frame) => guard('welcome', () => gateway.replyWelcome(frame)));

  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info?.(`wecom-bot shutdown:${reason}`);
    logger.event?.('bot.shutdown', { reason });
    try { await progress.close?.(); } catch { /* ignore */ }
    try { await logger.flush?.(); } catch { /* ignore */ }
    try { gateway.disconnect(); } catch { /* ignore */ }
    try { await manager.close(); } catch { /* ignore */ }
    if (options.exitOnShutdown !== false) process.exit(reason === 'kicked' ? 1 : 0);
  };

  gateway.onKicked(() => {
    logger.error?.('wecom-bot kicked by another connection; exiting to keep a single socket');
    logger.event?.('bot.kicked', {});
    void shutdown('kicked');
  });

  if (options.installSignals !== false) {
    process.once('SIGINT', () => { void shutdown('sigint'); });
    process.once('SIGTERM', () => { void shutdown('sigterm'); });
  }

  gateway.connect();
  if (logger.enabled) {
    logger.info?.(`wecom-log enabled dir=${logger.dir}`);
  }
  logger.event?.('bot.start', {
    wsUrl: config.wsUrl,
    workspace: config.currentWorkspace ?? null,
    logEnabled: Boolean(logger.enabled),
    logDir: logger.dir ?? null
  });
  logger.info?.(`wecom-bot connecting ${config.wsUrl}`);

  if (options.keepAlive === false) return { manager, gateway, config, shutdown };
  return new Promise(() => {});
}

export async function loadWeComSdk() {
  try {
    return await import('@wecom/aibot-node-sdk');
  } catch (first) {
    try {
      return await import(new URL('../node_modules/@wecom/aibot-node-sdk/dist/index.js', import.meta.url));
    } catch {
      throw new Error(`wecom-sdk-unavailable:${first instanceof Error ? first.message : first}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await startWeComBot();
}
