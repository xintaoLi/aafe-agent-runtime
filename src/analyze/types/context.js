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

/**
 * Create shared AnalyzeContext for the pipeline.
 */
export function createAnalyzeContext({ root, project, config, commit = null }) {
  return {
    project: project ?? {
      name: 'unknown',
      root,
      version: null
    },
    config,
    repository: null,
    graph: {
      nodes: [],
      edges: []
    },
    architecture: null,
    dataflow: null,
    features: null,
    business: null,
    diagnostics: [],
    cache: {
      fileHashes: new Map(),
      parsed: new Map()
    },
    runtime: {
      startedAt: Date.now(),
      currentPhase: 'init',
      commit,
      phaseTimings: {},
      stats: {
        files: 0,
        modules: 0,
        symbols: 0,
        dependencies: 0,
        flows: 0,
        features: 0,
        businessCandidates: 0
      }
    },
    results: {}
  };
}

export function mergeAnalysisResult(context, result) {
  context.results[result.analyzer] = result;
  context.diagnostics.push(...(result.diagnostics ?? []));
  if (result.data && result.analyzer === 'repository') context.repository = result.data;
  if (result.data && result.analyzer === 'graph') context.graph = result.data;
  if (result.data && result.analyzer === 'architecture') context.architecture = result.data;
  if (result.data && result.analyzer === 'dataflow') context.dataflow = result.data;
  if (result.data && result.analyzer === 'feature') context.features = result.data;
  if (result.data && result.analyzer === 'business') context.business = result.data;

  const stats = result.stats ?? {};
  if (stats.scannedFiles != null) context.runtime.stats.files = stats.scannedFiles;
  if (stats.modules != null) context.runtime.stats.modules = stats.modules;
  if (stats.symbols != null) context.runtime.stats.symbols = stats.symbols;
  if (stats.dependencies != null) context.runtime.stats.dependencies = stats.dependencies;
  if (stats.flows != null) context.runtime.stats.flows = stats.flows;
  if (stats.features != null) context.runtime.stats.features = stats.features;
  if (stats.businessCandidates != null) context.runtime.stats.businessCandidates = stats.businessCandidates;
  return context;
}
