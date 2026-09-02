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

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAgentPlatform } from '../agent-platform/index.js';
import { createAgentRequest, createTask } from '../agent-platform/protocol/request.js';
import { createAgentDefinition } from '../agent-platform/registry/definition.js';
import { agentFailed, agentSkipped } from '../agent-platform/protocol/response.js';
import { ExecutionPolicy } from '../agent-platform/policy/ExecutionPolicy.js';
import { isAgentModeEnabled } from './agentMode.js';
import { resolveCursorMcpForRun, toCursorMcpServers } from './agentMcp.js';
import { CONTEXT_FORMATS, renderContextPackage } from '../ide-bridge/context/render.js';
import { renderImpactMarkdown } from '../knowledge/report/impactMarkdown.js';
import { listRuns, replayRun } from '../agent-platform/state/RunStore.js';
import { loadE2eConfig, NEED_BASE_URL_PROMPT, NEED_URL_ROLE_PROMPT } from '../testing/e2e/config.js';
import { NEED_AUTH_PROMPT } from '../testing/e2e/auth.js';

/**
 * CLI surface for the agent platform (RFC §25).
 *
 * These commands are the bridge an IDE agent talks to: `context` produces the
 * package it should read, `impact` and `plan` are the inspectable steps behind it.
 */

export async function runContextCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  const format = CONTEXT_FORMATS.includes(options.format) ? options.format : 'ai';
  const task = taskFromOptions(options);
  if (!task) return usageError('context');

  const { result, warnings } = await executeTask(root, task, options);
  const pkg = result.contextPackage;

  if (!pkg) {
    const payload = {
      status: 'fail',
      command: 'aafe context',
      reason: result.reason,
      runStatus: result.status,
      decisions: result.decisions.map(compactDecision),
      nodes: result.nodes.map(compactNode),
      warnings
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return payload;
  }

  const rendered = renderContextPackage(pkg, format);
  if (options.out) {
    const target = path.isAbsolute(options.out) ? options.out : path.join(root, options.out);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, rendered, 'utf8');
    console.log(JSON.stringify({
      status: 'pass',
      command: 'aafe context',
      format,
      out: options.out,
      tokenEstimate: pkg.tokenEstimate,
      runRef: result.runRef,
      contextRef: result.contextRef
    }, null, 2));
    return result;
  }

  process.stdout.write(rendered);
  if (format !== 'json') {
    console.error(`\n[aafe context] run=${result.runId} tokens=${pkg.tokenEstimate}${result.contextRef ? ` saved=${result.contextRef}` : ''}`);
  }
  return result;
}

export async function runImpactCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  const task = taskFromOptions(options);
  if (!task) return usageError('impact');

  const { result, warnings } = await executeTask(root, task, options);
  const impact = pickImpact(result);

  if (!impact) {
    const payload = {
      status: 'fail',
      command: 'aafe impact',
      reason: result.reason,
      nodes: result.nodes.map(compactNode),
      warnings
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return payload;
  }

  if (options.format === 'md') {
    process.stdout.write(renderImpactMarkdown(task, impact));
    return result;
  }

  console.log(JSON.stringify({
    status: 'pass',
    command: 'aafe impact',
    task: { kind: task.kind, goal: task.goal, diffRef: task.diffRef },
    impact,
    validation: result.state.history.find((entry) => entry.capability === 'knowledge-validation') ?? null,
    runRef: result.runRef,
    warnings
  }, null, 2));
  return result;
}

/**
 * Shows the decision trace. With `--dry-run` no agent is invoked at all, which
 * makes it safe to inspect what the planner intends to do.
 */
export async function runPlanCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  const task = taskFromOptions(options);
  if (!task) return usageError('plan');

  const platform = await createAgentPlatform(root, { write: false });

  if (options.dryRun) {
    const trace = await tracePlan(platform, task);
    console.log(JSON.stringify({
      status: 'pass',
      command: 'aafe plan',
      dryRun: true,
      planner: platform.agentsConfig.planner.provider,
      task: { kind: task.kind, goal: task.goal },
      capabilities: platform.registry.capabilityMap(),
      trace,
      warnings: platform.warnings
    }, null, 2));
    return trace;
  }

  const result = await platform.orchestrator.execute(task);
  console.log(JSON.stringify({
    status: result.status === 'complete' ? 'pass' : 'fail',
    command: 'aafe plan',
    planner: platform.agentsConfig.planner.provider,
    runStatus: result.status,
    reason: result.reason,
    decisions: result.decisions.map(compactDecision),
    nodes: result.nodes.map(compactNode),
    warnings: platform.warnings
  }, null, 2));
  if (result.status !== 'complete') process.exitCode = 1;
  return result;
}

