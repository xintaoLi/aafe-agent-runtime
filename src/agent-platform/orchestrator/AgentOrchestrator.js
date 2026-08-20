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

import { ExecutionGraph } from './ExecutionGraph.js';
import { ExecutionState } from '../state/ExecutionState.js';
import { RunStore, createRunId } from '../state/RunStore.js';
import { ExecutionPolicy, mapWithConcurrency } from '../policy/ExecutionPolicy.js';
import { createAgentRequest } from '../protocol/request.js';
import { agentFailed, agentSkipped } from '../protocol/response.js';
import { AgentRuntime } from '../runtime/AgentRuntime.js';

/**
 * Executes planner decisions reliably. It does not decide *what* to do — that
 * is the planner's job — it only decides *how* the decision is carried out:
 * dependency-ordered scheduling, retries, timeouts, cancellation, budget
 * enforcement, and state/graph bookkeeping.
 *
 * Contract validation is not here either. That belongs to AgentRuntime, so the
 * orchestrator never has to know whether an agent is local code or a remote
 * model.
 */
export class AgentOrchestrator {
  constructor({
    registry,
    planner,
    providers,
    runtime = null,
    policies = {},
    root = process.cwd(),
    output = '.aafe',
    write = true,
    knowledge = null,
    onEvent = () => {}
  }) {
    this.registry = registry;
    this.planner = planner;
    this.providers = providers;
    this.policy = new ExecutionPolicy(policies);
    this.root = root;
    this.output = output;
    this.write = write;
    this.knowledge = knowledge;
    this.onEvent = onEvent;
    this.runtime = runtime ?? new AgentRuntime({ providers, root, onEvent });
    /** @type {Map<string, AbortController>} */
    this.controllers = new Map();
  }

