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

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CursorTaskRuntime } from '../src/agent-platform/runtime/CursorTaskRuntime.js';
import {
  assertCloudProjectReadiness,
  inspectCloudProjectReadiness
} from '../src/agent-platform/runtime/CloudProjectReadiness.js';
import { TaskManager } from '../src/agent-platform/tasks/TaskManager.js';
import { TaskScheduler } from '../src/agent-platform/tasks/TaskScheduler.js';
import { TaskStore } from '../src/agent-platform/tasks/TaskStore.js';

const execFileAsync = promisify(execFile);
const fixture = await mkdtemp(path.join(os.tmpdir(), 'aafe-task-manager-'));

try {
  // --- durable state and strict context isolation ---------------------------
  const store = new TaskStore({ root: fixture });
  await store.create({ id: 'task-a', goal: 'A' }, { secret: 'context-a' });
  await store.create({ id: 'task-b', goal: 'B' }, { secret: 'context-b' });
  assert.deepEqual(await store.getContext('task-a'), { secret: 'context-a' });
  assert.deepEqual(await store.getContext('task-b'), { secret: 'context-b' });
  const leaked = await store.getContext('task-a');
  leaked.secret = 'mutated';
  assert.deepEqual(await store.getContext('task-a'), { secret: 'context-a' });
  await store.transition('task-a', 'queued');
  await store.transition('task-a', 'running');
  await store.transition('task-a', 'completed');
  await assert.rejects(() => store.transition('task-a', 'running'), /illegal-task-transition/);
  assert.ok((await store.events('task-a')).some((event) => event.type === 'task.status.changed'));

  // --- bounded cross-task scheduling ---------------------------------------
  const scheduler = new TaskScheduler({ maxConcurrentTasks: 2 });
  let active = 0;
  let peak = 0;
  const worker = () => schedulerWork();
  async function schedulerWork() {
    active += 1;
    peak = Math.max(peak, active);
    await delay(15);
    active -= 1;
    return true;
  }
  await Promise.all([
    scheduler.schedule('s1', worker),
    scheduler.schedule('s2', worker),
    scheduler.schedule('s3', worker),
    scheduler.schedule('s4', worker)
  ]);
  assert.equal(peak, 2);
  assert.deepEqual(scheduler.stats().runningTaskIds, []);

  const serialScheduler = new TaskScheduler({ maxConcurrentTasks: 1 });
  let releaseFirst;
  const firstQueued = serialScheduler.schedule('hold', () => new Promise((resolve) => {
    releaseFirst = resolve;
  }));
  const cancelledQueued = serialScheduler.schedule('drop', async () => 'must-not-run');
  assert.equal(serialScheduler.cancelQueued('drop'), true);
  assert.deepEqual(await cancelledQueued, { cancelled: true, reason: 'cancelled-while-queued' });
  releaseFirst('released');
  assert.equal(await firstQueued, 'released');

  // --- one Cloud Agent per task, many Runs per Agent -----------------------
  const sdkState = { creates: 0, resumes: 0, runs: 0, getRuns: 0, cancels: 0 };
  const sdk = fakeCursorSdk(sdkState);
  const cursor = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => sdk
  });
  const cursorTaskA = {
    id: 'cursor-a',
    repository: { url: 'https://example.test/org/repo.git' },
    baseBranch: 'main',
    cursor: { agentId: null }
  };
  const first = await cursor.run(cursorTaskA, 'first');
  const second = await cursor.continue(cursorTaskA, 'second');
  const third = await cursor.run({ ...cursorTaskA, id: 'cursor-b' }, 'other');
  assert.equal(sdkState.creates, 2);
  assert.equal(first.agentId, second.agentId);
  assert.notEqual(first.agentId, third.agentId);
  assert.equal(sdkState.runs, 3);
  await cursor.closeAll();

  const resumedRuntime = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => sdk
  });
  await resumedRuntime.run({
    ...cursorTaskA,
    cursor: { agentId: first.agentId }
  }, 'after restart');
  assert.equal(sdkState.resumes, 1);

  const recovered = await resumedRuntime.recover({
    ...cursorTaskA,
    cursor: { agentId: first.agentId, activeRunId: 'recover-run' }
  });
  assert.equal(recovered.status, 'finished');
  assert.equal(sdkState.getRuns, 1);
  await resumedRuntime.cancel({
    ...cursorTaskA,
    cursor: { agentId: first.agentId, activeRunId: 'detached-run' }
  });
  assert.equal(sdkState.cancels, 1);
  await resumedRuntime.closeAll();

  // --- manager binds execution to isolated durable tasks -------------------
  const managerRoot = path.join(fixture, 'manager');
  let managerActive = 0;
  let managerPeak = 0;
  const fakeRuntime = {
    async run(task, _prompt, options) {
      managerActive += 1;
      managerPeak = Math.max(managerPeak, managerActive);
      await options.onBinding({ agentId: `agent-${task.id}`, runId: `run-${task.id}` });
      await delay(20);
      managerActive -= 1;
      return {
        agentId: `agent-${task.id}`,
        runId: `run-${task.id}`,
        status: 'finished',
        text: 'done',
        git: { branches: [{ branch: `aafe/task/${task.id}` }] }
      };
    },
    async recover(task) {
      return { agentId: task.cursor.agentId, runId: task.cursor.activeRunId, status: 'finished', text: 'recovered' };
    },
    async cancel() { return { cancelled: true }; },
    async close() {},
    async closeAll() {}
  };
  const manager = new TaskManager({
    root: managerRoot,
    runtime: fakeRuntime,
    maxConcurrentTasks: 1,
    validateProjectRuntime: false
  });
  await manager.create({ id: 'managed-a', requirement: 'A', repository: 'repo-a', context: { metadata: { own: 'a' } } });
  await manager.create({ id: 'managed-b', requirement: 'B', repository: 'repo-b', context: { metadata: { own: 'b' } } });
  const [managedA, managedB] = await Promise.all([manager.start('managed-a'), manager.start('managed-b')]);
  assert.equal(managerPeak, 1);
  assert.equal(managedA.status, 'completed');
  assert.equal(managedB.status, 'completed');
  assert.equal(managedA.cursor.agentId, 'agent-managed-a');
  assert.equal(managedB.cursor.agentId, 'agent-managed-b');
  assert.equal((await manager.getContext('managed-a')).metadata.own, 'a');
  assert.equal((await manager.getContext('managed-b')).metadata.own, 'b');
  assert.ok((await manager.events('managed-a')).some((event) => event.type === 'task.cursor.bound'));
  await manager.close();

  // --- restart recovery reattaches a running Cursor run --------------------
  const recoveryStore = new TaskStore({ root: managerRoot });
  await recoveryStore.create({
    id: 'recover-task',
    requirement: 'recover',
    repository: 'repo',
    status: 'running',
    cursor: { agentId: 'agent-recover', activeRunId: 'run-recover' }
  }, {});
  const recoveryManager = new TaskManager({
    root: managerRoot,
    store: recoveryStore,
    runtime: fakeRuntime,
    validateProjectRuntime: false
  });
  const queuedRecovery = await recoveryManager.recover();
  assert.equal(queuedRecovery.length, 1);
  const recoveredTask = await queuedRecovery[0].promise;
  assert.equal(recoveredTask.status, 'completed');
  await recoveryManager.close();

  // --- Cloud clone must contain tracked native Cursor pointers -------------
  const readyRoot = path.join(fixture, 'ready');
  await mkdir(path.join(readyRoot, '.ai-agent'), { recursive: true });
  await mkdir(path.join(readyRoot, '.cursor/rules'), { recursive: true });
  await mkdir(path.join(readyRoot, '.cursor/skills/aafe-runtime'), { recursive: true });
  await writeFile(path.join(readyRoot, '.aafe.config.json'), '{}');
  await writeFile(path.join(readyRoot, '.ai-agent/skill-index.md'), '# index');
  await writeFile(path.join(readyRoot, '.ai-agent/project.md'), '# project');
  await writeFile(
    path.join(readyRoot, '.cursor/rules/aafe-skill-router.mdc'),
    'Read `.ai-agent/skill-index.md`.'
  );
  await writeFile(
    path.join(readyRoot, '.cursor/skills/aafe-runtime/SKILL.md'),
    'The single source of truth is `.ai-agent`.'
  );
  await execFileAsync('git', ['init'], { cwd: readyRoot });
  let readiness = await inspectCloudProjectReadiness(readyRoot);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.untracked.length > 0);
  await execFileAsync('git', ['add', '.'], { cwd: readyRoot });
  readiness = await assertCloudProjectReadiness(readyRoot);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.activation, 'cursor-project-native');

  await writeFile(path.join(readyRoot, '.aafe.config.json'), JSON.stringify({ sdd: { enabled: true } }));
  readiness = await inspectCloudProjectReadiness(readyRoot);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes('.ai-agent/sdd/SKILL.md'));
  await mkdir(path.join(readyRoot, '.ai-agent/sdd'), { recursive: true });
  await writeFile(path.join(readyRoot, '.ai-agent/sdd/SKILL.md'), '# SDD');
  await writeFile(
    path.join(readyRoot, '.cursor/rules/aafe-sdd-gate.mdc'),
    'Source of truth: `.ai-agent/sdd/SKILL.md`.'
  );
  await execFileAsync('git', ['add', '.'], { cwd: readyRoot });
  readiness = await assertCloudProjectReadiness(readyRoot);
  assert.equal(readiness.ready, true);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log('task manager tests passed');

function fakeCursorSdk(state) {
  const makeAgent = (agentId) => ({
    agentId,
    async send() {
      state.runs += 1;
      return fakeRun(`run-${state.runs}`);
    },
    async [Symbol.asyncDispose]() {}
  });
  return {
    Agent: {
      async create(options) {
        state.creates += 1;
        assert.ok(options.cloud.repos[0].url);
        assert.equal(options.cloud.repos[0].startingRef, 'main');
        return makeAgent(`agent-${state.creates}`);
      },
      async resume(agentId) {
        state.resumes += 1;
        return makeAgent(agentId);
      },
      async getRun() {
        state.getRuns += 1;
        return fakeRun('recover-run');
      },
      async cancelRun() {
        state.cancels += 1;
      }
    }
  };
}

function fakeRun(id) {
  return {
    id,
    agentId: 'agent',
    status: 'running',
    supports: () => true,
    stream: async function* stream() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    },
    wait: async () => ({
      id,
      status: 'finished',
      result: 'ok',
      git: { branches: [{ repoUrl: 'repo', branch: `aafe/task/${id}` }] }
    }),
    cancel: async () => {}
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
