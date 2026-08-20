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

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAgentsConfig } from './config/agentsConfig.js';
import { createRegistryFromConfig } from './registry/AgentRegistry.js';
import { createPlanner } from './planner/index.js';
import { createDefaultProviders } from './runtime/providers/index.js';
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { ContractLoader } from './schema/loader.js';
import { AgentOrchestrator } from './orchestrator/AgentOrchestrator.js';
import { createBuiltinAgents } from '../agents/index.js';
import { KnowledgeStore } from '../knowledge/store/KnowledgeStore.js';

export { AgentRegistry, createRegistryFromConfig } from './registry/AgentRegistry.js';
export { AgentOrchestrator } from './orchestrator/AgentOrchestrator.js';
export { ExecutionGraph } from './orchestrator/ExecutionGraph.js';
export { ExecutionState } from './state/ExecutionState.js';
export { RunStore, createRunId } from './state/RunStore.js';
export { ExecutionPolicy } from './policy/ExecutionPolicy.js';
export { createPlanner, RulePlanner, LlmPlanner } from './planner/index.js';
export { loadAgentsConfig, defaultAgentsConfig, resolveAgentsConfig, AGENTS_CONFIG_FILE } from './config/agentsConfig.js';
export { AgentRuntime, createAgentRuntime } from './runtime/AgentRuntime.js';
export { ContractLoader, createContractLoader } from './schema/loader.js';
export { validateSchema, formatSchemaErrors } from './schema/validate.js';
export { coerceToSchema, coerceAndValidate, buildRepairPrompt } from './schema/repair.js';
export * from './protocol/request.js';
export * from './protocol/response.js';

/**
 * Assemble the full platform for a project root.
 *
 * @returns {Promise<{orchestrator: AgentOrchestrator, registry: object, planner: object, knowledge: KnowledgeStore, agentsConfig: object, warnings: string[]}>}
 */
export async function createAgentPlatform(root, options = {}) {
  const projectConfig = options.projectConfig ?? (await readJson(path.join(root, '.aafe.config.json'))) ?? {};
  const { config: agentsConfig, warnings } = await loadAgentsConfig(root, projectConfig);

  const output = options.output ?? projectConfig.analyze?.output ?? '.aafe';
  const knowledge = options.knowledge ?? new KnowledgeStore({ root, output });

  const registry = createRegistryFromConfig(agentsConfig.agents);
  const planner = options.planner ?? createPlanner(agentsConfig.planner, options.plannerDeps ?? {});
  const providers = options.providers ?? createDefaultProviders({
    implementations: createBuiltinAgents({ knowledge }),
    cwd: root,
    developer: agentsConfig.developer
  });

  // The contract loader resolves prompts and schemas from the project first and
  // falls back to the shipped builtins, so overriding one agent's contract does
  // not require forking the others.
  const contracts = options.contracts ?? new ContractLoader({ root });
  const runtime = options.runtime ?? new AgentRuntime({
    providers,
    contracts,
    root,
    onEvent: options.onEvent ?? (() => {})
  });

  const orchestrator = new AgentOrchestrator({
    registry,
    planner,
    providers,
    runtime,
    // `constraints` is the per-invocation escape hatch (a CLI flag); it may
    // only turn things on that the project config already permits by default.
    policies: { ...agentsConfig.policies, ...(options.policies ?? {}), ...(options.constraints ?? {}) },
    root,
    output,
    write: options.write !== false,
    knowledge,
    onEvent: options.onEvent
  });

  return {
    orchestrator,
    registry,
    planner,
    runtime,
    contracts,
    knowledge,
    agentsConfig,
    // Contract-loading problems surface after the first invocation, so the
    // getter keeps `platform.warnings` accurate rather than frozen at creation.
    get warnings() {
      return [...warnings, ...contracts.warnings];
    },
    output
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
