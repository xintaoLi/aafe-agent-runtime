import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeWeComProject } from '../ai-bots/wecom/src/project.js';
import { detectE2eBuild } from '../src/cli/e2eBuildDetection.js';
import { parseBotArgs } from '../src/cli/bot.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-project-init-'));
const json = async (file, data) => writeFile(file, JSON.stringify(data));
try {
  for (const name of ['vite-app', 'webpack-app', 'custom-app']) await mkdir(path.join(root, name));
  await json(path.join(root, 'vite-app/package.json'), { type: 'module', devDependencies: { vite: '*' }, scripts: { dev: 'vite --config vite.config.ts' } });
  await writeFile(path.join(root, 'vite-app/vite.config.ts'), 'throw new Error("must not execute during init")');
  await json(path.join(root, 'webpack-app/package.json'), { devDependencies: { webpack: '*' } });
  await writeFile(path.join(root, 'webpack-app/webpack.config.cjs'), 'throw new Error("must not execute during init")');
  await json(path.join(root, 'custom-app/package.json'), { scripts: { 'dev:e2e': 'bkmonitor-cli dev' } });
  const workspaces = ['vite-app', 'webpack-app', 'custom-app'].map((id) => ({ id, cwd: './' + id,
    e2eInit: { proxyTarget: `https://${id}.example.com`, proxyPaths: ['/api', '/rest'] } }));
  await json(path.join(root, 'wecom.local.json'), { workspaces }); // No Bot secret or model key.
  const args = (id, ...extra) => ['--workspace=' + id, ...extra];
  const dry = await initializeWeComProject(root, args('vite-app', '--dry-run'));
  const cli = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/aafe.js', import.meta.url)),
    'bot', 'project', 'init', '--wecom', '--root=' + root, '--workspace=vite-app', '--dry-run']);
  assert.equal(JSON.parse(cli.stdout).build.tool, 'vite');
  assert.ok(dry.created.includes('aafe.e2e.vite.mjs'));
  await assert.rejects(access(path.join(root, 'vite-app/.aafe.config.json')));
  await assert.rejects(access(path.join(root, 'vite-app/aafe.e2e.vite.mjs')));
  const vite = await initializeWeComProject(root, args('vite-app'));
  assert.equal(vite.build.tool, 'vite');
  assert.equal(vite.enabled, false);
  assert.ok(!vite.created.includes('aafe.e2e.webpack.cjs'));
  const configPath = path.join(root, 'vite-app/.aafe.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.e2e.devServer.proxyTarget, 'https://vite-app.example.com');
  assert.equal(config.e2e.devServer.viteConfig, 'vite.config.ts');
  assert.ok(config.e2e.devServer.command.includes('vite'));
  const before = await readFile(configPath, 'utf8');
  assert.equal((await initializeWeComProject(root, args('vite-app'))).created.length, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
  await assert.rejects(access(path.join(root, 'webpack-app/.aafe.config.json')), 'no cross-project writes');
  const webpack = await initializeWeComProject(root, args('webpack-app'));
  assert.equal(webpack.build.configFile, 'webpack.config.cjs');
  const custom = await initializeWeComProject(root, args('custom-app'));
  assert.equal(custom.build.tool, 'custom');
  assert.ok(custom.warnings.length);
  assert.deepEqual(custom.created, ['local.settings.e2e.aafe.cjs']);
  await assert.rejects(initializeWeComProject(root, []), /requires-workspace/);
  await assert.rejects(initializeWeComProject(root, args('missing')), /not-found/);
  await assert.rejects(initializeWeComProject(root, args('vite-app', '--tool=bad')), /invalid/);
  await assert.rejects(initializeWeComProject(root, args('vite-app', '--build-config=../x')), /project-relative/);
  await json(path.join(root, 'webpack-app/package.json'), { devDependencies: { webpack: '*', vite: '*' } });
  assert.equal((await detectE2eBuild(path.join(root, 'webpack-app'))).reason, 'ambiguous-build-tool');
  await json(path.join(root, 'wecom.local.json'), { workspaces: [{ id: 'remote', repository: 'owner/repo' }] });
  await assert.rejects(initializeWeComProject(root, args('remote')), /requires-local-checkout/);
  assert.equal(parseBotArgs(['project', 'init', '--wecom', '--workspace=app']).project, true);

  // Mock only Vite's config loader: validate generated adapter preserves its result
  // and wires the proxy callback without installing/building a user's project.
  const fixture = path.join(root, 'vite-app/node_modules/vite');
  await mkdir(fixture, { recursive: true });
  await json(path.join(fixture, 'package.json'), { type: 'module', exports: './index.js' });
  await writeFile(path.join(fixture, 'index.js'), `export async function loadConfigFromFile(env, filename) {
    if (!filename.endsWith('vite.config.ts')) throw Error('wrong config');
    return { config: { plugins: ['original-plugin'], resolve: { alias: { '@': '/src' } }, server: { proxy: { '/unsafe': 'https://old.example.com' }, open: true } } };
  }`);
  const adapter = (await import(pathToFileURL(path.join(root, 'vite-app/aafe.e2e.vite.mjs')))).default;
  const built = await adapter({ command: 'serve', mode: 'development' });
  assert.deepEqual(built.plugins, ['original-plugin']);
  assert.equal(built.resolve.alias['@'], '/src');
  assert.equal(built.server.strictPort, true);
  assert.equal(built.server.proxy['/unsafe'], undefined);
  let callback;
  built.server.proxy['/api'].configure({ on(event, fn) { assert.equal(event, 'proxyReq'); callback = fn; } });
  let cookie;
  const req = { setHeader(key, value) { cookie = value; }, removeHeader() { cookie = undefined; } };
  callback(req, { headers: { cookie: 'bk_token=fixture' } });
  assert.equal(cookie, 'bk_token=fixture');
  callback(req, { headers: {} });
  assert.equal(cookie, undefined);
  console.log('WeCom project init passed: Vite/Webpack/custom detection, dry-run, preservation, isolation and mocked Vite adapter');
} finally { await rm(root, { recursive: true, force: true }); }
