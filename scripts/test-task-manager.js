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
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CursorTaskRuntime } from '../src/agent-platform/runtime/CursorTaskRuntime.js';
import {
  assertCloudProjectReadiness,
  inspectCloudProjectReadiness
} from '../src/agent-platform/runtime/CloudProjectReadiness.js';
import { TaskManager, buildTaskPrompt } from '../src/agent-platform/tasks/TaskManager.js';
import {
  buildRepoAuthPromptSection,
  resolveWorkspaceRepoAuth,
  resolveWorkspaceRepoEnv,
  workspaceConfigDirs
} from '../src/agent-platform/tasks/workspaceRepoEnv.js';
import { TaskScheduler } from '../src/agent-platform/tasks/TaskScheduler.js';
import { TaskStore } from '../src/agent-platform/tasks/TaskStore.js';
import { DEFAULT_SHARED_PATHS, WorkspaceManager } from '../src/agent-platform/workspace/WorkspaceManager.js';

const execFileAsync = promisify(execFile);
const fixture = await mkdtemp(path.join(os.tmpdir(), 'aafe-task-manager-'));
const exists = (target) => lstat(target).then(() => true, () => false);

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

  const localState = { creates: 0, lastCreate: null };
  const localSdk = {
    Agent: {
      async create(options) {
        localState.creates += 1;
        localState.lastCreate = options;
        return {
          agentId: 'agent-local',
          async send() {
            return fakeRun('run-local');
          },
          async [Symbol.asyncDispose]() {}
        };
      },
      async resume() {},
      async getRun() {
        return fakeRun('recover-local');
      },
      async cancelRun() {}
    }
  };
  const localRuntime = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => localSdk
  });
  await localRuntime.run({
    id: 'cursor-local',
    repository: null,
    baseBranch: 'main',
    cursor: { agentId: null }
  }, 'local work', { cwd: '/tmp/aafe-local-agent' });
  assert.equal(localState.creates, 1);
  assert.equal(localState.lastCreate.local.cwd, '/tmp/aafe-local-agent');
  assert.equal(localState.lastCreate.cloud, undefined);
  await localRuntime.closeAll();

  const injectedShell = { CURSOR_API_KEY: 'cursor_test' };
  const injectRuntime = new CursorTaskRuntime({
    env: injectedShell,
    importSdk: async () => localSdk
  });
  await injectRuntime.run({
    id: 'cursor-local-env',
    repository: null,
    cursor: { agentId: null }
  }, 'push', {
    cwd: '/tmp/aafe-local-agent',
    mode: 'local',
    envVars: {
      GITHUB_TOKEN: 'ghp_injected',
      GH_TOKEN: 'ghp_injected',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: 'AUTHORIZATION: bearer ghp_injected'
    }
  });
  assert.equal(injectedShell.GITHUB_TOKEN, 'ghp_injected');
  assert.equal(injectedShell.GIT_CONFIG_VALUE_0.includes('ghp_injected'), true);
  await injectRuntime.closeAll();

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

  // --- a local Agent is resumed inside its own workspace store -------------
  const localResumeState = { resumeArgs: null, getRunArgs: null, cancelArgs: null, creates: 0 };
  const localResumeSdk = {
    Agent: {
      async create() {
        localResumeState.creates += 1;
        return {
          agentId: 'agent-local-new',
          async send() { return fakeRun('run-local-new'); },
          async [Symbol.asyncDispose]() {}
        };
      },
      async resume(agentId, options) {
        localResumeState.resumeArgs = { agentId, options };
        return {
          agentId,
          async send() { return fakeRun('run-local-resumed'); },
          async [Symbol.asyncDispose]() {}
        };
      },
      async getRun(runId, options) {
        localResumeState.getRunArgs = { runId, options };
        return fakeRun(runId);
      },
      async cancelRun(runId, options) {
        localResumeState.cancelArgs = { runId, options };
      }
    }
  };
  const localTask = {
    id: 'cursor-local-resume',
    repository: null,
    baseBranch: 'main',
    workspace: { cwd: '/tmp/aafe-workspace', mode: 'local' },
    cursor: { agentId: 'agent-local-old', activeRunId: 'run-old' }
  };
  const localResumeRuntime = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => localResumeSdk
  });
  await localResumeRuntime.run(localTask, 'follow up', { cwd: '/tmp/aafe-workspace', mode: 'local' });
  assert.equal(localResumeState.resumeArgs.agentId, 'agent-local-old');
  assert.equal(localResumeState.resumeArgs.options.local.cwd, '/tmp/aafe-workspace');
  assert.equal(localResumeState.creates, 0);
  await localResumeRuntime.closeAll();

  // A local Run still marked running after a restart is a leftover of the dead
  // process. Streaming it would block forever, which is what left tasks stuck
  // in `running` and made them shadow every later message.
  await assert.rejects(
    localResumeRuntime.recover(localTask, { cwd: '/tmp/aafe-workspace', mode: 'local' }),
    /cursor-run-stale/
  );
  assert.deepEqual(localResumeState.getRunArgs.options, { runtime: 'local', cwd: '/tmp/aafe-workspace' });
  await localResumeRuntime.cancel(localTask, { cwd: '/tmp/aafe-workspace', mode: 'local' });
  assert.deepEqual(localResumeState.cancelArgs.options, { runtime: 'local', cwd: '/tmp/aafe-workspace' });
  await localResumeRuntime.closeAll();

  // --- a lost Agent is replaced and replays the durable context ------------
  const lostState = { creates: 0, sent: [] };
  const lostSdk = {
    Agent: {
      async create() {
        lostState.creates += 1;
        return {
          agentId: 'agent-replacement',
          async send(message) {
            lostState.sent.push(message);
            return fakeRun('run-replacement');
          },
          async [Symbol.asyncDispose]() {}
        };
      },
      async resume(agentId) {
        throw new Error(`Agent ${agentId} not found`);
      },
      async getRun() { return fakeRun('run-x'); },
      async cancelRun() {}
    }
  };
  const lostRuntime = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => lostSdk
  });
  const lostEvents = [];
  const lostResult = await lostRuntime.run({
    id: 'cursor-lost',
    repository: null,
    baseBranch: 'main',
    workspace: { cwd: '/tmp/aafe-workspace', mode: 'local' },
    cursor: { agentId: 'agent-gone' }
  }, 'only the follow-up', {
    cwd: '/tmp/aafe-workspace',
    mode: 'local',
    fallbackPrompt: 'full task context',
    onEvent: (event) => lostEvents.push(event.type)
  });
  assert.equal(lostState.creates, 1);
  assert.deepEqual(lostState.sent, ['full task context']);
  assert.equal(lostResult.agentId, 'agent-replacement');
  assert.ok(lostEvents.includes('cursor.agent.lost'));
  assert.ok(lostEvents.includes('cursor.agent.recreated'));
  await lostRuntime.closeAll();

  // A leftover Cursor run must not block 继续: cancel it, then send again.
  const conflictState = { sends: 0, cancels: 0 };
  const conflictSdk = {
    Agent: {
      async create() { throw new Error('must resume the existing agent'); },
      async resume(agentId) {
        return {
          agentId,
          async send() {
            conflictState.sends += 1;
            if (conflictState.sends === 1) {
              throw new Error('Agent agent-busy already has active run');
            }
            return fakeRun('run-after-cancel');
          },
          async [Symbol.asyncDispose]() {}
        };
      },
      async getRun() { return fakeRun('x'); },
      async cancelRun() { conflictState.cancels += 1; }
    }
  };
  const conflictRuntime = new CursorTaskRuntime({
    env: { CURSOR_API_KEY: 'cursor_test' },
    importSdk: async () => conflictSdk
  });
  const conflictResult = await conflictRuntime.run({
    id: 'cursor-busy',
    repository: null,
    workspace: { cwd: '/tmp/aafe-workspace', mode: 'local' },
    cursor: { agentId: 'agent-busy', activeRunId: 'run-hung' }
  }, '继续', { cwd: '/tmp/aafe-workspace', mode: 'local' });
  assert.equal(conflictState.sends, 2);
  assert.equal(conflictState.cancels, 1);
  assert.equal(conflictResult.runId, 'run-after-cancel');
  await conflictRuntime.closeAll();

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

  // --- continue while running queues the next Run instead of throwing ------
  const continueRoot = path.join(fixture, 'continue-active');
  let continueRuns = 0;
  let releaseContinue;
  const continueRuntime = {
    async run(task, prompt) {
      continueRuns += 1;
      if (continueRuns === 1) {
        await new Promise((resolve) => { releaseContinue = resolve; });
      }
      return {
        agentId: `agent-${task.id}`,
        runId: `run-${continueRuns}`,
        status: 'finished',
        text: String(prompt),
        git: {}
      };
    },
    async recover() { return { status: 'finished', text: 'x' }; },
    async cancel() { return { cancelled: true }; },
    async close() {},
    async closeAll() {}
  };
  const continueManager = new TaskManager({
    root: continueRoot,
    runtime: continueRuntime,
    validateProjectRuntime: false
  });
  await continueManager.create({ id: 'active-task', requirement: 'first' });
  const firstRun = continueManager.start('active-task', { prompt: 'first' });
  await delay(20);
  const queued = await continueManager.continue('active-task', 'plus tests');
  assert.equal(queued.status, 'running');
  assert.equal(queued.followUpQueued, true);
  assert.deepEqual((await continueManager.getContext('active-task')).pendingFollowUps, [
  { text: 'plus tests', author: null }
]);
  releaseContinue();
  const firstFinished = await firstRun;
  assert.equal(firstFinished.status, 'waiting');
  await delay(50);
  const afterContinue = await continueManager.get('active-task');
  assert.equal(afterContinue.status, 'completed');
  assert.equal(continueRuns, 2);
  assert.deepEqual((await continueManager.getContext('active-task')).pendingFollowUps ?? [], []);
  await continueManager.close();

  // --- a follow-up carries who wrote it ------------------------------------
  // In a group chat several people add to one task, and the agent has to weigh
  // the owner's words above a bystander's, which merged text cannot express.
  const authorRoot = path.join(fixture, 'follow-up-author');
  const authorPrompts = [];
  const authorManager = new TaskManager({
    root: authorRoot,
    runtime: {
      async run(task, prompt) {
        authorPrompts.push(prompt);
        return { agentId: 'agent-x', runId: `run-${authorPrompts.length}`, status: 'finished', text: 'ok', git: {} };
      },
      async recover() { return { status: 'finished', text: 'x' }; },
      async cancel() { return { cancelled: true }; },
      async close() {},
      async closeAll() {}
    },
    validateProjectRuntime: false
  });
  await authorManager.create({
    id: 'group-task',
    requirement: 'first',
    source: { type: 'wecom', conversationId: 'chat-9', userId: 'user-a' }
  });
  await authorManager.start('group-task');
  // A queue written before authorship existed still has to run.
  const legacyContext = await authorManager.getContext('group-task');
  legacyContext.pendingFollowUps = ['旧格式的补充'];
  await authorManager.store.replaceContext('group-task', legacyContext);
  await authorManager.continue('group-task', '这里还要考虑灰度', {
    author: { userId: 'user-b', role: 'participant' }
  });
  const authorPrompt = authorPrompts.at(-1);
  assert.match(authorPrompt, /旧格式的补充/);
  assert.match(authorPrompt, /参与者 user-b 的补充，任务发起人是 user-a/);
  assert.match(authorPrompt, /这里还要考虑灰度/);
  const authorContext = await authorManager.getContext('group-task');
  assert.deepEqual(authorContext.conversation.messages.at(-1).author, { userId: 'user-b', role: 'participant' });
  assert.deepEqual(authorContext.participants, [{ userId: 'user-b', role: 'participant', messages: 1 }]);
  // The role is derived from the task, so a caller cannot promote a bystander.
  await authorManager.continue('group-task', '再补一句', { author: { userId: 'user-b', role: 'owner' } });
  assert.match(authorPrompts.at(-1), /参与者 user-b/);
  assert.equal((await authorManager.getContext('group-task')).participants[0].messages, 2);
  // The owner's own addendum reads as the requirement itself, unannotated.
  await authorManager.continue('group-task', '范围收一下', { author: { userId: 'user-a', role: 'owner' } });
  assert.equal(authorPrompts.at(-1), '范围收一下');
  await authorManager.close();

  // --- a successful retry drops the previous attempt's error ---------------
  const retryRoot = path.join(fixture, 'retry-error');
  let retryRuns = 0;
  const retryManager = new TaskManager({
    root: retryRoot,
    runtime: {
      async run(task) {
        retryRuns += 1;
        if (retryRuns === 1) throw new Error('cursor-agent-open-failed:Agent agent-x not found');
        return { agentId: 'agent-x', runId: `run-${retryRuns}`, status: 'finished', text: 'ok', git: {} };
      },
      async recover() { return { status: 'finished', text: 'x' }; },
      async cancel() { return { cancelled: true }; },
      async close() {},
      async closeAll() {}
    },
    validateProjectRuntime: false
  });
  await retryManager.create({ id: 'retry-task', requirement: 'retry' });
  const retryFailed = await retryManager.start('retry-task');
  assert.equal(retryFailed.status, 'failed');
  assert.match(retryFailed.error, /agent-x not found/);
  const retried = await retryManager.start('retry-task');
  assert.equal(retried.status, 'completed');
  assert.equal(retried.error, null);
  await retryManager.close();

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

  // --- a run that died with its process is parked, not silently re-run ------
  const staleRoot = path.join(fixture, 'stale-run');
  const staleStore = new TaskStore({ root: staleRoot });
  await staleStore.create({
    id: 'stale-task',
    requirement: 'interrupted',
    status: 'running',
    cursor: { agentId: 'agent-stale', activeRunId: 'run-stale' }
  }, {});
  let staleRuns = 0;
  let staleCancels = 0;
  const recoveredEvents = [];
  const staleManager = new TaskManager({
    root: staleRoot,
    store: staleStore,
    runtime: {
      async run() {
        staleRuns += 1;
        return { agentId: 'agent-stale', runId: 'run-new', status: 'finished', text: 'ok', git: {} };
      },
      async recover() {
        throw new Error('cursor-run-stale:local run run-stale did not survive the restart');
      },
      async cancel() {
        staleCancels += 1;
        return { cancelled: true };
      },
      async close() {},
      async closeAll() {}
    },
    validateProjectRuntime: false
  });
  staleManager.subscribe((event) => recoveredEvents.push(event));
  const staleRecovery = await staleManager.recover();
  const parked = await staleRecovery[0].promise;
  assert.equal(parked.status, 'failed');
  assert.equal(parked.error, 'task-interrupted:process-restart');
  assert.equal(recoveredEvents.some((event) => event.type === 'task.failed'), true);
  assert.equal(staleCancels, 1);
  // Re-running yesterday's requirement unasked is the surprise we are avoiding.
  assert.equal(staleRuns, 0);
  // Terminal means it no longer counts as live work competing for follow-ups.
  assert.deepEqual((await staleManager.list({ statuses: ['running'] })).length, 0);
  const resumedStale = await staleManager.start('stale-task');
  assert.equal(resumedStale.status, 'completed');
  assert.equal(staleRuns, 1);
  await staleManager.close();

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

  // --- one checkout per task ------------------------------------------------
  const repo = path.join(fixture, 'worktree-repo');
  await mkdir(repo, { recursive: true });
  await execFileAsync('git', ['init', '-q', '-b', 'main', '.'], { cwd: repo });
  await writeFile(path.join(repo, 'a.txt'), 'hello\n', 'utf8');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n', 'utf8');
  await mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(path.join(repo, 'node_modules', 'left-pad', 'package.json'), '{"v":1}\n', 'utf8');
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', [
    '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'
  ], { cwd: repo });

  const workspaces = new WorkspaceManager({ logger: { warn() {} } });
  const inRepo = (id) => ({ id, baseBranch: 'main', workspace: { cwd: repo, mode: 'local' } });
  const leaseA = await workspaces.acquire(inRepo('task-wt-a'));
  const leaseB = await workspaces.acquire(inRepo('task-wt-b'));
  assert.equal(leaseA.mode, 'worktree');
  assert.equal(leaseB.mode, 'worktree');
  // The whole point: two live tasks on one repository do not share a directory.
  assert.notEqual(leaseA.cwd, leaseB.cwd);
  assert.notEqual(leaseA.port, leaseB.port);
  assert.equal(leaseA.baseRef, 'main');
  // Acquiring twice for one task is the recovery path, not a second checkout.
  assert.equal((await workspaces.acquire(inRepo('task-wt-a'))).cwd, leaseA.cwd);
  const { stdout: worktreeList } = await execFileAsync('git', ['worktree', 'list'], { cwd: repo });
  assert.ok(worktreeList.includes('task-wt-a') && worktreeList.includes('task-wt-b'));
  // The checkouts must not surface as untracked files in the main tree.
  const { stdout: repoStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  assert.equal(repoStatus.trim(), '');

  // Installed dependencies are borrowed, or the agent's first move in a fresh
  // checkout is an install and the self-test gate never runs.
  assert.equal(
    (await readFile(path.join(leaseA.cwd, 'node_modules', 'left-pad', 'package.json'), 'utf8')).trim(),
    '{"v":1}'
  );
  // Borrowing must not leave the worktree dirty, in either checkout.
  const { stdout: leasedStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: leaseA.cwd });
  assert.equal(leasedStatus.trim(), '');

  // Dependencies are read-only in practice and safe to share; the build caches
  // that live among them are not, and two tasks writing one cache is how a task
  // ends up shipping another task's output.
  await writeFile(path.join(leaseA.cwd, 'node_modules', '.cache', 'build.json'), 'from-a\n', 'utf8');
  await writeFile(path.join(leaseB.cwd, 'node_modules', '.cache', 'build.json'), 'from-b\n', 'utf8');
  assert.equal(
    (await readFile(path.join(leaseA.cwd, 'node_modules', '.cache', 'build.json'), 'utf8')).trim(),
    'from-a'
  );
  assert.equal(
    (await readFile(path.join(leaseB.cwd, 'node_modules', '.cache', 'build.json'), 'utf8')).trim(),
    'from-b'
  );
  assert.equal(await exists(path.join(repo, 'node_modules', '.cache', 'build.json')), false,
    'a task must not write its build cache into the main checkout');
  // Shadowing the caches means `node_modules` itself is a real directory, which
  // the repository's own ignore rule already covers.
  assert.equal((await lstat(path.join(leaseA.cwd, 'node_modules'))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(leaseA.cwd, 'node_modules', 'left-pad'))).isSymbolicLink(), true);
  assert.equal(
    (await readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')).includes('AAFE'),
    false,
    'nothing has to be excluded when the borrowed path is a real directory'
  );
  // Naming the same path in config means what the default means, or a project
  // would lose cache isolation for having spelled `node_modules` out.
  assert.deepEqual(new WorkspaceManager({ share: ['node_modules'] }).share, [...DEFAULT_SHARED_PATHS]);
  // Anything else is borrowed whole, and a whole-directory symlink is the case
  // git will not ignore on its own.
  const built = path.join(repo, 'dist');
  await mkdir(built, { recursive: true });
  await writeFile(path.join(built, 'app.js'), 'built\n', 'utf8');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
  await execFileAsync('git', [
    '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'ignore dist'
  ], { cwd: repo });
  const whole = new WorkspaceManager({ share: ['dist'], logger: { warn() {} } });
  const wholeLease = await whole.acquire(inRepo('task-wt-dist'));
  assert.equal((await lstat(path.join(wholeLease.cwd, 'dist'))).isSymbolicLink(), true);
  const { stdout: distStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: wholeLease.cwd });
  assert.equal(distStatus.trim(), '', 'a borrowed symlink has to be excluded or every worktree is dirty');
  whole.release('task-wt-dist');
  await whole.remove('task-wt-dist', { repoRoot: repo, force: true });

  // Tracked content is never replaced by a link to the main checkout.
  const tracked = new WorkspaceManager({ share: ['a.txt'], logger: { warn() {} } });
  const noShare = await tracked.acquire(inRepo('task-wt-tracked'));
  assert.equal((await readFile(path.join(noShare.cwd, 'a.txt'), 'utf8')).trim(), 'hello');
  assert.equal((await lstat(path.join(noShare.cwd, 'a.txt'))).isSymbolicLink(), false);
  tracked.release('task-wt-tracked');
  await tracked.remove('task-wt-tracked', { repoRoot: repo, force: true });

  // A task is provisioned detached because the branch it will develop on is the
  // agent's to name. Once it has one, a re-created checkout must resume it:
  // detaching again would strand every commit the task has already made.
  assert.equal(leaseB.branch, null);
  await execFileAsync('git', ['switch', '-q', '-c', 'feat/ai/#4242'], { cwd: leaseB.cwd });
  await writeFile(path.join(leaseB.cwd, 'a.txt'), 'changed by b\n', 'utf8');
  await execFileAsync('git', [
    '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'work'
  ], { cwd: leaseB.cwd });
  workspaces.release('task-wt-b');
  assert.equal((await workspaces.remove('task-wt-b', { repoRoot: repo })).removed, true);
  const resumed = await workspaces.acquire({
    ...inRepo('task-wt-b'),
    taskBranch: 'feat/ai/#4242'
  });
  assert.equal(resumed.branch, 'feat/ai/#4242');
  assert.equal((await readFile(path.join(resumed.cwd, 'a.txt'), 'utf8')).trim(), 'changed by b');
  workspaces.release('task-wt-b');
  await workspaces.remove('task-wt-b', { repoRoot: repo, force: true });
  // A branch the repository has never heard of is not a reason to fail to
  // provision; the task is simply started detached as usual.
  const unknownBranch = await workspaces.acquire({
    ...inRepo('task-wt-c'),
    taskBranch: 'feat/ai/#never'
  });
  assert.equal(unknownBranch.branch, null);
  assert.equal(unknownBranch.baseRef, 'main');
  workspaces.release('task-wt-c');
  await workspaces.remove('task-wt-c', { repoRoot: repo, force: true });

  // A worktree still holding uncommitted work is the only copy of it.
  await writeFile(path.join(leaseA.cwd, 'scratch.txt'), 'unsaved\n', 'utf8');
  assert.equal(workspaces.release('task-wt-a').taskId, 'task-wt-a');
  assert.equal((await workspaces.remove('task-wt-a', { repoRoot: repo })).reason, 'dirty');
  assert.equal((await workspaces.remove('task-wt-a', { repoRoot: repo, force: true })).removed, true);

  // --- a directory that cannot be a worktree is held exclusively instead ----
  const plain = path.join(fixture, 'not-a-repo');
  await mkdir(plain, { recursive: true });
  const shares = new WorkspaceManager({ logger: { warn() {} } });
  const held = await shares.acquire({ id: 'task-plain-a', workspace: { cwd: plain } });
  assert.equal(held.mode, 'shared');
  let secondArrived = false;
  const waiting = shares.acquire({ id: 'task-plain-b', workspace: { cwd: plain } })
    .then((lease) => { secondArrived = true; return lease; });
  await delay(30);
  assert.equal(secondArrived, false, 'a shared checkout must not be handed to two tasks at once');
  shares.release('task-plain-a');
  const queuedLease = await waiting;
  assert.equal(queuedLease.cwd, held.cwd);
  assert.equal(queuedLease.port, held.port, 'a released port returns to the pool');
  shares.release('task-plain-b');

  // Worktrees can be turned off; the lock is what remains.
  const flat = new WorkspaceManager({ worktrees: false });
  assert.equal((await flat.acquire(inRepo('task-flat'))).mode, 'shared');
  flat.release('task-flat');

  // --- the lease and the PR are facts about the task, not log lines ---------
  let leasedPrompt = '';
  const leasedStore = new TaskStore({ root: path.join(fixture, 'leased') });
  await writeFile(path.join(repo, '.aafe.config.json'), JSON.stringify({
    repo: { githubAccessToken: 'ghp_workspace_cfg' }
  }), 'utf8');
  let leasedEnvVars = null;
  const leasedManager = new TaskManager({
    root: path.join(fixture, 'leased'),
    store: leasedStore,
    runtime: {
      async run(task, prompt, options = {}) {
        leasedPrompt = prompt;
        leasedEnvVars = options.envVars ?? null;
        // The agent must be inside its own checkout, not the repository root.
        assert.ok(prompt.includes(task.execution.cwd));
        return {
          agentId: 'agent-lease',
          runId: 'run-lease',
          status: 'finished',
          text: 'ok',
          git: { branches: [{ branch: 'feat/ai/#1' }], prUrl: 'https://github.com/o/r/pull/7' }
        };
      },
      async recover() { return { status: 'finished', text: 'x' }; },
      async cancel() { return { cancelled: true }; },
      async close() {},
      async closeAll() {}
    },
    validateProjectRuntime: false,
    workspaces: new WorkspaceManager({ logger: { warn() {} } })
  });
  const leased = await leasedManager.create({
    goal: 'lease me',
    baseBranch: 'main',
    workspace: { cwd: repo, mode: 'local' }
  });
  const previousGithub = process.env.GITHUB_TOKEN;
  const previousGh = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    await leasedManager.start(leased.id);
  } finally {
    if (previousGithub === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGithub;
    if (previousGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGh;
  }
  const settled = await leasedStore.get(leased.id);
  assert.equal(leasedEnvVars?.GITHUB_TOKEN, 'ghp_workspace_cfg');
  assert.match(leasedPrompt, /GITHUB_TOKEN \/ GH_TOKEN/);
  assert.equal(leasedPrompt.includes('ghp_workspace_cfg'), false);
  assert.equal(settled.execution.mode, 'worktree');
  assert.ok(settled.execution.cwd.includes(leased.id));
  assert.ok(settled.execution.port > 0);
  assert.ok((await leasedStore.events(leased.id)).some((e) => e.type === 'task.workspace.leased'));
  // The run reported a PR, so reading it no longer means digging through result.
  assert.equal(settled.pullRequest.url, 'https://github.com/o/r/pull/7');
  assert.equal(settled.pullRequest.provider, 'github');
  assert.equal(settled.pullRequest.number, 7);
  // Released once the run is over, so the next task may have the port.
  assert.equal(leasedManager.workspaces.get(leased.id), null);

  // A finished task's checkout is given back, or the directory grows by one per
  // task ever run.
  assert.deepEqual(await leasedManager.reclaimWorkspaces(), [leased.id]);
  assert.ok((await leasedStore.events(leased.id)).some((e) => e.type === 'task.workspace.reclaimed'));
  assert.deepEqual(await leasedManager.reclaimWorkspaces(), [], 'already reclaimed is not reclaimed twice');

  assert.match(leasedPrompt, /Isolated workspace:/);
  // Detached is deliberate; an agent told nothing would treat it as damage.
  assert.match(leasedPrompt, /HEAD is detached/);
  assert.match(leasedPrompt, new RegExp(`Reserved port: ${settled.execution.port}`));
  assert.equal(buildTaskPrompt(settled, {}, null).includes('Reserved port'), true);
  assert.equal(buildTaskPrompt({ id: 'x', goal: 'y' }, {}).includes('Isolated workspace'), false);
  assert.match(
    buildTaskPrompt({ id: 'x', goal: 'y' }, {}, null, { envVars: { GITHUB_TOKEN: 'secret' } }),
    /GitHub auth is already in this process environment/
  );
  assert.equal(
    buildTaskPrompt({ id: 'x', goal: 'y' }, {}, null, { envVars: { GITHUB_TOKEN: 'secret' } }).includes('secret'),
    false
  );

  const nestedDirs = workspaceConfigDirs(
    { workspace: { cwd: '/repo/bklog/web' } },
    { cwd: '/repo/.aafe/worktrees/task-1', repoRoot: '/repo' }
  );
  assert.equal(nestedDirs[0], path.resolve('/repo/bklog/web'));
  assert.ok(nestedDirs.some((dir) => dir.endsWith(path.join('task-1', 'bklog', 'web'))));
  const fromNestedConfig = await resolveWorkspaceRepoEnv(
    { workspace: { cwd: '/missing' } },
    { cwd: '/work', repoRoot: '/repo' },
    {},
    {
      readConfig: async (dir) => (
        dir === path.resolve('/repo/bklog/web')
          ? { repo: { githubAccessToken: 'ghp_nested' } }
          : null
      )
    }
  );
  assert.equal(fromNestedConfig.GITHUB_TOKEN, undefined);
  const fromInstall = await resolveWorkspaceRepoEnv(
    { workspace: { cwd: '/repo/bklog/web' } },
    { cwd: '/repo/.aafe/worktrees/task-1', repoRoot: '/repo' },
    {},
    {
      readConfig: async (dir) => (
        dir === path.resolve('/repo/bklog/web')
          ? { repo: { githubAccessToken: 'ghp_nested' } }
          : null
      )
    }
  );
  assert.equal(fromInstall.GITHUB_TOKEN, 'ghp_nested');
  assert.equal(fromInstall.GIT_CONFIG_VALUE_0.includes('ghp_nested'), true);
  assert.equal(buildRepoAuthPromptSection(fromInstall).join('\n').includes('ghp_nested'), false);

  const wecomWins = await resolveWorkspaceRepoAuth(
    { workspace: { cwd: '/repo/web' } },
    null,
    {},
    {
      overrideConfig: { repo: { githubAccessToken: 'ghp_wecom' } },
      aafeConfig: { repo: { githubAccessToken: 'ghp_aafe' } },
      readConfig: async (dir) => (
        dir === path.resolve('/repo/web')
          ? { repo: { githubAccessToken: 'ghp_workspace' } }
          : null
      )
    }
  );
  assert.equal(wecomWins.source, 'wecom');
  assert.equal(wecomWins.envVars.GITHUB_TOKEN, 'ghp_wecom');

  const aafeWins = await resolveWorkspaceRepoAuth(
    { workspace: { cwd: '/repo/web' } },
    null,
    {},
    {
      overrideConfig: { repo: { githubAccessToken: null } },
      aafeConfig: { repo: { githubAccessToken: 'ghp_aafe' } },
      readConfig: async (dir) => (
        dir === path.resolve('/repo/web')
          ? { repo: { githubAccessToken: 'ghp_workspace' } }
          : null
      )
    }
  );
  assert.equal(aafeWins.source, 'aafe');
  assert.equal(aafeWins.envVars.GITHUB_TOKEN, 'ghp_aafe');

  const workspaceWins = await resolveWorkspaceRepoAuth(
    { workspace: { cwd: '/repo/web' } },
    null,
    {},
    {
      aafeConfig: { repo: {} },
      readConfig: async (dir) => (
        dir === path.resolve('/repo/web')
          ? { repo: { githubAccessToken: 'ghp_workspace' } }
          : null
      )
    }
  );
  assert.equal(workspaceWins.source, 'workspace');
  assert.equal(workspaceWins.envVars.GITHUB_TOKEN, 'ghp_workspace');

  // --- the index narrows candidates without becoming the truth --------------
  const indexed = new TaskStore({ root: path.join(fixture, 'indexed') });
  await indexed.create({ id: 'idx-a', goal: 'A', source: { type: 'wecom', conversationId: 'room-1', userId: 'ann' } });
  await indexed.create({ id: 'idx-b', goal: 'B', source: { type: 'wecom', conversationId: 'room-1', userId: 'bob' } });
  await indexed.create({ id: 'idx-c', goal: 'C', source: { type: 'wecom', conversationId: 'room-2', userId: 'ann' } });
  await indexed.create({ id: 'idx-d', goal: 'D', source: { type: 'cli' } });
  assert.deepEqual(
    (await indexed.list({ conversationId: 'room-1' })).map((task) => task.id).sort(),
    ['idx-a', 'idx-b']
  );
  assert.deepEqual((await indexed.list({ conversationId: 'room-1', userId: 'ann' })).map((t) => t.id), ['idx-a']);
  assert.deepEqual((await indexed.list({ sourceType: 'cli' })).map((t) => t.id), ['idx-d']);
  assert.equal((await indexed.list({})).length, 4);
  await indexed.transition('idx-a', 'queued');
  assert.deepEqual((await indexed.list({ statuses: ['queued'] })).map((t) => t.id), ['idx-a']);
  // A task written without the index still has to be found and repaired into it.
  await rm(path.join(fixture, 'indexed', '.aafe', 'tasks', 'index.json'), { force: true });
  assert.equal((await indexed.list({ conversationId: 'room-1' })).length, 2);
  assert.equal((await indexed.list({ conversationId: 'room-1' })).length, 2);
  // An index entry pointing at a task that is gone must not resurrect it.
  await rm(path.join(fixture, 'indexed', '.aafe', 'tasks', 'idx-c'), { recursive: true, force: true });
  assert.deepEqual((await indexed.list({ userId: 'ann' })).map((t) => t.id), ['idx-a']);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

{
  const { CodexTaskRuntime, CODEX_RUNTIME_NOT_IMPLEMENTED } = await import('../src/agent-platform/runtime/CodexTaskRuntime.js');
  const { createTaskRuntime } = await import('../src/agent-platform/runtime/createTaskRuntime.js');
  const runtime = createTaskRuntime('codex');
  assert.equal(runtime instanceof CodexTaskRuntime, true);
  await assert.rejects(() => runtime.run({ id: 'task-codex-1' }), /codex-runtime-not-implemented/);
  assert.equal((await runtime.cancel()).reason, CODEX_RUNTIME_NOT_IMPLEMENTED);
  const recovered = await runtime.recover({ id: 'task-codex-1' });
  assert.equal(recovered.status, 'missing');

  let cursorCalled = false;
  const fakeCursor = {
    kind: 'cursor',
    async run() { cursorCalled = true; throw new Error('cursor-should-not-run'); },
    async cancel() { return { cancelled: false }; },
    async close() {},
    async closeAll() {}
  };
  const codexRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-codex-'));
  try {
    const manager = new TaskManager({
      root: codexRoot,
      output: '.aafe',
      runtime: fakeCursor,
      validateProjectRuntime: false,
      recoverOnStart: false,
      workspaceOptions: { worktrees: false }
    });
    const task = await manager.create({
      goal: 'codex entry',
      provider: 'codex',
      workspace: { cwd: codexRoot, mode: 'local' }
    });
    const result = await manager.start(task.id);
    assert.equal(cursorCalled, false);
    assert.equal(result.status, 'failed');
    assert.match(result.error, /codex-runtime-not-implemented/);
    await manager.close();
  } finally {
    await rm(codexRoot, { recursive: true, force: true });
  }
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
