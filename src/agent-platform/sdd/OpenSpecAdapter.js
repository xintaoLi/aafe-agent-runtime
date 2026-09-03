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

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateSDDChangeId } from './SDDStore.js';

const CAPABILITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ARTIFACT_FILES = Object.freeze({
  proposal: 'proposal.md',
  design: 'design.md',
  tasks: 'tasks.md'
});

export class OpenSpecAdapter {
  constructor({ root = process.cwd(), openspecRoot = 'openspec' } = {}) {
    this.root = path.resolve(root);
    this.openspecRoot = resolveWithin(this.root, openspecRoot);
    this.changesDir = path.join(this.openspecRoot, 'changes');
    this.specsDir = path.join(this.openspecRoot, 'specs');
  }

  async createChange(change) {
    const changeId = validateSDDChangeId(change.changeId);
    const directory = this.changeDir(changeId);
    if (await exists(directory)) throw new Error(`openspec-change-already-exists:${changeId}`);
    await mkdir(path.join(directory, 'specs'), { recursive: true });
    await atomicWrite(path.join(directory, '.openspec.yaml'), renderMetadata(change));
    return {
      changeId,
      absolutePath: directory,
      path: toRelativePosix(this.root, directory)
    };
  }

  async removeChange(changeId) {
    await rm(this.changeDir(changeId), { recursive: true, force: true });
  }

  changeDir(changeId) {
    return path.join(this.changesDir, validateSDDChangeId(changeId));
  }

  artifactPath(changeId, artifact, capability = null) {
    const directory = this.changeDir(changeId);
    if (artifact === 'spec') {
      return path.join(directory, 'specs', validateCapability(capability), 'spec.md');
    }
    const file = ARTIFACT_FILES[artifact];
    if (!file) throw new Error(`unknown-openspec-artifact:${artifact}`);
    return path.join(directory, file);
  }

  async writeArtifact(changeId, artifact, content, { capability = null } = {}) {
    const file = this.artifactPath(changeId, artifact, capability);
    await access(this.changeDir(changeId));
    await atomicWrite(file, normalizeMarkdown(content));
    return {
      absolutePath: file,
      path: toRelativePosix(this.root, file)
    };
  }

  async readArtifact(changeId, artifact, { capability = null } = {}) {
    return safeRead(this.artifactPath(changeId, artifact, capability));
  }

  async deleteArtifact(changeId, artifact, { capability = null } = {}) {
    await rm(this.artifactPath(changeId, artifact, capability), { force: true });
  }

  async readChange(changeId) {
    const id = validateSDDChangeId(changeId);
    const directory = this.changeDir(id);
    await access(directory);
    const [proposal, design, tasks, specs] = await Promise.all([
      safeRead(path.join(directory, 'proposal.md')),
      safeRead(path.join(directory, 'design.md')),
      safeRead(path.join(directory, 'tasks.md')),
      readSpecs(path.join(directory, 'specs'))
    ]);
    return {
      changeId: id,
      path: toRelativePosix(this.root, directory),
      proposal,
      design,
      tasks,
      specs
    };
  }

  async readConfig() {
    const text = await safeRead(path.join(this.openspecRoot, 'config.yaml'));
    if (text == null) return { schema: 'spec-driven', context: null, raw: null };
    return {
      schema: scalarValue(text, 'schema') ?? 'spec-driven',
      context: blockValue(text, 'context'),
      raw: text
    };
  }

  async planSync(changeId) {
    const change = await this.readChange(changeId);
    const writes = [];
    for (const [capability, deltaText] of Object.entries(change.specs)) {
      const target = path.join(this.specsDir, validateCapability(capability), 'spec.md');
      const current = await safeRead(target);
      const merged = mergeOpenSpecDelta(current, deltaText, capability);
      writes.push({
        capability,
        target,
        path: toRelativePosix(this.root, target),
        content: merged.content,
        changes: merged.changes
      });
    }
    return { changeId: change.changeId, writes };
  }

