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
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseUpdateOptions } from '../src/cli/update.js';
import { resolveForceAnalyzeDecision } from '../src/cli/prompts.js';
import { AnalysisStorage, PRESERVED_ANALYZE_OUTPUT_DIRS } from '../src/static-analysis/storage/persist.js';

assert.deepEqual(PRESERVED_ANALYZE_OUTPUT_DIRS, ['e2e', 'runs', 'tasks']);

const parsedDefault = parseUpdateOptions([]);
assert.equal(parsedDefault.analyze, undefined);
assert.equal(parsedDefault.yes, false);

const parsedForce = parseUpdateOptions(['--analyze']);
assert.equal(parsedForce.analyze, true);

const parsedAlias = parseUpdateOptions(['--force-analyze']);
assert.equal(parsedAlias.analyze, true);

const parsedSkip = parseUpdateOptions(['--no-analyze']);
assert.equal(parsedSkip.analyze, false);

const parsedYes = parseUpdateOptions(['--yes']);
assert.equal(parsedYes.yes, true);

const parsedManager = parseUpdateOptions([
  '--agent-manager',
  '--max-concurrent-tasks=8',
  '--task-output=.agent-state',
  '--no-agent-readiness-check',
  '--no-agent-recovery',
  '--sdd',
  '--sdd-root=specifications',
  '--sdd-schema=spec-driven',
  '--no-sdd-approval'
]);
assert.equal(parsedManager.agentManager, true);
assert.equal(parsedManager.maxConcurrentTasks, 8);
assert.equal(parsedManager.taskOutput, '.agent-state');
assert.equal(parsedManager.validateProjectRuntime, false);
assert.equal(parsedManager.recoverOnStart, false);
assert.equal(parsedManager.sddEnabled, true);
assert.equal(parsedManager.sddRoot, 'specifications');
assert.equal(parsedManager.sddSchema, 'spec-driven');
assert.equal(parsedManager.sddApprovalRequired, false);

assert.deepEqual(resolveForceAnalyzeDecision({}, { isTTY: false }), { forceAnalyze: true, shouldPrompt: false });
assert.deepEqual(resolveForceAnalyzeDecision({}, { isTTY: true }), { forceAnalyze: true, shouldPrompt: true });
assert.deepEqual(resolveForceAnalyzeDecision({ yes: true }, { isTTY: true }), { forceAnalyze: true, shouldPrompt: false });
assert.deepEqual(resolveForceAnalyzeDecision({ dryRun: true }, { isTTY: true }), { forceAnalyze: true, shouldPrompt: false });
assert.deepEqual(resolveForceAnalyzeDecision({ analyze: true }, { isTTY: true }), { forceAnalyze: true, shouldPrompt: false });
assert.deepEqual(resolveForceAnalyzeDecision({ analyze: false }, { isTTY: true }), { forceAnalyze: false, shouldPrompt: false });
assert.deepEqual(resolveForceAnalyzeDecision({ analyze: false, yes: true }, { isTTY: false }), { forceAnalyze: false, shouldPrompt: false });

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-update-analyze-'));
const output = '.aafe';
const outAbs = path.join(tmp, output);

await mkdir(path.join(outAbs, 'architecture'), { recursive: true });
await mkdir(path.join(outAbs, 'modules', 'legacy-mod'), { recursive: true });
await mkdir(path.join(outAbs, 'e2e', 'reports', 'run-1'), { recursive: true });
await mkdir(path.join(outAbs, 'runs', 'abc'), { recursive: true });
await mkdir(path.join(outAbs, 'tasks', 'task-1'), { recursive: true });
await writeFile(path.join(outAbs, 'stale.json'), '{"legacy":true}\n');
await writeFile(path.join(outAbs, 'architecture', 'index.md'), '# leftover\n');
await writeFile(path.join(outAbs, 'modules', 'legacy-mod', 'routes.json'), '[]\n');
await writeFile(path.join(outAbs, 'e2e', 'reports', 'run-1', 'report.json'), '{"ok":true}\n');
await writeFile(path.join(outAbs, 'runs', 'abc', 'run.json'), '{"id":"abc"}\n');
await writeFile(path.join(outAbs, 'tasks', 'task-1', 'task.json'), '{"id":"task-1"}\n');

const storage = new AnalysisStorage();
const result = await storage.persist(makeContext(tmp, { force: true, formats: ['json'] }));

assert.equal(result.mode, 'force');
assert.ok(result.forceMigration.removed.includes('stale.json'));
assert.ok(result.forceMigration.removed.includes('architecture'));
assert.ok(result.forceMigration.removed.includes('modules'));
assert.equal(result.forceMigration.removed.includes('e2e'), false);
assert.equal(result.forceMigration.removed.includes('runs'), false);
assert.equal(result.forceMigration.removed.includes('tasks'), false);

await assert.rejects(() => access(path.join(outAbs, 'stale.json')));
await assert.rejects(() => access(path.join(outAbs, 'architecture', 'index.md')));
await assert.rejects(() => access(path.join(outAbs, 'modules', 'legacy-mod', 'routes.json')));

const e2eReport = await readFile(path.join(outAbs, 'e2e', 'reports', 'run-1', 'report.json'), 'utf8');
const runRecord = await readFile(path.join(outAbs, 'runs', 'abc', 'run.json'), 'utf8');
const taskRecord = await readFile(path.join(outAbs, 'tasks', 'task-1', 'task.json'), 'utf8');
assert.equal(JSON.parse(e2eReport).ok, true);
assert.equal(JSON.parse(runRecord).id, 'abc');
assert.equal(JSON.parse(taskRecord).id, 'task-1');
assert.ok((await readFile(path.join(outAbs, 'manifest.json'), 'utf8')).includes('"version"'));

const mergeRoot = await mkdtemp(path.join(os.tmpdir(), 'aafe-update-analyze-merge-'));
const mergeOut = path.join(mergeRoot, output);
await mkdir(mergeOut, { recursive: true });
await writeFile(path.join(mergeOut, 'stale.json'), '{"legacy":true}\n');

const mergeResult = await storage.persist(makeContext(mergeRoot, { force: false, formats: ['json'] }));
assert.equal(mergeResult.mode, 'merge');
assert.equal(mergeResult.forceMigration, null);
await access(path.join(mergeOut, 'stale.json'));
assert.equal(JSON.parse(await readFile(path.join(mergeOut, 'stale.json'), 'utf8')).legacy, true);

await rm(tmp, { recursive: true, force: true });
await rm(mergeRoot, { recursive: true, force: true });

console.log('update-analyze tests passed');

function makeContext(root, { force, formats }) {
  return {
    config: {
      root,
      output,
      force,
      formats,
      llm: {}
    },
    project: { name: 'fixture', root, version: '0.0.0' },
    runtime: { commit: null, stats: { files: 0, modules: 0, symbols: 0, dependencies: 0, flows: 0, features: 0, businessCandidates: 0 } },
    repository: { files: [], packages: [], entrypoints: [] },
    graph: { nodes: [], edges: [], symbols: [] },
    architecture: { modules: [], dependencies: [], risks: [] },
    dataflow: { flows: [], levels: {} },
    features: { candidates: [] },
    business: { candidates: [] },
    results: {}
  };
}
