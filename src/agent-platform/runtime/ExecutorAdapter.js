import { createExecutionInput, normalizeExecutorCapabilities } from '../protocol/execution.js';

const ADAPTER = Symbol.for('aafe.executor-adapter');

export class ExecutorAdapter {
  constructor(runtime, { id = runtime?.kind, type = 'coding-agent', capabilities = null } = {}) {
    if (!runtime || typeof runtime.run !== 'function') throw new Error('executor-runtime-invalid');
    this.raw = runtime;
    this.id = id ?? 'unknown';
    this.kind = this.id;
    this.type = type;
    this[ADAPTER] = true;
    this.capabilities = normalizeExecutorCapabilities(capabilities ?? capabilitiesFor(this.id, runtime));
  }
  async getCapabilities() { return { ...this.capabilities }; }
  async estimate(input) {
    const normalized = createExecutionInput(input);
    return { executionId: normalized.executionId, estimatedInputTokens: normalized.limits.maxInputTokens, supported: true };
  }
  execute(input, options = {}) {
    const normalized = createExecutionInput(input);
    return this.raw.run(options.task ?? normalized.taskSnapshot, normalized.instruction, {
      ...options, executionId: normalized.executionId,
      tokenBudget: options.tokenBudget ?? normalized.limits.maxInputTokens,
      timeoutMs: options.timeoutMs ?? normalized.limits.timeoutMs
    });
  }
  recover(task, options = {}) {
    if (typeof this.raw.recover !== 'function') throw new Error(`executor-recover-unsupported:${this.id}`);
    return this.raw.recover(task, options);
  }
  cancel(task, options = {}) {
    return typeof this.raw.cancel === 'function' ? this.raw.cancel(task, options) : Promise.resolve({ cancelled: false, reason: 'unsupported' });
  }
  close(taskId) { return typeof this.raw.close === 'function' ? this.raw.close(taskId) : Promise.resolve(); }
  closeAll() { return typeof this.raw.closeAll === 'function' ? this.raw.closeAll() : Promise.resolve(); }
}

export function asExecutorAdapter(runtime, options = {}) { return runtime?.[ADAPTER] ? runtime : new ExecutorAdapter(runtime, options); }

function capabilitiesFor(kind, runtime) {
  const coding = ['cursor', 'codex'].includes(kind);
  return { fileRead: coding, fileWrite: coding, shell: coding, git: coding, mcp: coding,
    streaming: Boolean(runtime?.onEvent), resume: typeof runtime?.recover === 'function',
    cancellation: typeof runtime?.cancel === 'function', structuredOutput: kind === 'codex' };
}
