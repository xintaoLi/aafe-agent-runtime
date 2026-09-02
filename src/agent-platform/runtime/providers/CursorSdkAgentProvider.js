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

import { AgentProvider } from './AgentProvider.js';
import { agentFailed, agentSuccess } from '../../protocol/response.js';

const DEFAULT_MODEL = 'composer-2.5';
const DEFAULT_API_KEY_ENV = 'CURSOR_API_KEY';

/**
 * Executes an AAFE developer handoff through the Cursor TypeScript SDK.
 */
export class CursorSdkAgentProvider extends AgentProvider {
  static kind = 'cursor';

  constructor({ cwd = process.cwd(), env = process.env, importSdk = null } = {}) {
    super();
    this.cwd = cwd;
    this.env = env;
    this.importSdk = importSdk ?? (() => import('@cursor/sdk'));
  }

  async invoke(definition, request) {
    const apiKeyEnv = definition.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
    const apiKey = definition.apiKey ?? this.env[apiKeyEnv];
    if (!apiKey) return agentFailed(`cursor-sdk-api-key-missing:${apiKeyEnv}`);

    let sdk;
    try {
      sdk = await this.importSdk();
    } catch (error) {
      return agentFailed(`cursor-sdk-unavailable:${message(error)}`);
    }

    const { Agent } = sdk;
    if (!Agent?.create) return agentFailed('cursor-sdk-agent-create-unavailable');

    let agent = null;
    const prompt = buildPrompt(definition, request);
    try {
      agent = await Agent.create(this.#agentOptions(definition, request, apiKey));
      const run = await agent.send(prompt);
      const streamedText = [];

      if (typeof run?.stream === 'function') {
        for await (const event of run.stream()) {
          streamedText.push(...extractTextBlocks(event));
        }
      }

      const result = typeof run?.wait === 'function' ? await run.wait() : {};
      if (result?.status === 'error') {
        return agentFailed(`cursor-run-failed:${result.id ?? run?.id ?? 'unknown'}`, {
          result: compactRunResult(agent, run, result, streamedText)
        });
      }
      if (result?.status === 'cancelled') {
        return agentFailed(`cursor-run-cancelled:${result.id ?? run?.id ?? 'unknown'}`, {
          result: compactRunResult(agent, run, result, streamedText)
        });
      }

      return agentSuccess(compactRunResult(agent, run, result, streamedText), {
        metrics: extractMetrics(result)
      });
    } catch (error) {
      return agentFailed(`cursor-sdk-error:${message(error)}`);
    } finally {
      await disposeAgent(agent);
    }
  }

  #agentOptions(definition, request, apiKey) {
    const runtime = normalizeRuntime(definition.runtime ?? definition.ref);
    const model = definition.model || DEFAULT_MODEL;
    const options = {
      apiKey,
      model: { id: model }
    };
    const mcpServers = toMcpServers(definition.mcpServers);
    if (mcpServers) options.mcpServers = mcpServers;

    if (runtime === 'cloud') {
      const repos = normalizeRepos(definition.repository ?? definition.repositories ?? definition.repo ?? parseCloudRef(definition.ref));
      if (repos.length > 0) options.cloud = { repos };
      else options.cloud = {};
      if (definition.autoCreatePR !== undefined) options.cloud.autoCreatePR = definition.autoCreatePR === true;
      if (definition.skipReviewerRequest !== undefined) options.cloud.skipReviewerRequest = definition.skipReviewerRequest === true;
      return options;
    }

    options.local = {
      cwd: definition.cwd ?? request.context?.root ?? this.cwd
    };
    if (Array.isArray(definition.settingSources)) {
      options.local.settingSources = definition.settingSources;
    }
    return options;
  }
}

function buildPrompt(definition, request) {
  if (request.repair?.prompt) return request.repair.prompt;
  if (typeof request.input?.prompt === 'string' && request.input.prompt.trim()) return request.input.prompt;

  const payload = {
    task: request.goal,
    capability: request.capability,
    input: request.input,
    contextPackage: request.context?.contextPackage ?? null,
    priorResults: request.context?.priorResults ?? {}
  };

  return [
    definition.prompt,
    '## AAFE Request',
    JSON.stringify(payload, null, 2)
  ].filter(Boolean).join('\n\n');
}

function normalizeRuntime(value) {
  const text = String(value ?? '').toLowerCase();
  return text.includes('cloud') ? 'cloud' : 'local';
}

function parseCloudRef(ref) {
  const text = String(ref ?? '');
  const match = text.match(/^(?:cursor:)?cloud:(.+)$/);
  return match ? match[1] : null;
}

function toMcpServers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? value : null;
}

function normalizeRepos(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

function extractTextBlocks(event) {
  const blocks = event?.message?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
}

function compactRunResult(agent, run, result, streamedText) {
  return {
    agentId: agent?.agentId ?? agent?.id ?? null,
    runId: result?.id ?? run?.id ?? null,
    status: result?.status ?? null,
    text: streamedText.join('') || (typeof result?.result === 'string' ? result.result : ''),
    result: isPlainResult(result?.result) ? result.result : null
  };
}

function extractMetrics(result) {
  const usage = result?.usage ?? result?.metrics ?? {};
  return {
    tokens: Number.isFinite(usage.tokens) ? usage.tokens : undefined,
    cost: Number.isFinite(usage.cost) ? usage.cost : undefined
  };
}

function isPlainResult(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
}

async function disposeAgent(agent) {
  if (!agent) return;
  const dispose = agent[Symbol.asyncDispose] ?? agent.dispose ?? agent.close;
  if (typeof dispose === 'function') await dispose.call(agent);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
