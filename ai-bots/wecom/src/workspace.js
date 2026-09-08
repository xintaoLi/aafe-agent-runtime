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

import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function parseWorkspaces(raw, { root, repository, baseBranch } = {}) {
  const list = [];
  const seen = new Set();
  const entries = Array.isArray(raw) ? raw : [];
  for (const [index, item] of entries.entries()) {
    const workspace = normalizeWorkspace(item, { root, index });
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    list.push(workspace);
  }
  if (!list.length && repository) {
    list.push(normalizeWorkspace({
      id: 'default',
      name: '默认仓库',
      repository,
      baseBranch
    }, { root, index: 0 }));
  }
  return list.filter(Boolean);
}

export function normalizeWorkspace(raw, { root, index = 0 } = {}) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const classified = classifyWorkspaceTarget(raw, root);
    if (classified.kind === 'unknown') return null;
    return toWorkspace({
      id: classified.kind === 'local' ? `local-${index + 1}` : `repo-${index + 1}`,
      name: classified.kind === 'local' ? path.basename(classified.cwd) : classified.repository,
      ...classified
    }, root);
  }
  const repository = nonEmpty(raw.repository ?? raw.repo ?? raw.url);
  const cwd = resolveUserPath(raw.cwd ?? raw.path ?? raw.root, root);
  if (!repository && !cwd) return null;
  return toWorkspace({
    id: slug(raw.id ?? raw.name ?? (cwd ? path.basename(cwd) : repository) ?? `ws-${index + 1}`),
    name: nonEmpty(raw.name ?? raw.title) ?? (cwd ? path.basename(cwd) : repository),
    cwd,
    repository,
    baseBranch: nonEmpty(raw.baseBranch ?? raw.branch) ?? 'main'
  }, root);
}

export function createWorkspaceStore(config = {}, { persistCurrent } = {}) {
  const root = path.resolve(config.root ?? process.cwd());
  const workspaces = parseWorkspaces(config.workspaces, {
    root,
    repository: config.repository,
    baseBranch: config.baseBranch
  });
  let currentId = pickCurrentId(workspaces, config.currentWorkspace);
  const perConversation = new Map();

  function find(idOrName) {
    const key = String(idOrName ?? '').trim().toLowerCase();
    if (!key) return null;
    return workspaces.find((item) => item.id === key || item.name.toLowerCase() === key) ?? null;
  }

  return {
    root,
    list: () => [...workspaces],
    hasConfigured: () => workspaces.length > 0,
    getActive(conversationId) {
      const override = conversationId ? perConversation.get(conversationId) : null;
      return find(override) ?? find(currentId) ?? null;
    },
    switchTo(idOrName, { conversationId = null, persist = true } = {}) {
      const workspace = find(idOrName);
      if (!workspace) return null;
      if (conversationId) perConversation.set(conversationId, workspace.id);
      currentId = workspace.id;
      if (persist && typeof persistCurrent === 'function') {
        void persistCurrent(workspace.id).catch(() => {});
      }
      return workspace;
    },
    remember(conversationId, workspace) {
      if (conversationId && workspace?.id) perConversation.set(conversationId, workspace.id);
      return workspace;
    }
  };
}

export function classifyWorkspaceTarget(raw, root) {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'unknown' };
  // `local` is what the workspace picker card sends for 当前目录.
  if (/^(?:本地|当前目录|运行目录|bot目录|local|here|\.)$/i.test(text)) {
    return { kind: 'local', cwd: path.resolve(root) };
  }
  if (/tapd\.(?:woa\.com|cn)/i.test(text)) return { kind: 'unknown' };
  if (/^git@/i.test(text)
    || /(?:github\.com|gitlab\.com|git\.woa\.com|git\.tencent\.com|git\.code\.tencentyun\.com)\//i.test(text)
    || /^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(text)) {
    return { kind: 'remote', repository: text.replace(/\.git$/, '') };
  }
  if (text.startsWith('/') || text.startsWith('~/') || text.startsWith('./') || text.startsWith('../')) {
    return { kind: 'local', cwd: resolveUserPath(text, root) };
  }
  return { kind: 'unknown' };
}

