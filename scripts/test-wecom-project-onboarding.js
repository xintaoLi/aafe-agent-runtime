import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProjectOnboarding } from '../ai-bots/wecom/src/projectOnboarding.js';
import { createWorkspaceStore } from '../ai-bots/wecom/src/workspace.js';
import { initializeWeComProject } from '../ai-bots/wecom/src/project.js';
import { isE2eDevInitialized } from '../src/cli/e2eDevSetup.js';
import { handleWeComMessage } from '../ai-bots/wecom/src/handler.js';
import { createPendingStore } from '../ai-bots/wecom/src/pending.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-onboarding-'));
try {
  const entries = ['first', 'second', 'legacy'].map((id) => ({ id, cwd: path.join(root, id) }));
  for (const item of entries) {
    await mkdir(item.cwd);
    await writeFile(path.join(item.cwd, 'package.json'), JSON.stringify({ devDependencies: { vite: '*' } }));
  }
  await writeFile(path.join(root, 'wecom.local.json'), JSON.stringify({ workspaces: entries }));
  const config = { root };
  const workspaces = createWorkspaceStore({ root, workspaces: entries });
  let loaded = { workspaces: entries.slice(0, 1) };
  const live = createWorkspaceStore({ root, workspaces: loaded.workspaces }, { refreshConfig: async () => loaded });
  loaded = { workspaces: entries };
  assert.equal(await live.refresh(), true);
  assert.equal(live.list().length, 3);
  assert.equal(await live.refresh(), false);
  assert.equal(live.getActive().id, 'first');
  let calls = 0;
  const initialize = async (...args) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return initializeWeComProject(...args);
  };
  let service = createProjectOnboarding({ config, workspaces, initialize });
  assert.equal(await service.suggest(entries[0], 'user-a'), '');
  assert.equal(await service.suggest(entries[0], 'user-a'), '');
  assert.equal(calls, 0);
  await assert.rejects(access(path.join(entries[0].cwd, '.aafe.config.json')));
  const replies = await Promise.all([service.handle('初始化 E2E first'), service.handle('初始化 E2E first')]);
  assert.ok(replies.every((reply) => reply.includes('已初始化')));
  assert.equal(calls, 1);
  assert.equal(await isE2eDevInitialized(entries[0].cwd), true);
  const before = await readFile(path.join(entries[0].cwd, '.aafe.config.json'), 'utf8');
  service = createProjectOnboarding({ config, workspaces, initialize });
  assert.equal(await service.suggest(entries[0], 'user-b'), '');
  assert.match(await service.handle('初始化 E2E first'), /不重复/);
  assert.equal(calls, 1);
  assert.equal(await readFile(path.join(entries[0].cwd, '.aafe.config.json'), 'utf8'), before);
  assert.equal(await service.suggest(entries[1], 'user-a'), '');
  assert.match(await service.handle('暂不初始化 E2E second'), /不再自动询问/);
  service = createProjectOnboarding({ config, workspaces, initialize });
  assert.equal(await service.suggest(entries[1], 'user-c'), '');
  assert.equal(await isE2eDevInitialized(entries[1].cwd), false);
  const cardQuestion = await handleWeComMessage({ body: { msgid: 'switch-msg', chattype: 'single', from: { userid: 'owner' },
    text: { content: '切换 second' } } }, {
    projectOnboarding: createProjectOnboarding({ config, workspaces, initialize }), workspaces, config,
    manager: {}, replyAck: async () => 'stream', logger: { event() {} }
  });
  assert.equal(cardQuestion.action.type, 'workspace-switched');
  // Deferred projects do not add another question to normal workspace switching.
  assert.ok(!cardQuestion.reply.includes('是否初始化'));
  assert.equal(await service.handle('好的'), null, 'generic approval belongs to the agent, not project setup');
  await writeFile(path.join(entries[2].cwd, '.aafe.config.json'), JSON.stringify({ e2e: { devServer: { command: ['npm', 'run', 'dev:e2e'] } } }));
  assert.equal(await service.suggest(entries[2], 'user-a'), '', 'adopts existing custom setup');
  assert.match(await service.handle('初始化 E2E unknown'), /未找到/);

  const pending = createPendingStore();
  pending.set('unrelated', { type: 'task-feedback', taskId: 'existing-task' });
  const result = await handleWeComMessage({ body: { msgid: 'init-msg', chattype: 'single', from: { userid: 'owner' },
    text: { content: '初始化 E2E second' } } }, {
    projectOnboarding: service, pending,
    manager: new Proxy({}, { get() { throw new Error('must not call task manager'); } }),
    replyAck: async () => 'stream', logger: { event() {} }
  });
  assert.equal(result.action.type, 'project-e2e-init');
  assert.equal(calls, 2);
  assert.equal(pending.get('unrelated').taskId, 'existing-task');
  // Refuse to initialize a newly remapped path using an old confirmation target.
  await assert.rejects(initializeWeComProject(root, ['--workspace=first'], { expectedCwd: entries[1].cwd }), /changed-since-confirmation/);
  const failed = createProjectOnboarding({ config, workspaces, initialize: async () => { throw Error('permission'); } });
  await rm(path.join(entries[1].cwd, '.aafe'), { recursive: true });
  await rm(path.join(entries[1].cwd, 'aafe.e2e.vite.mjs'));
  assert.match(await failed.handle('初始化 E2E second'), /未完成/);
  assert.equal(await isE2eDevInitialized(entries[1].cwd), false);
  console.log('WeCom E2E onboarding passed: no pre-task prompt, explicit one-shot init, restart reuse, defer, legacy adoption and handler routing');
} finally { await rm(root, { recursive: true, force: true }); }
