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
import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import { parseTestReport, stackFileRefs } from '../../testing/reportParser.js';
import { collectDiffFacts } from '../../static-analysis/git/DiffFacts.js';
import { flowsForModules } from '../../knowledge/graph/relations.js';
import { deriveRisk, normalizeModuleId } from '../../knowledge/model/index.js';
import { classifyFailure, dominantClassification, fixSuggestions } from './classify.js';

/**
 * A4 — Failure Analyzer (RFC §16).
 *
 * Turns a raw test failure into a located one. The chain is deliberately
 * deterministic: parse the report, classify by signature, walk the stack down
 * to project files, map those to modules, and rank them by whether the diff
 * touched them. An LLM is not needed to know that the frame you just edited
 * and that appears in the stack is the place to look.
 */
export class FailureAnalyzerAgent {
  id = 'failure-analyzer';
  version = '1.0.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const root = request.context?.root ?? process.cwd();
    const knowledge = request.context?.knowledge ?? this.knowledge;

    const source = await this.#loadReport(request, root);
    if (source.error) return agentSkipped(source.error);

    const { report } = source;
    if (report.failures.length === 0) {
      return agentSuccess(
        { status: report.status, totals: report.totals, format: report.format, failures: [] },
        { metrics: { duration: 0 } }
      );
    }

    const started = Date.now();
    const diff = await collectDiffFacts(root, request.input?.diffRef ?? request.context?.task?.diffRef ?? null);
    const changedFiles = (diff.files ?? []).map((file) => file.path);

    const diagnoses = [];
    for (const failure of report.failures.slice(0, 20)) {
      diagnoses.push(await this.#diagnose(failure, { root, knowledge, changedFiles }));
    }

    const classification = dominantClassification(diagnoses.map((item) => item.classification));
    const relatedFiles = unique(diagnoses.flatMap((item) => item.relatedFiles));
    const moduleIds = unique(diagnoses.flatMap((item) => item.modules));
    const relatedDataFlows = await this.#flows(knowledge, moduleIds);

    const risk = deriveRisk({
      moduleCount: moduleIds.length,
      fileCount: relatedFiles.length,
      architectureRisks: classification === 'environment' ? 0 : diagnoses.length
    });

    const result = {
      status: report.status,
      format: report.format,
      source: source.ref,
      totals: report.totals,
      classification,
      rootCause: summarizeRootCause(diagnoses, classification, changedFiles),
      relatedFiles,
      relatedModules: moduleIds,
      relatedDataFlows,
      risk,
      fixSuggestions: fixSuggestions(classification, {
        files: relatedFiles,
        changedFiles,
        classifications: diagnoses.map((item) => item.classification)
      }),
      regressionTests: diagnoses.map((item) => item.title).slice(0, 10),
      diff: { ref: diff.ref, status: diff.status, changedFiles: changedFiles.slice(0, 40) },
      failures: diagnoses
    };

    const response = {
      metrics: { duration: Date.now() - started },
      evidence: relatedFiles.slice(0, 10).map((file) => ({ file, reason: 'appears in the failing stack' })),
      // The blast radius of the fix still has to be re-scoped before editing.
      nextActions: classification === 'environment'
        ? []
        : [{ capability: 'change-impact', reason: 'a fix needs its blast radius re-evaluated' }]
    };

    // An unlocated failure is a real answer, but a weaker one — say so.
    return relatedFiles.length === 0
      ? agentPartial(result, 'the failure could not be traced to a project file', response)
      : agentSuccess(result, response);
  }

  async #diagnose(failure, { root, knowledge, changedFiles }) {
    const classified = classifyFailure(failure);
    const frames = stackFileRefs(`${failure.stack ?? ''}\n${failure.message ?? ''}`);

    const projectFiles = [];
    for (const frame of frames) {
      const relative = toProjectPath(frame.file, root);
      // Frames inside dependencies describe someone else's code, not this bug.
      if (!relative || relative.includes('node_modules')) continue;
      if (!projectFiles.some((item) => item.file === relative)) {
        projectFiles.push({ file: relative, line: frame.line });
      }
    }
    if (projectFiles.length === 0 && failure.file) {
      const relative = toProjectPath(failure.file, root);
      if (relative) projectFiles.push({ file: relative, line: null });
    }

