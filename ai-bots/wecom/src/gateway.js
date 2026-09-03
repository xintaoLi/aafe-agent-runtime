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
import { WELCOME_TEXT } from './help.js';

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
    async sendMessage(chatid, body) {
      return client.sendMessage(chatid, body);
    }
  };
}
