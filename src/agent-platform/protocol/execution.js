import { randomUUID } from 'node:crypto';

export const EXECUTION_PROTOCOL_VERSION = 1;
export const EXECUTOR_TYPES = Object.freeze(['llm', 'coding-agent', 'workflow']);
export const EXECUTION_EVENT_TYPES = Object.freeze([
  'execution.started', 'thinking.delta', 'message.delta', 'tool.started',
  'tool.completed', 'file.changed', 'approval.required', 'usage.updated',
  'execution.completed', 'execution.failed', 'execution.cancelled'
]);

export function createExecutionInput(partial = {}) {
  const input = {
    version: EXECUTION_PROTOCOL_VERSION,
    executionId: id(partial.executionId) ?? randomUUID(),
    taskId: requiredId(partial.taskId, 'execution-task-id-missing'),
    instruction: String(partial.instruction ?? ''),
    taskSnapshot: clone(partial.taskSnapshot ?? {}),
    contextItems: clone(Array.isArray(partial.contextItems) ? partial.contextItems : []),
    workspace: clone(partial.workspace ?? null),
    capabilities: uniqueStrings(partial.capabilities),
    limits: normalizeLimits(partial.limits)
  };
  if (!input.instruction.trim()) throw new Error('execution-instruction-missing');
  return input;
}

export function createExecutionEvent(type, partial = {}) {
  if (!EXECUTION_EVENT_TYPES.includes(type)) throw new Error(`execution-event-unknown:${type}`);
  return {
    version: EXECUTION_PROTOCOL_VERSION,
    type,
    executionId: requiredId(partial.executionId, 'execution-event-id-missing'),
    taskId: id(partial.taskId),
    sequence: Number.isInteger(partial.sequence) && partial.sequence >= 0 ? partial.sequence : null,
    createdAt: validDate(partial.createdAt).toISOString(),
    payload: clone(partial.payload ?? {})
  };
}

export function normalizeExecutorCapabilities(value = {}) {
  return {
    fileRead: value.fileRead === true, fileWrite: value.fileWrite === true,
    shell: value.shell === true, git: value.git === true, mcp: value.mcp === true,
    streaming: value.streaming === true, resume: value.resume === true,
    cancellation: value.cancellation === true, structuredOutput: value.structuredOutput === true
  };
}

export function normalizeRuntimeExecutionEvent(event = {}, { executionId, sequence = null } = {}) {
  const type = String(event.type ?? '');
  const payload = event.payload ?? {};
  let normalizedType = null;
  let normalizedPayload = payload;
  if (/\.(?:run\.)?started$/.test(type)) normalizedType = 'execution.started';
  else if (/\.run\.completed$/.test(type)) normalizedType = 'usage.updated';
  else if (type === 'cursor.message' || type === 'codex.message') {
    if (payload.thinking && !payload.text) normalizedType = 'thinking.delta';
    else if (Array.isArray(payload.tools) && payload.tools.length) {
      normalizedType = 'tool.started';
      normalizedPayload = { tools: payload.tools };
    } else if (payload.text) normalizedType = 'message.delta';
  } else if (type === 'task.finished') normalizedType = 'execution.completed';
  else if (type === 'task.failed' || type === 'task.blocked') normalizedType = 'execution.failed';
  else if (type === 'task.cancelled') normalizedType = 'execution.cancelled';
  if (!normalizedType || !executionId) return null;
  return createExecutionEvent(normalizedType, {
    executionId, taskId: event.taskId, sequence,
    payload: { ...clone(normalizedPayload), providerEventType: type }
  });
}

function normalizeLimits(value = {}) {
  return {
    maxInputTokens: positive(value.maxInputTokens, 12000),
    maxOutputTokens: positive(value.maxOutputTokens, 4096),
    maxIterations: positive(value.maxIterations, 20),
    timeoutMs: positive(value.timeoutMs, 30 * 60_000),
    maxCost: nullablePositive(value.maxCost)
  };
}
function positive(value, fallback) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback; }
function nullablePositive(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function requiredId(value, error) { const result = id(value); if (!result) throw new Error(error); return result; }
function id(value) { const text = typeof value === 'string' ? value.trim() : ''; return text && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(text) ? text : null; }
function validDate(value) { const date = value ? new Date(value) : new Date(); if (!Number.isFinite(date.getTime())) throw new Error('execution-event-date-invalid'); return date; }
function uniqueStrings(value) { return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))]; }
function clone(value) { return value == null ? value : structuredClone(value); }
