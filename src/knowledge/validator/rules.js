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
import path from 'node:path';
import { normalizeModuleId } from '../model/index.js';

/**
 * Deterministic knowledge checks (RFC §18).
 *
 * Bad knowledge poisons every downstream agent, so these run on plain rules
 * rather than a model: a file either exists or it does not.
 *
 * @typedef Finding
 * @property {'ok'|'downgrade'|'reject'} verdict
 * @property {string} rule
 * @property {string} target
 * @property {string} [detail]
 */

export async function validateFileExists(root, file) {
  if (!file) return finding('reject', 'file-exists', String(file), 'empty path');
  try {
    await access(path.join(root, file));
    return finding('ok', 'file-exists', file);
  } catch {
    return finding('reject', 'file-exists', file, 'path not found on disk');
  }
}

export function validateHasEvidence(kind, item) {
  const evidence = item?.evidence ?? [];
  if (evidence.length === 0) {
    return finding('downgrade', 'has-evidence', item?.id ?? kind, 'no code evidence attached');
  }
  const withoutFile = evidence.filter((entry) => !entry?.file);
  if (withoutFile.length === evidence.length) {
    return finding('downgrade', 'has-evidence', item?.id ?? kind, 'evidence carries no file reference');
  }
  return finding('ok', 'has-evidence', item?.id ?? kind);
}

/**
 * A dependency edge is real only when both endpoints are known modules.
 */
export function validateDependency(relation, knownModuleIds) {
  const from = normalizeModuleId(relation?.from);
  const to = normalizeModuleId(relation?.to);
  if (!knownModuleIds.has(from)) {
    return finding('reject', 'dependency-endpoints', `${from}->${to}`, `unknown module "${from}"`);
  }
  if (!knownModuleIds.has(to)) {
    return finding('reject', 'dependency-endpoints', `${from}->${to}`, `unknown module "${to}"`);
  }
  return finding('ok', 'dependency-endpoints', `${from}->${to}`);
}

/**
 * A flow must resolve to files the repository actually contains.
 */
export function validateFlowTraceable(flow, knownFiles) {
  const nodes = (flow?.nodes ?? []).map((node) => String(node).replace(/^file:/, ''));
  const fileNodes = nodes.filter((node) => node.includes('/'));
  if (fileNodes.length === 0) {
    return finding('downgrade', 'flow-traceable', flow?.id ?? 'flow', 'flow has no file-level node');
  }
  const missing = fileNodes.filter((node) => !knownFiles.has(node));
  if (missing.length === fileNodes.length) {
    return finding('reject', 'flow-traceable', flow?.id ?? 'flow', `no node resolves: ${missing.slice(0, 3).join(', ')}`);
  }
  if (missing.length > 0) {
    return finding('downgrade', 'flow-traceable', flow?.id ?? 'flow', `${missing.length} unresolved node(s)`);
  }
  return finding('ok', 'flow-traceable', flow?.id ?? 'flow');
}

/**
 * Symbol must appear in the extracted component/symbol set of its file.
 */
export function validateSymbol(symbolName, file, knownSymbols) {
  const key = `${file}:${symbolName}`;
  if (knownSymbols.has(key) || knownSymbols.has(symbolName)) {
    return finding('ok', 'symbol-exists', key);
  }
  return finding('downgrade', 'symbol-exists', key, 'symbol not present in extracted AST facts');
}

export function summarizeFindings(findings) {
  const summary = { ok: 0, downgrade: 0, reject: 0 };
  for (const item of findings) summary[item.verdict] += 1;
  return summary;
}

/**
 * Turn rejects/downgrades into knowledge updates the orchestrator records, so
 * the context agent can trust what it receives.
 */
export function findingsToKnowledgeUpdates(findings, kind) {
  return findings
    .filter((item) => item.verdict !== 'ok')
    .map((item) => ({
      op: item.verdict === 'reject' ? 'drop' : 'downgrade',
      kind,
      id: item.target,
      reason: `${item.rule}: ${item.detail ?? item.verdict}`
    }));
}

function finding(verdict, rule, target, detail) {
  return { verdict, rule, target, ...(detail ? { detail } : {}) };
}