export async function runPlatformRunCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  if (options.list) return listStoredRuns(root, options);
  if (options.replay) return replayStoredRun(root, options);

  const task = taskFromOptions(options);
  if (!task) return usageError('run');

  const { result, warnings, platform } = await executeTask(root, task, options);
  const developerExecution = await runDeveloperAgent(root, task, result, options, platform);
  const runPassed = result.status === 'complete' && (!developerExecution || ['success', 'partial', 'skipped'].includes(developerExecution.status));
  console.log(JSON.stringify({
    status: runPassed ? 'pass' : 'fail',
    command: 'aafe run',
    runId: result.runId,
    runStatus: result.status,
    reason: result.reason,
    decisions: result.decisions.map(compactDecision),
    nodes: result.nodes.map(compactNode),
    summary: result.summary,
    metrics: result.metrics,
    knowledgeWrite: result.knowledgeWrite,
    contextRef: result.contextRef,
    tokenEstimate: result.contextPackage?.tokenEstimate ?? null,
    developerExecution,
    warnings
  }, null, 2));
  if (!runPassed) process.exitCode = 1;
  return result;
}

async function runDeveloperAgent(root, task, result, options, platform) {
  if (result.status !== 'complete' || !result.contextPackage) return null;
  const effectiveRoot = platform.orchestrator.root ?? root;

  const developer = platform.agentsConfig.developer ?? {};
  const overlay = platform.agentsConfig.agent ?? {};
  const provider = resolveDeveloperProvider(options, developer, overlay);
  if (!provider) return null;
  if (provider !== 'cursor') {
    return agentSkipped(`developer-provider-not-executable:${provider}`);
  }

  const mcp = await resolveCursorMcpForRun(overlay.mcp ?? {}, {
    root: effectiveRoot,
    env: process.env,
    enabled: options.mcp === false ? false : undefined,
    config: options.mcpConfig,
    settingSources: options.mcpSettingSources
  });
  const mcpServers = toCursorMcpServers(mcp.servers);

  const definition = createAgentDefinition('developer-agent', {
    name: 'AAFE Cursor Developer Agent',
    description: 'Executes the implementation phase through Cursor SDK.',
    provider: 'cursor',
    ref: options.agentRuntime ?? overlay.mode ?? developer.ref ?? developer.runtime ?? 'local',
    runtime: options.agentRuntime ?? overlay.mode ?? developer.runtime ?? null,
    model: options.model ?? overlay.model ?? developer.model ?? null,
    apiKeyEnv: options.cursorApiKeyEnv ?? overlay.apiKeyEnv ?? developer.apiKeyEnv ?? 'CURSOR_API_KEY',
    apiKey: overlay.apiKey ?? developer.apiKey ?? null,
    repository: options.cursorRepository ?? overlay.repository ?? developer.repository ?? developer.repositories ?? developer.repo ?? null,
    repositories: overlay.repositories ?? developer.repositories ?? null,
    repo: overlay.repo ?? developer.repo ?? null,
    cwd: overlay.cwd ?? developer.cwd ?? effectiveRoot,
    settingSources: mcp.settingSources.length
      ? mcp.settingSources
      : (overlay.settingSources ?? developer.settingSources),
    mcpServers,
    autoCreatePR: overlay.autoCreatePR ?? developer.autoCreatePR,
    skipReviewerRequest: overlay.skipReviewerRequest ?? developer.skipReviewerRequest,
    capabilities: ['implementation'],
    enabled: true,
    prompt: null,
    inputSchema: null,
    outputSchema: null,
    schemaMode: 'off'
  });

  // Network is allowed only for this post-plan Cursor step, not the planner loop.
  const cursorPolicy = new ExecutionPolicy({ ...platform.orchestrator.policy.base, allowNetwork: true });
  const denied = cursorPolicy.assertProviderAllowed(definition);
  if (denied) return agentFailed(denied);

  const execution = await platform.runtime.invoke(definition, createAgentRequest({
    taskId: task.id,
    runId: result.runId,
    agentId: definition.id,
    capability: 'implementation',
    goal: task.goal,
    input: {
      prompt: buildCursorImplementationPrompt(task, result.contextPackage)
    },
    context: {
      root: effectiveRoot,
      output: platform.output,
      task,
      contextPackage: result.contextPackage,
      priorResults: result.results ?? {}
    },
    constraints: platform.orchestrator.policy.base
  }));
  if (!execution || typeof execution !== 'object') return execution;
  return {
    ...execution,
    mcp: {
      enabled: mcp.enabled,
      servers: Object.keys(mcp.servers),
      settingSources: mcp.settingSources,
      warnings: mcp.warnings
    }
  };
}

