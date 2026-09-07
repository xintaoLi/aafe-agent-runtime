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

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WECOM_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_LOG_DIR = path.join(WECOM_DIR, 'logs');
const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const SECRET_KEY = /^(secret|apiKey|api_key|token|authorization|password|passwd|cookie)$/i;
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

export function resolveWeComLogConfig({
  env = {},
  local = {},
  root = process.cwd()
} = {}) {
  const fromEnv = parseBool(env.WECOM_LOG ?? env.AAFE_WECOM_LOG);
  const fromLocal = parseBool(local.log?.enabled ?? local.logEnabled);
  const enabled = fromEnv ?? fromLocal ?? false;
  const dirRaw = firstNonEmpty(env.WECOM_LOG_DIR, env.AAFE_WECOM_LOG_DIR, local.log?.dir);
  const dir = resolveLogDir(dirRaw, root);
  const level = firstNonEmpty(env.WECOM_LOG_LEVEL, local.log?.level) ?? 'info';
  return { enabled, dir, level };
}

export function createWeComLogger({
  enabled = false,
  dir = DEFAULT_LOG_DIR,
  level = 'info',
  sink = console,
  now = () => new Date()
} = {}) {
  const min = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;
  let queue = Promise.resolve();
  let ensured = false;

  function emit(lvl, event, data, { toConsole = true, consoleArgs } = {}) {
    if (toConsole) {
      if (consoleArgs) sink[lvl]?.(...consoleArgs);
      else sink[lvl]?.(`[wecom] ${event}`);
    }
    if (!enabled) return;
    if ((LEVELS[lvl] ?? LEVELS.info) > min) return;
    const record = {
      ts: now().toISOString(),
      level: lvl,
      event,
      payload: sanitizeLogValue(data ?? {})
    };
    queue = queue.then(async () => {
      if (!ensured) {
        await mkdir(dir, { recursive: true });
        ensured = true;
      }
      const file = path.join(dir, `wecom-${dayStamp(now())}.jsonl`);
      await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    }).catch(() => { /* local log must not break the bot */ });
  }

  return {
    enabled,
    dir,
    level,
    info: (...args) => emit('info', 'console', { message: joinArgs(args) }, { consoleArgs: args }),
    warn: (...args) => emit('warn', 'console', { message: joinArgs(args) }, { consoleArgs: args }),
    error: (...args) => emit('error', 'console', { message: joinArgs(args) }, { consoleArgs: args }),
    debug: (...args) => emit('debug', 'console', { message: joinArgs(args) }, { consoleArgs: args }),
    event(name, data = {}) {
      emit('info', name, data, { toConsole: false });
    },
    async flush() {
      await queue;
    }
  };
}

export function sanitizeLogValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clip(value, MAX_STRING);
  if (typeof value !== 'object') return String(value);
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeLogValue(item, depth + 1));
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeLogValue(item, depth + 1);
  }
  return out;
}

export function summarizeWeComFrame(frame = {}) {
  const body = frame.body ?? {};
  const event = body.event ?? {};
  return {
    msgid: body.msgid ?? null,
    chattype: body.chattype ?? null,
    chatid: body.chatid ?? null,
    userId: body.from?.userid ?? null,
    text: clip(body.text?.content ?? body.voice?.content, 800),
    msgtype: body.msgtype ?? null,
    eventtype: event.eventtype ?? null,
    eventKey: event.event_key ?? event.eventKey ?? event.EventKey ?? null
  };
}

/**
 * WeCom SDK rejections are plain objects, so the default string coercion
 * would log `[object Object]` and hide the errcode.
 */
export function describeWeComError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const code = error.errcode ?? error.errCode ?? null;
    const message = error.errmsg ?? error.errMsg ?? error.message ?? null;
    if (code != null || message) return `${code ?? 'error'}:${message ?? ''}`;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function normalizeLogValue(raw) {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return omitUndefined({
      enabled: parseBool(raw.enabled),
      dir: nonEmpty(raw.dir ?? raw.path),
      level: nonEmpty(raw.level)
    });
  }
  const enabled = parseBool(raw);
  return enabled == null ? undefined : { enabled };
}

function resolveLogDir(dirRaw, root) {
  if (!dirRaw) return DEFAULT_LOG_DIR;
  if (path.isAbsolute(dirRaw)) return dirRaw;
  if (dirRaw === 'logs') return DEFAULT_LOG_DIR;
  return path.resolve(root, dirRaw);
}

function parseBool(value) {
  if (value == null || value === '') return null;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

function dayStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function joinArgs(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? arg.message;
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(' ');
}

function clip(value, max) {
  const text = String(value ?? '');
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = nonEmpty(value);
    if (text) return text;
  }
  return null;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}
