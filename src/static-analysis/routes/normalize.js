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

const SOURCE_ROOTS = new Set(['src', 'packages', 'modules', 'apps', 'app', 'pages', 'views']);
const FILE_EXT = /\.(vue|tsx?|jsx?|mjs|cjs)$/i;

/**
 * Vue-router / React-router child paths are relative. Join them the same way
 * the runtime does so analyze emits `/manage/clean-templates/list` instead of
 * a dangling `list` that later fails `isRealRoute`.
 */
export function joinRoutePath(parentPath, childPath) {
  const child = String(childPath ?? '');
  if (child.startsWith('/') || /^https?:\/\//i.test(child)) return child || '/';
  const parent = String(parentPath ?? '').replace(/\/+$/, '');
  if (!child) return parent || '/';
  if (!parent || parent === '/') return `/${child}`.replace(/\/+/g, '/');
  return `${parent}/${child}`.replace(/\/+/g, '/');
}

export function looksLikeComponentFile(value) {
  const text = String(value ?? '');
  if (!text || text.includes('${')) return false;
  return FILE_EXT.test(text) || (/[/.]/.test(text) && !text.endsWith('()'));
}

/**
 * Architecture used to persist `routes: [pathString]`. Downstream then read
 * `route.path` and wrote empty records. Accept both shapes.
 */
export function normalizeRouteRecord(route, fallback = {}) {
  if (route == null) {
    return { path: '', name: '', file: fallback.file || '', component: '', source: fallback.source || 'unknown' };
  }
  if (typeof route === 'string') {
    return {
      path: route,
      name: '',
      file: fallback.file || '',
      component: fallback.component || '',
      source: fallback.source || 'unknown'
    };
  }
  return {
    path: route.path ?? route.route ?? '',
    name: route.name || '',
    file: route.file || fallback.file || '',
    component: route.component || fallback.component || '',
    source: route.source || fallback.source || 'unknown',
    importSource: route.importSource || '',
    childrenRef: route.childrenRef || ''
  };
}

export function routePathOf(route) {
  return normalizeRouteRecord(route).path;
}

/**
 * PR files in a monorepo are often `bklog/web/src/...` while analyze indexes
 * `src/...`. Produce suffixes that can match either side.
 */
export function filePathCandidates(file) {
  const normalized = String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return [];
  const out = [normalized];
  const parts = normalized.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    if (SOURCE_ROOTS.has(parts[i])) {
      out.push(parts.slice(i).join('/'));
    }
  }
  return unique(out);
}

export function filePathMatches(left, right) {
  if (!left || !right) return false;
  const a = filePathCandidates(left);
  const b = filePathCandidates(right);
  for (const candidate of a) {
    for (const known of b) {
      if (candidate === known) return true;
      if (candidate.endsWith(`/${known}`) || known.endsWith(`/${candidate}`)) return true;
    }
  }
  return false;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
