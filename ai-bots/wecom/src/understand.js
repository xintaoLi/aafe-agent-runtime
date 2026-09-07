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
import { isNewWork } from './intent.js';
import { scanTaskId } from './quote.js';

export const INTENT_KINDS = Object.freeze(['code', 'analysis', 'question', 'followup']);

export const INTENT_LABELS = Object.freeze({
  code: '代码开发',
  analysis: '分析排查',
  question: '问答',
  followup: '补充需求'
});

const DEFAULT_TIMEOUT_MS = 25_000;
/**
 * Classification never reads the project, so it runs in an empty scratch
 * directory: no indexing cost, and no chance of wandering into the workspace.
 */
const SCRATCH_DIR = path.join(os.tmpdir(), 'aafe-wecom-intent');
const SYSTEM_PROMPT = [
  '你是企业微信研发机器人的意图分类器。只输出一个 JSON 对象，不要解释，不要使用任何工具。',
  '字段：',
  '- kind: code | analysis | question | followup',
  '- needs_code: 布尔值，true 表示必须读写某个具体代码仓库才能完成',
  '- summary: 12 个汉字以内的短语，概括用户要做的事',
  '- confidence: 0 到 1 的小数',
  '判定要点：',
  '- 改代码 / 修 bug / 实现功能 / 重构 / 提交 PR → kind=code，needs_code=true',
  '- 排查原因 / 分析影响面 / 评估方案 / 读代码回答问题 → kind=analysis，needs_code 取决于是否必须读某个仓库',
  '- 概念问答 / 与具体仓库无关的请求 → kind=question，needs_code=false',
  '- 明显是在补充上一轮任务（has_active_task 为 true 且文本像追加说明）→ kind=followup',
  '- 带 quoted 字段说明用户引用了历史消息，除非另起新需求，否则是对被引用任务的补充 → kind=followup',
  '- 提交 / 提 PR / 合并 / 推送 / 回填 TAPD / 重跑测试 这类流程动作是在推进已有任务 → kind=followup，不要当成新需求',
  'TAPD 链接、需求单标题、缺陷描述通常是 code。'
].join('\n');

const CODE_HINT = /(?:修复|修一下|改一下|改下|实现|开发|重构|新增|加个|增加|接入|上线|提交|commit|pr\b|merge|bug|报错|异常|失效|不生效|崩溃|fix|implement|refactor)/i;
const ANALYSIS_HINT = /(?:分析|排查|定位|评估|梳理|影响面|影响范围|为什么|为何|原因|怎么回事|看一下|看看|了解|对比|调研|总结)/i;
const QUESTION_HINT = /(?:是什么|什么意思|怎么用|如何使用|区别|介绍一下|解释)/i;
const FOLLOW_HINT = /^(?:再|继续|补充|还要|顺便|另外|不对|这里|那个|加上|不要)/;
// Ship verbs — commit, PR, merge, TAPD backfill, run the tests again — happen
// to work that already exists. Read as new work they produce a task whose
// requirement is literally "提交 PR", which is how a ship instruction ends up
// starting something instead of finishing it.
//
// Two shapes qualify, because the same verb carries different weight depending
// on where it sits. A message that is nothing but the instruction is one
// wherever it lands, including with nothing running, where "there is nothing to
// submit" is the honest answer. Mid-sentence the verb is only a hint —
// 「购物车合并逻辑有问题」 is a defect report — so it needs live work or a quote
// behind it before it counts.
const SHIP_VERB = [
  '提交', 'commit',
  '推送', 'push',
  '(?:提|开|发起|建)\\s*(?:一?个)?\\s*(?:pr|mr)',
  '合并', 'merge',
  '回填', '自测', '重跑', '重新跑', '继续跑'
].join('|');
const SHIP_ONLY = new RegExp(`^(?:请?\\s*(?:帮我|帮忙|麻烦)?\\s*)?(?:继续|接着)?\\s*(?:${SHIP_VERB})[\\s\\S]{0,24}$`, 'i');
const SHIP_HINT = new RegExp(
  `(?:${SHIP_VERB}|同步\\s*(?:到)?\\s*tapd|跑(?:一下)?(?:测试|自测|e2e)|解决冲突)`,
  'i'
);

function isShipInstruction(body, { anchored = false } = {}) {
  if (isNewWork(body)) return false;
  return SHIP_ONLY.test(body) || (anchored && SHIP_HINT.test(body));
}

