import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MEMORY_PATH = '.aafe-memory';

export function resolveMemoryConfig(root, config = {}) {
  const memory = config.memory ?? config ?? {};
  const configuredPath = String(memory.path ?? DEFAULT_MEMORY_PATH);
  const remote = memory.remote ?? {};
  return {
    enabled: memory.enabled !== false,
    memoryDir: path.isAbsolute(configuredPath) ? configuredPath : path.join(root, configuredPath),
    path: configuredPath,
    remote: {
      enabled: remote.enabled === true,
      url: remote.url ?? null,
      projectId: remote.projectId ?? null,
      tokenEnv: remote.tokenEnv ?? null,
      timeoutMs: Number.isFinite(remote.timeoutMs) ? remote.timeoutMs : 15000
    }
  };
}

export async function loadMemoryConfig(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
    return resolveMemoryConfig(root, config);
  } catch {
    return resolveMemoryConfig(root);
  }
}
