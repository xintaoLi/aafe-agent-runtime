import path from 'node:path';
import { InvocationMetricStore, summarizeInvocations } from '../telemetry/index.js';

export async function runTelemetryCommand(root, args = []) {
  const subcommand = args.find((arg) => !arg.startsWith('--')) ?? 'report';
  if (!['report', 'summary'].includes(subcommand)) {
    throw new Error('Usage: aafe telemetry report [--file=<jsonl>] [--json]');
  }
  const fileArg = args.find((arg) => arg.startsWith('--file='));
  const file = fileArg ? path.resolve(root, fileArg.slice('--file='.length)) : null;
  const store = new InvocationMetricStore({ root, file });
  const metrics = await store.list();
  const summary = summarizeInvocations(metrics);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ file: store.file, ...summary }, null, 2));
    return summary;
  }
  console.log(renderTelemetrySummary(summary, store.file));
  return summary;
}

export function renderTelemetrySummary(summary, file = '') {
  const percent = summary.successRate === null ? '-' : `${(summary.successRate * 100).toFixed(1)}%`;
  const number = (value, digits = 0) => value === null ? '-' : Number(value).toFixed(digits);
  return [
    'AAFE invocation baseline',
    `file: ${file}`,
    `requests: ${summary.requests} (success ${summary.successes}, failure ${summary.failures}, rate ${percent})`,
    `tokens: total ${number(summary.totalTokens)}, average ${number(summary.averageTokens, 1)}`,
    `estimated cost: ${number(summary.totalEstimatedCost, 6)}`,
    `latency: p50 ${number(summary.latencyP50Ms)}ms, p95 ${number(summary.latencyP95Ms)}ms`,
    `providers: ${formatCounts(summary.byProvider)}`,
    `models: ${formatCounts(summary.byModel)}`,
    `routes: ${formatCounts(summary.byRoute)}`,
    `errors: ${formatCounts(summary.errors)}`
  ].join('\n');
}

function formatCounts(value) {
  const entries = Object.entries(value ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, count]) => `${key}=${count}`).join(', ') : '-';
}
