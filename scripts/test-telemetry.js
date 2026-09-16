import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createInvocationMetric,
  InvocationMetricStore,
  recordInvocationSafely,
  summarizeInvocations,
  validateInvocationMetric
} from '../src/telemetry/index.js';
import { LlmClient } from '../src/llm/LlmClient.js';
import { renderTelemetrySummary, runTelemetryCommand } from '../src/cli/telemetry.js';

const metric = createInvocationMetric({
  traceId: 'trace-1', taskId: 'task-1', executionId: 'run-1', source: 'wecom',
  provider: 'codex', model: 'gpt-test', operation: 'coding-agent',
  usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 60 },
  latencyMs: 900, firstTokenMs: 120, route: 'coding.fix', routeConfidence: 0.9,
  success: true, prompt: 'must not be retained', apiKey: 'must-not-be-retained'
});
assert.equal(validateInvocationMetric(metric), true);
assert.equal(metric.totalTokens, 120);
assert.equal(metric.cachedInputTokens, 60);
assert.equal('prompt' in metric, false);
assert.equal('apiKey' in metric, false);

const unknown = createInvocationMetric({ provider: 'cursor', success: false, errorCode: 'timeout:secret text' });
assert.equal(unknown.totalTokens, null, 'unknown usage must not become zero');
assert.equal(unknown.errorCode, 'timeout:secret_text');

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-telemetry-'));
const store = new InvocationMetricStore({ root });
await Promise.all([
  store.append(metric),
  store.append({ provider: 'cursor', model: 'fast', usage: { total_tokens: 30, cost: 0.02 }, latencyMs: 200,
    success: false, errorCode: 'provider-timeout' })
]);
const records = await store.list();
assert.equal(records.length, 2);
const raw = await readFile(store.file, 'utf8');
assert.equal(raw.includes('must not be retained'), false);
const summary = summarizeInvocations(records);
assert.equal(summary.requests, 2);
assert.equal(summary.successRate, 0.5);
assert.equal(summary.totalTokens, 150);
assert.equal(summary.latencyP50Ms, 200);
assert.equal(summary.latencyP95Ms, 900);
assert.deepEqual(summary.byProvider, { codex: 1, cursor: 1 });

let observed = '';
const ignored = await recordInvocationSafely({ append: async () => { throw new Error('disk-full'); } }, {},
  (error) => { observed = error.message; });
assert.equal(ignored, null);
assert.equal(observed, 'disk-full');

const llmStore = new InvocationMetricStore({ root, file: path.join(root, 'llm.jsonl') });
const llm = new LlmClient({
  endpoint: 'https://llm.example/v1/chat/completions',
  model: 'router-small',
  metricStore: llmStore,
  telemetry: { traceId: 'route-trace', source: 'runtime', operation: 'route' }
}, {
  fetchImpl: async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3 }
  }) })
});
assert.equal((await llm.chat([{ role: 'user', content: 'route me' }], {
  telemetry: { route: 'coding.fix', routeConfidence: 0.88 }
})).status, 'success');
const llmMetrics = await llmStore.list();
assert.equal(llmMetrics.length, 1);
assert.equal(llmMetrics[0].operation, 'route');
assert.equal(llmMetrics[0].route, 'coding.fix');
assert.equal(llmMetrics[0].totalTokens, 15);

const sample = JSON.parse(await readFile(new URL('../fixtures/telemetry/route-evaluation.sample.json', import.meta.url), 'utf8'));
assert.ok(sample.length >= 15);
for (const entry of sample) {
  assert.equal(typeof entry.name, 'string');
  assert.equal(typeof entry.input, 'string');
  assert.ok(['new', 'continue', 'supplement', 'clarify', 'cancel'].includes(entry.expected.relation));
  assert.ok(['L0', 'L1', 'L2', 'L3'].includes(entry.expected.complexity));
}

const rendered = renderTelemetrySummary(summary, store.file);
assert.match(rendered, /requests: 2/);
assert.match(rendered, /p95 900ms/);
const originalLog = console.log;
let cliOutput = '';
console.log = (value) => { cliOutput += String(value); };
try { await runTelemetryCommand(root, ['report', `--file=${store.file}`, '--json']); }
finally { console.log = originalLog; }
assert.equal(JSON.parse(cliOutput).requests, 2);

console.log('telemetry tests passed');
