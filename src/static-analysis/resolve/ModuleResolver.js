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

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Turns an import specifier into a repository-relative file path.
 *
 * Aliases are not cosmetic. In a real frontend project most cross-module
 * imports are written `@/components/x`, and an analyzer that only follows
 * relative paths reports those modules as unconnected — which makes the
 * dependency graph, and therefore every impact report built on it, wrong in
 * exactly the places that matter most.
 *
 * Alias sources, in the order a bundler would apply them:
 *   1. `tsconfig.json` / `jsconfig.json` — `compilerOptions.paths` + `baseUrl`
 *   2. `webpack.config.*` — `resolve.alias`
 *   3. `vite.config.*` — `resolve.alias`
 *
 * Bundler configs are JavaScript, so they are read with a regex rather than
 * evaluated: running a project's build config to analyse it is not a trade the
 * analyzer gets to make.
 */

export const RESOLVE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json'
]);

const TS_CONFIG_FILES = Object.freeze(['tsconfig.json', 'jsconfig.json']);
const BUNDLER_CONFIG_FILES = Object.freeze([
  'webpack.config.js', 'webpack.config.cjs', 'webpack.config.mjs', 'webpack.config.ts',
  'webpack.common.js', 'webpack.base.js', 'build/webpack.base.conf.js',
  'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs'
]);

export class ModuleResolver {
  /**
   * @param {string} root
   * @param {object} [options]
   * @param {(file: string) => Promise<boolean>} [options.exists] Injected for tests.
   */
  constructor(root, { exists = defaultExists } = {}) {
    this.root = root;
    this.exists = exists;
    /** @type {{prefix:string, target:string, wildcard:boolean}[]} */
    this.aliases = [];
    /** @type {string[]} */
    this.baseUrls = [];
    /** @type {string[]} */
    this.sources = [];
    this.cache = new Map();
    this.loaded = false;
  }

  /**
   * Reads the project's alias configuration. Safe to call repeatedly.
   */
  async load() {
    if (this.loaded) return this;
    this.loaded = true;

    for (const file of TS_CONFIG_FILES) {
      const config = await this.#readJsonc(path.join(this.root, file));
      if (!config) continue;
      this.sources.push(file);
      const options = config.compilerOptions ?? {};
      const base = typeof options.baseUrl === 'string' ? options.baseUrl : null;
      // `paths` are resolved against baseUrl, which itself is relative to the
      // config file. Without baseUrl, TypeScript resolves paths against the
      // config's own directory.
      const baseDir = base ? path.posix.join('.', toPosix(base)) : '.';
      if (base) this.baseUrls.push(normalizeRelative(baseDir));

      for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
        const target = Array.isArray(targets) ? targets[0] : targets;
        if (typeof target !== 'string') continue;
        this.#addAlias(pattern, path.posix.join(baseDir, toPosix(target)));
      }
    }

    for (const file of BUNDLER_CONFIG_FILES) {
      const source = await this.#readText(path.join(this.root, file));
      if (!source) continue;
      const found = extractBundlerAliases(source);
      if (found.length === 0) continue;
      this.sources.push(file);
      for (const { prefix, target } of found) this.#addAlias(prefix, target);
    }

    // Longest prefix first, so `@/components/*` wins over `@/*`.
    this.aliases.sort((a, b) => b.prefix.length - a.prefix.length);
    this.baseUrls = [...new Set(this.baseUrls)];
    return this;
  }

  /**
   * @param {string} fromFile   Repo-relative file containing the import.
   * @param {string} specifier
   * @returns {Promise<string|null>} Repo-relative path, or null for bare
   *   packages, unresolvable aliases and anything outside the repository.
   */
  async resolve(fromFile, specifier) {
    if (!specifier || specifier.startsWith('node:') || specifier.startsWith('data:')) return null;
    await this.load();

    const key = `${fromFile}\u0000${specifier}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const resolved = await this.#resolveUncached(fromFile, specifier);
    this.cache.set(key, resolved);
    return resolved;
  }

  /**
   * Whether a specifier points into this repository at all. Used to label graph
   * nodes: `@/utils` looks external to a naive check but is not.
   */
  isInternal(specifier) {
    if (!specifier) return false;
    if (specifier.startsWith('.') || specifier.startsWith('/')) return true;
    return this.aliases.some((alias) => matchesAlias(alias, specifier));
  }

  async #resolveUncached(fromFile, specifier) {
    const candidates = [];

    if (specifier.startsWith('.')) {
      candidates.push(path.posix.join(path.posix.dirname(toPosix(fromFile)), specifier));
    } else if (specifier.startsWith('/')) {
      candidates.push(specifier.replace(/^\/+/, ''));
    } else {
      for (const alias of this.aliases) {
        const applied = applyAlias(alias, specifier);
        if (applied) candidates.push(applied);
      }
      // A bare specifier can also be a baseUrl-relative import (`components/x`),
      // which TypeScript allows and bundlers commonly mirror.
      for (const base of this.baseUrls) candidates.push(path.posix.join(base, specifier));
    }

    for (const candidate of candidates) {
      const hit = await this.#firstExisting(normalizeRelative(candidate));
      if (hit) return hit;
    }
    return null;
  }

  async #firstExisting(relative) {
    if (!relative || relative.startsWith('..')) return null;
    const forms = [relative];
    for (const ext of RESOLVE_EXTENSIONS) forms.push(`${relative}${ext}`);
    for (const ext of RESOLVE_EXTENSIONS) forms.push(path.posix.join(relative, `index${ext}`));

    for (const form of forms) {
      if (path.posix.extname(form) === '' ) continue;
      if (await this.exists(path.join(this.root, form))) return form;
    }
    // A specifier may already name a real extensionless file (rare, but valid).
    return (await this.exists(path.join(this.root, relative))) ? relative : null;
  }

  /**
   * `@/*` and `@` are different aliases: the first only matches at a path
   * boundary, so `@babel/core` must not be rewritten to `src/babel/core`. The
   * trailing slash is what carries that distinction, so it is preserved.
   */
  #addAlias(pattern, target) {
    const prefix = pattern.replace(/\*$/, '');
    if (!prefix) return;
    this.aliases.push({
      prefix,
      target: normalizeRelative(target.replace(/\*$/, '')),
      boundary: prefix.endsWith('/')
    });
  }

  async #readText(file) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * tsconfig files are JSON with comments and trailing commas in practice.
   */
  async #readJsonc(file) {
    const text = await this.#readText(file);
    if (!text) return null;
    try {
      return JSON.parse(stripJsonc(text));
    } catch {
      return null;
    }
  }
}

