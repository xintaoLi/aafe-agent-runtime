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

import { RepositoryAnalyzer } from './analyzers/repository.js';
import { GraphAnalyzer } from './analyzers/graph.js';
import { ArchitectureAnalyzer } from './analyzers/architecture.js';
import { DataFlowAnalyzer } from './analyzers/dataflow.js';
import { FeatureAnalyzer } from './analyzers/feature.js';
import { BusinessAnalyzer } from './analyzers/business.js';

const DEFAULT_ORDER = [
  'repository',
  'graph',
  'architecture',
  'dataflow',
  'feature',
  'business'
];

export class AnalyzerRegistry {
  constructor() {
    this.analyzers = new Map();
  }

  register(analyzer) {
    this.analyzers.set(analyzer.id, analyzer);
    return this;
  }

  get(id) {
    return this.analyzers.get(id);
  }

  resolve(order = DEFAULT_ORDER) {
    return order.map((id) => this.analyzers.get(id)).filter(Boolean);
  }
}

export function createDefaultAnalyzerRegistry() {
  return new AnalyzerRegistry()
    .register(new RepositoryAnalyzer())
    .register(new GraphAnalyzer())
    .register(new ArchitectureAnalyzer())
    .register(new DataFlowAnalyzer())
    .register(new FeatureAnalyzer())
    .register(new BusinessAnalyzer());
}

export { DEFAULT_ORDER };
