import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { access, lstat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { devTemplates } from '../../cli/e2eDevSetup.js';

export function devServerUrl(config) {
  const url = new URL(config.devServer.url);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('e2e-dev-url-must-be-local-http');
  return url;
}

async function portOccupied(url) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname.replace(/[\[\]]/g, ''), port: Number(url.port || 80) });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}

export async function startE2eDevServer(config) {
  if (config.devServer?.enabled !== true) return { stop: async () => {} };
  const url = devServerUrl(config);
  // A per-task remote test address bypasses the optional local server.
  if (new URL(config.baseUrl).origin !== url.origin) return { stop: async () => {} };
  if (process.platform === 'win32') throw new Error('e2e-dev-process-groups-unsupported');
  const dev = config.devServer;
  if (!Array.isArray(dev.command) || !dev.command.length || dev.command.some((arg) => typeof arg !== 'string')) {
    throw new Error('e2e-dev-command-must-be-argv');
  }
  if (await portOccupied(url)) throw new Error('e2e-dev-port-in-use');
  const dependencyLink = await linkSourceDependencies(config);
  const adapterFiles = await materializeTaskAdapters(config);
  const readyUrl = new URL(dev.readyPath || '/', url);
  if (readyUrl.origin !== url.origin) throw new Error('e2e-dev-ready-origin-mismatch');
  const child = spawn(dev.command[0], dev.command.slice(1), {
    cwd: config.root, shell: false, detached: process.platform !== 'win32', stdio: 'ignore',
    env: { ...process.env, ...dev.env, AAFE_E2E_CONFIG_ROOT: config.configRoot,
      AAFE_E2E_DEV_URL: url.href, AAFE_E2E_PORT: url.port || '80',
      AAFE_E2E_PROXY_TARGET: dev.proxyTarget || '' }
  });
  let exited = false;
  child.once('error', () => { exited = true; });
  child.once('exit', () => { exited = true; });
  let stopped = false;
  const onInterrupt = () => { void stop().finally(() => process.exit(130)); };
  const onTerminate = () => { void stop().finally(() => process.exit(143)); };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    if (!child.pid) {
      await adapterFiles.cleanup();
      await dependencyLink.cleanup();
      return;
    }
    const signal = (name) => {
      try {
        if (process.platform === 'win32') child.kill(name);
        else process.kill(-child.pid, name);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    signal('SIGTERM');
    await delay(300);
    signal('SIGKILL');
    await adapterFiles.cleanup();
    await dependencyLink.cleanup();
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const timeout = Number(dev.timeoutMs) > 0 ? Math.min(Number(dev.timeoutMs), 600000) : 120000;
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (exited) throw new Error('e2e-dev-process-exited');
      try {
        const response = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))) });
        await response.body?.cancel();
        // A redirect, auth challenge or application-level 404 still proves the
        // local dev server is accepting HTTP. Playwright owns route/auth
        // validation; waiting only for 2xx turns valid SPA setups into a false
        // startup timeout.
        if (response.status < 500 && !exited) return { stop };
      } catch { /* Compilation may still be starting. */ }
      await delay(100);
    }
    throw new Error('e2e-dev-start-timeout');
  } catch (error) {
    await stop();
    throw error;
  }
}

async function materializeTaskAdapters(config) {
  const sourceRoot = path.resolve(config.configRoot ?? config.root);
  const executionRoot = path.resolve(config.root);
  if (sourceRoot === executionRoot) return { cleanup: async () => {} };
  const dev = config.devServer ?? {};
  const needed = new Set(['local.settings.e2e.aafe.cjs']);
  for (const arg of dev.command ?? []) {
    const name = path.basename(String(arg));
    if (/^aafe\.e2e\.(?:webpack\.cjs|vite\.mjs)$/.test(name)) needed.add(name);
  }
  const tool = dev.buildTool === 'vite' || needed.has('aafe.e2e.vite.mjs') ? 'vite' : 'webpack';
  const templates = devTemplates(tool);
  const created = [];
  for (const name of needed) {
    const content = templates[name];
    if (!content) continue;
    const target = path.join(executionRoot, name);
    try {
      await writeFile(target, content, { flag: 'wx' });
      created.push(target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return {
    async cleanup() {
      for (const file of created.reverse()) {
        try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  };
}

async function linkSourceDependencies(config) {
  const sourceRoot = path.resolve(config.configRoot ?? config.root);
  const executionRoot = path.resolve(config.root);
  if (sourceRoot === executionRoot) return { cleanup: async () => {} };
  const source = path.join(sourceRoot, 'node_modules');
  const target = path.join(executionRoot, 'node_modules');
  try { await access(source); } catch { throw new Error('e2e-dev-source-dependencies-missing'); }
  try {
    await lstat(target);
    return { cleanup: async () => {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await symlink(source, target, 'dir');
  return {
    async cleanup() {
      try { await unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
}
