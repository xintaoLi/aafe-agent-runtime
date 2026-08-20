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

import path from 'node:path';
import { DEFAULT_ANALYZE_FORMATS, resolveAnalyzeFormats } from '../emit/formats.js';

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  'output',
  'tmp',
  'temp',
  '.ai-agent',
  '.aafe',
  '.cursor'
];

/**
 * Resolve analyze config. Output directory is always configurable.
 * Precedence: CLI --output > analyze.output > analyze.docsOut (legacy) > default `.aafe`
 * Formats: default json+jsonl+md; add mmd via analyze.formats / --formats=
 */
export function resolveAnalyzeConfig(root, projectConfig = {}, cliOptions = {}) {
  const analyze = projectConfig.analyze ?? {};
  const output = normalizeOutputPath(
    cliOptions.output
      ?? cliOptions.docsOut
      ?? analyze.output
      ?? analyze.docsOut
      ?? '.aafe'
  );

  const formats = resolveAnalyzeFormats(analyze.formats, cliOptions.formats);

  return {
    root,
    output,
    formats,
    include: analyze.include ?? ['**/*'],
    exclude: analyze.exclude ?? DEFAULT_EXCLUDE,
    languages: analyze.languages ?? ['js', 'ts', 'jsx', 'tsx', 'vue'],
    maxDepth: cliOptions.maxDepth ?? analyze.maxDepth ?? 40,
    maxFiles: cliOptions.maxFiles ?? analyze.maxFiles ?? 6000,
    maxAstFiles: cliOptions.maxAstFiles ?? analyze.maxAstFiles ?? 400,
    force: Boolean(cliOptions.force),
    skipExisting: Boolean(cliOptions.skipExisting),
    dryRun: Boolean(cliOptions.dryRun),
    write: cliOptions.write !== false,
    quiet: Boolean(cliOptions.quiet),
    architecture: { enabled: analyze.architecture?.enabled !== false },
    dataflow: { enabled: analyze.dataflow?.enabled !== false },
    features: { enabled: analyze.features?.enabled !== false },
    business: { enabled: analyze.business?.enabled !== false },
    llm: {
      enabled: Boolean(analyze.llm?.enabled),
      provider: analyze.llm?.provider ?? null,
      model: analyze.llm?.model ?? null,
      endpoint: analyze.llm?.endpoint ?? null,
      apiKey: analyze.llm?.apiKey ?? null,
      temperature: analyze.llm?.temperature,
      agents: {
        architecture: Boolean(analyze.llm?.agents?.architecture),
        dataflow: Boolean(analyze.llm?.agents?.dataflow),
        feature: Boolean(analyze.llm?.agents?.feature),
        business: Boolean(analyze.llm?.agents?.business),
        testing: Boolean(analyze.llm?.agents?.testing)
      }
    },
    architectureDocs: cliOptions.architectureDocs ?? analyze.architectureDocs ?? '.docs',
    skillsOut: analyze.skillsOut ?? '.ai-agent/skills'
  };
}

function normalizeOutputPath(value) {
  const normalized = String(value || '.aafe').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return '.aafe';
  if (path.isAbsolute(normalized)) return normalized;
  return normalized;
}

export function defaultAnalyzeConfigBlock() {
  return {
    output: '.aafe',
    formats: [...DEFAULT_ANALYZE_FORMATS],
    maxDepth: 40,
    architecture: { enabled: true },
    dataflow: { enabled: true },
    features: { enabled: true },
    business: { enabled: true },
    llm: {
      enabled: false,
      provider: null,
      model: null,
      agents: {
        architecture: false,
        dataflow: false,
        feature: false,
        business: false,
        testing: false
      }
    }
  };
}