// A pasted link ahead of the request is not a reason to fall back to the model,
// so the verb may follow one. Anchored otherwise, so "再帮我看看" stays a
// follow-up rather than becoming new work.
const LEAD = '(?:^|\\n)\\s*(?:https?:\\/\\/\\S+\\s+)?(?:请)?(?:帮我|帮忙|麻烦)?\\s*';
const CODE_LEAD = new RegExp(`${LEAD}(?:修复|修一下|修好|修|改一下|改下|改成|改|实现|开发|重构|新增|加个|接入|上线|优化|支持|fix|implement|refactor)`, 'i');
const ANALYSIS_LEAD = new RegExp(`${LEAD}(?:分析|排查|定位|评估|梳理|调研|总结|对比|看一下|看看|查一下|为什么|为何)`, 'i');

/**
 * The fast path exists because the model earns nothing on the traffic this bot
 * actually gets: TAPD pastes, explicit verbs, and additions to the one open
 * task are already unambiguous, and paying seconds for them only delays the
 * task. It answers only when the signal is unmistakable and returns null
 * otherwise, which is exactly where a model is worth waiting for.
 */
export function fastIntent(text, { attachments = [], hasActiveTask = false, quote = null } = {}) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  const code = CODE_HINT.test(body);
  const analysis = ANALYSIS_HINT.test(body);

  // A Task ID, typed out or sitting in the footer of the quoted reply, is the
  // strongest reference there is; a model cannot improve on a target the user
  // wrote down. Waiting for one is what made `提交 PR 回填` take 25 seconds and
  // get sent three times.
  if (scanTaskId(body) || (quote?.present && scanTaskId(quote.text))) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.95, source: 'rules-fast' });
  }
  // Quoting a message while work is live is a deliberate reference to it, so
  // the addendum is settled without asking a model. Routing confirms which task
  // the quote actually points at.
  if (quote?.present && hasActiveTask && !isNewWork(body)) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.85, source: 'rules-fast' });
  }
  // A TAPD story or a bracketed defect title is always code work.
  if (isNewWork(body) && !ANALYSIS_LEAD.test(body)) {
    return intent({ kind: 'code', needsCode: true, summary: clip(body), confidence: 0.9, source: 'rules-fast' });
  }
  if (!ANALYSIS_LEAD.test(body) && isShipInstruction(body, { anchored: hasActiveTask || Boolean(quote?.present) })) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.85, source: 'rules-fast', action: 'ship' });
  }
  if (hasActiveTask && FOLLOW_HINT.test(body) && !CODE_LEAD.test(body)) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.8, source: 'rules-fast' });
  }
  if (ANALYSIS_LEAD.test(body) && !code) {
    return intent({ kind: 'analysis', needsCode: false, summary: clip(body), confidence: 0.8, source: 'rules-fast' });
  }
  if (CODE_LEAD.test(body) && !analysis) {
    return intent({ kind: 'code', needsCode: true, summary: clip(body), confidence: 0.8, source: 'rules-fast' });
  }
  if (QUESTION_HINT.test(body) && !code && !analysis && !attachments.length) {
    return intent({ kind: 'question', needsCode: false, summary: clip(body), confidence: 0.8, source: 'rules-fast' });
  }
  // An open task must not turn every unrecognised sentence into an addendum:
  // that is how "我想下班" ended up appended to a TAPD story. Without a
  // follow-up word (handled above) the signal is genuinely weak, which is
  // exactly the traffic a model is worth waiting for.
  return null;
}

/**
 * Rules are the floor, not the ceiling: the bot must keep routing when the
 * model is unreachable, slow, or answers with something unparsable.
 */
export function classifyIntentByRules(text, { attachments = [], hasActiveTask = false } = {}) {
  const body = String(text ?? '').trim();
  const withMedia = attachments.length ? `${body} ${attachments.map((item) => item.filename ?? '').join(' ')}` : body;
  if (hasActiveTask && FOLLOW_HINT.test(body)) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.4, source: 'rules' });
  }
  // Ahead of CODE_HINT, which reads 提交 as a reason to start something.
  if (isShipInstruction(body, { anchored: hasActiveTask })) {
    return intent({ kind: 'followup', needsCode: false, summary: clip(body), confidence: 0.5, source: 'rules', action: 'ship' });
  }
  if (CODE_HINT.test(withMedia)) {
    return intent({ kind: 'code', needsCode: true, summary: clip(body), confidence: 0.5, source: 'rules' });
  }
  if (ANALYSIS_HINT.test(withMedia)) {
    return intent({ kind: 'analysis', needsCode: false, summary: clip(body), confidence: 0.45, source: 'rules' });
  }
  if (QUESTION_HINT.test(withMedia)) {
    return intent({ kind: 'question', needsCode: false, summary: clip(body), confidence: 0.4, source: 'rules' });
  }
  // Unknown free text used to become a repository question, so keep that shape.
  return intent({ kind: 'code', needsCode: true, summary: clip(body), confidence: 0.2, source: 'rules' });
}

