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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { sessionKeyFromSource, sourceFromFrame } from './session.js';
import { analyzeWeComIntent } from './intent.js';
import { parseCardEvent } from './cards.js';

// Bot processes are single-instance. Persist successful receipts; unfinished
// receipts are retryable on restart. Side effects also carry stable message IDs.
export function createMessageInbox({ file = null, limit = 2048 } = {}) {
  const capacity = Number.isInteger(limit) && limit > 0 ? limit : 2048;
  const completed = new Map();
  const active = new Map();
  const sessions = new Map();
  let writes = Promise.resolve();
  const loaded = file ? readFile(file, 'utf8').then((s) => {
    for (const [key, time] of JSON.parse(s)) completed.set(key, time);
  }).catch((error) => { if (error.code !== 'ENOENT') throw error; }) : Promise.resolve();

  function persist() {
    const work = writes.then(async () => {
      if (!file) return;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify([...completed]), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    writes = work.catch(() => {});
    return work;
  }

  return {
    ready: () => loaded,
    async dispatch(frame, work) {
      const source = sourceFromFrame(frame);
      const messageId = source.messageId ?? frame?.headers?.req_id;
      const key = messageId ? createHash('sha256').update(JSON.stringify([source.chatbotId, source.conversationId, source.userId, messageId])).digest('hex') : null;
      await loaded;
      if (key && completed.has(key)) return { skipped: true, reason: 'duplicate' };
      if (key && active.has(key)) return active.get(key);
      const sessionKey = sessionKeyFromSource(source);
      const command = analyzeWeComIntent(frame?.body?.text?.content);
      const cardAction = parseCardEvent(frame).action;
      // A slow classification must not delay a user's stop/status request.
      const immediate = cardAction
        ? ['cancel', 'status', 'process'].includes(cardAction)
        : Boolean(frame?.body?.text?.content) && ['cancel', 'implicit-cancel', 'status', 'implicit-status', 'list', 'help'].includes(command.type);
      const previous = immediate ? Promise.resolve() : sessions.get(sessionKey) ?? Promise.resolve();
      const run = previous.catch(() => {}).then(work).then(async (result) => {
        if (key && !result?.error) {
          completed.set(key, Date.now());
          while (completed.size > capacity) completed.delete(completed.keys().next().value);
          try { await persist(); } catch (error) { completed.delete(key); throw error; }
        }
        return result;
      });
      if (key) active.set(key, run);
      if (!immediate) sessions.set(sessionKey, run);
      try { return await run; } finally {
        if (key) active.delete(key);
        if (sessions.get(sessionKey) === run) sessions.delete(sessionKey);
      }
    }
  };
}
