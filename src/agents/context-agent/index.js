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
import { estimateTokens } from '../../ide-bridge/context/tokens.js';

/**
 * A6 — Context / Evidence Agent.
 *
 * Its job is subtraction, not analysis (RFC §19): take everything the platform
 * knows and hand the IDE agent the smallest traceable slice that still answers
 * "what do I change and where". Sections are filled in priority order until
 * the token budget runs out, so the parts that matter most survive truncation.
 */
export class ContextAgent {
  id = 'context-agent';
  version = '1.0.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const knowledge = request.context?.knowledge ?? this.knowledge;
    const task = request.context?.task ?? {};
    const prior = toEntries(request.context?.priorResults);

    const validated = prior.get('knowledge-validation')?.result ?? null;
    const impact = validated?.trustedImpact
      ?? prior.get('requirement-impact')?.result
      ?? prior.get('change-impact')?.result
      ?? null;
    const diagnosis = prior.get('failure-analysis')?.result ?? null;

    if (!impact) {
      // A diagnosis alone is still worth packaging: it names files and a root
      // cause, which is exactly what the IDE agent needs to attempt the fix.
      if (diagnosis) return this.#failureOnlyPackage(diagnosis, task, knowledge, request);
      return agentSkipped('no-impact-report-available', {
        nextActions: [{ capability: 'requirement-impact', reason: 'context packaging needs an impact report' }]
      });
    }

    const started = Date.now();
    const budget = request.constraints?.tokenBudget ?? 12000;
    const manifest = knowledge ? await knowledge.manifest() : null;

    const architecture = await this.#architectureSlice(knowledge, impact);
    const evidence = collectEvidence(impact);
    const root = request.context?.root ?? process.cwd();
    const pkg = {
      task: {
        kind: task.kind ?? 'requirement',
        goal: task.goal ?? '',
        requirement: task.requirement ?? null,
        diffRef: task.diffRef ?? null
      },
      project: {
        name: manifest?.project?.name ?? null,
        commit: manifest?.analysis?.commit ?? null,
        knowledgeOutput: manifest?.output ?? '.aafe'
      },
      architecture,
      // Edges lifted out of `architecture` so a consumer can read them without
      // knowing how the architecture slice happens to be nested.
      relations: buildRelations(architecture, impact),
      // Everything above is derived; these are the statements that came
      // straight out of static analysis and can be checked without inference.
      facts: buildFacts(impact, architecture, manifest),
      affectedFiles: impact.affectedFiles ?? [],
      affectedModules: impact.affectedModules ?? [],
      affectedFeatures: impact.affectedFeatures ?? [],
      dataFlows: impact.affectedDataFlows ?? [],
      businessFlows: impact.affectedBusinessFlows ?? [],
      tests: impact.affectedTests ?? [],
      risk: impact.risk ?? 'low',
      confidence: impact.confidence ?? 0,
      constraints: buildConstraints(validated),
      evidence,
      // Real source beats a file path: the IDE agent otherwise spends its first
      // turns re-reading the files the platform already located.
      codeSnippets: await collectSnippets(root, evidence, impact, request.input),
      recommendedChanges: recommendChanges(impact),
      ...(diagnosis ? { failure: failureSlice(diagnosis) } : {}),
      ...(prior.get('test-planning')?.result ? { testPlan: testPlanSlice(prior.get('test-planning').result) } : {}),
      tokenEstimate: 0,
      truncated: []
    };

    const truncated = fitToBudget(pkg, budget);
    pkg.truncated = truncated;
    pkg.tokenEstimate = estimateTokens(pkg);

    const response = {
      metrics: { duration: Date.now() - started, tokens: pkg.tokenEstimate },
      nextActions: []
    };

