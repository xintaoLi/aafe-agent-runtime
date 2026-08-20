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

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Persists one planner+orchestrator run under `<output>/runs/<runId>/`.
 *
 * Node payloads are written as sibling files and referenced from `run.json`
 * by relative path, so the run record stays readable even for large analyses.
 * With `write: false` the store degrades to synthetic refs, which is what
 * `aafe plan --dry-run` uses.
 */
export class RunStore {
  constructor({ root, output = '.aafe', runId, write = true }) {
    this.root = root;
    this.runId = runId;
    this.write = write;
    this.relativeDir = path.posix.join(output, 'runs', runId);
    this.dir = path.join(root, output, 'runs', runId);
    this.initialized = false;
  }

  async init() {
    if (!this.write || this.initialized) return;
    await mkdir(path.join(this.dir, 'nodes'), { recursive: true });
    this.initialized = true;
  }

  /**
   * @returns {Promise<string>} ref usable as ExecutionNode.inputRef
   */
  async writeInput(nodeIdOrKey, payload) {
    return this.#writePayload(`${nodeIdOrKey}.input.json`, payload);
  }

  async writeOutput(nodeId, payload) {
    return this.#writePayload(`${nodeId}.output.json`, payload);
  }

  async writeRun(record) {
    if (!this.write) return null;
    await this.init();
    const file = path.join(this.dir, 'run.json');
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return path.posix.join(this.relativeDir, 'run.json');
  }

  async writeContextPackage(contextPackage) {
    if (!this.write) return null;
    await this.init();
    const file = path.join(this.dir, 'context.json');
    await writeFile(file, `${JSON.stringify(contextPackage, null, 2)}\n`, 'utf8');
    return path.posix.join(this.relativeDir, 'context.json');
  }

  /**
   * @returns {Promise<object|null>} The persisted run record.
   */
  async load() {
    return readJson(path.join(this.dir, 'run.json'));
  }

  async loadContextPackage() {
    return readJson(path.join(this.dir, 'context.json'));
  }

  /**
   * Resolve an `inputRef` / `outputRef` back to its payload.
   * `memory://` refs come from `write: false` runs and were never persisted.
   */
  async loadRef(ref) {
    if (typeof ref !== 'string' || !ref || ref.startsWith('memory://')) return null;
    return readJson(path.isAbsolute(ref) ? ref : path.join(this.root, ref));
  }

  async #writePayload(name, payload) {
    const ref = path.posix.join(this.relativeDir, 'nodes', name);
    if (!this.write) return `memory://${ref}`;
    await this.init();
    await writeFile(path.join(this.dir, 'nodes', name), `${JSON.stringify(payload ?? null, null, 2)}\n`, 'utf8');
    return ref;
  }
}

/**
 * Runs are directories, not rows in an index: no writer has to maintain a
 * manifest, and a half-written run cannot corrupt the listing.
 *
 * @returns {Promise<{runId:string,status:string,reason:string,task:object,startedAt:string,summary:object,metrics:object}[]>}
 */
export async function listRuns(root, output = '.aafe', { limit = 20 } = {}) {
  const dir = path.join(root, output, 'runs');
  let entries = [];
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const runs = [];
  for (const runId of entries.slice(0, limit)) {
    const record = await readJson(path.join(dir, runId, 'run.json'));
    if (!record) continue;
    runs.push({
      runId: record.runId ?? runId,
      status: record.status ?? 'unknown',
      reason: record.reason ?? '',
      task: { kind: record.task?.kind ?? null, goal: record.task?.goal ?? '' },
      startedAt: runIdToIso(record.runId ?? runId),
      summary: record.summary ?? {},
      metrics: record.metrics ?? {}
    });
  }
  return runs;
}

/**
 * Rehydrate a finished run for inspection (RFC §7).
 *
 * Replay is read-only by design: the value of a stored run is that it is the
 * exact record of what happened, so re-executing it would answer a different
 * question than the one the operator asked.
 *
 * @returns {Promise<{run:object,nodes:object[],contextPackage:object|null}|null>}
 */
export async function replayRun(root, output = '.aafe', runId) {
  const store = new RunStore({ root, output, runId, write: false });
  const run = await store.load();
  if (!run) return null;

  const nodes = [];
  for (const node of run.nodes ?? []) {
    nodes.push({
      ...node,
      input: await store.loadRef(node.inputRef),
      output: await store.loadRef(node.outputRef)
    });
  }

  return { run, nodes, contextPackage: await store.loadContextPackage() };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Run ids are `YYYYMMDDTHHMMSS-xxxx`, which is sortable but not readable.
 */
function runIdToIso(runId) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(runId));
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
}

export function createRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}
