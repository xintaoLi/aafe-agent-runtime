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

import { mergeAnalysisResult } from './types/context.js';
import { createDefaultAnalyzerRegistry, DEFAULT_ORDER } from './registry.js';
import { AnalysisStorage } from './storage/persist.js';
import { buildModuleBundles } from './modules/buildBundles.js';

const PHASE_LABELS = {
  repository: 'Repository scan',
  graph: 'Repository graph',
  architecture: 'Architecture analysis',
  dataflow: 'Data flow analysis',
  feature: 'Feature analysis',
  business: 'Business candidates',
  modules: 'Module consolidation'
};

export class AnalyzeOrchestrator {
  constructor(options = {}) {
    this.registry = options.registry ?? createDefaultAnalyzerRegistry();
    this.storage = options.storage ?? new AnalysisStorage();
    this.onPhase = options.onPhase ?? (() => {});
  }

  async run(context) {
    const order = DEFAULT_ORDER.filter((id) => {
      if (id === 'architecture') return context.config.architecture?.enabled !== false;
      if (id === 'dataflow') return context.config.dataflow?.enabled !== false;
      if (id === 'feature') return context.config.features?.enabled !== false;
      if (id === 'business') return context.config.business?.enabled !== false;
      return true;
    });

    for (const analyzer of this.registry.resolve(order)) {
      context.runtime.currentPhase = analyzer.id;
      const started = Date.now();
      const result = await analyzer.analyze(context, context);
      const durationMs = Date.now() - started;
      context.runtime.phaseTimings[analyzer.id] = durationMs;
      mergeAnalysisResult(context, {
        ...result,
        stats: { ...result.stats, durationMs: result.stats?.durationMs ?? durationMs }
      });
      this.onPhase({
        id: analyzer.id,
        label: PHASE_LABELS[analyzer.id] ?? analyzer.id,
        status: result.status,
        durationMs,
        stats: result.stats
      });
    }

    context.runtime.currentPhase = 'modules';
    const moduleStarted = Date.now();
    const moduleAnalysis = buildModuleBundles(context);
    context.moduleAnalysis = moduleAnalysis;
    const moduleDuration = Date.now() - moduleStarted;
    context.runtime.phaseTimings.modules = moduleDuration;
    this.onPhase({
      id: 'modules',
      label: PHASE_LABELS.modules,
      status: 'success',
      durationMs: moduleDuration,
      stats: { modules: moduleAnalysis.bundles.length }
    });

    context.runtime.currentPhase = 'persist';
    if (context.config.write !== false && !context.config.dryRun) {
      context.persistResult = await this.storage.persist(context);
    } else {
      context.persistResult = {
        skipped: true,
        output: context.config.output,
        formats: context.config.formats,
        planned: this.storage.plan(context)
      };
    }

    context.runtime.currentPhase = 'done';
    return context;
  }
}
