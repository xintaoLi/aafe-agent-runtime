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

export const SDD_CHANGE_STATUSES = Object.freeze([
  'draft',
  'waiting_approval',
  'ready',
  'implementing',
  'verifying',
  'verified',
  'synced',
  'archived',
  'failed',
  'cancelled'
]);

export const SDD_TERMINAL_STATUSES = Object.freeze(['archived', 'cancelled']);

export const SDD_ARTIFACT_GRAPH = Object.freeze({
  proposal: Object.freeze([]),
  specs: Object.freeze(['proposal']),
  design: Object.freeze(['proposal']),
  tasks: Object.freeze(['specs', 'design'])
});

const TRANSITIONS = Object.freeze({
  draft: ['waiting_approval', 'ready', 'cancelled', 'failed'],
  waiting_approval: ['draft', 'ready', 'cancelled', 'failed'],
  ready: ['draft', 'implementing', 'synced', 'cancelled', 'failed'],
  implementing: ['draft', 'verifying', 'synced', 'failed', 'cancelled'],
  verifying: ['draft', 'implementing', 'verified', 'synced', 'failed', 'cancelled'],
  verified: ['draft', 'implementing', 'synced', 'failed', 'cancelled'],
  synced: ['draft', 'implementing', 'archived', 'failed', 'cancelled'],
  archived: [],
  failed: ['draft', 'cancelled'],
  cancelled: []
});

export function isSDDChangeStatus(value) {
  return SDD_CHANGE_STATUSES.includes(value);
}

export function isTerminalSDDChangeStatus(value) {
  return SDD_TERMINAL_STATUSES.includes(value);
}

export function canTransitionSDDChange(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertSDDChangeTransition(from, to) {
  if (!isSDDChangeStatus(from)) throw new Error(`unknown-sdd-status:${from}`);
  if (!isSDDChangeStatus(to)) throw new Error(`unknown-sdd-status:${to}`);
  if (!canTransitionSDDChange(from, to)) {
    throw new Error(`illegal-sdd-transition:${from}->${to}`);
  }
}

export function availableSDDArtifacts(artifacts = {}) {
  const present = new Set();
  if (artifacts.proposal) present.add('proposal');
  if (artifacts.design) present.add('design');
  if (artifacts.tasks) present.add('tasks');
  if (artifacts.specs && Object.keys(artifacts.specs).length > 0) present.add('specs');

  return Object.entries(SDD_ARTIFACT_GRAPH)
    .filter(([, dependencies]) => dependencies.every((dependency) => present.has(dependency)))
    .map(([artifact]) => artifact);
}

export function assertSDDArtifactWritable(kind, artifacts = {}) {
  const normalized = kind === 'spec' ? 'specs' : kind;
  const dependencies = SDD_ARTIFACT_GRAPH[normalized];
  if (!dependencies) throw new Error(`unknown-sdd-artifact:${kind}`);
  const available = availableSDDArtifacts(artifacts);
  if (!available.includes(normalized)) {
    const missing = dependencies.filter((dependency) => !artifactPresent(artifacts, dependency));
    throw new Error(`sdd-artifact-dependencies-missing:${kind}:${missing.join(',')}`);
  }
}

function artifactPresent(artifacts, kind) {
  if (kind === 'specs') return Boolean(artifacts.specs && Object.keys(artifacts.specs).length);
  return Boolean(artifacts[kind]);
}
