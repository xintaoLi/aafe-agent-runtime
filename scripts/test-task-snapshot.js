import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTaskSnapshotPatch, assertTaskStoreContract, createTaskSnapshot, TaskStore } from '../src/agent-platform/index.js';

const initial = createTaskSnapshot({ id: 'task-1', goal: 'fix login', requirement: 'support retry', status: 'created' },
  { constraints: ['do not upgrade Vue'], pendingSteps: ['inspect'] });
assert.equal(initial.version, 1);
const patched = applyTaskSnapshotPatch(initial, { appendCompletedSteps: ['inspect'], removePendingSteps: ['inspect'],
  appendPendingSteps: ['implement'], appendTouchedFiles: ['src/auth.js', 'src/auth.js'] });
assert.equal(patched.version, 2);
assert.deepEqual(patched.touchedFiles, ['src/auth.js']);
assert.deepEqual(patched.pendingSteps, ['implement']);
assert.equal(applyTaskSnapshotPatch(patched, { appendTouchedFiles: ['src/auth.js'] }).version, 2, 'idempotent patch');
assert.throws(() => applyTaskSnapshotPatch({ schemaVersion: 99 }, {}), /version-unsupported/);

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-snapshot-'));
const store = new TaskStore({ root });
assert.equal(assertTaskStoreContract(store), store);
assert.throws(() => assertTaskStoreContract({ get() {} }), /task-store-contract-missing/);
await store.create({ id: 'task-store', goal: 'persist snapshot' }, { constraints: ['safe'] });
assert.equal((await store.getSnapshot('task-store')).constraints[0], 'safe');
await store.patchSnapshot('task-store', { appendPendingSteps: ['test'] });
assert.equal((await store.getSnapshot('task-store')).version, 2);
await store.transition('task-store', 'queued');
await store.transition('task-store', 'running');
await store.transition('task-store', 'completed', { result: { text: 'done' } });
const done = await store.getSnapshot('task-store');
assert.equal(done.status, 'completed');
assert.equal(done.lastResult, 'done');
assert.ok((await store.events('task-store')).some((event) => event.type === 'task.snapshot.updated'));
console.log('task snapshot tests passed');
