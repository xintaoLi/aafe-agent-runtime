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

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandSynonyms, matchesLoosely, sumWeight, tokenize } from '../../agents/impact-analyzer/tokenize.js';

/**
 * Inverted index over everything `.aafe/` knows: symbols, files, modules,
 * routes, components, features and business flows.
 *
 * Without it, every lookup is a linear scan across a dozen JSON files, which is
 * why the impact analyzer had to re-read and re-tokenize the whole knowledge
 * base on each run. The index makes "which artifacts mention X" a map lookup,
 * so retrieval stops being the reason to keep the knowledge base small.
 *
 * Ranking is weighted query coverage times a kind multiplier, which keeps every
 * score inside [0,1]. That range is not cosmetic: the impact analyzer feeds
 * these scores straight into `ImpactItem.score`, whose schema caps them at 1,
 * and into a confidence that would otherwise saturate.
 */

export const INDEX_FILE = 'knowledge/index/json/search.json';
const MODULE_INDEX_FILE = 'modules/index.json';
const INDEX_VERSION = 2;

/**
 * Applied as a multiplier rather than a per-term bonus. Summing it per matched
 * term multiplies coverage in a second time and pushes scores past 1.
 *
 * The range is compressed into [0.75, 1] so a caller's match threshold means
 * roughly the same thing whichever kind it lands on.
 */
const KIND_MULTIPLIER = Object.freeze({
  module: 1,
  route: 0.96,
  component: 0.92,
  feature: 0.92,
  'business-flow': 0.87,
  symbol: 0.83,
  file: 0.75
});

export class KnowledgeIndex {
  constructor({ root, output = '.aafe' } = {}) {
    this.root = root;
    this.output = output;
    this.file = path.join(root, output, INDEX_FILE);
    /** @type {{id:string,kind:string,label:string,file:string|null,module:string|null,text:string}[]} */
    this.entries = [];
    /** @type {Map<string, number[]>} token -> entry positions */
    this.postings = new Map();
    this.builtAt = null;
    /** @type {Map<string, string[]>} query term -> posting terms it loosely matches */
    this.looseCache = new Map();
  }

  get size() {
    return this.entries.length;
  }

  /**
   * Build from a KnowledgeStore. Reading through the store rather than the raw
   * files keeps one definition of what the knowledge base contains.
   */
  async build(store) {
    this.entries = [];
    this.postings = new Map();
    this.looseCache = new Map();
    /** @type {Map<string, string>} file -> owning module, for entries that only know their file */
    const moduleByFile = new Map();

    const modules = await store.modulesIndex();
    for (const entry of modules) {
      const id = String(entry.id ?? '').replace(/^module:/, '');
      if (!id) continue;
      const slice = await store.getModule(id);
      // The module entry carries the vocabulary of everything it contains, not
      // just its id. A requirement names a route or a component far more often
      // than it names the module those live in.
      this.#add({
        id: `module:${id}`,
        kind: 'module',
        label: id,
        module: id,
        text: [
          id,
          ...(slice?.routes ?? []).map((route) => `${route?.path ?? ''} ${route?.name ?? ''}`),
          ...(slice?.components ?? []).map((component) => component?.name ?? '')
        ].join(' ')
      });
      if (!slice) continue;

