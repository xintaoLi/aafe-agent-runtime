import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { detectE2eBuild } from './e2eBuildDetection.js';

export const DEFAULT_E2E_DEV_SERVER = Object.freeze({
  enabled: false,
  command: ['npx', '--no-install', 'webpack', 'serve', '--config', 'aafe.e2e.webpack.cjs'],
  url: 'http://127.0.0.1:8011',
  timeoutMs: 120000,
  proxyTarget: '',
  proxyPaths: ['/api'],
  secure: true,
  webpackConfig: 'webpack.config.js',
  env: {}
});

export async function isE2eDevInitialized(root) {
  try {
    const marker = JSON.parse(await readFile(path.join(root, '.aafe/e2e/project-init.json'), 'utf8'));
    if (marker.version === 1 && marker.initialized === true) return true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config;
  try { config = JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const dev = config.e2e?.devServer;
  if (!dev || !Array.isArray(dev.command) || !dev.command.length) return false;
  // Adopt previous installations and hand-configured dev scripts without reinitializing.
  const adapter = dev.command.find((arg) => /^aafe\.e2e\.(?:vite\.mjs|webpack\.cjs)$/.test(arg));
  if (!adapter) return true;
  try {
    await access(path.join(root, adapter));
    await access(path.join(root, 'local.settings.e2e.aafe.cjs'));
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Seed project-owned files, even on update --force. Never execute local JS here.
export async function initializeE2eDev(root, { build = null, defaults = {}, dryRun = false } = {}) {
  const configPath = path.join(root, '.aafe.config.json');
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; config = {}; }
  build ??= await detectE2eBuild(root);
  const tool = build.tool ?? 'webpack';
  const generated = { ...DEFAULT_E2E_DEV_SERVER, ...defaults,
    buildTool: tool,
    ...(build.command ? { command: defaults.command ?? build.command } : {}),
    ...(tool === 'vite' ? { viteConfig: build.configFile, url: defaults.url ?? 'http://127.0.0.1:5173' } : {}),
    ...(build.tool === 'webpack' ? { webpackConfig: build.configFile } : {}) };
  const existing = config.e2e?.devServer;
  const untouchedSeed = existing && Object.entries(DEFAULT_E2E_DEV_SERVER).every(([key, value]) =>
    JSON.stringify(existing[key]) === JSON.stringify(value))
    && Object.keys(existing).every((key) => key in DEFAULT_E2E_DEV_SERVER || key === 'buildTool');
  if (!existing || untouchedSeed) {
    config.e2e = { ...config.e2e, devServer: generated };
  }
  const routerModeAdded = !config.e2e?.routerMode && Boolean(build.routerMode);
  if (routerModeAdded) config.e2e = { ...config.e2e, routerMode: build.routerMode };
  if (!dryRun && ((!existing || untouchedSeed) || routerModeAdded)) {
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }
  const created = [];
  const preserved = [];
  for (const [name, content] of Object.entries(devTemplates(tool))) {
    try {
      if (dryRun) {
        try { await readFile(path.join(root, name)); preserved.push(name); }
        catch (error) { if (error.code !== 'ENOENT') throw error; created.push(name); }
        continue;
      }
      await writeFile(path.join(root, name), content, { flag: 'wx' });
      created.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      preserved.push(name);
    }
  }
  if (!dryRun) {
    await mkdir(path.join(root, '.aafe/e2e'), { recursive: true });
    try {
      await writeFile(path.join(root, '.aafe/e2e/project-init.json'),
        JSON.stringify({ version: 1, initialized: true, tool, initializedAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return { created, preserved, dryRun, build, enabled: config.e2e.devServer.enabled === true,
    warnings: [...(build.warnings ?? []), ...(config.e2e.devServer.buildTool && config.e2e.devServer.buildTool !== tool
      ? ['Existing devServer buildTool differs; configuration was preserved.'] : [])] };
}

export function devTemplates(tool = 'webpack') {
  const templates = {
    'local.settings.e2e.aafe.cjs': `// Project-owned AAFE E2E settings. Never reads .cookie or local.settings.js.
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.AAFE_E2E_CONFIG_ROOT || __dirname;
const config = JSON.parse(fs.readFileSync(path.join(root, '.aafe.config.json'), 'utf8')).e2e?.devServer || {};
const url = new URL(process.env.AAFE_E2E_DEV_URL || config.url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('E2E dev URL must be local HTTP');
const target = new URL(config.proxyTarget);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid E2E proxy target');
function inheritRequestCookie(proxyReq, req) {
  if (req.headers.cookie) proxyReq.setHeader('Cookie', req.headers.cookie);
  else proxyReq.removeHeader('Cookie');
}
const proxy = {
  context: config.proxyPaths || ['/api'], target: target.href,
  changeOrigin: true, secure: config.secure !== false,
  onProxyReq: inheritRequestCookie
};
module.exports = {
  host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/[\\[\\]]/g, ''),
  port: Number(url.port || 80), devProxyUrl: target.href,
  loginHost: new URL('/login', target).href, proxy: [proxy]
};
`,
    'aafe.e2e.webpack.cjs': `// Project-owned wrapper for standard webpack config objects/functions.
// Framework-specific config factories (e.g. bkmonitor-cli) should use their existing dev:e2e script instead.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
module.exports = async (env, argv) => {
  const root = process.env.AAFE_E2E_CONFIG_ROOT || __dirname;
  const dev = JSON.parse(fs.readFileSync(path.join(root, '.aafe.config.json'), 'utf8')).e2e.devServer;
  const filename = dev.webpackConfig === null ? null : path.resolve(__dirname, dev.webpackConfig || 'webpack.config.js');
  if (filename === __filename) throw new Error('E2E wrapper cannot load itself');
  const loaded = filename ? await import(pathToFileURL(filename).href) : { default: {} };
  let config = loaded.default || loaded;
  if (typeof config === 'function') config = await config(env, argv);
  const settings = require('./local.settings.e2e.aafe.cjs');
  const apply = (item) => ({ ...item, devServer: { ...item.devServer,
    host: settings.host, port: settings.port, open: false,
    proxy: settings.proxy, allowedHosts: [settings.host, 'localhost'], historyApiFallback: true
  } });
  return Array.isArray(config) ? config.map(apply) : apply(config);
};
`,
    'aafe.e2e.vite.mjs': `// Project-owned Vite E2E overlay. Load existing plugins, aliases and transforms.
import { loadConfigFromFile } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import settings from './local.settings.e2e.aafe.cjs';
const checkout = path.dirname(fileURLToPath(import.meta.url));
export default async (env) => {
  const source = process.env.AAFE_E2E_CONFIG_ROOT || checkout;
  const dev = JSON.parse(fs.readFileSync(path.join(source, '.aafe.config.json'), 'utf8')).e2e.devServer;
  const filename = dev.viteConfig ? path.resolve(checkout, dev.viteConfig) : undefined;
  if (filename === fileURLToPath(import.meta.url)) throw new Error('E2E wrapper cannot load itself');
  const loaded = await loadConfigFromFile(env, filename, checkout);
  if (filename && !loaded) throw new Error('Existing Vite config could not be loaded');
  const base = loaded?.config || {};
  const proxy = Object.fromEntries(settings.proxy[0].context.map((prefix) => [prefix, {
    target: settings.devProxyUrl, changeOrigin: true, secure: settings.proxy[0].secure,
    configure(server) { server.on('proxyReq', settings.proxy[0].onProxyReq); }
  }]));
  // Replace proxy map: never merge everyday development cookies/targets into E2E.
  return { ...base, server: { ...base.server, host: settings.host, port: settings.port,
    strictPort: true, open: false, https: false, proxy, allowedHosts: [settings.host, 'localhost'] } };
};
`
  };
  if (tool !== 'webpack') delete templates['aafe.e2e.webpack.cjs'];
  if (tool !== 'vite') delete templates['aafe.e2e.vite.mjs'];
  return templates;
}
