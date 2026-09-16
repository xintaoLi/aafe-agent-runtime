import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateTaskStore, SqliteTaskStore, TaskStore } from '../src/agent-platform/index.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-sqlite-'));
let sqlite;
try { sqlite = await SqliteTaskStore.open({ root }); }
catch (error) {
  if (/sqlite-driver-unavailable/.test(error.message)) {
    console.log('sqlite task store tests skipped: driver unavailable');
    process.exit(0);
  }
  throw error;
}
const created = await sqlite.create({ id: 'sql-task', requirement: 'persist', source: { type: 'wecom', userId: 'u' } }, { constraints: ['safe'] });
assert.equal(created.status, 'created');
await sqlite.transition('sql-task', 'queued');
await sqlite.transition('sql-task', 'running');
await sqlite.patchSnapshot('sql-task', { appendPendingSteps: ['test'] });
await sqlite.transition('sql-task', 'completed', { result: { text: 'done' } });
assert.equal((await sqlite.getSnapshot('sql-task')).lastResult, 'done');
assert.equal((await sqlite.list({ statuses: ['completed'] })).length, 1);

const files = new TaskStore({ root: path.join(root, 'files') });
await files.create({ id: 'file-task', requirement: 'migrate me' }, { acceptanceCriteria: ['works'] });
await files.appendEvent('file-task', 'custom', { ok: true });
assert.deepEqual(await migrateTaskStore(files, sqlite), { scanned: 1, imported: 1 });
assert.deepEqual(await migrateTaskStore(files, sqlite), { scanned: 1, imported: 0 });
assert.equal((await sqlite.getSnapshot('file-task')).acceptanceCriteria[0], 'works');
assert.ok((await sqlite.events('file-task')).some((event) => event.type === 'custom'));
sqlite.close();
console.log('sqlite task store tests passed');