    return truncated.length > 0
      ? agentPartial(pkg, `trimmed to fit ${budget} tokens: ${truncated.join(', ')}`, response)
      : agentSuccess(pkg, response);
  }

  /**
   * The `aafe context --failure` shape when diagnosis ran but impact analysis
   * did not: smaller, but complete enough for the IDE agent to act on.
   */
  async #failureOnlyPackage(diagnosis, task, knowledge, request) {
    const started = Date.now();
    const manifest = knowledge ? await knowledge.manifest() : null;
    const pkg = {
      task: {
        kind: task.kind ?? 'failure',
        goal: task.goal ?? '',
        requirement: task.requirement ?? null,
        failureRef: task.failureRef ?? null
      },
      project: {
        name: manifest?.project?.name ?? null,
        commit: manifest?.analysis?.commit ?? null,
        knowledgeOutput: manifest?.output ?? '.aafe'
      },
      architecture: { modules: [], dependencies: [] },
      affectedFiles: (diagnosis.relatedFiles ?? []).map((file) => ({ path: file, why: 'appears in the failing stack' })),
      affectedModules: (diagnosis.relatedModules ?? []).map((id) => ({ id, score: 0.9, why: 'owns a file in the failing stack' })),
      affectedFeatures: [],
      dataFlows: diagnosis.relatedDataFlows ?? [],
      businessFlows: [],
      tests: diagnosis.regressionTests ?? [],
      risk: diagnosis.risk ?? 'medium',
      confidence: 0.7,
      constraints: [],
      evidence: (diagnosis.relatedFiles ?? []).map((file) => ({ type: 'stack', file, reason: 'failing stack frame' })),
      recommendedChanges: (diagnosis.fixSuggestions ?? []).map((why, index) => ({
        order: index + 1,
        target: diagnosis.relatedFiles?.[0] ?? 'unknown',
        action: 'fix',
        why
      })),
      failure: failureSlice(diagnosis),
      tokenEstimate: 0,
      truncated: []
    };

    const budget = request.constraints?.tokenBudget ?? 12000;
    pkg.truncated = fitToBudget(pkg, budget);
    pkg.tokenEstimate = estimateTokens(pkg);
    return agentSuccess(pkg, { metrics: { duration: Date.now() - started, tokens: pkg.tokenEstimate } });
  }

  /**
   * Only the affected modules' boundaries — never the whole architecture map.
   */
  async #architectureSlice(knowledge, impact) {
    if (!knowledge) return { modules: [], dependencies: [] };
    const ids = (impact.affectedModules ?? []).slice(0, 6).map((item) => item.id);
    const modules = [];
    const dependencies = [];
    for (const id of ids) {
      const slice = await knowledge.getModule(id);
      if (!slice) continue;
      modules.push({
        id: slice.id,
        files: slice.files.slice(0, 12),
        routes: slice.routes.map((route) => route.path).filter(Boolean).slice(0, 10),
        components: slice.components.map((component) => component.name).slice(0, 12)
      });
      for (const dep of slice.dependencies) {
        dependencies.push({ from: slice.id, to: dep });
      }
    }
    return { modules, dependencies: dependencies.slice(0, 40) };
  }
}

/**
 * Validation outcomes become explicit constraints so the IDE agent knows which
 * claims it must not trust.
 */
function buildConstraints(validated) {
  const constraints = [
    'AAFE analysis is advisory; verify each claim against the cited file before editing.',
    'Do not change files outside the affected modules without re-running impact analysis.'
  ];
  if (!validated) {
    constraints.push('This context was not evidence-validated; treat low-score items with care.');
    return constraints;
  }
  for (const target of (validated.rejected ?? []).slice(0, 10)) {
    constraints.push(`Rejected by validation, do not rely on: ${target}`);
  }
  for (const target of (validated.downgraded ?? []).slice(0, 10)) {
    constraints.push(`Weak evidence, confirm manually: ${target}`);
  }
  return constraints;
}

/**
 * The diagnosis, minus the per-failure detail the IDE agent does not need to
 * read in order to attempt a fix.
 */
function failureSlice(diagnosis) {
  return {
    classification: diagnosis.classification,
    rootCause: diagnosis.rootCause,
    status: diagnosis.status,
    totals: diagnosis.totals,
    suspects: (diagnosis.failures ?? [])
      .filter((item) => item.suspect)
      .slice(0, 5)
      .map((item) => ({
        test: item.title,
        file: item.suspect.file,
        line: item.suspect.line,
        inDiff: item.suspect.inDiff,
        message: item.message
      })),
    fixSuggestions: diagnosis.fixSuggestions ?? [],
    regressionTests: (diagnosis.regressionTests ?? []).slice(0, 10)
  };
}

