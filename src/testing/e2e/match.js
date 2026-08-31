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

import { listCases, normalizeEntry } from './yaml.js';

/**
 * Match existing YAML cases against route hints / changed files.
 */
export async function matchExistingCases(casesDir, { routeHints = [], frontendPaths = [], prUrl = null } = {}) {
  const cases = await listCases(casesDir);
  const routes = new Set(routeHints.map(normalizeEntry).filter(Boolean));
  const files = new Set(frontendPaths.map((item) => String(item).replaceAll('\\', '/')));
  const matched = [];

  for (const item of cases) {
    const entry = normalizeEntry(item.entry?.path);
    const reasons = [];
    if (entry && routes.has(entry)) reasons.push(`entry ${entry}`);
    if (prUrl && String(item.file ?? '').includes(String(prUrl))) reasons.push('pr url');
    for (const filePath of files) {
      if (item.id && filePath.toLowerCase().includes(String(item.id).toLowerCase())) {
        reasons.push(`file ${filePath}`);
        break;
      }
    }
    if (reasons.length === 0) continue;
    matched.push({
      id: item.id,
      file: item.file,
      entry,
      title: item.title ?? null,
      reason: reasons.join('; ')
    });
  }
  return matched;
}
