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

import { DEFAULT_CURSOR_API_KEY_ENV, DEFAULT_CURSOR_MODEL } from './agentMode.js';

export const FALLBACK_AGENT_MODELS = Object.freeze([
  { id: 'auto', displayName: 'Auto', description: '由 Cursor 选择模型' },
  { id: DEFAULT_CURSOR_MODEL, displayName: 'Composer 2.5', description: 'Cursor SDK 默认模型' }
]);

/**
 * Resolve models the current API key can use. Falls back to a short catalog
 * when the key is missing or Cursor.models.list fails.
 */
export async function listAgentModels({
  apiKey = null,
  apiKeyEnv = DEFAULT_CURSOR_API_KEY_ENV,
  current = null,
  env = process.env,
  importSdk = null,
  timeoutMs = 8000
} = {}) {
  const key = String(apiKey ?? env[apiKeyEnv] ?? '').trim();
  const warnings = [];
  let live = [];
  let source = 'fallback';

  if (!key) {
    warnings.push(`cursor-sdk-api-key-missing:${apiKeyEnv}`);
  } else {
    try {
      live = await withTimeout(loadCursorModels(key, importSdk), timeoutMs);
      source = 'cursor';
    } catch (error) {
      warnings.push(`cursor-models-unavailable:${messageOf(error)}`);
    }
  }

  return {
    models: mergeModels(FALLBACK_AGENT_MODELS, live, current),
    source,
    current: nonEmpty(current) ?? DEFAULT_CURSOR_MODEL,
    warnings
  };
}

export function resolveModelChoice(value, models = []) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const index = Number.parseInt(raw, 10);
  if (String(index) === raw && index >= 1 && index <= models.length) {
    return models[index - 1].id;
  }
  return raw;
}

export function formatModelChoices(models = []) {
  return models.map((model, index) => {
    const label = model.displayName && model.displayName !== model.id
      ? `${model.id} — ${model.displayName}`
      : model.id;
    return `  ${index + 1}. ${label}`;
  }).join('\n');
}

async function loadCursorModels(apiKey, importSdk) {
  const sdk = await (importSdk ?? (() => import('@cursor/sdk')))();
  const list = sdk.Cursor?.models?.list;
  if (typeof list !== 'function') throw new Error('cursor-sdk-models-list-unavailable');
  const items = await list.call(sdk.Cursor.models, { apiKey });
  return (Array.isArray(items) ? items : []).map(normalizeModel).filter((item) => item.id);
}

function mergeModels(fallback, live, current) {
  const byId = new Map();
  for (const item of [...fallback, ...live]) {
    if (!item?.id) continue;
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  const selected = nonEmpty(current);
  if (selected && !byId.has(selected)) {
    byId.set(selected, { id: selected, displayName: selected, description: '当前配置' });
  }
  return [...byId.values()];
}

function normalizeModel(item) {
  if (typeof item === 'string') {
    const id = item.trim();
    return id ? { id, displayName: id } : null;
  }
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id ?? item.model ?? '').trim();
  if (!id) return null;
  return {
    id,
    displayName: String(item.displayName ?? item.name ?? id),
    description: item.description ? String(item.description) : '',
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : []
  };
}

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cursor-models-timeout')), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
