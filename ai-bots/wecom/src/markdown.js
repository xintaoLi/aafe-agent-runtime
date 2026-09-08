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

/** Byte-safe markdown pages for ordinary WeCom messages (not live streams).
 * Prefer line boundaries. A single long line is split at Unicode code points.
 */
export function splitWeComMarkdown(text, maxBytes = 3000) {
  if (!Number.isFinite(maxBytes) || maxBytes < 64) throw new Error('wecom-page-limit-invalid');
  const pages = [];
  let page = '', size = 0;
  for (const line of String(text ?? '').split(/(?<=\n)/)) {
    const bytes = Buffer.byteLength(line);
    if (size && size + bytes > maxBytes) {
      pages.push(page); page = ''; size = 0;
    }
    if (bytes <= maxBytes) { page += line; size += bytes; continue; }
    for (const char of line) {
      const length = Buffer.byteLength(char);
      if (size + length > maxBytes) { pages.push(page); page = ''; size = 0; }
      page += char; size += length;
    }
  }
  if (page) pages.push(page);
  return pages;
}

