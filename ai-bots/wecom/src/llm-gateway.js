/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 */

import { LlmClient } from '../../../src/llm/LlmClient.js';
import { ModelGateway } from '../../../src/model-gateway/ModelGateway.js';

/**
 * Builds the normal-model gateway used by WeCom intent/chat flows.
 *
 * This intentionally does not create a Coding Agent. Cursor/Codex remain
 * CodingAgentAdapter backends; OpenAI-compatible providers behind LiteLLM are
 * normal ModelProvider backends for classification and conversational replies.
 */
export function createWeComModelGateway({
  config = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  metricStore = null,
  operation = 'chat'
} = {}) {
  const providers = {};
  for (const [id, raw] of Object.entries(config.providers ?? {})) {
    const provider = normaliseProvider(raw);
    if (!provider.endpoint || !provider.model) continue;
    providers[id] = new LlmClient({
      endpoint: provider.endpoint,
      model: provider.model,
      apiKey: provider.apiKey ?? null,
      apiKeyEnv: provider.apiKeyEnv ?? 'AAFE_LLM_API_KEY',
      temperature: provider.temperature,
      timeoutMs: provider.timeoutMs,
      maxOutputTokens: provider.maxOutputTokens,
      tokenBudget: provider.tokenBudget,
      metricStore,
      telemetry: { source: 'wecom', operation, provider: id, gateway: 'model-gateway' },
      onUsage: (usage) => logger.event?.('llm.usage', { stage: operation, provider: id, ...usage })
    }, { env, fetchImpl });
  }
  if (!Object.keys(providers).length) return null;
  return new ModelGateway({ providers, policies: config.policies ?? {}, metricStore });
}

export function resolveModelGatewayRoute(settings = {}, operation = 'default') {
  const gateway = settings.modelGateway ?? null;
  const policy = settings.policy ?? settings.gatewayPolicy ?? operation;
  const provider = settings.provider
    ?? settings.gatewayProvider
    ?? gateway?.routes?.[operation]
    ?? gateway?.defaultProvider
    ?? null;
  return { provider, policy };
}

function normaliseProvider(raw = {}) {
  return {
    endpoint: raw.endpoint ?? raw.baseUrl ?? raw.url ?? null,
    model: raw.model ?? null,
    apiKey: raw.apiKey ?? null,
    apiKeyEnv: raw.apiKeyEnv ?? null,
    temperature: raw.temperature,
    timeoutMs: Number(raw.timeoutMs) > 0 ? Number(raw.timeoutMs) : undefined,
    maxOutputTokens: Number(raw.maxOutputTokens) > 0 ? Number(raw.maxOutputTokens) : undefined,
    tokenBudget: Number(raw.tokenBudget) > 0 ? Number(raw.tokenBudget) : undefined
  };
}