  /**
   * Observe → plan → act → observe loop (RFC §5).
   * @returns {Promise<object>} TaskResult
   */
  async execute(task, { signal: externalSignal = null } = {}) {
    const runId = createRunId();
    const graph = new ExecutionGraph();
    const state = new ExecutionState({ task, runId, root: this.root });
    const store = new RunStore({ root: this.root, output: this.output, runId, write: this.write });
    const controller = this.#registerController(task.id, externalSignal);
    const decisions = [];
    const maxSteps = this.planner.maxSteps ?? 12;

    let status = 'incomplete';
    let reason = 'max-steps-reached';

    try {
      while (state.step < maxSteps) {
        if (controller.signal.aborted) {
          status = 'cancelled';
          reason = 'cancelled-by-caller';
          break;
        }

        const overBudget = this.policy.assertWithinBudget(state.spent());
        if (overBudget) {
          status = 'failed';
          reason = overBudget;
          state.diagnostics.push(overBudget);
          break;
        }

        const decision = await this.planner.decide(await this.#plannerContext(task, state, graph));
        decisions.push(decision);
        this.onEvent({ type: 'decision', decision, step: state.step });

        if (decision.action === 'complete') {
          status = 'complete';
          reason = decision.reason;
          break;
        }
        if (decision.action === 'fail') {
          status = 'failed';
          reason = decision.reason;
          break;
        }
        if (decision.action === 'need_user_input') {
          status = 'need_user_input';
          reason = decision.reason;
          break;
        }
        if (decision.action === 'replan') {
          const replanned = this.replan(state, decision.reason);
          if (!replanned.ok) {
            status = 'failed';
            reason = replanned.reason;
            break;
          }
          continue;
        }

        const requested = decision.action === 'parallel'
          ? (decision.tasks ?? [])
          : [{ capability: decision.capability, input: decision.input, dependsOn: decision.dependsOn }];

        if (requested.length === 0) {
          state.diagnostics.push('planner returned an empty invocation set');
          status = 'failed';
          reason = 'planner-empty-invocation';
          break;
        }

        const ctx = { task, state, graph, store, signal: controller.signal };
        for (const { node, response } of await this.#runBatch(requested, ctx)) {
          this.updateState(state, node, response);
        }
      }
    } finally {
      this.controllers.delete(task.id);
    }

    const contextPackage = state.resultFor('context-packaging')?.result ?? null;
    const knowledgeWrite = await this.#persistKnowledge(state, runId);

    const record = {
      runId,
      status,
      reason,
      task,
      decisions,
      nodes: graph.toJSON(),
      state: state.toJSON(),
      summary: graph.summary(),
      metrics: { ...state.metrics, wallClockMs: Date.now() - state.startedAt },
      knowledgeWrite
    };
    const runRef = await store.writeRun(record);
    const contextRef = contextPackage ? await store.writeContextPackage(contextPackage) : null;

    // Agent payloads stay out of run.json (they are already in nodes/*.output.json)
    // but in-process callers get them directly instead of re-reading from disk.
    return {
      ...record,
      runRef,
      contextRef,
      contextPackage,
      results: Object.fromEntries(state.resultsByCapability)
    };
  }

  /**
   * Fold one agent result into the execution state (RFC §6).
   *
   * Exposed as a method rather than inlined so a caller driving the loop
   * manually — a replay, a test harness, an IDE stepping through a run — folds
   * results in exactly the way `execute` does.
   */
  updateState(state, node, response) {
    state.record(node, response);
    this.onEvent({ type: 'agent', node, status: response.status, reason: response.reason });
    return state;
  }

  /**
   * Discard the assumptions the current plan rested on and let the planner
   * start over from the observed state (RFC §6).
   *
   * Bounded, because a planner that can always replan can always avoid
   * finishing. Prior results are kept: replanning changes the route, not the
   * facts already established.
   */
  replan(state, reason, { maxReplans = 3 } = {}) {
    if (state.replans >= maxReplans) {
      return { ok: false, reason: `replan-limit-reached:${maxReplans}` };
    }
    state.replans += 1;
    state.pendingSuggestions = [];
    state.diagnostics.push(`replan(${state.replans}): ${reason}`);
    this.onEvent({ type: 'replan', reason, count: state.replans });
    return { ok: true, reason };
  }

  /**
   * Invoke one capability. Resolution failures are protocol responses, not
   * exceptions, so a missing agent degrades the run instead of crashing it.
   */
  async invoke(capability, input, ctx) {
    const prepared = await this.#prepare({ capability, input }, ctx, new Map());
    return prepared.response ? prepared : this.#run(prepared, ctx);
  }

  /**
   * Fan-out for `action: 'parallel'` decisions, bounded by policy.maxParallel.
   */
  async parallel(requests, ctx) {
    return this.#runBatch(requests, ctx);
  }

  cancel(taskId) {
    this.controllers.get(taskId)?.abort();
  }

  /**
   * Dependency-ordered execution of one planner decision.
   *
   * All nodes are created up front so the execution graph shows the intended
   * shape even for work that never gets to run, then released in waves as their
   * dependencies succeed. Without this the graph is only a log of what already
   * happened; with it, it is what decides what happens next.
   */
  async #runBatch(requested, ctx) {
    const byCapability = new Map();
    const prepared = [];
    for (const item of requested) {
      const node = await this.#prepare(item, ctx, byCapability);
      prepared.push(node);
      if (node.node) byCapability.set(item.capability, node.node.id);
    }

    const results = [];
    const pending = prepared.filter((item) => !item.response);
    for (const item of prepared) {
      if (item.response) results.push({ node: item.node, response: item.response });
    }

    while (pending.length > 0) {
      if (ctx.signal?.aborted) {
        for (const item of pending.splice(0)) {
          ctx.graph.transition(item.node.id, 'skipped', { reason: 'cancelled' });
          results.push({ node: item.node, response: agentSkipped('cancelled') });
        }
        break;
      }

      const ready = ctx.graph.ready();
      const readyIds = new Set(ready.map((node) => node.id));
      const wave = pending.filter((item) => readyIds.has(item.node.id));

      if (wave.length === 0) {
        // Nothing can advance: the remaining nodes depend on something that did
        // not succeed. Reporting that is more useful than deadlocking.
        for (const item of pending.splice(0)) {
          const reason = `dependency-not-satisfied:${item.node.dependencies.join(',')}`;
          ctx.graph.transition(item.node.id, 'skipped', { reason });
          results.push({ node: item.node, response: agentSkipped(reason) });
        }
        break;
      }

      const waveResults = await mapWithConcurrency(wave, this.policy.maxParallel, (item) => this.#run(item, ctx));
      results.push(...waveResults);
      for (const item of wave) {
        pending.splice(pending.indexOf(item), 1);
      }
    }

    return results;
  }

  /**
   * Resolve the capability, claim a node id, persist the input. Returns early
   * with a `response` when the capability cannot be served at all.
   */
  async #prepare({ capability, input = null, dependsOn = [] }, ctx, batchIds) {
    const id = ctx.graph.reserveNodeId();
    const inputRef = await ctx.store.writeInput(id, input);
    const dependencies = this.#resolveDependencies(dependsOn, ctx.graph, batchIds);

    const addNode = (agentId) => ctx.graph.addNode({ id, agent: agentId, capability, inputRef, dependencies });

    const { agent, reason } = this.registry.resolveCapability(capability);
    if (!agent) {
      const node = addNode('(unresolved)');
      ctx.graph.transition(node.id, 'skipped', { reason });
      return { node, response: agentSkipped(reason) };
    }

    const denied = this.policy.assertProviderAllowed(agent);
    if (denied) {
      const node = addNode(agent.id);
      ctx.graph.transition(node.id, 'skipped', { reason: denied });
      return { node, response: agentSkipped(denied) };
    }

    if (!this.providers[agent.provider]) {
      const node = addNode(agent.id);
      const unknown = `unknown-provider:${agent.provider}`;
      ctx.graph.transition(node.id, 'skipped', { reason: unknown });
      return { node, response: agentSkipped(unknown) };
    }

    return { node: addNode(agent.id), agent, capability, input };
  }

