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

import { INTENT_KINDS } from './understand.js';

export const MODEL_STAGES = Object.freeze(['intent', 'chat', 'task']);
export const DEFAULT_TASK_MODEL = 'grok-4.6';
/**
 * Measured on this repo over three representative messages: 3.8s steady state
 * and 3/3 correct, against 8.8s for `gemini-3.8-flash` at the same accuracy.
 * `gpt-5.4-nano` was 0.2s faster but misread a bug report as a question, and
 * one misroute costs far more than the 0.2s.
 */
export const DEFAULT_FAST_MODEL = 'gpt-5.4-mini';

/**
 * Built-in routing expressed as data, in the same shape a user rule takes, so
 * the shipped behaviour and a custom rule go through one matcher. Order is
 * priority: `complex-code` sits above `simple-analysis` so that "分析一下架构"
 * gets the reasoning model even though its intent is analysis.
 */
export const DEFAULT_MODEL_RULES = Object.freeze([
  {
    id: 'intent-classify',
    stage: 'intent',
    model: DEFAULT_FAST_MODEL,
    note: '意图/文本分类：一行标签不值得用推理模型'
  },
  {
    id: 'chat-reply',
    stage: 'chat',
    model: DEFAULT_FAST_MODEL,
    note: '闲聊问答：不读仓库，要的是快'
  },
  {
    id: 'complex-code',
    model: DEFAULT_TASK_MODEL,
    match: '架构|重构|设计方案|技术方案|迁移|重写|性能|并发|数据流|领域模型|依赖治理|多模块|全链路',
    note: '架构与复杂逻辑：需要推理模型'
  },
  {
    id: 'simple-analysis',
    intent: ['analysis', 'question'],
    model: DEFAULT_FAST_MODEL,
    note: '简单分析与问答：快模型足够'
  },
  {
    id: 'code-work',
    intent: ['code'],
    model: DEFAULT_TASK_MODEL,
    note: '代码实现与修复'
  }
]);

/**
 * Structural validation only. `models` enables the online check that a rule
 * names a model the account can actually run; the bot start-up path leaves it
 * out so a network hiccup cannot stop the process.
 *
 * @returns {{ ok: boolean, rules: object[], errors: string[] }}
 */
export function validateModelRules(rules, { models = null } = {}) {
  const errors = [];
  const valid = [];
  const seen = new Set();
  const known = models ? new Set(models) : null;

  if (rules != null && !Array.isArray(rules)) {
    return { ok: false, rules: [], errors: ['models.rules 必须是数组'] };
  }

  for (const [index, raw] of (rules ?? []).entries()) {
    const where = `规则 #${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${where}：必须是对象`);
      continue;
    }
    const id = text(raw.id);
    const problems = [];
    if (!id) problems.push('缺少 id');
    else if (seen.has(id)) problems.push(`id 重复：${id}`);

    const model = text(raw.model);
    if (!model) problems.push('缺少 model');
    else if (known && !known.has(model)) problems.push(`模型不存在：${model}`);

    const stage = text(raw.stage) ?? 'task';
    if (!MODEL_STAGES.includes(stage)) {
      problems.push(`stage 只能是 ${MODEL_STAGES.join(' / ')}，收到 ${stage}`);
    }

    if (raw.intent != null) {
      const kinds = Array.isArray(raw.intent) ? raw.intent : [raw.intent];
      const unknown = kinds.filter((kind) => !INTENT_KINDS.includes(kind));
      if (unknown.length) problems.push(`未知 intent：${unknown.join(', ')}`);
    }

    for (const key of ['match', 'not']) {
      if (raw[key] == null) continue;
      try {
        new RegExp(String(raw[key]), 'i');
      } catch (error) {
        problems.push(`${key} 不是合法正则：${error instanceof Error ? error.message : error}`);
      }
    }

    if (raw.minConfidence != null) {
      const value = Number(raw.minConfidence);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        problems.push(`minConfidence 必须是 0-1 的数字，收到 ${raw.minConfidence}`);
      }
    }

    if (problems.length) {
      errors.push(`${where}${id ? `（${id}）` : ''}：${problems.join('；')}`);
      continue;
    }
    seen.add(id);
    valid.push({
      id,
      stage,
      model,
      intent: raw.intent == null ? null : (Array.isArray(raw.intent) ? [...raw.intent] : [raw.intent]),
      match: raw.match == null ? null : String(raw.match),
      not: raw.not == null ? null : String(raw.not),
      minConfidence: raw.minConfidence == null ? null : Number(raw.minConfidence),
      note: text(raw.note) ?? null
    });
  }

  return { ok: errors.length === 0, rules: valid, errors };
}

/**
 * User rules are evaluated before the built-ins so they can win, and a user
 * rule reusing a built-in id replaces it in place instead of shadowing it.
 */
export function mergeModelRules(userRules = [], defaults = DEFAULT_MODEL_RULES) {
  const overridden = new Set(userRules.map((rule) => rule.id));
  return [...userRules, ...defaults.filter((rule) => !overridden.has(rule.id))];
}

export function createModelRouter({
  rules = DEFAULT_MODEL_RULES,
  fallback = DEFAULT_TASK_MODEL,
  logger = console
} = {}) {
  const { rules: compiled, errors } = validateModelRules(rules);
  for (const error of errors) {
    // A bad rule is dropped, never fatal: the bot still has to answer.
    logger.error?.(`wecom-model-rule-invalid:${error}`);
  }
  const ordered = compiled.map((rule) => ({
    ...rule,
    matchRe: rule.match ? new RegExp(rule.match, 'i') : null,
    notRe: rule.not ? new RegExp(rule.not, 'i') : null
  }));

  function select({ stage = 'task', intent = null, text: body = '', attachments = [] } = {}) {
    const haystack = [body, ...attachments.map((item) => item?.filename ?? '')].join(' ');
    for (const rule of ordered) {
      if (rule.stage !== stage) continue;
      if (rule.intent && !(intent?.kind && rule.intent.includes(intent.kind))) continue;
      if (rule.minConfidence != null && !(Number(intent?.confidence ?? 0) >= rule.minConfidence)) continue;
      if (rule.matchRe && !rule.matchRe.test(haystack)) continue;
      if (rule.notRe && rule.notRe.test(haystack)) continue;
      return { model: rule.model, ruleId: rule.id };
    }
    return { model: fallback, ruleId: 'fallback' };
  }

  return {
    select,
    model(input) {
      return select(input).model;
    },
    list() {
      return ordered.map(({ matchRe, notRe, ...rule }) => rule);
    },
    get fallback() {
      return fallback;
    },
    errors
  };
}

function text(value) {
  const body = String(value ?? '').trim();
  return body || null;
}