  async sync(changeId, { dryRun = false } = {}) {
    const plan = await this.planSync(changeId);
    if (!dryRun) {
      for (const write of plan.writes) await atomicWrite(write.target, write.content);
    }
    return {
      changeId: plan.changeId,
      dryRun,
      specs: plan.writes.map(({ capability, path: file, changes }) => ({ capability, path: file, changes }))
    };
  }

  async archive(changeId, { dryRun = false, now = new Date() } = {}) {
    const id = validateSDDChangeId(changeId);
    const source = this.changeDir(id);
    await access(source);
    const date = now.toISOString().slice(0, 10);
    const target = path.join(this.changesDir, 'archive', `${date}-${id}`);
    if (await exists(target)) throw new Error(`openspec-archive-already-exists:${date}-${id}`);
    if (!dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
    }
    return {
      changeId: id,
      dryRun,
      from: toRelativePosix(this.root, source),
      to: toRelativePosix(this.root, target)
    };
  }

  async restoreArchive(result) {
    if (!result || result.dryRun) return;
    const source = resolveWithin(this.root, result.to);
    const target = resolveWithin(this.root, result.from);
    if (!(await exists(source))) return;
    if (await exists(target)) throw new Error(`openspec-active-change-already-exists:${result.changeId}`);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
  }
}

