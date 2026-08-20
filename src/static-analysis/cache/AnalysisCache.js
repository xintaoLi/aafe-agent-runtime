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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-run cache of per-file extraction results.
 *
 * Parsing and extracting is the dominant cost of `aafe analyze`, and between
 * two runs almost nothing changed. The content hash the repository scan already
 * computes is enough to know which files can be reused, so a re-analysis after
 * a small edit costs roughly what that edit touched.
 *
 * Entries are keyed by content hash, not mtime: a checkout or a rebase changes
 * mtimes without changing content, and a cache that invalidates on those is a
 * cache that never hits when it matters.
 *
 * The extractor version is part of the cache key. A stale entry produced by an
 * older extractor is worse than no cache, because it silently reintroduces
 * facts the current code would never have derived.
 */

export const CACHE_FILE = 'cache/extract.json';
const CACHE_VERSION = 1;

export class AnalysisCache {
  /**
   * @param {object} options
   * @param {string} options.root
   * @param {string} [options.output]      Knowledge output dir, default `.aafe`.
   * @param {string} [options.extractorVersion]
   * @param {boolean} [options.enabled]
   */
  constructor({ root, output = '.aafe', extractorVersion = '1', enabled = true } = {}) {
    this.file = path.join(root, output, CACHE_FILE);
    this.extractorVersion = String(extractorVersion);
    this.enabled = enabled !== false;
    /** @type {Map<string, {hash:string, extracted:object}>} */
    this.entries = new Map();
    /** @type {Set<string>} */
    this.touched = new Set();
    this.stats = { hits: 0, misses: 0, written: 0, pruned: 0 };
    this.loaded = false;
  }

  async load() {
    if (!this.enabled || this.loaded) return this;
    this.loaded = true;
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      if (payload?.version !== CACHE_VERSION) return this;
      if (payload?.extractorVersion !== this.extractorVersion) return this;
      for (const [file, entry] of Object.entries(payload.entries ?? {})) {
        if (entry?.hash && entry.extracted) this.entries.set(file, entry);
      }
    } catch {
      // A missing or corrupt cache is not an error; it just means a cold run.
    }
    return this;
  }

  /**
   * @returns {object|null} The cached extraction, or null on a miss.
   */
  get(file, hash) {
    if (!this.enabled || !hash) return null;
    const entry = this.entries.get(file);
    if (!entry || entry.hash !== hash) {
      this.stats.misses += 1;
      return null;
    }
    this.touched.add(file);
    this.stats.hits += 1;
    return entry.extracted;
  }

  set(file, hash, extracted) {
    if (!this.enabled || !hash || !extracted) return;
    this.entries.set(file, { hash, extracted });
    this.touched.add(file);
    this.stats.written += 1;
  }

  /**
   * Drop entries for files this run never looked at, so a deleted file's facts
   * cannot come back to life on the next run.
   */
  prune() {
    for (const file of [...this.entries.keys()]) {
      if (this.touched.has(file)) continue;
      this.entries.delete(file);
      this.stats.pruned += 1;
    }
  }

  async save() {
    if (!this.enabled) return null;
    this.prune();
    const payload = {
      version: CACHE_VERSION,
      extractorVersion: this.extractorVersion,
      updatedAt: Date.now(),
      entries: Object.fromEntries(this.entries)
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    // Written via a temp file: a run interrupted mid-write must not leave a
    // truncated cache that the next run has to detect and discard.
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
    await rename(temporary, this.file);
    return this.file;
  }

  summary() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      entries: this.entries.size,
      hitRate: total === 0 ? 0 : Number((this.stats.hits / total).toFixed(3))
    };
  }
}

export function createAnalysisCache(options) {
  return new AnalysisCache(options);
}
