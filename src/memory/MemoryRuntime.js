import { MemoryStore } from './MemoryStore.js';

export class MemoryRuntime {
  constructor(root, options = {}) {
    this.store = options.store ?? new MemoryStore(root, options);
    this.enabled = options.enabled ?? true;
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
