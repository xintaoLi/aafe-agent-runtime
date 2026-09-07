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

// Usage reported by providers is distinct from locally estimated prompt size.
// Unknown fields remain null; cached input is a subset of input, never additive.
export function normalizeUsage(raw) {
  const u = raw ?? {};
  const number = (...values) => values.find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ?? null;
  const inputTokens = number(u.inputTokens, u.input_tokens, u.prompt_tokens);
  const outputTokens = number(u.outputTokens, u.output_tokens, u.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: number(u.cachedInputTokens, u.cached_input_tokens, u.input_tokens_details?.cached_tokens, u.prompt_tokens_details?.cached_tokens),
    totalTokens: number(u.totalTokens, u.total_tokens, u.tokens,
      inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    cost: number(u.cost)
  };
}

export function addMeasuredMetrics(total, metrics = {}) {
  for (const key of ['tokens', 'cost']) {
    if (typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) && metrics[key] >= 0) {
      total[key] = (total[key] ?? 0) + metrics[key];
    }
  }
  return total;
}
