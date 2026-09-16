import { createExecutionInput } from '../protocol/execution.js';
import { ManagedProcessExecutor } from './ManagedProcessExecutor.js';

export class CliCodingAgentAdapter {
  constructor({ id, executable, args = [], capabilities = {}, processExecutor = new ManagedProcessExecutor(), envKeys = [] } = {}) {
    if (!id || !executable) throw new Error('cli-coding-agent-config-invalid');
    this.id = id; this.kind = id; this.type = 'coding-agent'; this.executable = executable;
    this.args = args; this.processExecutor = processExecutor; this.envKeys = envKeys;
    this.capabilities = { fileRead: true, fileWrite: true, shell: true, git: true, streaming: false,
      resume: false, cancellation: true, structuredOutput: false, mcp: false, ...capabilities };
  }
  async getCapabilities() { return { ...this.capabilities }; }
  async estimate(input) { const value = createExecutionInput(input); return { executionId: value.executionId, supported: true, estimatedInputTokens: value.limits.maxInputTokens }; }
  async execute(input, options = {}) {
    const value = createExecutionInput(input);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|SHELL|TMPDIR|LANG|LC_.*)$/i.test(key) || this.envKeys.includes(key)));
    const result = await this.processExecutor.run({ executionId: value.executionId, command: this.executable,
      args: typeof this.args === 'function' ? this.args(value, options) : this.args, cwd: options.cwd ?? value.workspace?.root ?? process.cwd(),
      env: { ...env, ...options.env }, input: value.instruction, timeoutMs: value.limits.timeoutMs });
    return { status: result.cancelled ? 'cancelled' : result.exitCode === 0 ? 'completed' : 'error', text: result.stdout, diagnostic: result.stderr, ...result };
  }
  cancel(executionId) { return Promise.resolve({ cancelled: this.processExecutor.cancel(executionId) }); }
  closeAll() { this.processExecutor.closeAll(); return Promise.resolve(); }
}

export function createClaudeCodeAdapter(options = {}) {
  return new CliCodingAgentAdapter({ id: 'claude-code', executable: options.executable ?? 'claude',
    args: options.args ?? ['--print'], envKeys: ['ANTHROPIC_API_KEY'], capabilities: { mcp: true }, ...options });
}
