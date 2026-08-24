import { MemoryStore } from './MemoryStore.js';
import { resolveMemoryConfig } from './config.js';
import { createMemoryRemoteAdapter } from './MemoryRemoteAdapter.js';

export class MemoryRuntime {
  constructor(root, options = {}) {
    const config = resolveMemoryConfig(root, options.config ?? options);
    this.store = options.store ?? new MemoryStore(root, { ...options, memoryDir: config.memoryDir });
    this.enabled = options.enabled ?? config.enabled;
    this.remote = config.remote;
    this.remoteAdapter = options.remoteAdapter ?? null;
  }

  async init() {
    if (!this.enabled) return;
    await this.store.init();
  }

  async learn(entry) {
    if (!this.enabled) return null;
    if (!entry?.content) return null;
    return this.store.add(entry);
  }

  async recall(query, options = {}) {
    if (!this.enabled) return '';
    const context = await this.store.context(query, options.limit ?? 8);
    if (context || options.strict) return context;
    return this.store.context('', options.limit ?? 8);
  }

  async remoteStatus() {
    if (!this.remote.enabled) return { enabled: false, configured: false, reason: 'memory-remote-disabled' };
    const adapter = createMemoryRemoteAdapter(this.remote, { adapter: this.remoteAdapter });
    return { enabled: true, configured: true, remote: this.remote, health: await adapter.health() };
  }

  async sync({ direction = 'push', cursor = null } = {}) {
    if (!this.remote.enabled) throw new Error('Memory remote sync is disabled; configure memory.remote.enabled and memory.remote.url first');
    const adapter = createMemoryRemoteAdapter(this.remote, { adapter: this.remoteAdapter });
    if (direction === 'pull') return adapter.pull(cursor);
    if (direction !== 'push') throw new Error(`Unsupported memory sync direction: ${direction}`);
    await this.init();
    const records = await this.store.readRecords();
    return adapter.push({ records }, { projectId: this.remote.projectId, cursor, source: 'aafe-memory' });
  }

  async recordExecution(context) {
    if (!this.enabled) return null;
    const trace = context.trace ?? [];
    const failed = trace.filter((item) => item.status === 'fail');
    if (!failed.length) return null;
    return this.learn({
      type: 'learning',
      title: `Pipeline failure: ${failed.map((item) => item.name).join(', ')}`,
      content: `Task type: ${context.input?.taskType ?? 'unknown'}\nFailed steps: ${failed.map((item) => `${item.name}:${item.status}`).join(', ')}`,
      tags: ['pipeline', 'failure'],
      source: 'runtime'
    });
  }
}
