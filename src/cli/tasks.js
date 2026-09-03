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
import { TaskManager, createTaskId } from '../agent-platform/tasks/index.js';
import { resolveAgentModeConfig } from './agentMode.js';
import { resolveCursorMcpForRun, toCursorMcpServers } from './agentMcp.js';

export async function runTaskCommand(root, args = []) {
  const subcommand = String(args[0] ?? 'list').toLowerCase();
  const options = parseTaskArgs(args.slice(1), subcommand);
  const config = await readProjectConfig(root);
  const agent = resolveAgentModeConfig(config);
  const managerConfig = agent.manager;
  const mcp = await resolveCursorMcpForRun(agent.mcp, {
    root,
    env: process.env,
    enabled: options.mcp === false ? false : undefined
  });
  const manager = new TaskManager({
    root,
    output: managerConfig.output,
    maxConcurrentTasks: managerConfig.maxConcurrentTasks,
    validateProjectRuntime: options.validateProjectRuntime ?? managerConfig.validateProjectRuntime,
    recoverOnStart: managerConfig.recoverOnStart,
    runtimeOptions: {
      apiKey: agent.apiKey,
      apiKeyEnv: agent.apiKeyEnv,
      model: options.model ?? agent.model,
      repository: options.repository ?? agent.repository,
      autoCreatePR: agent.autoCreatePR,
      skipReviewerRequest: agent.skipReviewerRequest,
      mcpServers: toCursorMcpServers(mcp.servers)
    }
  });

  try {
    if (subcommand === 'create') return createAndMaybeRun(manager, options, agent);
    if (subcommand === 'list') return print({
      status: 'pass',
      command: 'aafe task list',
      tasks: await manager.list({ limit: options.limit })
    });
    if (subcommand === 'status') {
      const task = await requireTask(manager, options.taskId);
      return print({
        status: 'pass',
        command: 'aafe task status',
        task,
        scheduler: manager.stats()
      });
    }
    if (subcommand === 'continue') {
      const taskId = requireValue(options.taskId, 'task id');
      const message = requireValue(options.message, 'follow-up message');
      const task = await manager.continue(taskId, message);
      return print({ status: task.status === 'completed' ? 'pass' : task.status, command: 'aafe task continue', task });
    }
    if (subcommand === 'cancel') {
      const task = await manager.cancel(requireValue(options.taskId, 'task id'));
      return print({ status: 'pass', command: 'aafe task cancel', task });
    }
    if (subcommand === 'recover') {
      const scheduled = await manager.recover({ limit: options.limit });
      const tasks = await Promise.all(scheduled.map((entry) => entry.promise));
      return print({ status: 'pass', command: 'aafe task recover', recovered: tasks });
    }
    throw new Error('Usage: aafe task create|list|status|continue|cancel|recover');
  } finally {
    await manager.close();
  }
}

async function createAndMaybeRun(manager, options, agent) {
  const requirement = requireValue(options.requirement ?? options.message, 'requirement');
  const repository = requireValue(options.repository ?? agent.repository, 'repository');
  const id = options.taskId ?? createTaskId();
  const task = await manager.create({
    id,
    kind: 'requirement',
    goal: requirement,
    requirement,
    repository,
    baseBranch: options.baseBranch ?? 'main',
    taskBranch: options.taskBranch ?? `aafe/task/${id}`,
    source: options.source ? { type: options.source } : null,
    context: { userRequest: requirement }
  });
  if (options.run === false) {
    return print({ status: 'pass', command: 'aafe task create', task });
  }
  const completed = await manager.start(task.id);
  return print({
    status: completed.status === 'completed' ? 'pass' : completed.status,
    command: 'aafe task create',
    task: completed
  });
}

function parseTaskArgs(args, subcommand) {
  const options = { positional: [], run: true };
  for (const arg of args) {
    if (arg.startsWith('--id=')) { options.taskId = arg.slice(5); continue; }
    if (arg.startsWith('--requirement=')) { options.requirement = arg.slice(14); continue; }
    if (arg.startsWith('--repository=')) { options.repository = arg.slice(13); continue; }
    if (arg.startsWith('--base-branch=')) { options.baseBranch = arg.slice(14); continue; }
    if (arg.startsWith('--task-branch=')) { options.taskBranch = arg.slice(14); continue; }
    if (arg.startsWith('--model=')) { options.model = arg.slice(8); continue; }
    if (arg.startsWith('--source=')) { options.source = arg.slice(9); continue; }
    if (arg.startsWith('--limit=')) { options.limit = Number.parseInt(arg.slice(8), 10) || undefined; continue; }
    if (arg === '--no-run') { options.run = false; continue; }
    if (arg === '--no-mcp') { options.mcp = false; continue; }
    if (arg === '--no-readiness-check') { options.validateProjectRuntime = false; continue; }
    if (!arg.startsWith('--')) options.positional.push(arg);
  }
  if (subcommand !== 'create' && !options.taskId && options.positional.length) {
    options.taskId = options.positional.shift();
  }
  options.message = options.positional.join(' ').trim();
  return options;
}

async function requireTask(manager, taskId) {
  const id = requireValue(taskId, 'task id');
  const task = await manager.get(id);
  if (!task) throw new Error(`task-not-found:${id}`);
  return task;
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
