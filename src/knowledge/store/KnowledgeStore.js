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

import { execFile } from 'node:child_process';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeModuleId } from '../model/index.js';

const execFileAsync = promisify(execFile);

/**
 * Agent-produced knowledge is kept apart from analyze output. Analyze output is
 * derivable — it can be regenerated from the repository at any time — while
 * this layer is not, so a re-analysis must never overwrite it.
 */
const AGENT_ITEMS_FILE = 'knowledge/agent/json/items.json';
const AGENT_LOG_FILE = 'knowledge/agent/jsonl/updates.jsonl';

/**
 * Read side of the analyze output (default `.aafe/`).
 *
 * Follows the same lazy protocol the on-demand skills document: manifest →
 * index → the one module slice you actually need. Nothing here ever walks the
 * whole tree, which is what keeps impact and context analysis cheap on large
 * repositories.
 */
export class KnowledgeStore {
  constructor({ root = process.cwd(), output = '.aafe' } = {}) {
    this.root = root;
    this.output = output;
    this.base = path.isAbsolute(output) ? output : path.join(root, output);
    this.cache = new Map();
    this.fileIndex = null;
    this.index = null;
  }

  get available() {
    return this.cache.get('manifest') != null;
  }

  async manifest() {
    return this.#json('manifest', 'manifest.json');
  }

  async index() {
    return this.#json('index', 'index.json');
  }

  async modulesIndex() {
    const data = await this.#json('modules-index', 'modules/index.json');
    return data?.modules ?? [];
  }

  async relations() {
    const [modules, components, dataflow] = await Promise.all([
      this.#json('rel-modules', 'knowledge/relations/json/modules.json'),
      this.#json('rel-components', 'knowledge/relations/json/components.json'),
      this.#json('rel-dataflow', 'knowledge/relations/json/dataflow.json')
    ]);
    return {
      modules: modules?.relations ?? [],
      components: components?.relations ?? [],
      dataflow: dataflow?.relations ?? []
    };
  }

  async features() {
    const data = await this.#json('features', 'knowledge/features/json/candidates.json');
    return data?.candidates ?? [];
  }

  async business() {
    const data = await this.#json('business', 'knowledge/business/json/candidates.json');
    return data?.candidates ?? [];
  }

  async symbols() {
    const data = await this.#json('symbols', 'knowledge/repository/json/symbols.json');
    return data?.symbols ?? [];
  }

  async files() {
    const data = await this.#json('files', 'knowledge/repository/json/files.json');
    return data?.files ?? [];
  }

  /**
   * Ranked retrieval over everything the knowledge base holds.
   *
   * The index is built on first use and cached on disk, so the cost of "which
   * artifacts mention X" stops scaling with the size of the knowledge base.
   *
   * @param {string} query
   * @param {{limit?: number, kinds?: string[], rebuild?: boolean}} [options]
   */
  async search(query, options = {}) {
    const index = await this.searchIndex(options);
    return index.search(query, options);
  }

  async searchIndex({ rebuild = false } = {}) {
    if (this.index && !rebuild) return this.index;
    const { openKnowledgeIndex } = await import('../search/KnowledgeIndex.js');
    this.index = await openKnowledgeIndex(this, { root: this.root, output: this.output, rebuild });
    return this.index;
  }