      for (const file of slice.files ?? []) {
        moduleByFile.set(file, id);
        this.#add({ id: `file:${file}`, kind: 'file', label: file, file, module: id, text: file });
      }
      for (const route of slice.routes ?? []) {
        if (!route?.path) continue;
        this.#add({
          id: `route:${id}:${route.path}`,
          kind: 'route',
          label: route.path,
          file: route.file ?? null,
          module: id,
          text: `${route.path} ${route.name ?? ''} ${route.component ?? ''}`
        });
      }
      for (const component of slice.components ?? []) {
        if (!component?.name) continue;
        this.#add({
          id: `component:${id}:${component.name}`,
          kind: 'component',
          label: component.name,
          file: component.file ?? null,
          module: id,
          text: component.name
        });
      }
    }

    for (const feature of await store.features()) {
      if (!feature?.id) continue;
      this.#add({
        id: feature.id,
        kind: 'feature',
        label: feature.name ?? feature.id,
        file: feature.entrypoints?.[0] ?? null,
        module: null,
        text: `${feature.name ?? ''} ${(feature.entrypoints ?? []).join(' ')}`
      });
    }

    for (const flow of await store.business()) {
      if (!flow?.id) continue;
      this.#add({
        id: flow.id,
        kind: 'business-flow',
        label: flow.name ?? flow.id,
        file: flow.evidence?.[0]?.file ?? null,
        module: null,
        text: `${flow.name ?? ''} ${flow.description ?? ''}`
      });
    }

    for (const symbol of await store.symbols()) {
      if (!symbol?.name) continue;
      const file = String(symbol.fileId ?? '').replace(/^file:/, '') || null;
      this.#add({
        id: symbol.id ?? `symbol:${file}:${symbol.name}`,
        kind: 'symbol',
        label: symbol.name,
        file,
        // Resolved here so a symbol hit can promote its owning module instead of
        // being a dead end the caller has to re-resolve.
        module: file ? moduleByFile.get(file) ?? null : null,
        text: `${symbol.name} ${file ?? ''}`
      });
    }

    this.builtAt = Date.now();
    return this;
  }

  /**
   * @param {string} query
   * @param {{limit?: number, kinds?: string[], minScore?: number}} [options]
   * @returns {{id:string,kind:string,label:string,file:string|null,module:string|null,score:number,matched:string[]}[]}
   */
  search(query, { limit = 20, kinds = null, minScore = 0 } = {}) {
    const terms = expandSynonyms(tokenize(query));
    if (terms.size === 0) return [];
    const allowed = kinds ? new Set(kinds) : null;
    const total = sumWeight(terms);
    if (total === 0) return [];

    /** @type {Map<number, Set<string>>} entry position -> query terms it matched */
    const hits = new Map();
    for (const term of terms) {
      for (const posting of this.#expandTerm(term)) {
        for (const position of this.postings.get(posting) ?? []) {
          const entry = this.entries[position];
          if (allowed && !allowed.has(entry.kind)) continue;
          const matched = hits.get(position);
          if (matched) matched.add(term);
          else hits.set(position, new Set([term]));
        }
      }
    }

    return [...hits.entries()]
      .map(([position, matched]) => {
        const entry = this.entries[position];
        // Coverage of the query matters more than raw term count: an entry that
        // matches two of two terms beats one that matches two of six. Weighted,
        // so a long Chinese requirement is not diluted by its own recall bigrams.
        const coverage = sumWeight(matched) / total;
        return {
          id: entry.id,
          kind: entry.kind,
          label: entry.label,
          file: entry.file,
          module: entry.module,
          score: Number((coverage * (KIND_MULTIPLIER[entry.kind] ?? 1)).toFixed(3)),
          matched: [...matched]
        };
      })
      .filter((hit) => hit.score >= minScore)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /**
   * Posting terms a query term should hit: itself plus everything it matches as
   * a substring, so `user` reaches a `userlist` posting.
   *
   * The loose set is unioned in rather than used only when the exact lookup
   * misses. Substring matching is a per-entry question, and a term can have an
   * exact posting for one entry while only loosely matching another.
   *
   * @returns {string[]}
   */
  #expandTerm(term) {
    const cached = this.looseCache.get(term);
    if (cached) return cached;

    const expanded = this.postings.has(term) ? [term] : [];
    if (term.length >= 3) {
      for (const posting of this.postings.keys()) {
        if (posting !== term && matchesLoosely(term, posting)) expanded.push(posting);
      }
    }
    this.looseCache.set(term, expanded);
    return expanded;
  }

  /**
   * @returns {Promise<string|null>} The written path.
   */
  async save() {
    const payload = {
      version: INDEX_VERSION,
      builtAt: this.builtAt ?? Date.now(),
      entries: this.entries,
      postings: Object.fromEntries([...this.postings].map(([term, list]) => [term, list]))
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(payload)}\n`, 'utf8');
    return path.posix.join(this.output, INDEX_FILE);
  }

  /**
   * @returns {Promise<boolean>} Whether a usable index was loaded.
   */
  async load() {
    if (await this.#isStale()) return false;
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      if (payload?.version !== INDEX_VERSION) return false;
      this.entries = payload.entries ?? [];
      this.postings = new Map(Object.entries(payload.postings ?? {}));
      this.builtAt = payload.builtAt ?? null;
      this.looseCache = new Map();
      return this.entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * An index older than the analysis it describes points agents at code that
   * has already moved, which is worse than having no index at all. Compared by
   * mtime against the module index because that is rewritten by every persist.
   *
   * Distinct from `KnowledgeStore.staleness()`, which asks whether `.aafe/` as a
   * whole has fallen behind the working tree.
   */
  async #isStale() {
    try {
      const [index, modules] = await Promise.all([
        stat(this.file),
        stat(path.join(this.root, this.output, MODULE_INDEX_FILE))
      ]);
      return index.mtimeMs < modules.mtimeMs;
    } catch {
      // No module index to compare against: let the version check decide.
      return false;
    }
  }

  #add(entry) {
    const position = this.entries.length;
    this.entries.push({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      file: entry.file ?? null,
      module: entry.module ?? null
    });
    // Both the label and the path are tokenized: `UserPhoneSearch` and
    // `src/user/phone-search.js` are the same answer to the same question, and
    // which one a developer types is not something the index should care about.
    for (const term of expandSynonyms(tokenize(entry.text))) {
      const list = this.postings.get(term);
      if (list) list.push(position);
      else this.postings.set(term, [position]);
    }
  }
}

/**
 * Load the persisted index, rebuilding it from the store when it is missing or
 * from an older format.
 */
export async function openKnowledgeIndex(store, { root, output = '.aafe', rebuild = false } = {}) {
  const index = new KnowledgeIndex({ root, output });
  if (!rebuild && await index.load()) return index;
  await index.build(store);
  return index;
}
