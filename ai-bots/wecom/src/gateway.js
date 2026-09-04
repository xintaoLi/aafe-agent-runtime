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

import { randomUUID } from 'node:crypto';
import { cardEventPayload, freshCardTaskId } from './cards.js';
import { WELCOME_TEXT } from './help.js';
import { describeWeComError } from './logger.js';
import { notifyTargetFromSource, sourceFromFrame } from './session.js';

export function createWeComGateway({
  botId,
  secret,
  wsUrl,
  WSClient,
  generateReqId = (prefix = 'stream') => `${prefix}-${randomUUID()}`,
  logger = console,
  heartbeatInterval = 30_000,
  maxReconnectAttempts = -1
} = {}) {
  if (!WSClient) throw new Error('wecom-ws-client-missing');
  const client = new WSClient({
    botId,
    secret,
    wsUrl,
    heartbeatInterval,
    maxReconnectAttempts
  });

  let kicked = false;
  const onKicked = [];

  client.on?.('authenticated', () => {
    logger.info?.('wecom-bot authenticated');
  });
  client.on?.('error', (error) => {
    logger.error?.(`wecom-bot error:${error instanceof Error ? error.message : error}`);
  });
  client.on?.('disconnected', (reason) => {
    logger.warn?.(`wecom-bot disconnected:${reason ?? ''}`);
  });
  client.on?.('event', (frame) => {
    if (frame?.body?.event?.eventtype === 'disconnected_event') {
      kicked = true;
      for (const listener of onKicked) listener(frame);
    }
  });

  return {
    client,
    get kicked() {
      return kicked;
    },
    connect() {
      client.connect();
      return this;
    },
    disconnect() {
      client.disconnect?.();
    },
    onText(handler) {
      client.on?.('message.text', handler);
    },
    onMedia(handler) {
      for (const event of ['message.image', 'message.file', 'message.voice', 'message.video', 'message.mixed']) {
        client.on?.(event, handler);
      }
    },
    onEnterChat(handler) {
      client.on?.('event.enter_chat', handler);
    },
    onCard(handler) {
      const seen = new Set();
      const wrap = (frame) => {
        if (!isTemplateCardEvent(frame)) return;
        const id = frame?.body?.msgid ?? frame?.headers?.req_id;
        if (id) {
          if (seen.has(id)) return;
          seen.add(id);
          if (seen.size > 200) seen.clear();
        }
        handler(frame);
      };
      client.on?.('event.template_card_event', wrap);
      client.on?.('event', wrap);
    },
    onKicked(handler) {
      onKicked.push(handler);
    },
    async replyWelcome(frame, content = WELCOME_TEXT) {
      await client.replyWelcome(frame, {
        msgtype: 'text',
        text: { content }
      });
    },
    async replyAck(frame, content, { finish = true } = {}) {
      const streamId = generateReqId('stream');
      await client.replyStream(frame, streamId, content, finish);
      return streamId;
    },
    async replyCard(frame, card) {
      if (!card) return null;
      if (typeof client.replyTemplateCard === 'function') {
        try {
          return await client.replyTemplateCard(frame, card);
        } catch (error) {
          logger.warn?.(`wecom-reply-card-failed:${describeWeComError(error)}`);
        }
      }
      const target = notifyTargetFromSource(sourceFromFrame(frame));
      if (!target) throw new Error('wecom-card-chat-missing');
      return client.sendMessage(target.chatid, {
        msgtype: 'template_card',
        // The reply attempt already consumed this task_id on the WeCom side.
        template_card: { ...card, task_id: freshCardTaskId('run', card.task_id) },
        chat_type: target.chatType
      });
    },
    async updateCard(frame, card, userids) {
      return client.updateTemplateCard(frame, card, userids);
    },
    /**
     * Non-blocking drops a frame when the previous one is still unacked, which
     * is right for animation but wrong for a stage the user must see.
     */
    async replyProgress(frame, streamId, content, finish = false, { blocking = false } = {}) {
      if (!finish && !blocking && typeof client.replyStreamNonBlocking === 'function') {
        return client.replyStreamNonBlocking(frame, streamId, content, finish);
      }
      return client.replyStream(frame, streamId, content, finish);
    },
    async sendMessage(chatid, body) {
      return client.sendMessage(chatid, body);
    },
    /**
     * A card-event req_id only accepts `aibot_respond_update_msg`, so text that
     * answers a card click has to be pushed actively instead of replied.
     */
    async sendMarkdown(source, content) {
      const target = notifyTargetFromSource(source);
      if (!target) throw new Error('wecom-card-chat-missing');
      return client.sendMessage(target.chatid, {
        msgtype: 'markdown',
        markdown: { content },
        chat_type: target.chatType
      });
    },
    async downloadFile(url, aeskey) {
      if (!url) throw new Error('wecom-media-url-missing');
      if (typeof client.downloadFile !== 'function') throw new Error('wecom-download-unavailable');
      return client.downloadFile(url, aeskey);
    },
    async uploadMedia(buffer, options) {
      if (typeof client.uploadMedia !== 'function') throw new Error('wecom-upload-unavailable');
      return client.uploadMedia(buffer, options);
    },
    async replyMedia(frame, mediaType, mediaId, videoOptions) {
      if (typeof client.replyMedia !== 'function') throw new Error('wecom-reply-media-unavailable');
      return client.replyMedia(frame, mediaType, mediaId, videoOptions);
    },
    async sendMedia(chatid, mediaType, mediaId, videoOptions) {
      if (typeof client.sendMediaMessage === 'function') {
        return client.sendMediaMessage(chatid, mediaType, mediaId, videoOptions);
      }
      if (typeof client.sendMessage !== 'function') throw new Error('wecom-send-media-unavailable');
      const body = { msgtype: mediaType, [mediaType]: { media_id: mediaId } };
      if (mediaType === 'video' && videoOptions) Object.assign(body.video, videoOptions);
      return client.sendMessage(chatid, body);
    }
  };
}

function isTemplateCardEvent(frame) {
  const event = cardEventPayload(frame);
  return event.eventtype === 'template_card_event'
    || Boolean(event.event_key ?? event.eventKey ?? event.EventKey);
}
