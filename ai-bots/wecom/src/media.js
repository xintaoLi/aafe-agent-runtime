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

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stripMentions } from './commands.js';

const MEDIA_TYPES = new Set(['image', 'file', 'voice', 'video', 'mixed']);
const DEFAULT_NAME = {
  image: 'image.png',
  file: 'file.bin',
  voice: 'voice.amr',
  video: 'video.mp4'
};

export function isWeComMediaType(msgtype) {
  return MEDIA_TYPES.has(String(msgtype ?? ''));
}

export function parseWeComMedia(frame = {}) {
  const body = frame.body ?? {};
  const type = String(body.msgtype ?? '');
  if (type === 'voice') {
    const voice = body.voice ?? {};
    return {
      type: 'voice',
      text: String(voice.content ?? ''),
      assets: voice.url ? [toAsset('voice', voice)] : []
    };
  }
  if (type === 'image') {
    return { type: 'image', text: '', assets: [toAsset('image', body.image)] };
  }
  if (type === 'file') {
    return { type: 'file', text: '', assets: [toAsset('file', body.file)] };
  }
  if (type === 'video') {
    return { type: 'video', text: '', assets: [toAsset('video', body.video)] };
  }
  if (type === 'mixed') {
    const items = body.mixed?.msg_item ?? body.mixed?.msgItem ?? [];
    const texts = [];
    const assets = [];
    for (const item of items) {
      if (item?.msgtype === 'text') texts.push(String(item.text?.content ?? ''));
      if (item?.msgtype === 'image') assets.push(toAsset('image', item.image));
      if (item?.msgtype === 'file') assets.push(toAsset('file', item.file));
      if (item?.msgtype === 'video') assets.push(toAsset('video', item.video));
    }
    return { type: 'mixed', text: texts.filter(Boolean).join('\n'), assets };
  }
  return { type: 'unknown', text: '', assets: [] };
}

export function mediaRequirement(parsed, files = []) {
  const note = formatAttachmentNote(files);
  const text = stripMentions(parsed?.text);
  if (text && note) return `${text}\n\n${note}`;
  if (text) return text;
  if (parsed?.type === 'image') return `请根据用户发送的图片处理。\n${note}`.trim();
  if (parsed?.type === 'file') return `请根据用户发送的文件处理。\n${note}`.trim();
  if (parsed?.type === 'video') return `请根据用户发送的视频处理。\n${note}`.trim();
  return note || '用户发送了媒体消息';
}

export function formatAttachmentNote(files = []) {
  if (!files.length) return '';
  return ['附件：', ...files.map((file) => `- ${file.filename}${file.path ? `（${file.path}）` : ''}`)].join('\n');
}

export function weComMediaDir(config, frame) {
  const root = config?.root ?? process.cwd();
  const conversationId = String(frame?.body?.chatid ?? frame?.body?.from?.userid ?? 'unknown');
  const msgid = String(frame?.body?.msgid ?? Date.now()).replace(/[^\w.-]+/g, '_');
  return path.join(root, '.aafe', 'wecom-media', safeName(conversationId, 'chat'), safeName(msgid, 'msg'));
}

export async function materializeWeComMedia(parsed, {
  downloadFile,
  dir,
  write = writeFile,
  ensureDir = mkdir
} = {}) {
  const files = [];
  if (!parsed?.assets?.length) return files;
  if (typeof downloadFile !== 'function') throw new Error('wecom-download-unavailable');
  await ensureDir(dir, { recursive: true });
  const used = new Set();
  for (const [index, asset] of parsed.assets.entries()) {
    if (!asset?.url) continue;
    const result = await downloadFile(asset.url, asset.aeskey);
    const filename = uniqueName(safeName(
      result?.filename || asset.filename || DEFAULT_NAME[asset.type] || `part-${index + 1}`,
      DEFAULT_NAME[asset.type] ?? 'file.bin'
    ), used);
    const dest = path.join(dir, filename);
    const buffer = result?.buffer ?? result;
    await write(dest, buffer);
    files.push({
      type: asset.type,
      filename,
      path: dest,
      bytes: Buffer.isBuffer(buffer) ? buffer.length : Number(result?.bytes ?? 0)
    });
  }
  return files;
}

export function inferMediaType(filename, fallback = 'file') {
  const ext = path.extname(String(filename ?? '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) return 'image';
  if (['.amr', '.mp3', '.wav'].includes(ext)) return 'voice';
  if (['.mp4'].includes(ext)) return 'video';
  return fallback;
}

function toAsset(type, raw = {}) {
  return {
    type,
    url: raw?.url ?? raw?.full_url ?? null,
    aeskey: raw?.aeskey ?? raw?.aes_key ?? null,
    filename: raw?.filename ?? raw?.name ?? null
  };
}

function safeName(value, fallback) {
  const text = String(value ?? '').trim();
  const cleaned = text.replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || fallback).slice(0, 120);
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let index = 2;
  let next = `${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}