export async function createModuleResolver(root, options) {
  return new ModuleResolver(root, options).load();
}

/**
 * `resolve: { alias: { '@': path.resolve(__dirname, 'src') } }` and its
 * many spellings, without executing the config.
 */
export function extractBundlerAliases(source) {
  const block = sliceAliasBlock(source);
  if (!block) return [];

  const aliases = [];
  for (const entry of splitTopLevel(block)) {
    const separator = entry.indexOf(':');
    if (separator < 0) continue;
    const prefix = entry.slice(0, separator).trim().replace(/^['"`]|['"`]$/g, '');
    const target = aliasTarget(entry.slice(separator + 1));
    if (!prefix || !target) continue;
    aliases.push({ prefix, target });
  }
  return aliases;
}

/**
 * Split on commas that separate entries, not on commas inside
 * `path.resolve(__dirname, 'src')`.
 */
function splitTopLevel(block) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
    if (quote) {
      if (char === quote && block[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(block.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(block.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Pull out the `alias: { ... }` object literal by brace counting; a regex over
 * the whole file would happily match the next unrelated object.
 */
function sliceAliasBlock(source) {
  const start = /alias\s*:\s*\{/.exec(source);
  if (!start) return null;
  let depth = 0;
  for (let index = start.index + start[0].length - 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start.index + start[0].length, index);
    }
  }
  return null;
}

/**
 * Targets are expressions (`path.resolve(__dirname, 'src')`, `'./src'`,
 * `` `${__dirname}/src` ``). Only the repo-relative directory matters here.
 */
function aliasTarget(expression) {
  const value = expression.trim();
  const literal = /^['"`](.+)['"`]$/.exec(value);
  if (literal) return normalizeRelative(literal[1]);

  const call = /(?:path\.(?:resolve|join))\s*\(([^)]*)\)/.exec(value);
  if (call) {
    const parts = call[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !/^__dirname$|^__filename$|^process\.cwd\(\)$/.test(part))
      .map((part) => /^['"`](.*)['"`]$/.exec(part)?.[1])
      .filter(Boolean);
    if (parts.length > 0) return normalizeRelative(parts.join('/'));
  }

  const template = /^`\$\{__dirname\}\/?(.*)`$/.exec(value);
  if (template) return normalizeRelative(template[1]);

  return null;
}

function applyAlias(alias, specifier) {
  if (!matchesAlias(alias, specifier)) return null;
  const rest = specifier.slice(alias.prefix.length).replace(/^\//, '');
  return rest ? path.posix.join(alias.target, rest) : alias.target;
}

function matchesAlias(alias, specifier) {
  if (alias.boundary) return specifier.startsWith(alias.prefix);
  if (specifier === alias.prefix) return true;
  return specifier.startsWith(`${alias.prefix}/`);
}

function normalizeRelative(value) {
  const posix = toPosix(String(value ?? ''))
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  return posix === '.' ? '' : posix;
}

function toPosix(value) {
  return String(value ?? '').split(path.sep).join('/');
}

/**
 * Comments and trailing commas, which tsconfig files are allowed to contain.
 */
function stripJsonc(text) {
  return text
    .replace(/\\"/g, '\u0000')
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
      (match.startsWith('"') ? match : ''))
    .replace(/\u0000/g, '\\"')
    .replace(/,(\s*[}\]])/g, '$1');
}

async function defaultExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