    const modules = [];
    for (const entry of projectFiles) {
      const moduleId = await knowledge?.findModuleByFile(entry.file);
      if (moduleId && !modules.includes(normalizeModuleId(moduleId))) modules.push(normalizeModuleId(moduleId));
    }

    // The topmost frame that the diff also touched is the strongest candidate;
    // otherwise fall back to the topmost project frame.
    const suspect = projectFiles.find((entry) => changedFiles.includes(entry.file)) ?? projectFiles[0] ?? null;

    return {
      title: failure.title,
      classification: classified.classification,
      confidence: classified.confidence,
      reason: classified.hint,
      message: truncate(failure.message, 400),
      testFile: failure.file ? toProjectPath(failure.file, root) : null,
      suspect: suspect ? { ...suspect, inDiff: changedFiles.includes(suspect.file) } : null,
      relatedFiles: projectFiles.map((entry) => entry.file),
      modules,
      artifacts: failure.artifacts ?? null
    };
  }

  async #flows(knowledge, moduleIds) {
    if (!knowledge || moduleIds.length === 0) return [];
    try {
      const relations = await knowledge.relations();
      return flowsForModules(relations.dataflow, moduleIds).slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * Accepts a file path, inline text, or the report a prior `e2e-execution`
   * node already produced, so the loop works whether it is driven by the
   * orchestrator or by a developer pointing at a CI log.
   */
  async #loadReport(request, root) {
    const inline = request.input?.report ?? request.input?.output;
    if (inline && typeof inline === 'object' && Array.isArray(inline.failures)) {
      return { report: inline, ref: 'inline' };
    }
    if (typeof inline === 'string' && inline.trim()) {
      return { report: parseTestReport(inline), ref: 'inline' };
    }

    const prior = toEntries(request.context?.priorResults).get('e2e-execution')?.result;
    if (prior?.report) return { report: prior.report, ref: `e2e-execution:${prior.command ?? prior.runner}` };

    const ref = request.input?.failureRef ?? request.context?.task?.failureRef ?? null;
    if (!ref) {
      return { error: 'no-failure-artifact-provided' };
    }

    try {
      const file = path.isAbsolute(ref) ? ref : path.join(root, ref);
      return { report: parseTestReport(await readFile(file, 'utf8')), ref };
    } catch (error) {
      return { error: `failure-artifact-unreadable:${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

function summarizeRootCause(diagnoses, classification, changedFiles) {
  const located = diagnoses.find((item) => item.suspect?.inDiff) ?? diagnoses.find((item) => item.suspect);
  const count = diagnoses.length;
  const scope = count === 1 ? '1 test' : `${count} tests`;

  if (classification === 'environment') {
    return `${scope} failed before reaching the code under test: ${diagnoses[0]?.message ?? 'environment error'}.`;
  }
  if (!located?.suspect) {
    return `${scope} failed (${classification}) but no project file appears in the stack.`;
  }

  const where = `${located.suspect.file}${located.suspect.line ? `:${located.suspect.line}` : ''}`;
  return located.suspect.inDiff
    ? `${scope} failed (${classification}); the topmost project frame is ${where}, which this diff modified.`
    : `${scope} failed (${classification}); the topmost project frame is ${where}, untouched by the current diff${changedFiles.length > 0 ? ' — the cause may be indirect' : ''}.`;
}

function toProjectPath(file, root) {
  if (!file) return null;
  const normalized = String(file).replace(/\\/g, '/');
  const absoluteRoot = `${root.replace(/\\/g, '/')}/`;
  if (normalized.startsWith(absoluteRoot)) return normalized.slice(absoluteRoot.length);
  if (path.isAbsolute(normalized)) return null;
  return normalized.replace(/^\.\//, '');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function truncate(text, limit) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function toEntries(priorResults) {
  if (!priorResults) return new Map();
  return priorResults instanceof Map ? priorResults : new Map(Object.entries(priorResults));
}
