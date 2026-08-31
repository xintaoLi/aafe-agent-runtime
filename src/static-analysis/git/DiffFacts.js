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
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Deterministic git facts for diff-driven impact analysis.
 *
 * @typedef ChangedFile
 * @property {string} path
 * @property {'added'|'modified'|'deleted'|'renamed'} change
 * @property {number} added
 * @property {number} removed
 * @property {string} [from]   Previous path for renames.
 */

/**
 * @param {string} root
 * @param {string|null} ref  A commit, range (`main...HEAD`) or null for the
 *                           working tree (staged + unstaged + untracked).
 * @returns {Promise<{ status:'ok'|'unavailable', ref:string, files:ChangedFile[], reason?:string }>}
 */
export async function collectDiffFacts(root, ref = null) {
  if (!(await isGitRepository(root))) {
    return { status: 'unavailable', ref: ref ?? 'working-tree', files: [], reason: 'not-a-git-repository' };
  }

  try {
    const files = ref ? await diffAgainstRef(root, ref) : await workingTreeDiff(root);
    return { status: 'ok', ref: ref ?? 'working-tree', files };
  } catch (error) {
    return {
      status: 'unavailable',
      ref: ref ?? 'working-tree',
      files: [],
      reason: `git-failed:${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function diffAgainstRef(root, ref) {
  const [nameStatus, numstat] = await Promise.all([
    git(root, ['diff', '--name-status', '-M', ref]),
    git(root, ['diff', '--numstat', '-M', ref])
  ]);
  return merge(parseNameStatus(nameStatus), parseNumstat(numstat));
}

async function workingTreeDiff(root) {
  const [nameStatus, numstat, untracked] = await Promise.all([
    git(root, ['diff', '--name-status', '-M', 'HEAD']),
    git(root, ['diff', '--numstat', '-M', 'HEAD']),
    git(root, ['ls-files', '--others', '--exclude-standard'])
  ]);

  const files = merge(parseNameStatus(nameStatus), parseNumstat(numstat));
  const known = new Set(files.map((file) => file.path));
  for (const line of splitLines(untracked)) {
    if (known.has(line)) continue;
    files.push({ path: line, change: 'added', added: 0, removed: 0 });
  }
  return files;
}

function parseNameStatus(output) {
  const files = [];
  for (const line of splitLines(output)) {
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    if (code.startsWith('R') && parts.length >= 3) {
      files.push({ path: parts[2], change: 'renamed', from: parts[1], added: 0, removed: 0 });
      continue;
    }
    if (parts.length < 2) continue;
    files.push({ path: parts[1], change: statusToChange(code), added: 0, removed: 0 });
  }
  return files;
}

function parseNumstat(output) {
  const stats = new Map();
  for (const line of splitLines(output)) {
    const [added, removed, ...rest] = line.split('\t');
    const file = rest.join('\t');
    if (!file) continue;
    // Renames appear as `old => new`; attribute the churn to the new path.
    const resolved = file.includes(' => ') ? file.split(' => ').pop().replace(/[{}]/g, '') : file;
    stats.set(resolved, {
      added: added === '-' ? 0 : Number(added) || 0,
      removed: removed === '-' ? 0 : Number(removed) || 0
    });
  }
  return stats;
}

function merge(files, stats) {
  return files.map((file) => ({ ...file, ...(stats.get(file.path) ?? {}) }));
}

function statusToChange(code) {
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  return 'modified';
}

async function isGitRepository(root) {
  try {
    await git(root, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function splitLines(output) {
  return String(output ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}
