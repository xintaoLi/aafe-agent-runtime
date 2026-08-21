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

import { createLlmClient } from '../../llm/LlmClient.js';

/**
 * Semantic analysis port — static facts vs LLM inference stay separated.
 * Analyzers must never call LLM APIs directly; they go through this port.
 */

export class StaticSemanticAnalyzer {
  id = 'static-semantic';
  version = '1.0.0';

  async analyze(_input, _context = {}) {
    return {
      status: 'not_available',
      source: 'static',
      candidates: [],
      message: 'Semantic enrichment is reserved for LLM providers; static pipeline only emits facts/candidates.'
    };
  }
}

const SYSTEM_PROMPT = `You enrich deterministic frontend static-analysis facts with semantic labels.
You must not invent files, symbols or routes: every candidate you emit has to be
grounded in the facts you were given.

Reply with one JSON object: {"candidates":[{"name":"...","kind":"...","rationale":"...","refs":["<file or route from the facts>"]}]}`;

/**
 * LLM-backed semantic enrichment. Facts stay authoritative: this only adds
 * naming and grouping on top, and any candidate that references something
 * absent from the facts is dropped.
 */
export class LLMSemanticAnalyzer {
  id = 'llm-semantic';
  version = '1.0.0';

  constructor(llmConfig = {}, deps = {}) {
    this.llmConfig = llmConfig;
    this.client = deps.client ?? createLlmClient(
      {
        endpoint: llmConfig.endpoint,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        apiKeyEnv: llmConfig.apiKeyEnv ?? 'AAFE_ANALYZE_LLM_API_KEY',
        temperature: llmConfig.temperature ?? 0
      },
      deps
    );
  }

  async analyze(input, _context = {}) {
    if (!this.llmConfig?.enabled) {
      return { status: 'not_available', source: 'llm', candidates: [], reason: 'llm-disabled' };
    }
    if (!this.client.isConfigured()) {
      return {
        status: 'not_available',
        source: 'llm',
        candidates: [],
        reason: this.client.unavailableReason(),
        message: 'Set analyze.llm.endpoint and analyze.llm.model to enable semantic enrichment.'
      };
    }

    const facts = summarizeFacts(input);
    if (facts.refs.length === 0) {
      return { status: 'not_available', source: 'llm', candidates: [], reason: 'no-facts-to-enrich' };
    }

    const result = await this.client.chatJson([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(facts) }
    ]);
    if (result.status !== 'success') {
      return { status: 'not_available', source: 'llm', candidates: [], reason: result.reason };
    }

    const allowed = new Set(facts.refs);
    const candidates = (Array.isArray(result.data?.candidates) ? result.data.candidates : [])
      .map((candidate) => ({
        name: String(candidate?.name ?? '').trim(),
        kind: String(candidate?.kind ?? facts.kind),
        rationale: String(candidate?.rationale ?? ''),
        refs: (Array.isArray(candidate?.refs) ? candidate.refs : []).map(String).filter((ref) => allowed.has(ref))
      }))
      .filter((candidate) => candidate.name && candidate.refs.length > 0);

    return {
      status: candidates.length > 0 ? 'ok' : 'not_available',
      source: 'llm',
      candidates,
      ...(candidates.length === 0 ? { reason: 'no-grounded-candidates' } : {}),
      usage: result.usage ?? {}
    };
  }
}

export function createSemanticAnalyzer(llmConfig = {}, deps = {}) {
  if (llmConfig?.enabled) return new LLMSemanticAnalyzer(llmConfig, deps);
  return new StaticSemanticAnalyzer();
}

/**
 * Reduce analyzer input to a bounded fact sheet. The `refs` list doubles as the
 * allow-list used to reject ungrounded candidates.
 */
function summarizeFacts(input = {}) {
  const kind = String(input.kind ?? 'architecture');
  const modules = (input.modules ?? []).slice(0, 40).map((mod) => ({
    id: mod.id,
    name: mod.name,
    files: (mod.filePaths ?? []).slice(0, 8),
    routes: (mod.routes ?? []).map((route) => (typeof route === 'string' ? route : route.path)).filter(Boolean).slice(0, 8),
    dependsOn: (mod.dependencies ?? []).slice(0, 8)
  }));
  const features = [...(input.features ?? []), ...(input.candidates ?? [])]
    .slice(0, 40)
    .map((feature) => ({
      id: feature.id,
      name: feature.name,
      entrypoints: [
        ...(feature.entrypoints ?? []),
        ...(feature.evidence ?? []).map((item) => item.file)
      ].filter(Boolean).slice(0, 6)
    }));

  const refs = [
    ...modules.flatMap((mod) => [...mod.files, ...mod.routes]),
    ...features.flatMap((feature) => feature.entrypoints)
  ].filter(Boolean);

  return { kind, modules, features, refs: Array.from(new Set(refs)) };
}
