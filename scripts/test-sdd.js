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
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  mergeOpenSpecDelta,
  OpenSpecAdapter,
  SDDEngine,
  SDDStore,
  SDDValidator
} from '../src/agent-platform/sdd/index.js';
import { TaskManager } from '../src/agent-platform/tasks/TaskManager.js';
import { TaskStore } from '../src/agent-platform/tasks/TaskStore.js';
import { defaultSDDConfig, resolveSDDConfig } from '../src/cli/sddConfig.js';
import { parseSDDArgs, runSDDCommand } from '../src/cli/sdd.js';
import { sddPointerRuleMdc, sddRuntimeFiles, sddRuntimePaths } from '../src/cli/sddRuntimeFiles.js';
import { createSDDEngine as createPublicSDDEngine } from '../src/index.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-sdd-'));

try {
  const taskStore = new TaskStore({ root });
  await taskStore.create({ id: 'task-a', requirement: 'Add login', goal: 'Add login' }, { own: 'a' });
  await taskStore.create({ id: 'task-b', requirement: 'Other work', goal: 'Other work' }, { own: 'b' });
  const engine = new SDDEngine({ root, taskStore });

  const created = await engine.createChange({ taskId: 'task-a', slug: 'add-login' });
  assert.equal(created.taskId, 'task-a');
  assert.equal(created.changeId, 'task-a-add-login');
  assert.equal((await taskStore.get('task-a')).sdd.changeId, created.changeId);
  assert.deepEqual(await taskStore.getContext('task-b'), { own: 'b' });
  await assert.rejects(
    () => engine.createChange({ taskId: 'task-a', slug: 'duplicate' }),
    /task-sdd-already-bound/
  );
  await assert.rejects(
    () => engine.createChange({ taskId: 'task-b', changeId: created.changeId }),
    /sdd-change-id-already-bound/
  );
  await assert.rejects(
    () => engine.writeArtifact('task-a', 'design', '# Design\n'),
    /sdd-artifact-dependencies-missing/
  );

  await engine.writeArtifact('task-a', 'proposal', proposal());
  await engine.writeArtifact('task-a', 'design', design());
  await engine.writeArtifact('task-a', 'spec', addedLoginSpec(), { capability: 'auth' });
  await engine.writeArtifact('task-a', 'tasks', tasks());
  await engine.setTraceability('task-a', {
    specs: [{
      capability: 'auth',
      requirements: ['Login'],
      files: ['src/auth.js'],
      tests: ['tests/auth.test.js']
    }]
  });
  assert.equal((await engine.revisions('task-a')).length, 5);

  const validation = await engine.validate('task-a');
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(validation.change.status, 'waiting_approval');
  await engine.approve('task-a', { approvedBy: 'tester' });
  const applyContext = await engine.getApplyContext('task-a');
  assert.equal(applyContext.sdd.changeId, created.changeId);
  assert.equal(applyContext.projectCapabilities.embedded, false);
  assert.equal('rules' in applyContext.sdd, false);
  assert.equal(applyContext.taskContext.own, 'a');

  await engine.writeArtifact('task-a', 'design', `${design()}\n## Revision\nUse a durable session.\n`);
  assert.equal((await engine.get('task-a')).status, 'draft');
  assert.equal((await engine.get('task-a')).approval, null);
  const blockedManager = new TaskManager({
    root,
    store: taskStore,
    runtime: noOpRuntime(),
    validateProjectRuntime: false
  });
  await assert.rejects(() => blockedManager.start('task-a'), /task-sdd-not-ready/);
  await blockedManager.close();

  assert.equal((await engine.validate('task-a')).valid, true);
  await engine.approve('task-a');
  await engine.getApplyContext('task-a', { markImplementing: true });
  await engine.recordVerification('task-a', { status: 'passed', tests: [{ name: 'unit', passed: true }] });
  const preview = await engine.sync('task-a', { dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.specs[0].changes.added[0], 'Login');
  await assert.rejects(() => access(path.join(root, 'openspec/specs/auth/spec.md')));
  await engine.sync('task-a');
  assert.match(await readFile(path.join(root, 'openspec/specs/auth/spec.md'), 'utf8'), /Requirement: Login/);

  const archivePreview = await engine.archive('task-a', { dryRun: true });
  assert.equal(archivePreview.dryRun, true);
  const archived = await engine.archive('task-a', { now: new Date('2026-09-03T00:00:00Z') });
  assert.equal(archived.change.status, 'archived');
  await access(path.join(root, 'openspec/changes/archive/2026-09-03-task-a-add-login/proposal.md'));

  await taskStore.create({ id: 'task-c', requirement: 'Change login', goal: 'Change login' }, {});
  await createReadyVerifiedChange(engine, 'task-c', 'change-login', modifiedLoginSpec());
  await engine.sync('task-c');
  assert.match(await readFile(path.join(root, 'openspec/specs/auth/spec.md'), 'utf8'), /secure session/);

  await taskStore.create({ id: 'task-d', requirement: 'Remove login', goal: 'Remove login' }, {});
  await createReadyVerifiedChange(engine, 'task-d', 'remove-login', removedLoginSpec());
  await engine.sync('task-d');
  assert.doesNotMatch(await readFile(path.join(root, 'openspec/specs/auth/spec.md'), 'utf8'), /Requirement: Login/);

  assert.throws(
    () => new OpenSpecAdapter({ root, openspecRoot: '../outside' }),
    /openspec-root-outside-project/
  );
  assert.throws(
    () => new SDDEngine({ root, schema: 'custom-workflow' }),
    /unsupported-sdd-schema/
  );
  assert.throws(
    () => mergeOpenSpecDelta('', modifiedLoginSpec(), 'auth'),
    /modified-requirement-not-found/
  );
  const badValidation = new SDDValidator().validate(
    { taskId: 'x', changeId: 'x', revision: 0 },
    { proposal: proposal(), design: design(), tasks: tasks(), specs: { auth: invalidSpec() } }
  );
  assert.equal(badValidation.valid, false);
  assert.ok(badValidation.errors.some((error) => error.rule === 'scenario'));

  const isolatedStore = new SDDStore({ root });
  assert.equal((await isolatedStore.get('task-a')).changeId, created.changeId);

  assert.deepEqual(defaultSDDConfig(), {
    enabled: true,
    root: 'openspec',
    schema: 'spec-driven',
    approvalRequired: true
  });
  assert.deepEqual(resolveSDDConfig({ sdd: { enabled: true, root: 'specs-root' } }), {
    enabled: true,
    root: 'specs-root',
    schema: 'spec-driven',
    approvalRequired: true
  });
  assert.deepEqual(parseSDDArgs([
    'task-a',
    '--capability=auth',
    '--file=delta.md',
    '--yes',
    '--allow-unverified'
  ]), {
    positional: [],
    taskId: 'task-a',
    capability: 'auth',
    file: 'delta.md',
    yes: true,
    allowUnverified: true
  });
  assert.deepEqual(sddRuntimePaths('.ai-agent'), [
    '.ai-agent/sdd/SKILL.md',
    '.ai-agent/sdd/rules/sdd-gate.md',
    '.ai-agent/sdd/rules/workflow.md',
    '.ai-agent/sdd/rules/artifacts.md'
  ]);
  assert.equal(Object.keys(sddRuntimeFiles('.ai-agent')).length, 4);
  assert.match(sddPointerRuleMdc(), /\.ai-agent\/sdd\/SKILL\.md/);
  assert.ok(createPublicSDDEngine({ root, taskStore }) instanceof SDDEngine);

  await taskStore.create({ id: 'task-cli', requirement: 'CLI change', goal: 'CLI change' }, {});
  const originalLog = console.log;
  let cliCreated;
  try {
    console.log = () => {};
    cliCreated = await runSDDCommand(root, ['create', 'task-cli', '--slug=cli-change']);
    const cliStatus = await runSDDCommand(root, ['status', 'task-cli']);
    assert.equal(cliStatus.change.changeId, 'task-cli-cli-change');
  } finally {
    console.log = originalLog;
  }
  assert.equal(cliCreated.change.taskId, 'task-cli');
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('sdd tests passed');

async function createReadyVerifiedChange(engine, taskId, slug, spec) {
  await engine.createChange({ taskId, slug });
  await engine.writeArtifact(taskId, 'proposal', proposal());
  await engine.writeArtifact(taskId, 'design', design());
  await engine.writeArtifact(taskId, 'spec', spec, { capability: 'auth' });
  await engine.writeArtifact(taskId, 'tasks', tasks());
  assert.equal((await engine.validate(taskId)).valid, true);
  await engine.approve(taskId);
  await engine.getApplyContext(taskId, { markImplementing: true });
  await engine.recordVerification(taskId, { status: 'passed' });
}

function proposal() {
  return '# Proposal: Login\n\n## Why\nUsers need authentication.\n\n## What Changes\nAdd login behavior.\n';
}

function design() {
  return '# Design: Login\n\nUse the existing authentication boundary.\n';
}

function tasks() {
  return '# Tasks\n\n- [ ] 1. Implement login\n- [ ] 2. Test login\n';
}

function addedLoginSpec() {
  return `# Delta for Auth

## ADDED Requirements

### Requirement: Login
The system MUST authenticate a user.

#### Scenario: Valid credentials
- GIVEN an active user
- WHEN valid credentials are submitted
- THEN a secure session is created
`;
}

function modifiedLoginSpec() {
  return `# Delta for Auth

## MODIFIED Requirements

### Requirement: Login
The system MUST authenticate a user into a secure session.

#### Scenario: Valid credentials
- GIVEN an active user
- WHEN valid credentials are submitted
- THEN a secure session is created
`;
}

function removedLoginSpec() {
  return `# Delta for Auth

## REMOVED Requirements

### Requirement: Login
Login is retired.
`;
}

function invalidSpec() {
  return '# Delta\n\n## ADDED Requirements\n\n### Requirement: Missing Scenario\nThe system MUST fail validation.\n';
}

function noOpRuntime() {
  return {
    async run() { throw new Error('must-not-run'); },
    async recover() { throw new Error('must-not-recover'); },
    async cancel() { return { cancelled: true }; },
    async close() {},
    async closeAll() {}
  };
}