  async #run({ node, agent, capability, input }, ctx) {
    const constraints = this.policy.constraintsFor(agent);
    const request = createAgentRequest({
      taskId: ctx.task.id,
      runId: ctx.state.runId,
      agentId: agent.id,
      capability,
      goal: ctx.task.goal,
      input,
      context: {
        root: this.root,
        output: this.output,
        knowledge: this.knowledge,
        task: ctx.task,
        priorResults: Object.fromEntries(ctx.state.resultsByCapability)
      },
      constraints
    });

    ctx.graph.transition(node.id, 'running');
    const response = await this.#invokeWithRetry(agent, request, constraints, ctx.signal);
    const outputRef = await ctx.store.writeOutput(node.id, response);
    ctx.graph.transition(node.id, statusToNodeStatus(response.status), {
      outputRef,
      ...(response.reason ? { reason: response.reason } : {})
    });
    return { node, response };
  }

  async #invokeWithRetry(agent, request, constraints, signal) {
    let last = agentFailed('agent-not-invoked');
    for (let attempt = 0; attempt <= constraints.maxRetries; attempt += 1) {
      if (signal?.aborted) return agentSkipped('cancelled');
      try {
        last = await this.runtime.invoke(agent, request, { signal });
      } catch (error) {
        last = agentFailed(error instanceof Error ? error.message : String(error));
      }
      if (last.status !== 'failed') return last;
    }
    return last;
  }

  /**
   * A planner may express a dependency as a capability name (the natural way to
   * think about it) or as an execution node id (the precise way). Both resolve
   * to node ids here so the graph only ever holds ids.
   */
  #resolveDependencies(dependsOn, graph, batchIds) {
    const ids = [];
    for (const raw of Array.isArray(dependsOn) ? dependsOn : []) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      if (graph.get(value)) {
        ids.push(value);
        continue;
      }
      const withinBatch = batchIds.get(value);
      if (withinBatch) {
        ids.push(withinBatch);
        continue;
      }
      const previous = graph.lastSuccessFor(value);
      if (previous) ids.push(previous.id);
    }
    return [...new Set(ids)];
  }

  /**
   * Close the `Knowledge Update -> Planner` loop (RFC §5) by writing what the
   * agents learned back to the store. A run that only records updates in its
   * own log teaches the platform nothing.
   */
  async #persistKnowledge(state, runId) {
    if (state.knowledgeUpdates.length === 0) return null;
    if (!this.knowledge || typeof this.knowledge.applyKnowledgeUpdates !== 'function') return null;
    try {
      const stats = await this.knowledge.applyKnowledgeUpdates(state.knowledgeUpdates, {
        runId,
        write: this.write
      });
      this.onEvent({ type: 'knowledge', ...stats });
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.diagnostics.push(`knowledge-write-failed: ${message}`);
      return { error: message };
    }
  }

  #registerController(taskId, externalSignal) {
    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    this.controllers.set(taskId, controller);
    return controller;
  }

  /**
   * PlannerContext (RFC §4.1). The planner gets the project, the agent list and
   * the execution graph — not just a capability map — so it can reason about
   * why something is unavailable and about what already ran.
   */
  async #plannerContext(task, state, graph) {
    return {
      task,
      state,
      graph,
      registry: this.registry,
      knowledge: this.knowledge,
      project: await this.#projectContext(),
      availableAgents: this.registry.capabilityList(),
      capabilities: this.registry.capabilityMap(),
      constraints: this.policy.base,
      spent: state.spent()
    };
  }

  async #projectContext() {
    const base = { name: null, root: this.root, commit: null, knowledgeOutput: this.output, knowledgeAvailable: false };
    if (!this.knowledge) return { ...base, knowledgeStale: true, stalenessReason: 'unavailable' };
    try {
      const [manifest, staleness] = await Promise.all([
        this.knowledge.manifest(),
        this.knowledge.staleness()
      ]);
      return {
        ...base,
        name: manifest?.project?.name ?? null,
        commit: manifest?.analysis?.commit ?? null,
        knowledgeOutput: manifest?.output ?? this.output,
        knowledgeAvailable: Boolean(manifest),
        knowledgeStale: staleness.stale === true,
        stalenessReason: staleness.reason ?? null
      };
    } catch (error) {
      return {
        ...base,
        knowledgeStale: true,
        stalenessReason: `unreadable:${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

function statusToNodeStatus(status) {
  if (status === 'success' || status === 'partial') return 'success';
  if (status === 'skipped') return 'skipped';
  return 'failed';
}
