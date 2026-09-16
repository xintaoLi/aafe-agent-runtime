import { spawn } from 'node:child_process';

export class ManagedProcessExecutor {
  constructor({ spawnProcess = spawn } = {}) { this.spawnProcess = spawnProcess; this.active = new Map(); }

  run({ executionId, command, args = [], cwd = process.cwd(), env = {}, input = '', timeoutMs = 30 * 60_000, maxOutputBytes = 2_000_000 }) {
    if (!executionId || !command) throw new Error('managed-process-input-invalid');
    if (this.active.has(executionId)) throw new Error(`managed-process-already-running:${executionId}`);
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      const state = { child, cancelled: false, timer: null };
      this.active.set(executionId, state);
      let stdout = '', stderr = '', settled = false;
      const finish = (error, code = null, signal = null) => {
        if (settled) return; settled = true; clearTimeout(state.timer); this.active.delete(executionId);
        if (error) reject(error); else resolve({ executionId, pid: child.pid, exitCode: code, signal, stdout, stderr, cancelled: state.cancelled });
      };
      const collect = (target, chunk) => {
        const next = target + chunk.toString();
        if (Buffer.byteLength(next) > maxOutputBytes) { this.cancel(executionId); finish(new Error('managed-process-output-limit')); return target; }
        return next;
      };
      child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
      child.on('error', (error) => finish(error.code === 'ENOENT' ? new Error(`managed-process-command-not-found:${command}`) : error));
      child.on('close', (code, signal) => finish(null, code, signal));
      state.timer = setTimeout(() => { this.cancel(executionId); finish(new Error('managed-process-timeout')); }, timeoutMs);
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }

  cancel(executionId) {
    const state = this.active.get(executionId);
    if (!state) return false;
    state.cancelled = true;
    try { process.platform !== 'win32' && state.child.pid ? process.kill(-state.child.pid, 'SIGTERM') : state.child.kill('SIGTERM'); } catch { state.child.kill?.('SIGTERM'); }
    return true;
  }
  closeAll() { for (const id of this.active.keys()) this.cancel(id); }
}
