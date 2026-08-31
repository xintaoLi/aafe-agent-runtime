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

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Resolves the prompt + input schema + output schema triple bound to an agent
 * (AGENTS.SCHEMA §12, §16).
 *
 * Everything is addressed by reference, never imported by a hard-coded path, so
 * a project can override any builtin contract from `.aafe.agents.json` without
 * forking the runtime.
 *
 * Reference forms:
 *   `builtin:<agent-id>`                  the shipped contract for that agent
 *   `./agents/x/output.schema.json`       a project file, relative to the root
 *   `/abs/path/prompt.md`                 an absolute file
 *   `{ ...schema }`                       an inline schema object
 */

const BUILTIN_AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agents');

export class ContractLoader {
  constructor({ root = process.cwd(), agentsDir = BUILTIN_AGENTS_DIR } = {}) {
    this.root = root;
    this.agentsDir = agentsDir;
    this.cache = new Map();
    /** @type {string[]} */
    this.warnings = [];
  }

  /**
   * @param {import('../registry/definition.js').AgentDefinition} definition
   * @returns {Promise<{ prompt: string|null, inputSchema: object|null, outputSchema: object|null }>}
   */
  async contractsFor(definition) {
    const [prompt, inputSchema, outputSchema] = await Promise.all([
      this.loadPrompt(definition.prompt ?? `builtin:${definition.id}`, definition.id),
      this.loadSchema(definition.inputSchema ?? `builtin:${definition.id}`, definition.id, 'input'),
      this.loadSchema(definition.outputSchema ?? `builtin:${definition.id}`, definition.id, 'output')
    ]);
    return { prompt, inputSchema, outputSchema };
  }

  /**
   * @returns {Promise<object|null>} null when the agent declares no contract.
   */
  async loadSchema(ref, agentId, kind) {
    if (ref == null) return null;
    if (typeof ref === 'object') return ref;

    const key = `schema:${kind}:${ref}:${agentId}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const file = this.#resolve(ref, agentId, `${kind}.schema.json`);
    const schema = file ? await this.#readJson(file, `${agentId} ${kind} schema`) : null;
    this.cache.set(key, schema);
    return schema;
  }

  /**
   * @returns {Promise<string|null>}
   */
  async loadPrompt(ref, agentId) {
    if (ref == null) return null;
    if (typeof ref === 'string' && ref.includes('\n')) return ref;

    const key = `prompt:${ref}:${agentId}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const file = this.#resolve(ref, agentId, 'prompt.js');
    const prompt = file ? await this.#readPrompt(file, agentId) : null;
    this.cache.set(key, prompt);
    return prompt;
  }

  #resolve(ref, agentId, builtinFile) {
    const value = String(ref);
    if (value.startsWith('builtin:')) {
      const id = value.slice('builtin:'.length) || agentId;
      return path.join(this.agentsDir, id, builtinFile);
    }
    return path.isAbsolute(value) ? value : path.join(this.root, value);
  }

  async #readJson(file, label) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      // A missing contract is not fatal: the agent simply runs unvalidated.
      // A malformed one is worth saying out loud, because it silently disables
      // the very check the project asked for.
      if (error?.code !== 'ENOENT') {
        this.warnings.push(`${label} could not be read (${file}): ${message(error)}`);
      }
      return null;
    }
  }

  /**
   * Prompts are modules so they can compose the shared base rules. A plain
   * text/markdown file is accepted too, for projects that keep prompts as docs.
   */
  async #readPrompt(file, agentId) {
    if (/\.(md|txt)$/i.test(file)) {
      try {
        return await readFile(file, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') this.warnings.push(`${agentId} prompt unreadable (${file}): ${message(error)}`);
        return null;
      }
    }

    try {
      const module = await import(pathToFileURL(file).href);
      const value = module.default ?? module.PROMPT ?? module.prompt ?? null;
      if (typeof value === 'function') return String(value());
      return typeof value === 'string' ? value : null;
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
        this.warnings.push(`${agentId} prompt module failed to load (${file}): ${message(error)}`);
      }
      return null;
    }
  }
}

export function createContractLoader(options) {
  return new ContractLoader(options);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