function testPlanSlice(plan) {
  return {
    id: plan.id,
    risk: plan.risk,
    preconditions: plan.preconditions ?? [],
    scenarios: (plan.scenarios ?? []).slice(0, 10).map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      priority: scenario.priority
    }))
  };
}

/**
 * Facts are the part of the package a consumer may act on without re-deriving
 * anything: they come from the analyzer's output, not from scoring or matching.
 * Keeping them separate from the ranked impact lists is what lets an IDE agent
 * tell "this is where the code is" from "this is where we think it matters".
 */
function buildFacts(impact, architecture, manifest) {
  const facts = [];
  if (manifest?.analysis?.commit) {
    facts.push({ kind: 'analysis-commit', value: manifest.analysis.commit, source: 'manifest.json' });
  }
  facts.push({ kind: 'impact-source', value: impact.source ?? 'requirement', source: 'impact-analyzer' });

  for (const module of architecture.modules ?? []) {
    if (module.files?.length) {
      facts.push({ kind: 'module-files', value: { module: module.id, files: module.files }, source: `modules/${module.id}` });
    }
    for (const route of module.routes ?? []) {
      facts.push({ kind: 'route', value: { module: module.id, path: route }, source: `modules/${module.id}/routes` });
    }
    if (module.components?.length) {
      facts.push({ kind: 'components', value: { module: module.id, components: module.components }, source: `modules/${module.id}/components` });
    }
  }

  for (const flow of (impact.affectedDataFlows ?? []).slice(0, 10)) {
    facts.push({ kind: 'data-flow', value: { id: flow.id, label: flow.label }, source: 'dataflow' });
  }
  return facts;
}

function buildRelations(architecture, impact) {
  const relations = (architecture.dependencies ?? []).map((dependency) => ({
    from: dependency.from,
    to: dependency.to,
    type: 'module-depends-on',
    why: 'declared in the module dependency graph'
  }));

  for (const item of impact.affectedModules ?? []) {
    for (const entry of item.evidence ?? []) {
      const file = entry.file ?? entry.location?.file;
      if (!file) continue;
      relations.push({ from: item.id, to: file, type: 'module-contains', why: entry.reason ?? 'evidence' });
    }
  }
  return relations.slice(0, 60);
}

/**
 * Pull the cited lines out of the files the evidence points at.
 *
 * Bounded hard on purpose: snippets are by far the most expensive part of the
 * package, and a context that spends its budget on source has none left for
 * the reasoning that explains why that source matters.
 */
async function collectSnippets(root, evidence, impact, input = {}) {
  if (input?.includeCode === false) return [];
  const maxFiles = clampInt(input?.maxSnippets, 6, 1, 20);
  const contextLines = clampInt(input?.snippetContext, 12, 2, 60);

  const targets = new Map();
  for (const entry of evidence) {
    const file = entry.file ?? entry.location?.file;
    if (!file || targets.has(file)) continue;
    targets.set(file, {
      line: entry.startLine ?? entry.location?.startLine ?? entry.line ?? null,
      why: entry.reason ?? 'cited as evidence'
    });
    if (targets.size >= maxFiles) break;
  }
  for (const item of impact.affectedFiles ?? []) {
    if (targets.size >= maxFiles) break;
    const file = item.id ?? item.path;
    if (!file || targets.has(file)) continue;
    targets.set(file, { line: null, why: item.why || 'in the impact report' });
  }

  const snippets = [];
  for (const [file, target] of targets) {
    const snippet = await readSnippet(root, file, target, contextLines);
    if (snippet) snippets.push(snippet);
  }
  return snippets;
}

async function readSnippet(root, file, target, contextLines) {
  let text = '';
  try {
    text = await readFile(path.join(root, file), 'utf8');
  } catch {
    // A file the knowledge base still lists but the working tree no longer has
    // is itself useful information, but it is not a snippet.
    return null;
  }

  const lines = text.split('\n');
  const anchored = Number.isInteger(target.line) && target.line > 0;
  const anchor = anchored ? target.line : firstMeaningfulLine(lines);
  const startLine = anchored
    ? Math.max(1, anchor - Math.floor(contextLines / 2))
    : anchor;
  const endLine = Math.min(lines.length, startLine + contextLines - 1);

  return {
    path: file,
    startLine,
    endLine,
    language: path.extname(file).replace('.', '') || 'text',
    why: target.why,
    truncated: endLine < lines.length || startLine > 1,
    content: lines.slice(startLine - 1, endLine).join('\n')
  };
}

