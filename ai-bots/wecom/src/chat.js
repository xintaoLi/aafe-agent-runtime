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

import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LlmClient } from '../../../src/llm/LlmClient.js';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Answering a question never reads the project, so it runs outside it. */
const SCRATCH_DIR = path.join(os.tmpdir(), 'aafe-wecom-chat');

const SYSTEM_PROMPT = [
  '你是 AAFE 研发助手，接在企业微信里，服务前端研发同学。',
  '你能做的事：接需求/缺陷/TAPD 单，拉分支改代码、自测、提 PR、回填单据；也能只读代码做分析和回答问题。',
  '回答要求：',
  '- 用中文，口语化，像同事聊天，不要客服腔',
  '- 直接给结论，控制在 3 句话或 5 个要点以内',
  '- 企业微信只支持简单 markdown，不要用表格和多级标题',
  '- 不知道就说不知道，不要编造这个项目的细节',
  '- 如果对方其实是想让你干活（改代码、查问题），一句话告诉他直接把需求发过来即可',
  '- 不要输出命令列表或使用说明，那是「帮助」命令的事'
].join('\n');

/**
 * Answers open-ended questions without creating a task. Greetings and identity
 * questions never reach here: the bot knows those answers already, and a model
 * round trip would only make them slower and less accurate.
 *
 * @param {object} options
 * @param {object} [options.settings] Same block as the classifier: endpoint / model / apiKey / timeoutMs.
 * @param {(input: object) => string | null} [options.selectModel] Rule-table lookup for the `chat` stage.
 */
export function createChatResponder({
  settings = {},
  cwd = SCRATCH_DIR,
  logger = console,
  env = process.env,
  fetchImpl = globalThis.fetch,
  importSdk = null,
  selectModel = null
} = {}) {
  const enabled = settings.enabled !== false;
  const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const http = settings.endpoint && settings.model
    ? new LlmClient({
      endpoint: settings.endpoint,
      model: settings.model,
      apiKey: settings.apiKey ?? null,
      apiKeyEnv: settings.apiKeyEnv ?? 'AAFE_LLM_API_KEY',
      timeoutMs
    }, { fetchImpl, env })
    : null;
  const cursorKey = settings.cursorApiKey ?? null;
  const loadSdk = importSdk ?? (() => import('@cursor/sdk'));
  const backend = !enabled ? 'none' : http?.isConfigured() ? 'llm' : cursorKey ? 'cursor' : 'none';

  async function callHttp(text) {
    const result = await http.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ]);
    if (result.status !== 'success') throw new Error(result.reason ?? 'llm-failed');
    return result.content ?? '';
  }

  async function callCursor(text) {
    const sdk = await loadSdk();
    if (typeof sdk?.Agent?.prompt !== 'function') throw new Error('cursor-sdk-prompt-unavailable');
    await mkdir(cwd, { recursive: true });
    const model = selectModel?.({ stage: 'chat', text }) ?? null;
    const result = await sdk.Agent.prompt(`${SYSTEM_PROMPT}\n\n用户：\n${text}`, {
      apiKey: cursorKey,
      ...(model ? { model: { id: model } } : {}),
      mode: 'plan',
      local: { cwd }
    });
    if (result?.status && result.status !== 'finished') throw new Error(`cursor-prompt-${result.status}`);
    return result?.result ?? '';
  }

  return {
    backend,
    /**
     * @returns {Promise<string|null>} null when no backend is configured or the
     * call fails, so the caller can fall back to a canned reply.
     */
    async reply(text) {
      const body = String(text ?? '').trim();
      if (!body || backend === 'none') return null;
      try {
        const raw = await withTimeout(backend === 'llm' ? callHttp(body) : callCursor(body), timeoutMs);
        return clean(raw);
      } catch (error) {
        logger.warn?.(`wecom-chat-failed:${backend}:${error instanceof Error ? error.message : error}`);
        return null;
      }
    }
  };
}

function clean(raw) {
  const body = String(raw ?? '').trim();
  if (!body) return null;
  // Models like to wrap prose in a fence when the prompt mentions markdown.
  const fenced = body.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1].trim() : body) || null;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`chat-timeout-${ms}ms`)), ms);
    })
  ]);
}