  async architecture() {
    return (await this.#json('architecture', 'knowledge/architecture/json/analysis.json')) ?? {};
  }

  async dataflow() {
    return (await this.#json('dataflow', 'knowledge/dataflow/json/analysis.json')) ?? {};
  }

  /**
   * One module slice. Sub-documents are loaded together because a caller that
   * wants a module almost always wants its routes and dataflow too.
   */
  async getModule(id) {
    const moduleId = normalizeModuleId(id);
    const cacheKey = `module:${moduleId}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const dir = `modules/${moduleId}`;
    const index = await this.#json(`${cacheKey}:index`, `${dir}/index.json`);
    if (!index) {
      this.cache.set(cacheKey, null);
      return null;
    }
    const [architecture, routes, components, features, dataflow] = await Promise.all([
      this.#json(`${cacheKey}:arch`, `${dir}/json/architecture.json`),
      this.#json(`${cacheKey}:routes`, `${dir}/json/routes.json`),
      this.#json(`${cacheKey}:components`, `${dir}/json/components.json`),
      this.#json(`${cacheKey}:features`, `${dir}/json/features.json`),
      this.#json(`${cacheKey}:dataflow`, `${dir}/json/dataflow.json`)
    ]);

    const slice = {
      id: moduleId,
      index,
      files: architecture?.architecture?.boundaries?.files ?? [],
      architecture: architecture?.architecture ?? null,
      routes: routes?.routes ?? index.routes ?? [],
      components: components?.components ?? index.components ?? [],
      features: features?.features ?? [],
      dataflow: dataflow?.dataflow ?? dataflow ?? null,
      dependencies: (index.dependencies ?? []).map(normalizeModuleId)
    };
    this.cache.set(cacheKey, slice);
    return slice;
  }

  /**
   * file path -> module id. Built once from module architecture boundaries;
   * this is the only place that touches every module slice, and it is only
   * paid for by diff-driven impact analysis.
   */
  async fileToModuleIndex() {
    if (this.fileIndex) return this.fileIndex;
    const index = new Map();
    for (const entry of await this.modulesIndex()) {
      const slice = await this.getModule(entry.id);
      for (const file of slice?.files ?? []) {
        if (!index.has(file)) index.set(file, entry.id);
      }
    }
    this.fileIndex = index;
    return index;
  }

  async findModuleByFile(file) {
    const index = await this.fileToModuleIndex();
    if (index.has(file)) return index.get(file);
    // Directory fallback keeps renamed/added files attributable to a module.
    const dir = path.posix.dirname(file);
    for (const [known, moduleId] of index) {
      if (path.posix.dirname(known) === dir) return moduleId;
    }
    return null;
  }

  /**
   * Whether the persisted knowledge still describes the working tree.
   * @returns {Promise<{stale: boolean, reason: string, commit?: string|null}>}
   */
  async staleness() {
    const manifest = await this.manifest();
    if (!manifest) return { stale: true, reason: 'unavailable' };

    const recorded = manifest.analysis?.commit ?? null;
    const head = await this.#gitHead();
    if (!head) {
      return { stale: false, reason: 'no-git-metadata', commit: recorded };
    }
    if (!recorded) {
      return { stale: true, reason: 'no-commit-recorded', commit: null };
    }
    if (!sameCommit(recorded, head)) {
      return { stale: true, reason: `commit-changed:${recorded.slice(0, 7)}->${head.slice(0, 7)}`, commit: recorded };
    }
    if (await this.#hasUncommittedSources()) {
      return { stale: true, reason: 'working-tree-dirty', commit: recorded };
    }
    return { stale: false, reason: 'fresh', commit: recorded };
  }

  async exists() {
    try {
      await access(path.join(this.base, 'manifest.json'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * KnowledgeItem[] contributed by agents in previous runs (AGENTS.SCHEMA §10).
   */
  async agentKnowledge() {
    const data = await this.#json('agent-items', AGENT_ITEMS_FILE);
    return data?.items ?? [];
  }

  /**
   * Write side of the `Knowledge Update -> Planner` loop (RFC §5).
   *
   * Without this, an agent's `knowledgeUpdates` are collected into the run
   * record and then discarded, so the platform can never learn that a claim was
   * rejected: the next run rediscovers and re-reports the same bad module.
   *
   * Nothing is deleted. A `drop` marks the item invalid and keeps it, because a
   * validator bug must be recoverable and an audit trail is the only way to see
   * that the same claim keeps getting rejected.
   *
   * @param {import('../../agent-platform/protocol/response.js').KnowledgeUpdate[]} updates
   * @param {{ generatedBy?: string, runId?: string, write?: boolean }} [options]
   * @returns {Promise<{applied:number,upserted:number,downgraded:number,dropped:number,skipped:number,ref:string|null}>}
   */
  async applyKnowledgeUpdates(updates = [], { generatedBy = 'agent', runId = null, write = true } = {}) {
    const stats = { applied: 0, upserted: 0, downgraded: 0, dropped: 0, skipped: 0, ref: null };
    if (!Array.isArray(updates) || updates.length === 0) return stats;

    const items = new Map((await this.agentKnowledge()).map((item) => [item.id, item]));
    const now = Date.now();

    for (const update of updates) {
      const id = String(update?.id ?? '').trim();
      if (!id || !['upsert', 'downgrade', 'drop'].includes(update?.op)) {
        stats.skipped += 1;
        continue;
      }

      const existing = items.get(id);
      const evidence = update.evidence ?? existing?.evidence ?? [];
      // Last gate before a claim becomes something later runs treat as fact:
      // an upsert with nothing to point at is stored, but never as validated.
      // Storing it as verified is how an unsupported claim becomes a "fact"
      // that every subsequent run inherits.
      const op = update.op === 'upsert' && evidence.length === 0 ? 'downgrade' : update.op;

      items.set(id, {
        id,
        type: String(update.kind ?? existing?.type ?? 'impact'),
        name: String(update.name ?? existing?.name ?? id),
        content: update.value ?? existing?.content ?? null,
        evidence,
        confidence: nextConfidence(op, existing?.confidence),
        generatedBy: update.generatedBy ?? generatedBy,
        validated: op === 'upsert',
        updatedAt: now,
        ...(op !== update.op ? { reason: 'upsert carried no evidence' } : {}),
        ...(update.reason ? { reason: update.reason } : {}),
        ...(op === 'drop' ? { invalidated: true } : {}),
        ...(runId ? { runId } : {})
      });

      stats.applied += 1;
      if (op === 'upsert') stats.upserted += 1;
      if (op === 'downgrade') stats.downgraded += 1;
      if (op === 'drop') stats.dropped += 1;
    }

    if (!write || stats.applied === 0) return stats;

    const payload = { updatedAt: now, count: items.size, items: Array.from(items.values()) };
    await this.#writeJson(AGENT_ITEMS_FILE, payload);
    await this.#appendLog(AGENT_LOG_FILE, updates.map((update) => ({ ...update, runId, at: now })));
    this.cache.set('agent-items', payload);
    stats.ref = path.posix.join(this.output, AGENT_ITEMS_FILE);
    return stats;
  }

  /**
   * Rejected and downgraded ids from previous runs, so the impact analyzer can
   * stop re-proposing what validation already threw out.
   * @returns {Promise<{ rejected: Set<string>, weak: Set<string> }>}
   */
  async knowledgeVerdicts() {
    const rejected = new Set();
    const weak = new Set();
    for (const item of await this.agentKnowledge()) {
      if (item.invalidated === true) rejected.add(item.id);
      else if ((item.confidence ?? 1) < 0.5) weak.add(item.id);
    }
    return { rejected, weak };
  }

  invalidate() {
    this.cache.clear();
    this.fileIndex = null;
    this.index = null;
  }

  async #json(cacheKey, relative) {
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    let value = null;
    try {
      value = JSON.parse(await readFile(path.join(this.base, relative), 'utf8'));
    } catch {
      value = null;
    }
    this.cache.set(cacheKey, value);
    return value;
  }

  async #writeJson(relative, value) {
    const file = path.join(this.base, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  async #appendLog(relative, entries) {
    if (entries.length === 0) return;
    const file = path.join(this.base, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  }

  async #gitHead() {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.root });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async #hasUncommittedSources() {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', '.'], { cwd: this.root });
      return stdout
        .split('\n')
        .map((line) => line.slice(3).trim())
        .some((file) => file && !file.startsWith(this.output));
    } catch {
      return false;
    }
  }
}

export function createKnowledgeStore(options) {
  return new KnowledgeStore(options);
}

/**
 * The manifest records an abbreviated commit while `git rev-parse` returns the
 * full hash, so compare on the shorter of the two.
 */
function sameCommit(a, b) {
  const length = Math.min(a.length, b.length);
  return length > 0 && a.slice(0, length) === b.slice(0, length);
}

/**
 * A downgrade halves the standing confidence rather than setting a fixed value,
 * so an item downgraded three runs in a row keeps sinking.
 */
function nextConfidence(op, previous) {
  const base = Number.isFinite(previous) ? previous : 0.6;
  if (op === 'upsert') return Math.min(1, Math.max(base, 0.8));
  if (op === 'downgrade') return Math.max(0.05, Number((base / 2).toFixed(3)));
  return 0;
}
