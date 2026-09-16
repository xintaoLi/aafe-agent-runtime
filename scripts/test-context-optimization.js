import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextBudgetAllocator, FileSummaryCache, RepositoryMapStore, ToolOutputCompressor, compactTaskContext } from '../src/index.js';

const allocator = new ContextBudgetAllocator({ maxTokens: 120, shares: { system: 0.5, snapshot: 0.5, recent: 0, code: 0, tools: 0, reserve: 0 } });
const allocation = allocator.allocate({ system: [{ id: 'rules', content: 'x'.repeat(400), mandatory: true }], snapshot: [{ id: 'goal', content: 'goal', mandatory: true }] });
assert.equal(allocation.selected.system.length, 1);
assert.ok(allocation.totalTokens > 0);
const compact = compactTaskContext({ constraints: ['keep'], conversation: { messages: Array.from({ length: 12 }, (_, index) => ({ content: `m${index}` })) }, pendingFollowUps: ['secret'] });
assert.equal(compact.conversation.messages.length, 8); assert.equal(compact.conversation.omittedMessages, 4); assert.equal(compact.constraints[0], 'keep'); assert.equal('pendingFollowUps' in compact, false);

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-context-'));
const cache = new FileSummaryCache({ root }); let summaries = 0;
await cache.getOrCreate('a.js', 'const a=1', async () => { summaries += 1; return 'a'; });
await cache.getOrCreate('a.js', 'const a=1', async () => { summaries += 1; return 'different'; });
assert.equal(summaries, 1);
const map = new RepositoryMapStore({ root }); let builds = 0;
await map.getOrCreate('abc', async () => { builds += 1; return [{ path: 'a.js' }]; });
await map.getOrCreate('abc', async () => { builds += 1; return []; });
assert.equal(builds, 1);
assert.ok((await readFile(map.file, 'utf8')).includes('a.js'));

const compressed = new ToolOutputCompressor({ maxChars: 100, headChars: 20, tailChars: 30 }).compress(`start\n${'x'.repeat(100)}\nERROR bad\nend`, { artifact: 'log.txt' });
assert.equal(compressed.truncated, true); assert.match(compressed.content, /ERROR bad/); assert.equal(compressed.artifact, 'log.txt');
console.log('context optimization tests passed');