export function parseOpenSpecDelta(text) {
  const lines = normalizeMarkdown(text).trimEnd().split('\n');
  const requirements = [];
  let operation = null;
  let current = null;
  let purpose = null;
  let purposeLines = null;

  const flush = () => {
    if (!current) return;
    current.content = `${current.lines.join('\n').trimEnd()}\n`;
    delete current.lines;
    requirements.push(current);
    current = null;
  };

  for (const line of lines) {
    const purposeHeading = /^##\s+Purpose\s*$/i.test(line);
    const operationHeading = line.match(/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i);
    const requirementHeading = line.match(/^###\s+Requirement:\s*(.+?)\s*$/i);
    const secondLevelHeading = /^##\s+/.test(line);

    if (purposeHeading) {
      flush();
      operation = null;
      purposeLines = [];
      continue;
    }
    if (operationHeading) {
      flush();
      if (purposeLines) {
        purpose = purposeLines.join('\n').trim();
        purposeLines = null;
      }
      operation = operationHeading[1].toUpperCase();
      continue;
    }
    if (secondLevelHeading) {
      flush();
      if (purposeLines) {
        purpose = purposeLines.join('\n').trim();
        purposeLines = null;
      }
      operation = null;
      continue;
    }
    if (purposeLines) {
      purposeLines.push(line);
      continue;
    }
    if (requirementHeading && operation) {
      flush();
      current = {
        operation,
        title: requirementHeading[1].trim(),
        lines: [line]
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  if (purposeLines) purpose = purposeLines.join('\n').trim();
  return { purpose, requirements };
}

export function parseOpenSpecRequirements(text) {
  const source = normalizeMarkdown(text);
  const lines = source.trimEnd().split('\n');
  const requirements = [];
  let current = null;
  let firstStart = -1;
  let lastEnd = -1;

  const flush = (end) => {
    if (!current) return;
    current.end = end;
    current.content = `${lines.slice(current.start, end).join('\n').trimEnd()}\n`;
    requirements.push(current);
    lastEnd = end;
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^###\s+Requirement:\s*(.+?)\s*$/i);
    if (match) {
      flush(index);
      if (firstStart < 0) firstStart = index;
      current = { title: match[1].trim(), start: index };
      continue;
    }
    if (current && /^##\s+/.test(lines[index])) flush(index);
  }
  flush(lines.length);
  return {
    requirements,
    prefix: firstStart < 0 ? source.trimEnd() : lines.slice(0, firstStart).join('\n').trimEnd(),
    suffix: lastEnd > 0 ? lines.slice(lastEnd).join('\n').trim() : ''
  };
}

export function mergeOpenSpecDelta(currentText, deltaText, capability = 'capability') {
  const delta = parseOpenSpecDelta(deltaText);
  if (delta.requirements.length === 0) {
    throw new Error(`openspec-delta-has-no-requirements:${capability}`);
  }
  const main = parseOpenSpecRequirements(currentText ?? '');
  const ordered = main.requirements.map((item) => ({ title: item.title, content: item.content }));
  const index = new Map(ordered.map((item, position) => [normalizeTitle(item.title), position]));
  if (index.size !== ordered.length) {
    throw new Error(`openspec-main-spec-has-duplicate-requirements:${capability}`);
  }
  const seen = new Set();
  const changes = { added: [], modified: [], removed: [] };

  for (const requirement of delta.requirements) {
    const key = normalizeTitle(requirement.title);
    if (seen.has(key)) {
      throw new Error(`openspec-duplicate-delta-requirement:${requirement.title}`);
    }
    seen.add(key);
    const position = index.get(key);
    if (requirement.operation === 'ADDED') {
      if (position !== undefined) throw new Error(`openspec-added-requirement-already-exists:${requirement.title}`);
      index.set(key, ordered.length);
      ordered.push({ title: requirement.title, content: requirement.content });
      changes.added.push(requirement.title);
      continue;
    }
    if (position === undefined) {
      throw new Error(`openspec-${requirement.operation.toLowerCase()}-requirement-not-found:${requirement.title}`);
    }
    if (requirement.operation === 'MODIFIED') {
      ordered[position] = { title: requirement.title, content: requirement.content };
      changes.modified.push(requirement.title);
    } else {
      ordered[position] = null;
      changes.removed.push(requirement.title);
    }
  }

  const active = ordered.filter(Boolean);
  let prefix = main.prefix;
  if (!currentText) {
    prefix = [
      `# ${titleCase(capability)} Specification`,
      '',
      '## Purpose',
      delta.purpose || `Defines the current behavior of ${capability}.`,
      '',
      '## Requirements'
    ].join('\n');
  } else if (!/##\s+Requirements\s*$/im.test(prefix)) {
    prefix = `${prefix}\n\n## Requirements`.trim();
  }
  const body = active.map((item) => item.content.trimEnd()).join('\n\n');
  const suffix = main.suffix ? `\n\n${main.suffix}` : '';
  return {
    content: `${prefix.trimEnd()}\n\n${body}${suffix}\n`,
    changes
  };
}

function renderMetadata(change) {
  return [
    `schema: ${change.schema ?? 'spec-driven'}`,
    `created: ${change.createdAt ?? new Date().toISOString()}`,
    ''
  ].join('\n');
}

async function readSpecs(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  const specs = {};
  for (const entry of entries) {
    if (!entry.isDirectory() || !CAPABILITY_PATTERN.test(entry.name)) continue;
    const content = await safeRead(path.join(directory, entry.name, 'spec.md'));
    if (content != null) specs[entry.name] = content;
  }
  return specs;
}

function validateCapability(value) {
  const capability = String(value ?? '');
  if (!CAPABILITY_PATTERN.test(capability) || capability === 'archive') {
    throw new Error(`invalid-openspec-capability:${capability}`);
  }
  return capability;
}

function resolveWithin(root, value) {
  const resolved = path.resolve(root, String(value ?? 'openspec'));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`openspec-root-outside-project:${value}`);
  }
  return resolved;
}

function toRelativePosix(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function normalizeMarkdown(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  return `${text.trimEnd()}\n`;
}

function normalizeTitle(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function titleCase(value) {
  return String(value).split(/[-_.\s]+/).filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function scalarValue(text, key) {
  const match = String(text).match(new RegExp(`^${key}:\\s*([^|>][^\\n]*)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
}

function blockValue(text, key) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*[|>]\\s*$`).test(line));
  if (start < 0) return null;
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index] && !/^\s/.test(lines[index])) break;
    body.push(lines[index].replace(/^\s{2}/, ''));
  }
  return body.join('\n').trim() || null;
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

async function safeRead(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
