import assert from 'node:assert/strict';
import { createExecutionEvent, createExecutionInput, ExecutorAdapter, normalizeExecutorCapabilities,
  normalizeRuntimeExecutionEvent } from '../src/agent-platform/index.js';

const input = createExecutionInput({ taskId: 'task-1', instruction: 'inspect repository', taskSnapshot: { id: 'task-1' },
  contextItems: [{ kind: 'snapshot' }], capabilities: ['file-read', 'file-read'], limits: { maxInputTokens: 8000, timeoutMs: 5000 } });
assert.equal(input.version, 1);
assert.deepEqual(input.capabilities, ['file-read']);
assert.equal(input.limits.maxOutputTokens, 4096);
assert.throws(() => createExecutionInput({ taskId: 'task-1', instruction: '' }), /instruction-missing/);
const event = createExecutionEvent('message.delta', { executionId: input.executionId, taskId: input.taskId, sequence: 2, payload: { content: 'ok' } });
assert.equal(event.type, 'message.delta');
assert.throws(() => createExecutionEvent('cursor.private', { executionId: input.executionId }), /event-unknown/);
assert.equal(normalizeRuntimeExecutionEvent({ taskId: 'task-1', type: 'codex.message', payload: { text: 'hello' } },
  { executionId: input.executionId }).type, 'message.delta');
assert.equal(normalizeRuntimeExecutionEvent({ taskId: 'task-1', type: 'cursor.message', payload: { tools: [{ name: 'shell' }] } },
  { executionId: input.executionId }).type, 'tool.started');
assert.equal(normalizeRuntimeExecutionEvent({ taskId: 'task-1', type: 'unknown' }, { executionId: input.executionId }), null);
const calls = [];
const adapter = new ExecutorAdapter({ kind: 'cursor', async run(task, instruction, options) { calls.push({ task, instruction, options }); return { status: 'completed' }; },
  async cancel() { return { cancelled: true }; }, async close() {}, async closeAll() {} });
assert.equal((await adapter.getCapabilities()).fileWrite, true);
assert.equal((await adapter.execute(input, { tokenBudget: 7000 })).status, 'completed');
assert.equal(calls[0].options.executionId, input.executionId);
assert.deepEqual(normalizeExecutorCapabilities({ fileRead: true, shell: 1 }), { fileRead: true, fileWrite: false, shell: false,
  git: false, mcp: false, streaming: false, resume: false, cancellation: false, structuredOutput: false });
console.log('execution protocol tests passed');
