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

import { normalizeModuleId } from '../model/index.js';

/**
 * Module dependency graph with both directions available.
 * `MODULE_DEPENDS: A -> B` means A imports B, so a change in B propagates to A.
 */
export function buildModuleGraph(moduleRelations = []) {
  const forward = new Map();
  const reverse = new Map();
  const evidence = new Map();

  for (const relation of moduleRelations) {
    const from = normalizeModuleId(relation.from);
    const to = normalizeModuleId(relation.to);
    if (!from || !to || from === to) continue;
    push(forward, from, to);
    push(reverse, to, from);
    evidence.set(`${to}<-${from}`, relation.evidence ?? []);
  }

  return { forward, reverse, evidence };
}

/**
 * Breadth-first walk over dependents. A change in `seeds` reaches everything
 * that (transitively) imports them; the score decays per hop so direct
 * dependents outrank far-away ones.
 *
 * @returns {Map<string, {distance:number, score:number, via:string|null, evidence:object[]}>}
 */
export function propagateImpact(graph, seeds, { maxDepth = 3, decay = 0.55 } = {}) {
  const reached = new Map();
  let frontier = Array.from(new Set(seeds.map(normalizeModuleId))).filter(Boolean);

  for (const seed of frontier) {
    reached.set(seed, { distance: 0, score: 1, via: null, evidence: [] });
  }

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const dependent of graph.reverse.get(current) ?? []) {
        if (reached.has(dependent)) continue;
        reached.set(dependent, {
          distance: depth,
          score: Number((decay ** depth).toFixed(3)),
          via: current,
          evidence: (graph.evidence.get(`${current}<-${dependent}`) ?? []).slice(0, 3)
        });
        next.push(dependent);
      }
    }
    frontier = next;
  }

  return reached;
}

/**
 * Application-level dataflow edges that touch any of the given modules.
 */
export function flowsForModules(dataflowRelations = [], moduleIds = []) {
  const wanted = new Set(moduleIds.map(normalizeModuleId));
  const byFlow = new Map();
  for (const relation of dataflowRelations) {
    const moduleId = normalizeModuleId(relation.moduleId);
    if (!wanted.has(moduleId)) continue;
    const entry = byFlow.get(relation.flowId) ?? { id: relation.flowId, moduleId, edges: [] };
    entry.edges.push({ from: relation.from, to: relation.to, type: relation.type });
    byFlow.set(relation.flowId, entry);
  }
  return Array.from(byFlow.values());
}

/**
 * Fan-in / fan-out per module. High fan-in marks a module whose change is
 * expensive; high fan-out marks one that is hard to reason about in isolation.
 */
export function degreeStats(graph, moduleIds = []) {
  const ids = new Set([...moduleIds.map(normalizeModuleId), ...graph.forward.keys(), ...graph.reverse.keys()]);
  return Array.from(ids)
    .filter(Boolean)
    .map((id) => ({
      id,
      dependsOn: (graph.forward.get(id) ?? []).length,
      dependents: (graph.reverse.get(id) ?? []).length
    }))
    .sort((a, b) => (b.dependents - a.dependents) || (b.dependsOn - a.dependsOn));
}

/**
 * Dependency cycles via iterative DFS on the colour marking. Iterative rather
 * than recursive because a large monorepo graph can exceed the call stack.
 * @returns {string[][]} each cycle as the path that closes it
 */
export function detectCycles(graph, { maxCycles = 20 } = {}) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map();
  const cycles = [];

  for (const start of graph.forward.keys()) {
    if ((colour.get(start) ?? WHITE) !== WHITE) continue;

    /** @type {{node:string, edges:string[], index:number}[]} */
    const stack = [{ node: start, edges: graph.forward.get(start) ?? [], index: 0 }];
    colour.set(start, GREY);

    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame.index >= frame.edges.length) {
        colour.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const next = frame.edges[frame.index];
      frame.index += 1;

      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        const from = stack.findIndex((item) => item.node === next);
        if (from !== -1 && cycles.length < maxCycles) {
          cycles.push([...stack.slice(from).map((item) => item.node), next]);
        }
        continue;
      }
      if (state === BLACK) continue;

      colour.set(next, GREY);
      stack.push({ node: next, edges: graph.forward.get(next) ?? [], index: 0 });
    }
  }
  return cycles;
}

function push(map, key, value) {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}
