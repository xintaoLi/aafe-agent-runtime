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
  constructor() {
    /** @type {Map<string, import('./definition.js').AgentDefinition>} */
    this.agents = new Map();
    /** @type {Map<string, string[]>} capability -> agent ids in registration order */
    this.capabilityIndex = new Map();
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
    const owners = this.capabilityIndex.get(capability) ?? [];
    if (owners.length === 0) {
      return { agent: null, reason: `no-agent-provides-capability:${capability}` };
    }
    for (const id of owners) {
      const agent = this.agents.get(id);
      if (agent?.enabled) return { agent };
    }
    return { agent: null, reason: `capability-disabled:${capability}` };
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
export function createRegistryFromConfig(agentsConfig = {}) {
  const registry = new AgentRegistry();
  for (const [id, entry] of Object.entries(agentsConfig)) {
    registry.register(createAgentDefinition(id, entry));
  }
  return registry;
}
