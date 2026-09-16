import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { initializeE2eDev } from '../src/cli/e2eDevSetup.js';
import { loadE2eConfig } from '../src/testing/e2e/config.js';
import { withE2eConfigRoots } from '../src/testing/e2e/configContext.js';
import { startE2eDevServer } from '../src/testing/e2e/devServer.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-dev-test-'));
const reserve = net.createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const url = `http://127.0.0.1:${port}`;
try {
  await writeFile(path.join(root, '.aafe.config.json'), JSON.stringify({ e2e: { baseUrl: 'https://remote.example.com' } }));
  await writeFile(path.join(root, 'local.settings.e2e.js'), 'existing custom settings');
  assert.equal((await initializeE2eDev(root)).created.length, 2);
  assert.equal((await initializeE2eDev(root)).created.length, 0);
  assert.equal(await readFile(path.join(root, 'local.settings.e2e.js'), 'utf8'), 'existing custom settings');
  const project = JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
  assert.equal(project.e2e.devServer.enabled, false);
  project.e2e.devServer = { ...project.e2e.devServer, enabled: true, url, proxyTarget: 'https://backend.example.com',
    command: [process.execPath, '-e', `require('http').createServer((q,s)=>s.end('ready')).listen(process.env.AAFE_E2E_PORT, '127.0.0.1')`],
    timeoutMs: 2000 };
  project.e2e.auth = { mode: 'none' };
  await writeFile(path.join(root, '.aafe.config.json'), JSON.stringify(project));
  await initializeE2eDev(root);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8')), project);
  const settings = createRequire(import.meta.url)(path.join(root, 'local.settings.e2e.aafe.cjs'));
  assert.equal(settings.port, port);
  assert.equal(settings.proxy[0].secure, true);
  await writeFile(path.join(root, 'webpack.config.js'), 'module.exports = async () => ({ mode: "development", devServer: { open: true } });');
  const webpackWrapper = createRequire(import.meta.url)(path.join(root, 'aafe.e2e.webpack.cjs'));
  const webpackConfig = await webpackWrapper({}, {});
  assert.equal(webpackConfig.mode, 'development');
  assert.equal(webpackConfig.devServer.open, false);
  assert.equal(webpackConfig.devServer.port, port);
  assert.equal(webpackConfig.devServer.proxy[0].target, 'https://backend.example.com/');
  const headers = {};
  const proxyReq = { setHeader: (key, value) => { headers[key] = value; }, removeHeader: (key) => { delete headers[key]; } };
  settings.proxy[0].onProxyReq(proxyReq, { headers: { cookie: 'bk_token=test' } });
  assert.equal(headers.Cookie, 'bk_token=test');
  settings.proxy[0].onProxyReq(proxyReq, { headers: {} });
  assert.equal(headers.Cookie, undefined, 'no cookie leaks between requests');
  const config = await loadE2eConfig(root);
  assert.equal(config.baseUrl, url);
  await withE2eConfigRoots(root, ['--dev-port=41001'], async () => {
    assert.equal(new URL((await loadE2eConfig(root)).baseUrl).port, '41001');
  });
  const server = await startE2eDevServer(config);
  try {
    assert.equal(await (await fetch(url)).text(), 'ready');
    await assert.rejects(startE2eDevServer(config), /port-in-use/);
  } finally { await server.stop(); }
  await assert.rejects(fetch(url));
  const notFoundConfig = { ...config, devServer: { ...config.devServer,
    command: [process.execPath, '-e', `require('http').createServer((q,s)=>{s.statusCode=404;s.end('spa fallback')}).listen(process.env.AAFE_E2E_PORT, '127.0.0.1')`] } };
  const notFoundServer = await startE2eDevServer(notFoundConfig);
  await notFoundServer.stop();
  await assert.rejects(startE2eDevServer({ ...config, devServer: { ...config.devServer, command: [process.execPath, '-e', 'process.exit(1)'] } }), /process-exited/);
  await assert.rejects(startE2eDevServer({ ...config, devServer: { ...config.devServer, command: ['/aafe-nonexistent-command'] } }), /process-exited/);
  await assert.rejects(startE2eDevServer({ ...config, devServer: { ...config.devServer, command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 } }), /start-timeout/);
  const bypass = await startE2eDevServer({ ...config, baseUrl: 'https://explicit.example.com' });
  await bypass.stop();
  const noExplicitAuthCheck = await startE2eDevServer({ ...config, authMode: 'reuse', auth: {} });
  await noExplicitAuthCheck.stop();
  const taskRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-dev-worktree-'));
  await mkdir(path.join(root, 'node_modules'));
  const taskConfig = { ...config, root: taskRoot, configRoot: root, devServer: { ...config.devServer,
    command: [process.execPath, '-e', "const s=require('./local.settings.e2e.aafe.cjs'); require('http').createServer((q,r)=>r.end(String(s.port))).listen(process.env.AAFE_E2E_PORT, '127.0.0.1')"] } };
  const taskServer = await startE2eDevServer(taskConfig);
  try {
    await access(path.join(taskRoot, 'local.settings.e2e.aafe.cjs'));
    assert.equal(await (await fetch(url)).text(), String(port));
  } finally {
    await taskServer.stop();
    await assert.rejects(access(path.join(taskRoot, 'local.settings.e2e.aafe.cjs')), /ENOENT/);
    await rm(taskRoot, { recursive: true, force: true });
  }
  await assert.rejects(startE2eDevServer({ ...config, devServer: { ...config.devServer, url: 'https://remote.example.com' } }), /local-http/);
  console.log('E2E dev initialization, cookie forwarding, scoped ports, startup/failure/cleanup tests passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
