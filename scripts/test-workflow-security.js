import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PermissionPolicy, WorkflowEngine } from '../src/index.js';

const policy = new PermissionPolicy({ maxAutoLevel: 'P2' });
assert.equal(policy.decide({ command: 'git status' }).allowed, true);
assert.equal(policy.decide({ command: 'git push origin main' }).allowed, false);
assert.throws(() => policy.assert({ command: 'rm -rf /tmp/project' }), /permission-P4-required/);

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-workflow-')); let firstRuns = 0;
const engine = new WorkflowEngine({ root, permissionPolicy: policy });
const definition = { id: 'recoverable', nodes: [
  { id: 'first', run: async () => ({ output: ++firstRuns, receipt: { id: 'first:1', verified: true } }) },
  { id: 'delivery', permission: { command: 'git push origin branch' }, run: async () => ({ output: 'pushed' }) }
] };
let state = await engine.run(definition, {}, { workflowId: 'wf-1' });
assert.equal(state.status, 'blocked'); assert.equal(firstRuns, 1);
state = await engine.run(definition, {}, { workflowId: 'wf-1', authorizedLevels: ['P3'] });
assert.equal(state.status, 'completed'); assert.equal(firstRuns, 1); assert.equal(state.receipts.length, 1);
console.log('workflow and security tests passed');
