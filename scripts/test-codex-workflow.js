/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */



import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { resolveCodexWorkflow, codexWorkflowPrompt, codexToolReceipt, verifyCodexWorkflow } from '../src/agent-platform/runtime/CodexWorkflow.js';
import { CodexTaskRuntime } from '../src/agent-platform/runtime/CodexTaskRuntime.js';
import { TaskManager } from '../src/agent-platform/tasks/TaskManager.js';
import { runRepoPrCommand } from '../src/cli/repoSubmit.js';

const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-workflow-test-'));
const repo = path.join(root, 'repo'), install = path.join(repo, 'app');
const git = async (args, cwd = repo) => (await exec('git', args, { cwd })).stdout.trim();
const entryId = '1010158081137994989', workspaceId = '10158081';
const requirement = 'https://tapd.woa.com/tapd_fe/' + workspaceId + '/story/detail/' + entryId;
const gate = (name, decision = 'skip', receipt = '') => ({
  gate: name, decision, status: decision === 'skip' ? 'skipped' : 'done', reason: 'fixture decision',
  authorization: '', receipt, evidence: ['fixture evidence']
});
const allSkipped = ['commit', 'pr', 'tapd_backfill'].map((name) => gate(name));
const item = (operation, args, output, id = operation) => ({
  id, type: 'mcp_tool_call', status: 'completed', tool: 'proxy_execute_tool',
  arguments: { tool_name: operation, tool_args: args },
  result: { content: [{ type: 'text', text: JSON.stringify({ data: output }) }] }
});
try {
  await mkdir(install, { recursive: true });
  await git(['init', '-b', 'master']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(path.join(repo, 'change.txt'), 'base');
  await git(['add', 'change.txt']);
  await git(['commit', '-m', 'base']);
  await git(['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
  const initialHead = await git(['rev-parse', 'HEAD']);
  await mkdir(path.join(install, '.ai-agent/skills'), { recursive: true });
  for (const name of ['workflow-mode', 'repo-submit', 'tapd-submit-backfill']) {
    await writeFile(path.join(install, '.ai-agent/skills', name + '.md'), '# fixture skill: ' + name);
  }
  const configFile = path.join(install, '.aafe.config.json');
  await writeFile(configFile, JSON.stringify({ mode: { workflow: 'autonomous' }, submit: { cli: 'gtm' },
    repo: { githubAccessToken: 'must-not-appear-in-prompt', reviewers: ['reviewer'], labels: ['fix'] },
    tapd: { enabled: true, tapd_story: { status_doing: 'implementing' } } }));
  const task = { id: 'workflow-task', requirement, kind: 'requirement', source: { type: 'wecom', userId: 'owner' },
    workspace: { cwd: install }, execution: { cwd: repo, repoRoot: repo } };
  const workflow = await resolveCodexWorkflow(task, {}, task.execution);
  assert.equal(workflow.configRoot, install);
  assert.equal(workflow.submitCli, 'gtm');
  assert.equal(workflow.mode, 'autonomous');
  assert.equal(workflow.ready, true);
  assert.equal(workflow.initialHead, initialHead);
  assert.ok(!codexWorkflowPrompt(workflow).includes('must-not-appear'));
  assert.ok(codexWorkflowPrompt(workflow).includes('--config-root'));
  await writeFile(configFile, JSON.stringify({ mode: { workflow: 'ask' }, submit: { cli: 'git' } }));
  const refreshed = await resolveCodexWorkflow(task, {}, task.execution);
  assert.equal(refreshed.mode, 'ask');
  assert.equal((await resolveCodexWorkflow(task, {}, task.execution, { workflowOverride: 'auto' })).mode, 'autonomous');
  assert.equal((await resolveCodexWorkflow(task, {}, task.execution, { workflowOverride: 'project' })).mode, 'ask');
  assert.equal((await resolveCodexWorkflow(task, {}, task.execution, { workflowOverride: 'invalid' })).mode, 'ask');
  assert.equal((await resolveCodexWorkflow({ ...task, requirement: '先问我，不要提交' }, {}, task.execution,
    { workflowOverride: 'auto' })).mode, 'ask');
  assert.notEqual(refreshed.policyHash, workflow.policyHash);
  const overridden = await resolveCodexWorkflow(task, { conversation: { messages: [
    { role: 'user', author: { role: 'owner' }, content: '按自主判断继续' },
    { role: 'user', author: { role: 'participant' }, content: '用询问模式' }
  ] } }, task.execution);
  assert.equal(overridden.mode, 'autonomous');

  const comment = codexToolReceipt(item('comments_create', { workspace_id: workspaceId, entry_id: entryId },
    { Comment: { id: '777' } }));
  assert.ok(comment.identifiers.includes('777'));
  const state = (status, id) => codexToolReceipt(item('stories_get', { workspace_id: workspaceId, id: entryId },
    { Story: { id: entryId, status } }, id));
  const update = (status, id) => codexToolReceipt(item('stories_update', { workspace_id: workspaceId, id: entryId,
    status, check_workflow: 'permission,condition' }, { Story: { id: entryId } }, id));
  const receipts = [state('backlog', 'before'), update('todo', 'todo'), update('implementing', 'doing'), comment, state('implementing', 'after')];
  assert.deepEqual(codexToolReceipt(item('stories_get', { id: entryId, workspace_id: workspaceId },
    { status: 'success', Story: { id: entryId, status: 'doing' } })).statuses, ['doing']);
  const result = { outcome: { delivery: [gate('commit'), gate('pr'), gate('tapd_backfill', 'proceed', '777')] }, receipts };
  assert.equal((await verifyCodexWorkflow(task, result, workflow)).passed, true);
  const prFailed = structuredClone(result);
  prFailed.outcome.delivery[1] = { ...gate('pr', 'proceed'), status: 'failed', reason: 'fixture remote failure' };
  const partial = await verifyCodexWorkflow(task, prFailed, workflow);
  assert.equal(partial.passed, false);
  assert.ok(partial.verified.some((record) => record.gate === 'tapd_backfill'));
  assert.equal((await verifyCodexWorkflow(task, { ...result, receipts: [] }, workflow)).passed, false);
  assert.equal((await verifyCodexWorkflow(task, { ...result, receipts: [state('backlog', 'before'), update('implementing', 'jump'), comment, state('implementing', 'after')] }, workflow)).passed, false);
  assert.equal((await verifyCodexWorkflow(task, { ...result, receipts: receipts.slice(0, -1) }, workflow)).passed, false);
  assert.equal((await verifyCodexWorkflow(task, result, { ...workflow, tapd: { enabled: false } })).passed, false);
  assert.equal((await verifyCodexWorkflow(task, { outcome: { delivery: allSkipped }, receipts: [] }, refreshed)).passed, true);
  const unrelated = codexToolReceipt(item('comments_create', { workspace_id: workspaceId, entry_id: '999' }, { id: '777' }));
  assert.equal((await verifyCodexWorkflow(task, { ...result, receipts: [unrelated, state('implementing', 'after')] }, workflow)).passed, false);
  const badUpdate = codexToolReceipt(item('stories_update', { workspace_id: workspaceId, id: entryId, description: 'never-persist-this-body' }, { id: entryId }));
  assert.ok(!JSON.stringify(badUpdate).includes('never-persist'));
  assert.equal((await verifyCodexWorkflow(task, { ...result, receipts: [...receipts, badUpdate] }, workflow)).passed, false);

  // Ask consent is scoped to the pending gate, not a blanket yes for every write.
  const consentResult = structuredClone(result);
  consentResult.outcome.delivery[2].authorization = '是';
  const pending = { ...refreshed, pendingGate: 'tapd_backfill', ownerMessages: ['是'],
    tapd: workflow.tapd };
  assert.equal((await verifyCodexWorkflow(task, consentResult, pending)).passed, true);
  assert.equal((await verifyCodexWorkflow(task, consentResult, { ...pending, pendingGate: 'commit' })).passed, false);
  for (const latest of ['不要回填', '不是', '稍后再说']) {
    assert.equal((await verifyCodexWorkflow(task, consentResult,
      { ...pending, ownerMessages: ['是', latest] })).passed, false, 'old yes is not fresh consent');
  }
  const failedMcp = item('comments_create', { workspace_id: workspaceId, entry_id: entryId }, { id: '777' });
  failedMcp.result.isError = true;
  assert.equal(codexToolReceipt(failedMcp), null);
  // A worker-created config must not override the original install-root ask policy.
  const untrustedCheckout = path.join(root, 'untrusted-checkout');
  await mkdir(untrustedCheckout);
  await writeFile(path.join(untrustedCheckout, '.aafe.config.json'), JSON.stringify({ mode: { workflow: 'autonomous' } }));
  assert.equal((await resolveCodexWorkflow(task, {}, { cwd: untrustedCheckout })).mode, 'ask');

  const calls = [];
  const spawnProcess = (_bin, args, options) => {
    calls.push({ args, options, prompt: '' });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null)); };
    child.stdin.on('data', (data) => { calls.at(-1).prompt += data; });
    child.stdin.on('finish', async () => {
      const send = (event) => child.stdout.write(JSON.stringify(event) + '\n');
      try {
        send({ type: 'thread.started', thread_id: 'workflow-native-thread' });
        send({ type: 'turn.started' });
        // Real local-only Git, no pushes; external successes below are explicit fixtures.
        await git(['switch', '-c', 'feat/workflow/#137994989'], options.cwd);
        await writeFile(path.join(options.cwd, 'change.txt'), 'implemented fixture');
        await git(['add', 'change.txt'], options.cwd);
        await git(['commit', '-m', 'feat: fixture --story=137994989'], options.cwd);
        const sha = await git(['rev-parse', 'HEAD'], options.cwd);
        send({ type: 'item.completed', item: { id: 'pr', type: 'command_execution', status: 'completed', exit_code: 0,
          command: 'aafe repo pr --title=fixture', aggregated_output: 'https://github.com/acme/demo/pull/7' } });
        for (const record of [item('stories_get', { workspace_id: workspaceId, id: entryId }, { id: entryId, status: 'doing' }, 'state'),
          item('comments_create', { workspace_id: workspaceId, entry_id: entryId }, { id: '777' }, 'comment')]) {
          send({ type: 'item.completed', item: record });
        }
        send({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({
          status: 'completed', summary: 'fixture delivered', evidence: ['fixture tests'], remainingSteps: [],
          delivery: [gate('commit', 'proceed', sha), gate('pr', 'proceed', 'https://github.com/acme/demo/pull/7'), gate('tapd_backfill', 'proceed', '777')]
        }) } });
        send({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } });
        child.emit('close', 0);
      } catch (error) { child.stderr.write(String(error)); child.emit('close', 1); }
    });
    return child;
  };
  await writeFile(configFile, JSON.stringify({ mode: { workflow: 'autonomous' }, submit: { cli: 'git' } }));
  const manager = new TaskManager({ root, runtime: new CodexTaskRuntime({ spawnProcess }),
    validateProjectRuntime: false, recoverOnStart: false, workspaceOptions: { share: [] },
    runtimeOptions: { codex: { mcpServers: { tapd: { url: 'https://example.invalid/mcp' } } },
      envVars: { GITHUB_TOKEN: 'fixture-github-token', CURSOR_API_KEY: 'must-not-forward' } } });
  try {
    const created = await manager.create({ requirement, provider: 'codex', kind: 'requirement',
      source: { type: 'wecom', userId: 'owner' }, workspace: { cwd: install } });
    const done = await manager.start(created.id);
    assert.equal(done.status, 'completed', done.error);
    assert.equal(done.pullRequest.url, 'https://github.com/acme/demo/pull/7');
    assert.equal(done.taskBranch, 'feat/workflow/#137994989');
    assert.ok(done.delivery.receipts.length >= 3);
    assert.equal(done.delivery.verification.passed, true);
    assert.ok(calls[0].args.includes('--approve-for-me'));
    assert.ok(calls[0].args.includes('approval_policy="on-request"'));
    assert.ok(!calls[0].args.join(' ').includes('danger-full-access'));
    assert.equal(calls[0].options.env.GITHUB_TOKEN, 'fixture-github-token');
    assert.equal(calls[0].options.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
    assert.equal(calls[0].options.env.GIT_CONFIG_VALUE_0,
      'AUTHORIZATION: basic ' + Buffer.from('x-access-token:fixture-github-token').toString('base64'));
    assert.ok(calls[0].prompt.includes('never add a Bearer extraheader'));
    assert.equal(calls[0].options.env.CURSOR_API_KEY, undefined);
    assert.ok(!calls[0].args.join(' ').includes('fixture-github-token'));
    assert.equal((await git(['branch', '--show-current'])), 'master');
  } finally { await manager.close(); }

  const dryRun = await runRepoPrCommand(repo, ['--dry-run', '--config-root=' + install, '--title=fixture'], {
    env: { GITHUB_TOKEN: 'fixture' }, readConfig: async (dir) => { assert.equal(dir, install); return { repo: { labels: ['fix'] } }; }
  });
  assert.deepEqual(dryRun.labels, ['fix']);
  console.log('codex workflow tests passed (local Git + mocked CLI/MCP; no external writes)');
} finally { await rm(root, { recursive: true, force: true }); }