/**
 * Where a snippet should start when the evidence carries no line number.
 *
 * Every file in a licensed repository opens with the same banner, so anchoring
 * at line 1 would spend the whole snippet budget showing the reader the license
 * they already know instead of the code they asked about.
 */
function firstMeaningfulLine(lines) {
  let index = 0;
  let inBlockComment = false;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      index += 1;
      continue;
    }
    if (line === '' || line.startsWith('//') || line.startsWith('#!')) {
      index += 1;
      continue;
    }
    if (line.startsWith('/*')) {
      inBlockComment = !line.includes('*/');
      index += 1;
      continue;
    }
    return index + 1;
  }
  return 1;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function collectEvidence(impact) {
  const seen = new Set();
  const evidence = [];
  const groups = [impact.affectedModules, impact.affectedFiles, impact.affectedFeatures, impact.affectedBusinessFlows];
  for (const group of groups) {
    for (const item of group ?? []) {
      for (const entry of item.evidence ?? []) {
        const key = `${entry.type}:${entry.file}:${entry.reason ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        evidence.push(entry);
      }
    }
  }
  return evidence;
}

/**
 * Deterministic, obviously-derived suggestions. Concrete code design stays
 * with the IDE agent; this only points at the seams.
 */
function recommendChanges(impact) {
  const primary = (impact.affectedModules ?? []).filter((item) => item.score >= 0.85).slice(0, 5);
  const downstream = (impact.affectedModules ?? []).filter((item) => item.score < 0.85).slice(0, 5);

  const changes = primary.map((item, position) => ({
    order: position + 1,
    target: item.id,
    action: 'implement',
    why: item.why
  }));
  for (const item of downstream) {
    changes.push({
      order: changes.length + 1,
      target: item.id,
      action: 'review-for-regression',
      why: item.why
    });
  }
  if ((impact.affectedTests ?? []).length > 0) {
    changes.push({
      order: changes.length + 1,
      target: impact.affectedTests.slice(0, 5).join(', '),
      action: 'update-or-extend-tests',
      why: 'existing tests cover the affected modules'
    });
  }
  return changes;
}

/**
 * Trim least-valuable sections first until the package fits. Files, modules
 * and constraints are kept longest because they are what the IDE agent acts on.
 */
function fitToBudget(pkg, budget) {
  const order = [
    // Snippets shrink first: they are the most expensive section and the only
    // one the consumer can cheaply recover on its own, since it holds the file.
    ['codeSnippets', 2],
    ['facts', 10],
    ['relations', 12],
    ['evidence', 12],
    ['dataFlows', 8],
    ['businessFlows', 6],
    ['affectedFeatures', 8],
    ['tests', 10],
    ['affectedFiles', 20],
    ['affectedModules', 10]
  ];
  const truncated = [];

  for (const [key, floor] of order) {
    if (estimateTokens(pkg) <= budget) break;
    const list = pkg[key];
    if (!Array.isArray(list) || list.length <= floor) continue;
    truncated.push(`${key} ${list.length}->${floor}`);
    pkg[key] = list.slice(0, floor);
  }

  if (estimateTokens(pkg) > budget && pkg.codeSnippets?.length > 0) {
    truncated.push(`codeSnippets ${pkg.codeSnippets.length}->0`);
    pkg.codeSnippets = [];
  }

  if (estimateTokens(pkg) > budget && pkg.architecture?.modules?.length > 2) {
    truncated.push(`architecture.modules ${pkg.architecture.modules.length}->2`);
    pkg.architecture.modules = pkg.architecture.modules.slice(0, 2);
  }
  return truncated;
}

function toEntries(priorResults) {
  if (!priorResults) return new Map();
  return priorResults instanceof Map ? priorResults : new Map(Object.entries(priorResults));
}
