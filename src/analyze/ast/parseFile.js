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

import { parse } from '@babel/parser';
import path from 'node:path';

/**
 * Parse a source file into Babel AST. Vue SFC extracts script blocks first.
 * @returns {{ ast: object|null, scripts: Array<{lang:string,setup:boolean,code:string}>, warnings: string[], kind: string }}
 */
export function parseSourceFile(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const warnings = [];

  if (ext === '.vue') {
    const scripts = extractVueScripts(content);
    const trees = [];
    for (const script of scripts) {
      const parsed = tryParse(script.code, filePath, script.lang, warnings);
      if (parsed) trees.push({ ...script, ast: parsed });
    }
    return {
      kind: 'vue-sfc',
      scripts,
      ast: trees[0]?.ast ?? null,
      scriptTrees: trees,
      warnings
    };
  }

  const lang = ext === '.ts' || ext === '.tsx' ? 'ts' : 'js';
  const isJsx = ext === '.tsx' || ext === '.jsx';
  const ast = tryParse(content, filePath, lang, warnings, isJsx);
  return {
    kind: 'script',
    scripts: [{ lang, setup: false, code: content }],
    ast,
    scriptTrees: ast ? [{ lang, setup: false, code: content, ast }] : [],
    warnings
  };
}

export function extractVueScripts(content) {
  const scripts = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(content))) {
    const attrs = match[1] ?? '';
    const code = match[2] ?? '';
    const langMatch = attrs.match(/\blang\s*=\s*['"]([^'"]+)['"]/i);
    const lang = (langMatch?.[1] ?? 'js').toLowerCase().replace(/^tsx?$/, (v) => v);
    scripts.push({
      lang: lang.includes('ts') ? 'ts' : 'js',
      setup: /\bsetup\b/i.test(attrs),
      code
    });
  }
  return scripts;
}

function tryParse(code, filePath, lang, warnings, forceJsx = false) {
  if (!code || !String(code).trim()) return null;
  const plugins = [];
  if (lang === 'ts' || filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    plugins.push('typescript');
  }
  if (forceJsx || filePath.endsWith('.tsx') || filePath.endsWith('.jsx') || /<[A-Z/!]/.test(code)) {
    plugins.push('jsx');
  }
  plugins.push('importAttributes', 'topLevelAwait', 'classProperties', 'decorators-legacy');

  try {
    return parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      plugins
    });
  } catch (error) {
    // Retry as script for CJS
    try {
      return parse(code, {
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        errorRecovery: true,
        plugins
      });
    } catch (retryError) {
      warnings.push(`${filePath}: ${retryError.message || error.message}`);
      return null;
    }
  }
}