/**
 * @param {object} options
 * @param {object} [options.settings] `config.intent`: enabled / endpoint / model / apiKey / timeoutMs.
 * @param {string} [options.cwd] Scratch directory a local Cursor classification runs in.
 */
export function createIntentAnalyzer({
  settings = {},
  cwd = SCRATCH_DIR,
  logger = console,
  env = process.env,
  fetchImpl = globalThis.fetch,
  importSdk = null,
  selectModel = null,
  now = () => Date.now()
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
  // Explicit config wins over the rule table; model names live in models.js,
  // which reads INTENT_KINDS from here, so this module must not import it back.
  const modelFor = (payload) => settings.cursorModel
    ?? selectModel?.({ stage: 'intent', text: payload.text, attachments: payload.attachments })
    ?? null;
  const backend = !enabled
    ? 'rules'
    : http?.isConfigured()
      ? 'llm'
      : cursorKey
        ? 'cursor'
        : 'rules';

  async function callHttp(payload) {
    const result = await http.chatJson([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) }
    ]);
    if (result.status !== 'success') throw new Error(result.reason ?? 'llm-failed');
    return result.data ?? result.content;
  }

  async function callCursor(payload) {
    const sdk = await loadSdk();
    if (typeof sdk?.Agent?.prompt !== 'function') throw new Error('cursor-sdk-prompt-unavailable');
    await mkdir(cwd, { recursive: true });
    const model = modelFor(payload);
    const result = await sdk.Agent.prompt(
      `${SYSTEM_PROMPT}\n\n用户输入：\n${JSON.stringify(payload)}`,
      {
        apiKey: cursorKey,
        ...(model ? { model: { id: model } } : {}),
        mode: 'plan',
        local: { cwd }
      }
    );
    if (result?.status && result.status !== 'finished') throw new Error(`cursor-prompt-${result.status}`);
    return result?.result ?? '';
  }

  return {
    backend,
    async analyze({ text, attachments = [], hasActiveTask = false, quote = null } = {}) {
      const fast = fastIntent(text, { attachments, hasActiveTask, quote });
      if (fast) return fast;
      const fallback = classifyIntentByRules(text, { attachments, hasActiveTask });
      if (backend === 'rules') return fallback;
      const payload = {
        text: String(text ?? ''),
        attachments: attachments.map((item) => ({ type: item.type ?? null, filename: item.filename ?? null })),
        has_active_task: Boolean(hasActiveTask),
        // What was quoted decides whether this is an addendum, so the model has
        // to see it too; clipped because only the gist changes the answer.
        ...(quote?.present ? { quoted: clip(quote.text || quote.note || '', 200) } : {})
      };
      const startedAt = now();
      try {
        const raw = await withTimeout(
          backend === 'llm' ? callHttp(payload) : callCursor(payload),
          timeoutMs
        );
        const parsed = parseIntent(raw);
        if (!parsed) return { ...fallback, reason: 'intent-unparsable' };
        return { ...parsed, source: backend, elapsedMs: now() - startedAt };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn?.(`wecom-intent-fallback:${backend}:${reason}`);
        return { ...fallback, reason };
      }
    }
  };
}

export function parseIntent(raw) {
  const value = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!value || typeof value !== 'object') return null;
  const kind = INTENT_KINDS.includes(value.kind) ? value.kind : null;
  if (!kind) return null;
  const needsCode = typeof value.needs_code === 'boolean'
    ? value.needs_code
    : typeof value.needsCode === 'boolean'
      ? value.needsCode
      : kind === 'code';
  return intent({
    kind,
    needsCode,
    summary: clip(value.summary ?? ''),
    confidence: clampConfidence(value.confidence),
    source: 'llm'
  });
}

export function describeIntent(value) {
  if (!value) return null;
  const label = INTENT_LABELS[value.kind] ?? '待定';
  return value.summary ? `${label}（${value.summary}）` : label;
}

function intent({ kind, needsCode, summary, confidence, source, action = null }) {
  return {
    kind,
    label: INTENT_LABELS[kind] ?? '待定',
    needsCode: Boolean(needsCode),
    summary: summary ?? '',
    confidence,
    source,
    // `ship` marks the instructions routing must not guess a target for:
    // commit, push, PR, merge, TAPD backfill. Which task they land on is not
    // recoverable by sending another message.
    ...(action ? { action } : {})
  };
}

function extractJson(text) {
  const body = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  if (!body) return null;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

function clip(text, max = 24) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`intent-timeout-${ms}ms`)), ms);
    })
  ]);
}
