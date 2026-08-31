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
 * Execution graph of agent invocations (RFC §7).
 *
 * Payloads are referenced by `inputRef` / `outputRef` rather than inlined so a
 * long run's graph stays small enough to serialise and re-read cheaply.
 *
 * @typedef {'pending'|'running'|'success'|'failed'|'skipped'} NodeStatus
 *
 * @typedef ExecutionNode
 * @property {string} id
 * @property {string} agent
 * @property {string} capability
 * @property {NodeStatus} status
 * @property {string} inputRef
 * @property {string} [outputRef]
 * @property {string} [parent]
 * @property {string[]} dependencies
 * @property {number} [startedAt]
 * @property {number} [finishedAt]
 * @property {string} [reason]
 */

const TRANSITIONS = Object.freeze({
  pending: ['running', 'skipped'],
  running: ['success', 'failed', 'skipped'],
  success: [],
  failed: [],
  skipped: []
});

export class ExecutionGraph {
  constructor() {
    /** @type {Map<string, ExecutionNode>} */
    this.nodes = new Map();
    this.sequence = 0;
  }

  /**
   * Claim an id before the node exists, so input artifacts can be named after
   * it. Synchronous on purpose: parallel invocations must not race for ids.
   */
  reserveNodeId() {
    this.sequence += 1;
    return `N${this.sequence}`;
  }

  /**
   * @returns {ExecutionNode}
   */
  addNode({ id, agent, capability, inputRef, parent = null, dependencies = [] }) {
    const node = {
      id: id ?? this.reserveNodeId(),
      agent,
      capability,
      status: 'pending',
      inputRef,
      outputRef: null,
      parent,
      dependencies: [...dependencies],
      startedAt: null,
      finishedAt: null
    };
    this.nodes.set(node.id, node);
    return node;
  }

  get(id) {
    return this.nodes.get(id) ?? null;
  }

  /**
   * Guarded status transition. Illegal moves throw rather than silently
   * corrupting the run record.
   */
  transition(id, status, patch = {}) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown execution node: ${id}`);
    if (!TRANSITIONS[node.status]?.includes(status)) {
      throw new Error(`Illegal execution node transition ${node.status} -> ${status} (${id})`);
    }
    node.status = status;
    if (status === 'running') node.startedAt = Date.now();
    if (status !== 'running' && status !== 'pending') node.finishedAt = Date.now();
    Object.assign(node, patch);
    return node;
  }

  /**
   * Nodes whose dependencies have all succeeded.
   */
  ready() {
    return this.list().filter((node) =>
      node.status === 'pending'
      && node.dependencies.every((dep) => this.nodes.get(dep)?.status === 'success')
    );
  }

  list() {
    return Array.from(this.nodes.values());
  }

  lastSuccessFor(capability) {
    return this.list()
      .filter((node) => node.capability === capability && node.status === 'success')
      .at(-1) ?? null;
  }

  toJSON() {
    return this.list().map((node) => ({ ...node }));
  }

  summary() {
    const counts = { pending: 0, running: 0, success: 0, failed: 0, skipped: 0 };
    for (const node of this.nodes.values()) counts[node.status] += 1;
    return counts;
  }
}
