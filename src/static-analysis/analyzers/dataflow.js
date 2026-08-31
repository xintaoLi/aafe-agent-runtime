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

import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

export class DataFlowAnalyzer {
  id = 'dataflow';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    if (context.config.dataflow?.enabled === false) {
      return createAnalysisResult(this.id, this.version, { flows: [], levels: {} }, {
        status: 'partial',
        diagnostics: [{ level: 'info', code: 'disabled', message: 'dataflow analyzer disabled' }]
      });
    }

    const graph = context.graph ?? { edges: [], nodes: [], routes: [] };
    const importFlows = graph.edges
      .filter((edge) => edge.type === 'IMPORTS')
      .slice(0, 500)
      .map((edge, index) => ({
        id: `flow:import:${index}`,
        level: 1,
        kind: 'import',
        entrypoint: edge.from,
        nodes: [edge.from, edge.to],
        edges: [{ from: edge.from, to: edge.to, type: 'IMPORTS' }],
        evidence: edge.evidence ?? []
      }));

    const callFlows = graph.edges
      .filter((edge) => edge.type === 'CALLS')
      .slice(0, 500)
      .map((edge, index) => ({
        id: `flow:call:${index}`,
        level: 2,
        kind: 'call',
        entrypoint: edge.from,
        nodes: [edge.from, edge.to],
        edges: [{ from: edge.from, to: edge.to, type: 'CALLS' }],
        evidence: edge.evidence ?? []
      }));

    const appFlows = [];
    for (const route of graph.routes ?? []) {
      const nodes = [`route:${route.path}`, `file:${route.file}`];
      const edges = [{ from: `route:${route.path}`, to: `file:${route.file}`, type: 'ROUTES_TO' }];
      const parsed = context.cache.parsed.get(route.file)?.extracted;
      if (parsed) {
        for (const hint of (parsed.dataHints ?? []).slice(0, 8)) {
          nodes.push(`data:${hint}`);
          edges.push({ from: `file:${route.file}`, to: `data:${hint}`, type: 'USES' });
        }
        for (const imp of (parsed.imports ?? []).slice(0, 8)) {
          if (/api|service|store|request|hooks|composables|query/i.test(imp.source)) {
            nodes.push(`import:${imp.source}`);
            edges.push({ from: `file:${route.file}`, to: `import:${imp.source}`, type: 'REQUESTS' });
          }
        }
      }
      appFlows.push({
        id: `flow:app:${route.path}:${route.file}`,
        level: 3,
        kind: 'application',
        entrypoint: route.path,
        nodes,
        edges,
        evidence: [createEvidence({ type: 'route', file: route.file, reason: route.path })]
      });
    }

    const flows = [...importFlows, ...callFlows, ...appFlows];
    return createAnalysisResult(this.id, this.version, {
      flows,
      levels: {
        import: importFlows.length,
        call: callFlows.length,
        application: appFlows.length
      }
    }, {
      evidence: appFlows.flatMap((flow) => flow.evidence).slice(0, 100),
      stats: {
        flows: flows.length,
        durationMs: Date.now() - started
      }
    });
  }
}
