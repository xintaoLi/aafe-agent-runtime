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

import { createAgentDefinition } from './definition.js';

/**
 * Capability-addressed agent registry (RFC §8, §11).
 */
export class AgentRegistry {
  /**
   * @param {object} [options]
   * @param {{ enabled?: boolean, mode?: string, capabilities?: string[] }} [options.ideAgent]
   *   When enabled, capabilities that no registered agent serves resolve to the
   *   IDE agent instead of failing. It cannot be pre-registered like a normal
   *   agent because the set of capabilities it may be asked for is open-ended.
   */
  constructor({ ideAgent = null } = {}) {
    /** @type {Map<string, import('./definition.js').AgentDefinition>} */
    this.agents = new Map();
    /** @type {Map<string, string[]>} capability -> agent ids in registration order */
    this.capabilityIndex = new Map();
    this.ideAgent = ideAgent?.enabled ? ideAgent : null;
  }

  register(definition) {
    const agent = definition.id ? definition : createAgentDefinition(definition);
    this.agents.set(agent.id, agent);
    for (const capability of agent.capabilities) {
      const owners = this.capabilityIndex.get(capability) ?? [];
      if (!owners.includes(agent.id)) owners.push(agent.id);
      this.capabilityIndex.set(capability, owners);
    }
    return this;
  }

  get(id) {
    return this.agents.get(id) ?? null;
  }

  list({ enabledOnly = false } = {}) {
    const all = Array.from(this.agents.values());
    return enabledOnly ? all.filter((agent) => agent.enabled) : all;
  }

  /**
   * Resolve which agent currently serves a capability.
   * Disabled agents are still reported so callers can explain *why* a
   * capability is unavailable instead of failing with "unknown capability".
   * @returns {{ agent: import('./definition.js').AgentDefinition|null, reason?: string }}
   */
  resolveCapability(capability) {
    // An explicit allowlist wins over a configured agent: it is how a project
    // says "this particular analysis needs judgement, send it to the IDE".
    if (this.ideAgent?.capabilities?.includes(capability)) {
      return { agent: this.ideAgentDefinition(capability), reason: 'ide-agent-requested' };
    }

    const owners = this.capabilityIndex.get(capability) ?? [];
    for (const id of owners) {
      const agent = this.agents.get(id);
      if (agent?.enabled) return { agent };
    }

    if (this.ideAgent) {
      return { agent: this.ideAgentDefinition(capability), reason: 'ide-agent-fallback' };
    }
    return {
      agent: null,
      reason: owners.length === 0
        ? `no-agent-provides-capability:${capability}`
        : `capability-disabled:${capability}`
    };
  }

  /**
   * The synthesized handoff agent. It declares only the capability being asked
   * for, so nothing downstream mistakes the fallback for an agent that can
   * serve everything.
   */
  ideAgentDefinition(capability) {
    return createAgentDefinition('ide-agent', {
      name: 'IDE Agent',
      description: 'Hands the capability to the coding agent running in the editor.',
      provider: 'ide',
      ref: `ide:${this.ideAgent.mode ?? 'current'}`,
      capabilities: [capability],
      enabled: true
    });
  }

  hasCapability(capability) {
    return Boolean(this.resolveCapability(capability).agent);
  }

  /**
   * `AgentCapability[]` for PlannerContext (RFC §4.1).
   *
   * A capability -> id map cannot express *why* something is unavailable, and a
   * planner that cannot tell "disabled" from "nonexistent" will keep proposing
   * a capability that will never be served.
   *
   * @returns {{id:string,name:string,description:string,capabilities:string[],enabled:boolean,provider:string,unavailableReason:string|null}[]}
   */
  capabilityList() {
    return this.list().map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: [...agent.capabilities],
      enabled: agent.enabled === true,
      provider: agent.provider,
      unavailableReason: agent.enabled === true ? null : `agent-disabled:${agent.id}`
    }));
  }

  /**
   * Capabilities the registry can actually serve right now.
   */
  servableCapabilities() {
    return Array.from(this.capabilityIndex.keys()).filter((capability) => this.hasCapability(capability));
  }

  /**
   * Capability -> agent id map for planner context and `aafe doctor`.
   */
  capabilityMap() {
    const map = {};
    for (const capability of this.capabilityIndex.keys()) {
      const { agent, reason } = this.resolveCapability(capability);
      map[capability] = agent ? agent.id : `unavailable(${reason})`;
    }
    return map;
  }
}

/**
 * Build a registry from a resolved `.aafe.agents.json` agents block.
 */
export function createRegistryFromConfig(agentsConfig = {}, { ideAgent = null } = {}) {
  const registry = new AgentRegistry({ ideAgent });
  for (const [id, entry] of Object.entries(agentsConfig)) {
    registry.register(createAgentDefinition(id, entry));
  }
  return registry;
}
