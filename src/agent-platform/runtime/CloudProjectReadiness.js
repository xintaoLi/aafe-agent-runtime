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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Proves that a Cloud clone can discover AAFE through Cursor's native project
 * Rules/Skills. It intentionally does not load or flatten their contents.
 */
export async function inspectCloudProjectReadiness(root = process.cwd(), options = {}) {
  const config = options.projectConfig ?? await readJson(path.join(root, '.aafe.config.json')) ?? {};
  const layout = resolveLayout(root, config);
  const required = [
    layout.config,
    layout.skillIndex,
    layout.projectEntry,
    layout.cursorRule,
    layout.cursorSkill
  ];
  const missing = [];
  for (const file of required) {
    if (!(await exists(path.join(layout.gitRoot, file)))) missing.push(file);
  }

  const invalid = [];
  const rule = await safeRead(path.join(layout.gitRoot, layout.cursorRule));
  const skill = await safeRead(path.join(layout.gitRoot, layout.cursorSkill));
  if (rule && !rule.includes(layout.skillIndex)) {
    invalid.push(`${layout.cursorRule}:missing-skill-index-pointer`);
  }
  if (skill && !skill.includes(layout.agentPrefix)) {
    invalid.push(`${layout.cursorSkill}:missing-ai-agent-pointer`);
  }

  let tracked = [];
  let gitAvailable = true;
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', ...required], {
      cwd: layout.gitRoot,
      maxBuffer: 1024 * 1024
    });
    tracked = stdout.split('\0').filter(Boolean);
  } catch {
    gitAvailable = false;
  }
  const trackedSet = new Set(tracked);
  const untracked = gitAvailable ? required.filter((file) => !trackedSet.has(file)) : [...required];
  const ready = missing.length === 0 && invalid.length === 0 && untracked.length === 0;

  return {
    ready,
    activation: 'cursor-project-native',
    sourceOfTruth: layout.agentPrefix,
    editorPointers: path.posix.dirname(layout.cursorRule),
    required,
    missing,
    untracked,
    invalid,
    gitAvailable,
    reason: ready
      ? null
      : [
          missing.length ? `missing:${missing.join(',')}` : null,
          untracked.length ? `not-in-cloud-clone:${untracked.join(',')}` : null,
          invalid.length ? `invalid-pointer:${invalid.join(',')}` : null,
          !gitAvailable ? 'git-index-unavailable' : null
        ].filter(Boolean).join(';')
  };
}

export async function assertCloudProjectReadiness(root, options = {}) {
  const report = await inspectCloudProjectReadiness(root, options);
  if (!report.ready) {
    const error = new Error(`cloud-project-runtime-not-ready:${report.reason}`);
    error.readiness = report;
    throw error;
  }
  return report;
}

function resolveLayout(root, config) {
  const workspace = config.workspace ?? {};
  const layered = workspace.layeredEditors === true && workspace.moduleName && workspace.moduleRelativePath;
  const workspaceRoot = layered
    ? path.resolve(root, workspace.workspaceRoot ?? workspace.workspaceRootRelative ?? relativeWorkspaceRoot(workspace.moduleRelativePath))
    : root;
  const moduleName = workspace.moduleName;
  const modulePrefix = layered ? normalize(workspace.moduleRelativePath) : '';
  const agentPrefix = layered ? `${modulePrefix}/.ai-agent` : '.ai-agent';
  return {
    gitRoot: workspaceRoot,
    config: layered ? `${modulePrefix}/.aafe.config.json` : '.aafe.config.json',
    agentPrefix,
    skillIndex: `${agentPrefix}/skill-index.md`,
    projectEntry: `${agentPrefix}/project.md`,
    cursorRule: layered
      ? `.cursor/rules/${moduleName}/aafe-skill-router.mdc`
      : '.cursor/rules/aafe-skill-router.mdc',
    cursorSkill: layered
      ? `.cursor/skills/${moduleName}/aafe-runtime/SKILL.md`
      : '.cursor/skills/aafe-runtime/SKILL.md'
  };
}

function relativeWorkspaceRoot(moduleRelativePath) {
  const depth = normalize(moduleRelativePath).split('/').filter(Boolean).length;
  return Array.from({ length: depth }, () => '..').join('/') || '.';
}

function normalize(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.?\//, '').replace(/\/+$/, '');
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
