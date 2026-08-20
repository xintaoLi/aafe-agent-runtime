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

/** Default: machine JSON/JSONL + markdown indexes + Mermaid for humans. */
export const DEFAULT_ANALYZE_FORMATS = ['json', 'jsonl', 'md', 'mmd'];

/**
 * @param {string[]|string|undefined} value
 * @param {string[]|undefined} cliFormats
 */
export function resolveAnalyzeFormats(value, cliFormats) {
  const raw = cliFormats?.length
    ? cliFormats
    : Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[,+\s]+/)
        : DEFAULT_ANALYZE_FORMATS;

  const formats = new Set();
  for (const item of raw) {
    const token = String(item).trim().toLowerCase().replace(/^\./, '');
    if (!token) continue;
    if (token === 'json' || token === 'jsonl' || token === 'mmd' || token === 'md' || token === 'mermaid') {
      formats.add(token === 'mermaid' ? 'mmd' : token);
    }
  }
  if (!formats.size) {
    for (const item of DEFAULT_ANALYZE_FORMATS) formats.add(item);
  }
  // Agent machine formats: if only mmd requested, still keep json for agents unless explicitly json-only exclusion
  return [...formats];
}

export function createFormatGate(formats) {
  const set = new Set(formats);
  return {
    list: [...set],
    wantsJson: () => set.has('json'),
    wantsJsonl: () => set.has('jsonl'),
    wantsMmd: () => set.has('mmd'),
    wantsMd: () => set.has('md')
  };
}
