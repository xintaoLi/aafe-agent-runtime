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

/**
 * Detect which test runner a project uses, from declared dependencies rather
 * than from guessing at file layout.
 *
 * @typedef DetectedRunner
 * @property {'playwright'|'cypress'|'vitest'|'jest'|null} id
 * @property {'e2e'|'unit'|null} kind
 * @property {string|null} command   npm script that runs it, when one exists.
 * @property {string[]} evidence
 */

const RUNNERS = [
  { id: 'playwright', kind: 'e2e', packages: ['@playwright/test', 'playwright'] },
  { id: 'cypress', kind: 'e2e', packages: ['cypress'] },
  { id: 'vitest', kind: 'unit', packages: ['vitest'] },
  { id: 'jest', kind: 'unit', packages: ['jest', '@jest/globals'] }
];

/**
 * @returns {Promise<{ e2e: DetectedRunner, unit: DetectedRunner, scripts: Record<string,string> }>}
 */
export async function detectTestRunners(root) {
  const pkg = await readJson(path.join(root, 'package.json')) ?? {};
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};

  const found = RUNNERS
    .map((runner) => {
      const packages = runner.packages.filter((name) => declared[name]);
      if (packages.length === 0) return null;
      return {
        id: runner.id,
        kind: runner.kind,
        command: findScript(scripts, runner.id),
        evidence: packages.map((name) => `package.json: ${name}@${declared[name]}`)
      };
    })
    .filter(Boolean);

  return {
    e2e: found.find((runner) => runner.kind === 'e2e') ?? emptyRunner(),
    unit: found.find((runner) => runner.kind === 'unit') ?? emptyRunner(),
    scripts
  };
}

/**
 * Prefer a script that names the runner, then a generic `test` script that
 * actually invokes it. A bare `test` script running something else must not be
 * reported as this runner's entry point.
 */
function findScript(scripts, runnerId) {
  const named = Object.keys(scripts).find((name) => name === runnerId || name === `test:${runnerId}`);
  if (named) return named;
  const byBody = Object.entries(scripts).find(([, body]) => new RegExp(`(^|[\\s/])${runnerId}(\\s|$)`).test(body));
  return byBody ? byBody[0] : null;
}

function emptyRunner() {
  return { id: null, kind: null, command: null, evidence: [] };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
