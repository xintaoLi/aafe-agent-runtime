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
import { SDDEngine } from '../agent-platform/sdd/SDDEngine.js';
import { createTaskId, TaskStore } from '../agent-platform/tasks/TaskStore.js';
import { resolveSDDConfig } from './sddConfig.js';

export async function runSDDCommand(root, args = []) {
  const subcommand = String(args[0] ?? 'status').toLowerCase();
  const options = parseSDDArgs(args.slice(1));
  const projectConfig = await readProjectConfig(root);
  const config = resolveSDDConfig(projectConfig, {
    root: options.openspecRoot,
    schema: options.schema,
    approvalRequired: options.approvalRequired
  });
  const output = projectConfig.agent?.manager?.output ?? '.aafe';
  const taskStore = new TaskStore({ root, output });
  const engine = new SDDEngine({
    root,
    output,
    openspecRoot: config.root,
    schema: config.schema,
    approvalRequired: config.approvalRequired,
    taskStore
  });

  if (subcommand === 'create') {
    const taskId = await ensureTask(taskStore, options);
    return print({
      status: 'pass',
      command: 'aafe sdd create',
      change: await engine.createChange({
        taskId,
        changeId: options.changeId,
        slug: options.slug,
        title: options.title
      })
    });
  }

  const taskId = requireValue(options.taskId, 'task id');
  if (subcommand === 'status') {
    return print({ status: 'pass', command: 'aafe sdd status', change: await requireChange(engine, taskId) });
  }
  if (['propose', 'design', 'tasks'].includes(subcommand)) {
    const artifact = subcommand === 'propose' ? 'proposal' : subcommand;
    const content = await readInput(root, options);
    return print({
      status: 'pass',
      command: `aafe sdd ${subcommand}`,
      ...(await engine.writeArtifact(taskId, artifact, content, { reason: options.reason }))
    });
  }
  if (subcommand === 'spec') {
    const content = await readInput(root, options);
    return print({
      status: 'pass',
      command: 'aafe sdd spec',
      ...(await engine.writeArtifact(taskId, 'spec', content, {
        capability: requireValue(options.capability, 'capability'),
        reason: options.reason
      }))
    });
  }
  if (subcommand === 'validate') {
    const result = await engine.validate(taskId);
    return print({
      status: result.valid ? 'pass' : 'fail',
      command: 'aafe sdd validate',
      ...result
    });
  }
  if (subcommand === 'approve') {
    return print({
      status: 'pass',
      command: 'aafe sdd approve',
      change: await engine.approve(taskId, { approvedBy: options.approvedBy ?? 'user' })
    });
  }
  if (subcommand === 'apply-context') {
    return print({
      status: 'pass',
      command: 'aafe sdd apply-context',
      context: await engine.getApplyContext(taskId, { markImplementing: options.markImplementing })
    });
  }
  if (subcommand === 'trace') {
    if (!options.file && !options.content) {
      return print({ status: 'pass', command: 'aafe sdd trace', traceability: await engine.traceability(taskId) });
    }
    const value = JSON.parse(await readInput(root, options));
    return print({
      status: 'pass',
      command: 'aafe sdd trace',
      ...(await engine.setTraceability(taskId, value, { reason: options.reason }))
    });
  }
  if (subcommand === 'revisions') {
    return print({ status: 'pass', command: 'aafe sdd revisions', revisions: await engine.revisions(taskId) });
  }
  if (subcommand === 'verify') {
    const value = JSON.parse(await readInput(root, options));
    const current = await requireChange(engine, taskId);
    if (current.status === 'ready') await engine.getApplyContext(taskId, { markImplementing: true });
    return print({
      status: 'pass',
      command: 'aafe sdd verify',
      change: await engine.recordVerification(taskId, value)
    });
  }
  if (subcommand === 'sync') {
    const result = await engine.sync(taskId, { dryRun: !options.yes || options.dryRun });
    return print({ status: 'pass', command: 'aafe sdd sync', ...result });
  }
  if (subcommand === 'archive') {
    const result = await engine.archive(taskId, {
      dryRun: !options.yes || options.dryRun,
      allowUnverified: options.allowUnverified
    });
    return print({ status: 'pass', command: 'aafe sdd archive', ...result });
  }
  throw new Error('Usage: aafe sdd create|status|propose|spec|design|tasks|validate|approve|apply-context|trace|revisions|verify|sync|archive');
}

export function parseSDDArgs(args = []) {
  const options = { positional: [] };
  for (const arg of args) {
    if (arg.startsWith('--task-id=')) { options.taskId = arg.slice(10); continue; }
    if (arg.startsWith('--change=')) { options.changeId = arg.slice(9); continue; }
    if (arg.startsWith('--slug=')) { options.slug = arg.slice(7); continue; }
    if (arg.startsWith('--title=')) { options.title = arg.slice(8); continue; }
    if (arg.startsWith('--requirement=')) { options.requirement = arg.slice(14); continue; }
    if (arg.startsWith('--repository=')) { options.repository = arg.slice(13); continue; }
    if (arg.startsWith('--base-branch=')) { options.baseBranch = arg.slice(14); continue; }
    if (arg.startsWith('--task-branch=')) { options.taskBranch = arg.slice(14); continue; }
    if (arg.startsWith('--file=')) { options.file = arg.slice(7); continue; }
    if (arg.startsWith('--content=')) { options.content = arg.slice(10); continue; }
    if (arg.startsWith('--capability=')) { options.capability = arg.slice(13); continue; }
    if (arg.startsWith('--reason=')) { options.reason = arg.slice(9); continue; }
    if (arg.startsWith('--approved-by=')) { options.approvedBy = arg.slice(14); continue; }
    if (arg.startsWith('--openspec-root=')) { options.openspecRoot = arg.slice(16); continue; }
    if (arg.startsWith('--schema=')) { options.schema = arg.slice(9); continue; }
    if (arg === '--no-approval') { options.approvalRequired = false; continue; }
    if (arg === '--mark-implementing') { options.markImplementing = true; continue; }
    if (arg === '--allow-unverified') { options.allowUnverified = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--yes' || arg === '-y') { options.yes = true; continue; }
    if (!arg.startsWith('--')) options.positional.push(arg);
  }
  if (!options.taskId && options.positional.length) options.taskId = options.positional.shift();
  if (!options.content && options.positional.length) options.content = options.positional.join(' ');
  return options;
}

async function ensureTask(store, options) {
  if (options.taskId) {
    const task = await store.get(options.taskId);
    if (!task) throw new Error(`task-not-found:${options.taskId}`);
    return task.id;
  }
  const requirement = requireValue(options.requirement ?? options.title, 'requirement');
  const taskId = createTaskId();
  await store.create({
    id: taskId,
    kind: 'requirement',
    goal: requirement,
    requirement,
    repository: options.repository ?? null,
    baseBranch: options.baseBranch ?? 'main',
    taskBranch: options.taskBranch ?? `aafe/task/${taskId}`
  }, {
    userRequest: requirement,
    conversation: { messages: [] },
    project: {},
    plan: null,
    constraints: [],
    metadata: {}
  });
  return taskId;
}

async function requireChange(engine, taskId) {
  const change = await engine.get(taskId);
  if (!change) throw new Error(`sdd-change-not-found:${taskId}`);
  return change;
}

async function readInput(root, options) {
  if (options.file) {
    const file = path.isAbsolute(options.file) ? options.file : path.join(root, options.file);
    return readFile(file, 'utf8');
  }
  return requireValue(options.content, 'artifact content or --file');
}

function requireValue(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
}

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function readProjectConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  } catch {
    return {};
  }
}
