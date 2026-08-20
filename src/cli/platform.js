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
import { createTask } from '../agent-platform/protocol/request.js';
import { CONTEXT_FORMATS, renderContextPackage } from '../ide-bridge/context/render.js';
import { renderImpactMarkdown } from '../knowledge/report/impactMarkdown.js';
import { listRuns, replayRun } from '../agent-platform/state/RunStore.js';

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

  const { result, warnings } = await executeTask(root, task, options);
  console.log(JSON.stringify({
    status: result.status === 'complete' ? 'pass' : 'fail',
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
    warnings
  }, null, 2));
  if (result.status !== 'complete') process.exitCode = 1;
  return result;
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
  const task = createTask({
    kind: 'test',
    goal: options.goal || options.requirement || options.positional || 'verify the current change',
    requirement: options.requirement || options.positional || null,
    diffRef: options.diff || null
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
    runId: result.runId,
    plan: plan
      ? { id: plan.id, risk: plan.risk, scenarios: plan.scenarios?.length ?? 0, preconditions: plan.preconditions }
      : null,
    scenarios: plan?.scenarios ?? [],
    generated: generation?.files?.map((file) => file.path) ?? [],
    written: generation?.written ?? [],
    execution: execution
      ? { status: execution.status, reason: execution.reason ?? null, ...(execution.result ?? {}) }
      : null,
    nodes: result.nodes.map(compactNode),
    runRef: result.runRef,
    warnings
  };

  // A failing run is the entry point to the other half of the loop.
  if (execution?.result?.status === 'failed') {
    payload.nextCommand = 'aafe diagnose --failure=<report>  (or rerun: the report is saved under the run dir)';
  }
  console.log(JSON.stringify(payload, null, 2));
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
  const platform = await createAgentPlatform(root, {
    write: options.write !== false,
    constraints,
    ideAgent: options.ideAgent
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
    if (arg === '--run') { options.run = true; continue; }
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
