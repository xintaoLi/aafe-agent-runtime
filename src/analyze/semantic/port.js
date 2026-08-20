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

/**
 * Reserved LLM semantic analyzer. No remote calls in v1.
 */
export class LLMSemanticAnalyzer {
  id = 'llm-semantic';
  version = '0.0.0';

  constructor(llmConfig = {}) {
    this.llmConfig = llmConfig;
  }

  async analyze(_input, _context = {}) {
    if (!this.llmConfig?.enabled) {
      return {
        status: 'not_available',
        source: 'llm',
        candidates: [],
        reason: 'llm-disabled'
      };
    }
    return {
      status: 'not_available',
      source: 'llm',
      candidates: [],
      reason: 'llm-provider-not-implemented',
      message: 'Configure analyze.llm and implement a provider adapter; no HTTP call was made.'
    };
  }
}

export function createSemanticAnalyzer(llmConfig = {}) {
  if (llmConfig?.enabled) return new LLMSemanticAnalyzer(llmConfig);
  return new StaticSemanticAnalyzer();
}