/** Explicit labels only: file paths and PR URLs elsewhere are not a checkout. */
export function extractWorkspaceTargets(text) {
  const targets = [];
  const pattern = /(?:目标仓库|仓库路径|仓库目录|目标工作区|工作区|仓库)\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s，,；;。]+))/g;
  for (const match of String(text ?? '').matchAll(pattern)) {
    const target = (match[1] ?? match[2] ?? match[3] ?? match[4]).trim();
    if (target && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

export async function assertLocalWorkspace(cwd) {
  const resolved = path.resolve(cwd);
  await access(resolved);
  return resolved;
}

export function formatWorkspaceList(workspaces, currentId) {
  if (!workspaces.length) {
    return [
      '还没有配置仓库。代码任务会先询问：',
      '- 使用 Bot 运行目录',
      '- 或发送本地路径 / 远程仓库地址',
      '也可在 wecom.local.json 里配置 workspaces 后发送「切换」。'
    ].join('\n');
  }
  return [
    '可用仓库：',
    ...workspaces.map((item) => {
      const mark = item.id === currentId ? '（当前）' : '';
      return `- ${item.id} ${item.name}${mark}  ${describeWorkspace(item)}`;
    }),
    '发送「切换 <id>」或点卡片按钮切换。'
  ].join('\n');
}

export function formatWorkspacePrompt(botRoot, workspaces = []) {
  const lines = [
    '这是代码任务，需要先选定仓库（按 AAFE git 流程执行）。',
    `Bot 运行目录：${path.resolve(botRoot)}`,
    '请选择：',
    '1. 发送「本地」使用运行目录',
    '2. 发送本地路径，如 `/path/to/repo`',
    '3. 发送远程仓库，如 `owner/repo` 或 git URL'
  ];
  if (workspaces.length) {
    lines.push('', '已配置：', ...workspaces.map((item) => `- ${item.id} ${item.name}`));
    lines.push('也可发送「切换 <id>」。');
  }
  return lines.join('\n');
}

export function describeWorkspace(workspace) {
  if (workspace?.repository) return workspace.repository;
  if (workspace?.cwd) return workspace.cwd;
  return '-';
}

export function toTaskWorkspace(workspace, root) {
  if (!workspace) return null;
  const cwd = workspace.cwd ? path.resolve(workspace.cwd) : path.resolve(root);
  if (workspace.repository) {
    return {
      id: workspace.id,
      name: workspace.name,
      cwd,
      repository: workspace.repository,
      baseBranch: workspace.baseBranch ?? 'main',
      mode: 'cloud'
    };
  }
  return {
    id: workspace.id ?? 'local',
    name: workspace.name ?? path.basename(cwd),
    cwd,
    repository: null,
    baseBranch: workspace.baseBranch ?? 'main',
    mode: 'local'
  };
}

function toWorkspace(input, root) {
  const cwd = input.cwd ? path.resolve(input.cwd) : (input.repository ? null : path.resolve(root));
  return {
    id: slug(input.id),
    name: String(input.name ?? input.id),
    cwd,
    repository: input.repository ?? null,
    baseBranch: input.baseBranch ?? 'main',
    mode: input.repository ? 'cloud' : 'local'
  };
}

function pickCurrentId(workspaces, preferred) {
  if (preferred && workspaces.some((item) => item.id === slug(preferred) || item.name === preferred)) {
    return workspaces.find((item) => item.id === slug(preferred) || item.name === preferred).id;
  }
  return workspaces[0]?.id ?? null;
}

function resolveUserPath(value, root) {
  const text = nonEmpty(value);
  if (!text) return null;
  if (text === '.' ) return path.resolve(root);
  if (text.startsWith('~/')) return path.resolve(os.homedir(), text.slice(2));
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(root, text);
}

function slug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'ws';
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}
