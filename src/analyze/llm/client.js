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
 * Reserved LLM client for future architecture / dataflow enrichment.
 * Deterministic AST facts remain authoritative until a provider is configured.
 */

export function isLlmConfigured(config = {}) {
  const llm = config.analyze?.llm ?? config.llm ?? {};
  if (llm.enabled === true && llm.provider) return true;
  if (process.env.AAFE_ANALYZE_LLM_PROVIDER && process.env.AAFE_ANALYZE_LLM_API_KEY) return true;
  return false;
}

/**
 * @returns {Promise<{ status: string, reason?: string, enrichments?: object[] }>}
 */
export async function analyzeModuleWithLlm(_moduleFacts, options = {}) {
  if (!isLlmConfigured(options.config ?? {})) {
    return {
      status: 'skipped',
      reason: 'llm-not-configured',
      message: 'Set analyze.llm.enabled + provider (or AAFE_ANALYZE_LLM_* env) when API is available.'
    };
  }

  // Placeholder for future HTTP provider integration.
  return {
    status: 'skipped',
    reason: 'llm-provider-not-implemented',
    message: 'LLM provider interface is reserved; no remote call was made.'
  };
}

export function llmPromptPaths(docsOut = '.ai-agent/.docs') {
  return {
    readme: `${docsOut}/llm/README.md`,
    analyzeModule: `${docsOut}/llm/prompts/analyze-module.md`
  };
}
