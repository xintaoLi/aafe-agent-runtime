import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertTaskTransition, isTaskStatus } from './TaskState.js';
import { applyTaskSnapshotPatch, createTaskSnapshot } from './TaskSnapshot.js';

export class SqliteTaskStore {
  static async open({ root = process.cwd(), output = '.aafe', file = null, DatabaseSync = null } = {}) {
    const filename = file ?? path.join(root, output, 'tasks.sqlite');
    await mkdir(path.dirname(filename), { recursive: true });
    let Driver = DatabaseSync;
    if (!Driver) {
      try { ({ DatabaseSync: Driver } = await import('node:sqlite')); }
      catch { throw new Error('sqlite-driver-unavailable:Node 22+ or injected DatabaseSync required'); }
    }
    return new SqliteTaskStore(new Driver(filename), { root, output, file: filename });
  }

  constructor(db, { root = process.cwd(), output = '.aafe', file = null } = {}) {
    if (!db?.prepare || !db?.exec) throw new Error('sqlite-database-invalid');
    this.db = db;
    this.root = root;
    this.output = output;
    this.file = file;
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, task_json TEXT NOT NULL, context_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        event_type TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_task_id ON task_events(task_id, id);
    `);
  }

  async create(partial = {}, context = {}) {
    const task = taskRecord(partial);
    const snapshot = createTaskSnapshot(task, context);
    try {
      this.db.prepare('INSERT INTO tasks(id,task_json,context_json,snapshot_json,status,updated_at) VALUES(?,?,?,?,?,?)')
        .run(task.id, json(task), json(context), json(snapshot), task.status, task.updatedAt);
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message))) throw new Error(`task-already-exists:${task.id}`);
      throw error;
    }
    this.#event(task.id, 'task.created', { status: task.status });
    return clone(task);
  }

  async get(taskId) { return this.#row(taskId)?.task ?? null; }
  async getContext(taskId) { return clone(this.#require(taskId).context); }
  async getSnapshot(taskId) { return clone(this.#require(taskId).snapshot); }

  async replaceContext(taskId, context) {
    const row = this.#require(taskId);
    this.#write({ ...row, context: clone(context ?? {}) });
    this.#event(taskId, 'task.context.updated');
    return clone(context ?? {});
  }

  async patchSnapshot(taskId, patch = {}) {
    const row = this.#require(taskId);
    const next = applyTaskSnapshotPatch(row.snapshot, patch);
    if (next.version === row.snapshot.version) return clone(row.snapshot);
    this.#write({ ...row, snapshot: next });
    this.#event(taskId, 'task.snapshot.updated', { fromVersion: row.snapshot.version, toVersion: next.version });
    return clone(next);
  }

  async update(taskId, patch, { eventType = 'task.updated', eventPayload = null } = {}) {
    const row = this.#require(taskId);
    if (patch?.status !== undefined) assertTaskTransition(row.task.status, patch.status);
    const task = { ...row.task, ...clone(patch ?? {}), id: row.task.id,
      cursor: patch?.cursor ? { ...row.task.cursor, ...clone(patch.cursor) } : row.task.cursor,
      codex: patch?.codex ? { ...row.task.codex, ...clone(patch.codex) } : row.task.codex,
      sdd: patch?.sdd ? { ...(row.task.sdd ?? {}), ...clone(patch.sdd) } : row.task.sdd,
      updatedAt: new Date().toISOString() };
    this.#write({ ...row, task });
    if (eventType) this.#event(taskId, eventType, eventPayload ?? { status: task.status });
    return clone(task);
  }

  async transition(taskId, status, payload = {}) {
    const row = this.#require(taskId);
    assertTaskTransition(row.task.status, status);
    const task = { ...row.task, status,
      error: payload.error !== undefined ? payload.error : row.task.error,
      result: payload.result !== undefined ? clone(payload.result) : row.task.result,
      updatedAt: new Date().toISOString() };
    const snapshot = applyTaskSnapshotPatch(row.snapshot, { status,
      ...(payload.error ? { appendBlockers: [payload.error] } : {}),
      ...(['completed', 'cancelled'].includes(status) ? { removeBlockers: row.snapshot.blockers } : {}),
      ...(payload.result?.text ? { lastResult: String(payload.result.text).slice(0, 6000) } : {}) });
    this.#write({ ...row, task, snapshot });
    this.#event(taskId, 'task.status.changed', { from: row.task.status, to: status, ...clone(payload.event ?? {}) });
    return clone(task);
  }

  async appendEvent(taskId, type, payload = {}) { this.#require(taskId); return this.#event(taskId, type, payload); }
  async events(taskId) {
    this.#require(taskId);
    return this.db.prepare('SELECT event_json FROM task_events WHERE task_id=? ORDER BY id').all(taskId)
      .map((row) => JSON.parse(row.event_json));
  }
  async list({ statuses = null, sourceType = null, conversationId = null, userId = null, limit = 1000 } = {}) {
    const rows = this.db.prepare('SELECT task_json FROM tasks ORDER BY updated_at DESC').all();
    return rows.map((row) => JSON.parse(row.task_json)).filter((task) =>
      (!statuses || statuses.includes(task.status))
      && (!sourceType || task.source?.type === sourceType)
      && (!conversationId || task.source?.conversationId === conversationId)
      && (!userId || task.source?.userId === userId)).slice(0, Math.max(1, Number(limit) || 1000));
  }
  close() { this.db.close?.(); }

  async importTask(task, context, snapshot, events = []) {
    if (await this.get(task.id)) return false;
    this.db.prepare('INSERT INTO tasks(id,task_json,context_json,snapshot_json,status,updated_at) VALUES(?,?,?,?,?,?)')
      .run(task.id, json(task), json(context ?? {}), json(snapshot ?? createTaskSnapshot(task, context)), task.status, task.updatedAt);
    for (const event of events) this.#event(task.id, event.type, event.payload, event);
    return true;
  }

  #row(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(String(id));
    return row ? { task: JSON.parse(row.task_json), context: JSON.parse(row.context_json), snapshot: JSON.parse(row.snapshot_json) } : null;
  }
  #require(id) { const row = this.#row(id); if (!row) throw new Error(`task-not-found:${id}`); return row; }
  #write(row) {
    this.db.prepare('UPDATE tasks SET task_json=?,context_json=?,snapshot_json=?,status=?,updated_at=? WHERE id=?')
      .run(json(row.task), json(row.context), json(row.snapshot), row.task.status, row.task.updatedAt, row.task.id);
  }
  #event(taskId, type, payload = {}, existing = null) {
    const event = existing ?? { id: randomUUID(), taskId, type, payload: clone(payload), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO task_events(task_id,event_type,event_json,created_at) VALUES(?,?,?,?)')
      .run(taskId, type, json(event), event.createdAt);
    return clone(event);
  }
}

export async function migrateTaskStore(source, target, { limit = 100000 } = {}) {
  const tasks = await source.list({ limit });
  let imported = 0;
  for (const task of tasks.reverse()) {
    if (await target.importTask(task, await source.getContext(task.id), await source.getSnapshot(task.id), await source.events(task.id))) imported += 1;
  }
  return { scanned: tasks.length, imported };
}

function taskRecord(partial) {
  const now = new Date().toISOString();
  const status = partial.status ?? 'created';
  if (!isTaskStatus(status)) throw new Error(`unknown-task-status:${status}`);
  const id = String(partial.id ?? `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error(`invalid-task-id:${id}`);
  return { version: 1, id, kind: partial.kind ?? 'generic', goal: partial.goal ?? partial.requirement ?? '',
    requirement: partial.requirement ?? null, source: clone(partial.source ?? null), repository: clone(partial.repository ?? null),
    workspace: clone(partial.workspace ?? null), baseBranch: partial.baseBranch ?? null, taskBranch: partial.taskBranch ?? null,
    model: partial.model ?? null, provider: partial.provider ?? 'cursor',
    codex: { agentId: partial.codex?.agentId ?? null, activeRunId: partial.codex?.activeRunId ?? null, runs: clone(partial.codex?.runs ?? []) },
    status, cursor: { agentId: partial.cursor?.agentId ?? null, activeRunId: partial.cursor?.activeRunId ?? null, runs: clone(partial.cursor?.runs ?? []) },
    sdd: clone(partial.sdd ?? null), execution: clone(partial.execution ?? null), pullRequest: clone(partial.pullRequest ?? null),
    result: clone(partial.result ?? null), error: partial.error ?? null, createdAt: partial.createdAt ?? now, updatedAt: partial.updatedAt ?? now };
}
function json(value) { return JSON.stringify(value ?? null); }
function clone(value) { return value == null ? value : structuredClone(value); }
