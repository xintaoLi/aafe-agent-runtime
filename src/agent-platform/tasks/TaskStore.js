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

import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTaskTransition, isTaskStatus } from './TaskState.js';

const TASK_FILE = 'task.json';
const CONTEXT_FILE = 'context.json';
const EVENTS_FILE = 'events.jsonl';
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Durable file-backed task state. Each task owns one directory, context file
 * and event log so no API can accidentally read another task's dynamic state.
 */
export class TaskStore {
  constructor({ root = process.cwd(), output = '.aafe' } = {}) {
    this.root = root;
    this.output = output;
    this.tasksDir = path.join(root, output, 'tasks');
    this.writeQueues = new Map();
  }

  async create(partial = {}, context = {}) {
    const now = new Date().toISOString();
    const id = validateTaskId(partial.id ?? createTaskId());
    const existing = await this.get(id);
    if (existing) throw new Error(`task-already-exists:${id}`);

    const task = {
      version: 1,
      id,
      kind: partial.kind ?? 'generic',
      goal: partial.goal ?? partial.requirement ?? '',
      requirement: partial.requirement ?? null,
      source: clone(partial.source ?? null),
      repository: clone(partial.repository ?? null),
      baseBranch: partial.baseBranch ?? partial.repository?.baseBranch ?? partial.repository?.branch ?? null,
      taskBranch: partial.taskBranch ?? null,
      status: partial.status ?? 'created',
      cursor: {
        agentId: partial.cursor?.agentId ?? null,
        activeRunId: partial.cursor?.activeRunId ?? null,
        runs: clone(partial.cursor?.runs ?? [])
      },
      result: clone(partial.result ?? null),
      error: partial.error ?? null,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now
    };
    if (!isTaskStatus(task.status)) throw new Error(`unknown-task-status:${task.status}`);

    await this.#withTaskLock(id, async () => {
      await mkdir(this.#taskDir(id), { recursive: true });
      await atomicJsonWrite(this.#file(id, TASK_FILE), task);
      await atomicJsonWrite(this.#file(id, CONTEXT_FILE), clone(context));
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.created', {
        status: task.status
      }));
    });
    return clone(task);
  }

  async get(taskId) {
    const id = validateTaskId(taskId);
    return readJson(this.#file(id, TASK_FILE));
  }

  async getContext(taskId) {
    const id = validateTaskId(taskId);
    return clone((await readJson(this.#file(id, CONTEXT_FILE))) ?? {});
  }

  async replaceContext(taskId, context) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      await this.#require(id);
      const isolated = clone(context ?? {});
      await atomicJsonWrite(this.#file(id, CONTEXT_FILE), isolated);
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.context.updated'));
      return clone(isolated);
    });
  }

  async update(taskId, patch, { eventType = 'task.updated', eventPayload = null } = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.#require(id);
      if (patch?.status !== undefined) assertTaskTransition(current.status, patch.status);
      const next = {
        ...current,
        ...clone(patch ?? {}),
        id,
        cursor: patch?.cursor ? { ...current.cursor, ...clone(patch.cursor) } : current.cursor,
        updatedAt: new Date().toISOString()
      };
      await atomicJsonWrite(this.#file(id, TASK_FILE), next);
      if (eventType) {
        await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, eventType, eventPayload ?? {
          status: next.status
        }));
      }
      return clone(next);
    });
  }

  async transition(taskId, status, payload = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      const current = await this.#require(id);
      assertTaskTransition(current.status, status);
      const next = {
        ...current,
        status,
        error: payload.error !== undefined ? payload.error : current.error,
        result: payload.result !== undefined ? clone(payload.result) : current.result,
        updatedAt: new Date().toISOString()
      };
      await atomicJsonWrite(this.#file(id, TASK_FILE), next);
      await appendJsonLine(this.#file(id, EVENTS_FILE), createEvent(id, 'task.status.changed', {
        from: current.status,
        to: status,
        ...clone(payload.event ?? {})
      }));
      return clone(next);
    });
  }

  async appendEvent(taskId, type, payload = {}) {
    const id = validateTaskId(taskId);
    return this.#withTaskLock(id, async () => {
      await this.#require(id);
      const event = createEvent(id, type, payload);
      await appendJsonLine(this.#file(id, EVENTS_FILE), event);
      return clone(event);
    });
  }

  async events(taskId) {
    const id = validateTaskId(taskId);
    try {
      const text = await readFile(this.#file(id, EVENTS_FILE), 'utf8');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async list({ statuses = null, limit = 100 } = {}) {
    let entries = [];
    try {
      entries = await readdir(this.tasksDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const allowed = Array.isArray(statuses) && statuses.length ? new Set(statuses) : null;
    const tasks = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name)) continue;
      const task = await this.get(entry.name);
      if (task && (!allowed || allowed.has(task.status))) tasks.push(task);
    }
    return tasks
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, Math.max(0, limit));
  }

  async #require(taskId) {
    const task = await readJson(this.#file(taskId, TASK_FILE));
    if (!task) throw new Error(`task-not-found:${taskId}`);
    return task;
  }

  #taskDir(taskId) {
    return path.join(this.tasksDir, validateTaskId(taskId));
  }

  #file(taskId, name) {
    return path.join(this.#taskDir(taskId), name);
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
}

export function createTaskId(now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `task-${stamp}-${randomUUID().slice(0, 8)}`;
}

function createEvent(taskId, type, payload = {}) {
  return {
    id: randomUUID(),
    taskId,
    type,
    payload: clone(payload),
    createdAt: new Date().toISOString()
  };
}

function validateTaskId(value) {
  const id = String(value ?? '');
  if (!TASK_ID_PATTERN.test(id)) throw new Error(`invalid-task-id:${id}`);
  return id;
}

async function atomicJsonWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function appendJsonLine(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
