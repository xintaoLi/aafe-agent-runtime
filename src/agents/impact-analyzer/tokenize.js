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

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_ONLY = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'add', 'new', 'support', 'implement', 'update', 'fix', 'a', 'an', 'to', 'of', 'in', 'on',
  'src', 'index', 'js', 'ts', 'jsx', 'tsx', 'vue', 'json',
  '增加', '新增', '支持', '实现', '修改', '优化', '功能', '需求', '一个', '的', '了'
]);

/**
 * Mixed Chinese/English tokenizer for requirement matching.
 *
 * Chinese has no word boundaries, so CJK runs are emitted both whole and as
 * character bigrams; that is enough to match "手机号" against a `phone` feature
 * name once the synonym pass runs, without pulling in a segmentation library.
 *
 * @returns {Set<string>}
 */
export function tokenize(text) {
  const tokens = new Set();
  const raw = String(text ?? '');
  if (!raw.trim()) return tokens;

  for (const chunk of raw.split(/[^\p{L}\p{N}]+/u)) {
    if (!chunk) continue;
    if (CJK.test(chunk)) {
      addCjk(tokens, chunk);
      continue;
    }
    for (const word of splitIdentifier(chunk)) {
      const lower = word.toLowerCase();
      if (lower.length < 2 || STOPWORDS.has(lower)) continue;
      tokens.add(lower);
    }
  }
  return tokens;
}

/**
 * Tokens for a code artifact: path segments, identifier casing and extensions
 * all carry signal about what a file is for.
 */
export function tokenizeArtifact(...parts) {
  const tokens = new Set();
  for (const part of parts.flat()) {
    for (const token of tokenize(String(part ?? '').replace(/[/\\.]/g, ' '))) {
      tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Overlap score normalised by query weight, so a short requirement is not
 * penalised for matching a module with a large vocabulary.
 *
 * @returns {{score:number, matched:string[]}}
 */
export function scoreOverlap(queryTokens, targetTokens) {
  if (queryTokens.size === 0 || targetTokens.size === 0) return { score: 0, matched: [] };
  const matched = [];
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      matched.push(token);
      continue;
    }
    for (const candidate of targetTokens) {
      if (matchesLoosely(token, candidate)) {
        matched.push(token);
        break;
      }
    }
  }

  const unique = Array.from(new Set(matched));
  const total = sumWeight(queryTokens);
  if (total === 0) return { score: 0, matched: unique };
  return { score: Number((sumWeight(unique) / total).toFixed(3)), matched: unique };
}

/**
 * Recall bigrams are cheap to emit and expensive to trust, so they count for a
 * quarter of a real term.
 *
 * `addCjk` emits every bigram of an unsegmented Chinese run to widen recall,
 * but those bigrams are not independent query terms. Given them full weight, a
 * long Chinese requirement dilutes its own real terms below the match threshold
 * and the whole report comes back empty.
 */
export const RECALL_BIGRAM_WEIGHT = 0.25;

/**
 * @returns {number} 1 for a real term, `RECALL_BIGRAM_WEIGHT` for a bigram
 * emitted only to widen recall.
 */
export function termWeight(token) {
  return isRecallBigram(token) ? RECALL_BIGRAM_WEIGHT : 1;
}

/**
 * @param {Iterable<string>} tokens
 * @returns {number}
 */
export function sumWeight(tokens) {
  let sum = 0;
  for (const token of tokens) sum += termWeight(token);
  return sum;
}

/**
 * Substring match in either direction, which catches `userlist` vs `user` and
 * `phoneNumber` vs `phone`. Short tokens are excluded because two- and
 * three-letter substrings match almost anything.
 */
export function matchesLoosely(token, candidate) {
  if (token.length < 3 || candidate.length < 3) return false;
  return candidate.includes(token) || token.includes(candidate);
}

function isRecallBigram(token) {
  return token.length === 2 && CJK_ONLY.test(token) && !SYNONYMS.has(token);
}

/**
 * Bridge Chinese requirement wording to English identifiers. Deliberately
 * small: a wrong synonym is worse than a missed match because it produces
 * confident-looking noise.
 */
const SYNONYMS = new Map(Object.entries({
  用户: ['user', 'users', 'account'],
  手机: ['phone', 'mobile', 'tel'],
  手机号: ['phone', 'mobile', 'telephone'],
  电话: ['phone', 'tel'],
  搜索: ['search', 'query', 'filter'],
  查询: ['query', 'search', 'fetch'],
  筛选: ['filter'],
  列表: ['list', 'table', 'grid'],
  登录: ['login', 'signin', 'auth'],
  权限: ['permission', 'auth', 'role'],
  角色: ['role'],
  订单: ['order'],
  详情: ['detail', 'detail'],
  编辑: ['edit', 'update'],
  新建: ['create', 'new'],
  删除: ['delete', 'remove'],
  分页: ['page', 'pagination'],
  导出: ['export'],
  配置: ['config', 'setting'],
  路由: ['route', 'router'],
  组件: ['component'],
  接口: ['api', 'service'],
  缓存: ['cache'],
  知识: ['knowledge'],
  分析: ['analyze', 'analysis'],
  记忆: ['memory'],
  技能: ['skill'],
  模板: ['template'],
  架构: ['architecture']
}));

export function expandSynonyms(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS.get(token) ?? []) {
      expanded.add(synonym);
    }
  }
  return expanded;
}

function addCjk(tokens, chunk) {
  if (chunk.length <= 4 && !STOPWORDS.has(chunk)) tokens.add(chunk);
  for (let i = 0; i < chunk.length - 1; i += 1) {
    const bigram = chunk.slice(i, i + 2);
    if (!STOPWORDS.has(bigram)) tokens.add(bigram);
  }
  for (let i = 0; i < chunk.length - 2; i += 1) {
    const trigram = chunk.slice(i, i + 3);
    if (SYNONYMS.has(trigram)) tokens.add(trigram);
  }
}

function splitIdentifier(chunk) {
  return chunk
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);
}