function resolveDeveloperProvider(options, developer, overlay = {}) {
  if (options.agent === 'off') return null;
  if (options.agent) return options.agent;
  if (isAgentModeEnabled(overlay) && (overlay.provider ?? 'cursor') === 'cursor') return 'cursor';
  return developer.provider === 'cursor' ? 'cursor' : null;
}

function buildCursorImplementationPrompt(task, contextPackage) {
  return [
    'You are the implementation agent of AAFE.',
    '',
    '## Task',
    task.requirement ?? task.goal,
    '',
    '## AAFE Context Package',
    renderContextPackage(contextPackage, 'ai'),
    '',
    '## Execution',
    '1. Inspect the identified files before editing.',
    '2. Implement the smallest change that satisfies the task.',
    '3. Preserve unrelated user changes.',
    '4. Run focused verification when appropriate.',
    '5. Report changed files and verification results.'
  ].join('\n');
}

/**
 * `aafe run --list` — what has this repository already asked the platform?
 */
async function listStoredRuns(root, options) {
  const output = options.output ?? '.aafe';
  const runs = await listRuns(root, output, { limit: options.limit ?? 20 });
  const payload = { status: 'pass', command: 'aafe run --list', output, count: runs.length, runs };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * `aafe run --replay=<runId>` — rehydrate a stored run with its node payloads.
 *
 * Read-only: the point of a stored run is that it is the record of what
 * happened, so re-executing it would answer a different question.
 */
async function replayStoredRun(root, options) {
  const output = options.output ?? '.aafe';
  const replayed = await replayRun(root, output, options.replay);
  if (!replayed) {
    console.error(`No stored run "${options.replay}" under ${output}/runs. Try: aafe run --list`);
    process.exitCode = 1;
    return null;
  }

  const payload = {
    status: 'pass',
    command: 'aafe run --replay',
    runId: replayed.run.runId,
    runStatus: replayed.run.status,
    reason: replayed.run.reason,
    task: replayed.run.task,
    decisions: (replayed.run.decisions ?? []).map(compactDecision),
    steps: replayed.nodes.map((node) => ({
      ...compactNode(node),
      input: node.input,
      output: node.output
    })),
    summary: replayed.run.summary,
    metrics: replayed.run.metrics ?? null,
    contextPackage: replayed.contextPackage
  };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * `test` and `diagnose` resolve through the registry so callers get the
 * documented `skipped` contract rather than an unknown-command error.
 */
/**
 * `aafe test` — the verification half of the loop (RFC §27). Plans and
 * generates tests for whatever changed; only runs them when explicitly asked,
 * because spawning the project's suite is a side effect the caller must own.
 */
export async function runTestCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  if (options.inlineToken !== undefined) {
    console.error('拒绝从命令行读取令牌：不要使用 --token <值>。请写到 `.aafe.config.json` 的 e2e.githubAccessToken / e2e.gongfengAccessToken，或环境变量 GITHUB_TOKEN / GIT_PRIVATE_TOKEN。');
    process.exitCode = 3;
    return null;
  }
  if (options.prPending || options.prUrl === '') {
    console.error('缺少 PR 链接。请提供 GitHub pull 或工蜂 merge_requests 完整 URL。');
    process.exitCode = 3;
    return null;
  }

  const e2e = await loadE2eConfig(root, null, {
    baseUrl: options.baseUrl,
    urlRole: options.urlRole,
    authMode: options.authMode,
    authEnv: options.authEnv,
    storageState: options.storageState
  });
  if (!e2e.enabled && (options.run || options.coverage || options.prUrl)) {
    console.error('E2E 未启用。运行 `aafe e2e enable`，或在 `aafe init` / `aafe update --interactive` 时选择启用。');
    process.exitCode = 3;
    return null;
  }

  const scenario = options.coverage ? 'coverage' : (options.prUrl ? 'pr' : 'changes');
  const task = createTask({
    kind: 'test',
    goal: options.goal
      || options.requirement
      || options.positional
      || (scenario === 'coverage' ? 'full functional coverage from analyze' : 'verify the current change'),
    requirement: options.requirement || options.positional || (scenario === 'coverage' ? 'full coverage from analyze' : null),
    diffRef: options.diff !== undefined ? (options.diff || null) : (scenario === 'changes' ? null : undefined),
    scenario,
    prUrl: options.prUrl || null,
    baseUrl: e2e.baseUrl,
    urlRole: e2e.urlRole,
    authMode: e2e.authMode,
    authEnv: e2e.authEnv,
    storageState: options.storageState ?? null,
    e2eWrite: options.writeCases,
    e2eUpdate: options.update === true,
    e2eForce: options.force === true,
    dryRun: options.dryRun === true
  });

  const { result, warnings } = await executeTask(root, task, options, {
    allowTestExecution: options.run === true
  });

  const plan = result.results?.['test-planning']?.result ?? null;
  const generation = result.results?.['test-generation']?.result ?? null;
  const execution = result.results?.['e2e-execution'] ?? null;

  const payload = {
    status: result.status === 'complete' ? 'pass' : result.status,
    command: 'aafe test',
    scenario,
    runId: result.runId,
    plan: plan
      ? { id: plan.id, risk: plan.risk, scenarios: plan.scenarios?.length ?? 0, layers: plan.layers ?? null, e2eApplicable: plan.e2eApplicable ?? null }
      : null,
    scenarios: plan?.scenarios ?? [],
    generated: generation?.files?.map((file) => file.path) ?? [],
    written: generation?.written ?? [],
    execution: execution
      ? { status: execution.status, reason: execution.reason ?? null, ...(execution.result ?? {}) }
      : null,
    reportDir: execution?.result?.reportDir ?? null,
    htmlPath: execution?.result?.htmlPath ?? null,
    verdict: execution?.result?.verdict ?? (plan?.blocked ? 'blocked' : null),
    needInput: execution?.needInput ?? execution?.result?.needInput ?? null,
    askUser: execution?.askUser ?? execution?.result?.askUser ?? false,
    prompt: execution?.prompt ?? execution?.result?.prompt ?? null,
    persistBaseUrl: false,
    urlRole: e2e.urlRole ?? null,
    nodes: result.nodes.map(compactNode),
    runRef: result.runRef,
    warnings
  };

  if (execution?.result?.status === 'failed') {
    payload.nextCommand = execution.result.jsonPath
      ? `aafe diagnose --failure=${execution.result.jsonPath}`
      : 'aafe diagnose --failure=<report>  (or rerun: the report is saved under .aafe/e2e/reports)';
  }
  const executionSkipped = execution?.status === 'skipped';
  const skipAskingUrl = executionSkipped && [
    'e2e-not-applicable',
    'e2e-not-enabled',
    'pr-fetch-blocked'
  ].includes(execution?.reason);
  if (
    options.run
    && !e2e.baseUrlConfigured
    && !skipAskingUrl
    && (payload.needInput === 'baseUrl' || !executionSkipped)
  ) {
    payload.needInput = 'baseUrl';
    payload.askUser = true;
    payload.prompt = NEED_BASE_URL_PROMPT;
    payload.nextCommand = rebuildTestCommand(options);
    payload.persistBaseUrl = false;
    console.error(NEED_BASE_URL_PROMPT);
  }
  if (options.run && payload.needInput === 'urlRole') {
    payload.askUser = true;
    payload.prompt = NEED_URL_ROLE_PROMPT;
    payload.nextCommand = rebuildTestCommand(options, { urlRolePlaceholder: true });
    payload.persistBaseUrl = false;
    console.error(NEED_URL_ROLE_PROMPT);
  }
  if (options.run && payload.needInput === 'auth') {
    payload.askUser = true;
    payload.prompt = payload.prompt || NEED_AUTH_PROMPT;
    payload.nextCommand = rebuildTestCommand(options, { authPlaceholder: true });
    payload.persistBaseUrl = false;
    console.error(payload.prompt);
  }
  console.log(JSON.stringify(payload, null, 2));
  if (plan?.blocked) {
    process.exitCode = 3;
    return payload;
  }
  if (execution?.result?.verdict && execution.result.verdict !== 'passed') {
    process.exitCode = execution.result.verdict === 'blocked' ? 3 : execution.result.verdict === 'uncertain' ? 4 : 2;
  }
  return payload;
}

/**
 * `aafe diagnose` — turns a failing run into a located root cause (RFC §16).
 */
export async function runDiagnoseCommand(root, args = []) {
  const options = parsePlatformArgs(args);
  if (!options.failure) return usageError('diagnose');

  const task = createTask({
    kind: 'failure',
    goal: options.goal || `diagnose failure ${options.failure}`,
    failureRef: options.failure,
    diffRef: options.diff || null
  });

  const { result, warnings } = await executeTask(root, task, options);
  const diagnosis = result.results?.['failure-analysis'] ?? null;

  const payload = {
    status: diagnosis?.status === 'success' || diagnosis?.status === 'partial' ? 'pass' : (diagnosis?.status ?? result.status),
    command: 'aafe diagnose',
    runId: result.runId,
    reason: diagnosis?.reason ?? null,
    diagnosis: diagnosis?.result ?? null,
    nodes: result.nodes.map(compactNode),
    runRef: result.runRef,
    nextCommand: `aafe context --failure=${options.failure}`,
    warnings
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!diagnosis || diagnosis.status === 'skipped') process.exitCode = 1;
  return payload;
}

/**
 * Runs the planner without invoking any agent by feeding it a state where
 * every decision is recorded as skipped.
 */
async function tracePlan(platform, task) {
  const { ExecutionState } = await import('../agent-platform/state/ExecutionState.js');
  const { ExecutionGraph } = await import('../agent-platform/orchestrator/ExecutionGraph.js');
  const state = new ExecutionState({ task, runId: 'dry-run', root: platform.orchestrator.root });
  const graph = new ExecutionGraph();
  const trace = [];

  for (let step = 0; step < (platform.planner.maxSteps ?? 12); step += 1) {
    const decision = await platform.planner.decide({
      task,
      state,
      graph,
      registry: platform.registry,
      knowledge: platform.knowledge,
      availableAgents: platform.registry.capabilityList(),
      capabilities: platform.registry.capabilityMap(),
      constraints: platform.orchestrator.policy.base
    });
    trace.push(compactDecision(decision));
    if (['complete', 'fail', 'need_user_input'].includes(decision.action)) break;

    const capabilities = decision.action === 'parallel'
      ? decision.tasks.map((item) => item.capability)
      : [decision.capability];
    for (const capability of capabilities) {
      const { agent } = platform.registry.resolveCapability(capability);
      const node = graph.addNode({ agent: agent?.id ?? '(unresolved)', capability, inputRef: 'dry-run' });
      graph.transition(node.id, 'skipped', { reason: 'dry-run' });
      state.record(node, { status: 'skipped', reason: 'dry-run', nextActions: [] });
    }
  }
  return trace;
}

async function executeTask(root, task, options, constraints = {}) {
  const effectiveRoot = options.projectRoot ? path.resolve(options.projectRoot) : root;
  const platform = await createAgentPlatform(effectiveRoot, {
    write: options.write !== false,
    constraints,
    ideAgent: options.ideAgent,
    host: options.host,
    workspaceRoot: options.workspaceRoot
  });
  const result = await platform.orchestrator.execute(task);
  return { result, warnings: platform.warnings, platform };
}

/**
 * Prefer the validated impact so the CLI never prints claims the validator
 * already rejected.
 */
function pickImpact(result) {
  const validated = result.results?.['knowledge-validation']?.result;
  if (validated?.trustedImpact) return validated.trustedImpact;
  return result.results?.['requirement-impact']?.result
    ?? result.results?.['change-impact']?.result
    ?? null;
}

function taskFromOptions(options) {
  if (options.diff !== undefined) {
    return createTask({
      kind: 'diff',
      goal: options.goal || `analyze impact of ${options.diff || 'working tree'} changes`,
      diffRef: options.diff || null
    });
  }
  if (options.failure) {
    return createTask({
      kind: 'failure',
      goal: options.goal || `diagnose failure ${options.failure}`,
      failureRef: options.failure
    });
  }
  const requirement = options.requirement || options.task || options.positional;
  if (!requirement) return null;
  return createTask({ kind: 'requirement', goal: requirement, requirement });
}

export function parsePlatformArgs(args = []) {
  const options = { positional: '' };
  const positional = [];

  for (const arg of args) {
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--no-write') { options.write = false; continue; }
    if (arg === '--no-ide-agent') { options.ideAgent = false; continue; }
    if (arg === '--cursor') { options.agent = 'cursor'; continue; }
    if (arg.startsWith('--agent=')) { options.agent = arg.slice('--agent='.length).toLowerCase(); continue; }
    if (arg.startsWith('--model=')) { options.model = arg.slice('--model='.length); continue; }
    if (arg.startsWith('--cursor-model=')) { options.model = arg.slice('--cursor-model='.length); continue; }
    if (arg.startsWith('--agent-runtime=')) { options.agentRuntime = arg.slice('--agent-runtime='.length).toLowerCase(); continue; }
    if (arg.startsWith('--agentRuntime=')) { options.agentRuntime = arg.slice('--agentRuntime='.length).toLowerCase(); continue; }
    if (arg.startsWith('--cursor-api-key-env=')) { options.cursorApiKeyEnv = arg.slice('--cursor-api-key-env='.length); continue; }
    if (arg.startsWith('--cursor-repository=')) { options.cursorRepository = arg.slice('--cursor-repository='.length); continue; }
    if (arg.startsWith('--mcp-config=')) { options.mcpConfig = arg.slice('--mcp-config='.length); continue; }
    if (arg.startsWith('--mcp-setting-sources=')) { options.mcpSettingSources = arg.slice('--mcp-setting-sources='.length); continue; }
    if (arg === '--no-mcp') { options.mcp = false; continue; }
    if (arg.startsWith('--host=')) { options.host = arg.slice('--host='.length).toLowerCase(); continue; }
    if (arg.startsWith('--project-root=')) { options.projectRoot = arg.slice('--project-root='.length); continue; }
    if (arg.startsWith('--workspace-root=')) { options.workspaceRoot = arg.slice('--workspace-root='.length); continue; }
    if (arg === '--run') { options.run = true; continue; }
    if (arg.startsWith('--base-url=')) { options.baseUrl = arg.slice('--base-url='.length); continue; }
    if (arg.startsWith('--baseUrl=')) { options.baseUrl = arg.slice('--baseUrl='.length); continue; }
    if (arg === '--base-url' || arg === '--baseUrl') { options.baseUrlPending = true; continue; }
    if (options.baseUrlPending && !arg.startsWith('--')) { options.baseUrl = arg; options.baseUrlPending = false; continue; }
    if (arg.startsWith('--url-role=')) { options.urlRole = arg.slice('--url-role='.length); continue; }
    if (arg.startsWith('--urlRole=')) { options.urlRole = arg.slice('--urlRole='.length); continue; }
    if (arg === '--url-role' || arg === '--urlRole') { options.urlRolePending = true; continue; }
    if (options.urlRolePending && !arg.startsWith('--')) { options.urlRole = arg; options.urlRolePending = false; continue; }
    if (arg.startsWith('--auth-mode=')) { options.authMode = arg.slice('--auth-mode='.length); continue; }
    if (arg.startsWith('--authMode=')) { options.authMode = arg.slice('--authMode='.length); continue; }
    if (arg === '--auth-mode' || arg === '--authMode') { options.authModePending = true; continue; }
    if (options.authModePending && !arg.startsWith('--')) { options.authMode = arg; options.authModePending = false; continue; }
    if (arg.startsWith('--auth-env=')) { options.authEnv = arg.slice('--auth-env='.length); continue; }
    if (arg.startsWith('--authEnv=')) { options.authEnv = arg.slice('--authEnv='.length); continue; }
    if (arg.startsWith('--storage-state=')) { options.storageState = arg.slice('--storage-state='.length); continue; }
    if (arg.startsWith('--storageState=')) { options.storageState = arg.slice('--storageState='.length); continue; }
    if (arg === '--coverage') { options.coverage = true; continue; }
    if (arg === '--update') { options.update = true; continue; }
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--write') { options.writeCases = true; continue; }
    if (arg === '--no-write-cases') { options.writeCases = false; continue; }
    if (arg === '--token-stdin') { options.tokenStdin = true; continue; }
    if (arg === '--token' || arg.startsWith('--token=')) { options.inlineToken = arg === '--token' ? '' : arg.slice('--token='.length); continue; }
    if (arg.startsWith('--pr=')) { options.prUrl = arg.slice('--pr='.length); continue; }
    if (arg === '--pr') { options.prPending = true; continue; }
    if (options.prPending && !arg.startsWith('--')) { options.prUrl = arg; options.prPending = false; continue; }
    if (arg === '--json') { options.format = 'json'; continue; }
    if (arg === '--list') { options.list = true; continue; }
    if (arg.startsWith('--replay=')) { options.replay = arg.slice('--replay='.length); continue; }
    if (arg.startsWith('--output=')) { options.output = arg.slice('--output='.length); continue; }
    if (arg.startsWith('--limit=')) { options.limit = Number.parseInt(arg.slice('--limit='.length), 10) || undefined; continue; }
    if (arg === '--diff') { options.diff = ''; continue; }
    if (arg.startsWith('--diff=')) { options.diff = arg.slice('--diff='.length); continue; }
    if (arg.startsWith('--requirement=')) { options.requirement = arg.slice('--requirement='.length); continue; }
    if (arg.startsWith('--task=')) { options.task = arg.slice('--task='.length); continue; }
    if (arg.startsWith('--failure=')) { options.failure = arg.slice('--failure='.length); continue; }
    if (arg.startsWith('--format=')) { options.format = arg.slice('--format='.length); continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice('--out='.length); continue; }
    if (arg.startsWith('--goal=')) { options.goal = arg.slice('--goal='.length); continue; }
    if (arg.startsWith('--')) continue;
    positional.push(arg);
  }
  options.positional = positional.join(' ').trim();
  return options;
}

function rebuildTestCommand(options, { urlRolePlaceholder = false, authPlaceholder = false } = {}) {
  const parts = ['aafe test'];
  if (options.prUrl) parts.push(`--pr=${options.prUrl}`);
  else if (options.coverage) parts.push('--coverage');
  else if (options.diff !== undefined) parts.push(options.diff ? `--diff=${options.diff}` : '--diff');
  else if (options.requirement) parts.push(`--requirement=${JSON.stringify(options.requirement)}`);
  if (options.run) parts.push('--run');
  if (options.baseUrl) parts.push(`--base-url=${quoteCliUrl(options.baseUrl)}`);
  else parts.push('--base-url=<本次测试地址>');
  if (options.urlRole) parts.push(`--url-role=${options.urlRole}`);
  else if (urlRolePlaceholder) parts.push('--url-role=<A|B|C>');
  if (options.authMode) parts.push(`--auth-mode=${options.authMode}`);
  else if (authPlaceholder) parts.push('--auth-mode=reuse-or-headed');
  if (options.authEnv) parts.push(`--auth-env=${options.authEnv}`);
  if (options.storageState) parts.push(`--storage-state=${options.storageState}`);
  return parts.join(' ');
}

function quoteCliUrl(value) {
  const text = String(value ?? '');
  if (!/[#?&\s]/.test(text)) return text;
  return JSON.stringify(text);
}

function compactDecision(decision) {
  return {
    action: decision.action,
    ...(decision.capability ? { capability: decision.capability } : {}),
    ...(decision.tasks ? { capabilities: decision.tasks.map((item) => item.capability) } : {}),
    reason: decision.reason
  };
}

function compactNode(node) {
  return {
    id: node.id,
    agent: node.agent,
    capability: node.capability,
    status: node.status,
    ...(node.reason ? { reason: node.reason } : {}),
    outputRef: node.outputRef ?? null
  };
}

function usageError(command) {
  const hint = command === 'diagnose'
    ? 'aafe diagnose --failure=<report.json|log.txt> [--diff[=<ref>]]'
    : command === 'impact'
      ? 'aafe impact --requirement="..."  |  aafe impact --diff[=<ref>]'
      : `aafe ${command} --requirement="..."  |  aafe ${command} --diff[=<ref>]`;
  console.error(`Missing task. Usage:\n  ${hint}`);
  process.exitCode = 1;
  return null;
}
