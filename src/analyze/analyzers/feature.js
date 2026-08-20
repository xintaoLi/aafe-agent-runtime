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

import path from 'node:path';
import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

/**
 * Static Feature Candidate extractor.
 * Marks source=static / status=candidate — not business truth.
 */
export class FeatureAnalyzer {
  id = 'feature';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    if (context.config.features?.enabled === false) {
      return createAnalysisResult(this.id, this.version, { candidates: [] }, {
        status: 'partial',
        diagnostics: [{ level: 'info', code: 'disabled', message: 'feature analyzer disabled' }]
      });
    }

    const routes = context.graph?.routes ?? [];
    const candidates = [];

    for (const route of routes) {
      const extracted = context.cache.parsed.get(route.file)?.extracted;
      const components = (extracted?.components ?? []).map((item) => item.name);
      const apis = (extracted?.imports ?? [])
        .map((item) => item.source)
        .filter((source) => /api|service|request/i.test(source));
      const stores = (extracted?.imports ?? [])
        .map((item) => item.source)
        .filter((source) => /store|pinia|vuex|redux|zustand/i.test(source));
      const dataHints = extracted?.dataHints ?? [];

      const name = inferFeatureName(route);
      const confidence = scoreConfidence({ route, components, apis, stores, dataHints });

      candidates.push({
        id: `feature:${slug(route.path || route.file)}`,
        name,
        entrypoints: [route.path || route.file],
        components,
        apis,
        stores,
        dataHints,
        evidence: [
          createEvidence({ type: 'route', file: route.file, reason: route.path }),
          ...apis.slice(0, 3).map((api) => createEvidence({ type: 'api', file: route.file, reason: api })),
          ...components.slice(0, 3).map((component) => createEvidence({
            type: 'ast',
            file: route.file,
            symbol: component
          }))
        ],
        confidence,
        source: 'static',
        status: 'candidate'
      });
    }

    // Also create candidates from high-signal page components without explicit routes
    for (const [file, cached] of context.cache.parsed.entries()) {
      if (!/(pages|views|app)\//.test(file)) continue;
      if (candidates.some((item) => item.evidence.some((ev) => ev.file === file))) continue;
      const components = (cached.extracted?.components ?? []).map((item) => item.name);
      candidates.push({
        id: `feature:file:${slug(file)}`,
        name: path.basename(file, path.extname(file)),
        entrypoints: [file],
        components,
        apis: [],
        stores: [],
        dataHints: cached.extracted?.dataHints ?? [],
        evidence: [createEvidence({ type: 'source', file, reason: 'page-like file' })],
        confidence: 0.45,
        source: 'static',
        status: 'candidate'
      });
    }

    return createAnalysisResult(this.id, this.version, { candidates: candidates.slice(0, 200) }, {
      evidence: candidates.flatMap((item) => item.evidence).slice(0, 120),
      stats: {
        features: candidates.length,
        durationMs: Date.now() - started
      }
    });
  }
}

function inferFeatureName(route) {
  const raw = String(route.path || route.name || route.file || 'feature')
    .replace(/^\//, '')
    .replace(/[:*]/g, '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!raw) return 'root';
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/\.[^.]+$/, '');
}

function scoreConfidence({ route, components, apis, stores, dataHints }) {
  let score = 0.4;
  if (route.path) score += 0.2;
  if (components.length) score += 0.1;
  if (apis.length) score += 0.15;
  if (stores.length) score += 0.1;
  if (dataHints.length) score += 0.05;
  return Math.min(0.95, Number(score.toFixed(2)));
}

function slug(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/[/_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'feature';
}
