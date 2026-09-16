import assert from 'node:assert/strict';
import { CliCodingAgentAdapter, ModelGateway, createExecutionInput } from '../src/index.js';

let calls = 0;
const gateway = new ModelGateway({ providers: {
  primary: { model: 'small', chat: async () => ({ status: 'failed', reason: ++calls === 1 ? 'llm-http-429' : 'llm-http-500' }) },
  fallback: { model: 'safe', chat: async () => ({ status: 'success', content: 'ok', usage: { total_tokens: 2 } }) }
}, policies: { default: { retries: 1, retryDelayMs: 0, providers: ['primary', 'fallback'] } }, sleep: async () => {} });
const result = await gateway.chat([{ role: 'user', content: 'hi' }]);
assert.equal(result.provider, 'fallback');
assert.equal(result.attempts.length, 3);

const fake = { run: async (options) => ({ executionId: options.executionId, pid: 1, exitCode: 0, stdout: options.input, stderr: '', cancelled: false }), cancel: () => true, closeAll: () => {} };
const adapter = new CliCodingAgentAdapter({ id: 'fake', executable: 'fake', args: ['--print'], processExecutor: fake });
const input = createExecutionInput({ taskId: 'task-1', instruction: 'do it', taskSnapshot: { id: 'task-1' } });
assert.equal((await adapter.execute(input)).status, 'completed');
assert.equal((await adapter.getCapabilities()).cancellation, true);
console.log('model gateway and CLI adapter tests passed');
