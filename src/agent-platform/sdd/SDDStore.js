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

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSDDChangeTransition, isSDDChangeStatus } from './SDDState.js';

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CHANGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CHANGE_FILE = 'change.json';
const TRACEABILITY_FILE = 'traceability.json';

export class SDDStore {
  constructor({ root = process.cwd(), output = '.aafe' } = {}) {
    this.root = root;
    this.output = output;
    this.tasksDir = path.join(root, output, 'tasks');
    this.writeQueues = new Map();
    this.globalWrite = Promise.resolve();
  }

  async create(taskId, partial = {}) {
    const id = validateTaskId(taskId);
    const changeId = validateChangeId(partial.changeId);
    return this.#withGlobalLock(async () => {
      await access(path.join(this.tasksDir, id, 'task.json'));
      if (await this.get(id)) throw new Error(`sdd-change-already-exists:${id}`);
      const owner = await this.findByChangeId(changeId);
      if (owner) throw new Error(`sdd-change-id-already-bound:${changeId}:${owner.taskId}`);

      const now = new Date().toISOString();
      const change = {
        version: 1,
        taskId: id,
        changeId,
        slug: partial.slug ?? changeId,
        schema: partial.schema ?? 'spec-driven',
        openspecPath: partial.openspecPath,
        status: 'draft',
        revision: 0,
        artifacts: { proposal: null, design: null, tasks: null, specs: {} },
        validation: null,
        approval: null,
        verification: null,
        syncedAt: null,
        archivedAt: null,
        archivePath: null,
        createdAt: now,
        updatedAt: now
      };
      await atomicJsonWrite(this.#file(id, CHANGE_FILE), change);
      return clone(change);
    });
  }

  async get(taskId) {
    return readJson(this.#file(validateTaskId(taskId), CHANGE_FILE));
  }

  async require(taskId) {
    const change = await this.get(taskId);
    if (!change) throw new Error(`sdd-change-not-found:${taskId}`);
    return change;
  }

  async findByChangeId(changeId) {
    const wanted = validateChangeId(changeId);
    let entries;
    try {
      entries = await readdir(this.tasksDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name)) continue;
      const change = await this.get(entry.name);
      if (change?.changeId === wanted) return change;
    }
    return null;
  }

  async update(taskId, patch = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.require(id);
      if (patch.status !== undefined) {
        if (!isSDDChangeStatus(patch.status)) throw new Error(`unknown-sdd-status:${patch.status}`);
        assertSDDChangeTransition(current.status, patch.status);
      }
      const next = mergeChange(current, patch);
      await atomicJsonWrite(this.#file(id, CHANGE_FILE), next);
      return clone(next);
    });
  }

  async revise(taskId, {
    artifact,
    artifactPath,
    capability = null,
    content,
    reason = null,
    traceability = undefined
  }) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.require(id);
      if (['archived', 'cancelled'].includes(current.status)) {
        throw new Error(`sdd-change-not-revisable:${current.status}`);
      }
      const revision = current.revision + 1;
      const snapshot = {
        id: randomUUID(),
        taskId: id,
        changeId: current.changeId,
        revision,
        artifact,
        capability,
        path: artifactPath,
        reason,
        hash: hashContent(content),
        snapshot: clone(content),
        createdAt: new Date().toISOString()
      };
      await atomicJsonWrite(
        path.join(this.#sddDir(id), 'revisions', `${String(revision).padStart(6, '0')}.json`),
        snapshot
      );

      const artifacts = clone(current.artifacts);
      if (artifact === 'spec') artifacts.specs[capability] = artifactPath;
      else if (artifact !== 'traceability') artifacts[artifact] = artifactPath;
      if (traceability !== undefined) {
        await atomicJsonWrite(this.#file(id, TRACEABILITY_FILE), traceability);
      }
      const next = {
        ...current,
        status: 'draft',
        revision,
        artifacts,
        validation: null,
        approval: null,
        verification: null,
        syncedAt: null,
        updatedAt: new Date().toISOString()
      };
      await atomicJsonWrite(this.#file(id, CHANGE_FILE), next);
      return { change: clone(next), revision: clone(snapshot) };
    });
  }

  async setTraceability(taskId, value, options = {}) {
    return this.revise(taskId, {
      artifact: 'traceability',
      artifactPath: path.posix.join(this.output, 'tasks', validateTaskId(taskId), 'sdd', TRACEABILITY_FILE),
      content: value,
      traceability: value,
      reason: options.reason ?? null
    });
  }

  async getTraceability(taskId) {
    return readJson(this.#file(validateTaskId(taskId), TRACEABILITY_FILE));
  }

  async revisions(taskId) {
    const id = validateTaskId(taskId);
    const directory = path.join(this.#sddDir(id), 'revisions');
    let names;
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const values = [];
    for (const name of names) {
      const value = await readJson(path.join(directory, name));
      if (value) values.push(value);
    }
    return values;
  }

  async remove(taskId) {
    const id = validateTaskId(taskId);
    await this.#withTaskLock(id, () => rm(this.#sddDir(id), { recursive: true, force: true }));
  }

  #sddDir(taskId) {
    return path.join(this.tasksDir, validateTaskId(taskId), 'sdd');
  }

  #file(taskId, name) {
    return path.join(this.#sddDir(taskId), name);
  }

  async #withTaskLock(taskId, action) {
    const previous = this.writeQueues.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.writeQueues.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(taskId) === current) this.writeQueues.delete(taskId);
    }
  }

  async #withGlobalLock(action) {
    const current = this.globalWrite.catch(() => {}).then(action);
    this.globalWrite = current;
    return current;
  }
}

export function validateSDDTaskId(value) {
  return validateTaskId(value);
}

export function validateSDDChangeId(value) {
  return validateChangeId(value);
}

function validateTaskId(value) {
  const id = String(value ?? '');
  if (!TASK_ID_PATTERN.test(id)) throw new Error(`invalid-task-id:${id}`);
  return id;
}

function validateChangeId(value) {
  const id = String(value ?? '');
  if (!CHANGE_ID_PATTERN.test(id) || id === 'archive') throw new Error(`invalid-sdd-change-id:${id}`);
  return id;
}

function mergeChange(current, patch) {
  return {
    ...current,
    ...clone(patch),
    taskId: current.taskId,
    changeId: current.changeId,
    artifacts: patch.artifacts
      ? { ...current.artifacts, ...clone(patch.artifacts), specs: { ...current.artifacts.specs, ...(patch.artifacts.specs ?? {}) } }
      : current.artifacts,
    updatedAt: new Date().toISOString()
  };
}

async function atomicJsonWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function hashContent(value) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(content).digest('hex');
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
