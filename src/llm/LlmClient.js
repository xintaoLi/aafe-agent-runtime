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

/**
 * Shared OpenAI-compatible chat client.
 *
 * Both the LLM planner and the semantic enrichment port go through here, so
 * there is exactly one place that knows how to reach a model.
 *
 * @typedef LlmSettings
 * @property {string|null} endpoint   Full chat-completions URL.
 * @property {string|null} model
 * @property {string} [apiKeyEnv]     Env var holding the key (never the key itself).
 * @property {string|null} [apiKey]
 * @property {number} [temperature]
 * @property {number} [timeoutMs]
 */

export class LlmClient {
  /**
   * @param {LlmSettings} settings
   */
  constructor(settings = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
    this.endpoint = settings.endpoint ?? null;
    this.model = settings.model ?? null;
    this.temperature = settings.temperature ?? 0;
    this.timeoutMs = settings.timeoutMs ?? 60000;
    this.apiKey = settings.apiKey ?? env[settings.apiKeyEnv ?? 'AAFE_LLM_API_KEY'] ?? null;
    this.fetchImpl = fetchImpl;
  }

  /**
   * A client is only usable with an endpoint and a model; the key may be
   * omitted for local gateways such as Ollama or vLLM.
   */
  isConfigured() {
    return Boolean(this.endpoint && this.model && typeof this.fetchImpl === 'function');
  }

  unavailableReason() {
    if (!this.endpoint) return 'llm-endpoint-missing';
    if (!this.model) return 'llm-model-missing';
    if (typeof this.fetchImpl !== 'function') return 'llm-fetch-unavailable';
    return null;
  }

  /**
   * @param {{role:string,content:string}[]} messages
   * @returns {Promise<{ status:'success'|'failed', content?:string, reason?:string, usage?:object }>}
   */
  async chat(messages, { responseFormat = null, temperature = this.temperature } = {}) {
    const reason = this.unavailableReason();
    if (reason) return { status: 'failed', reason };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          temperature,
          messages,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return { status: 'failed', reason: `llm-http-${response.status}` };
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        return { status: 'failed', reason: 'llm-empty-completion' };
      }
      return { status: 'success', content, usage: payload.usage ?? {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', reason: `llm-request-failed:${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Chat call that must return a JSON object. Tolerates models that wrap JSON
   * in prose or fenced code blocks.
   */
  async chatJson(messages, options = {}) {
    const result = await this.chat(messages, {
      ...options,
      responseFormat: options.responseFormat ?? { type: 'json_object' }
    });
    if (result.status !== 'success') return result;
    const parsed = parseJsonLoose(result.content);
    if (!parsed) {
      return { status: 'failed', reason: 'llm-invalid-json', content: result.content };
    }
    return { status: 'success', data: parsed, usage: result.usage };
  }
}

/**
 * Build a client from the `.aafe.agents.json` planner.llm block or the legacy
 * `.aafe.config.json` analyze.llm block.
 */
export function createLlmClient(settings = {}, deps = {}) {
  return new LlmClient(settings, deps);
}

export function parseJsonLoose(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const candidates = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
