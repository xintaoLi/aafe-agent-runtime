export class MemoryRemoteAdapter {
  async health() {
    throw new Error('Memory remote adapter is not configured');
  }

  async push(_snapshot, _metadata) {
    throw new Error('Memory remote adapter is not configured');
  }

  async pull(_cursor) {
    throw new Error('Memory remote adapter is not configured');
  }
}

/**
 * Boundary for the future Memory MCP. The runtime does not implement transport:
 * an MCP-backed adapter can provide these methods without changing local memory.
 */
export function createMemoryRemoteAdapter(remote, { adapter = null } = {}) {
  if (!remote?.enabled) return null;
  if (adapter) return adapter;
  throw new Error('Memory remote is enabled but no MemoryRemoteAdapter is registered; configure the future MCP adapter before sync/upload');
}
