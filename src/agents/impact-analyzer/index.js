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

import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import { collectDiffFacts } from '../../static-analysis/git/DiffFacts.js';
import { createEvidence } from '../../static-analysis/types/evidence.js';
import { buildModuleGraph, flowsForModules, propagateImpact } from '../../knowledge/graph/relations.js';
import { createImpactItem, createImpactReport, deriveRisk, normalizeModuleId } from '../../knowledge/model/index.js';
import { tokenize } from './tokenize.js';

const MATCH_THRESHOLD = 0.15;
const MAX_SEEDS = 8;
// Wide enough that the per-module rollup still sees the long tail of file and
// component hits, which is what promotes a module the requirement never names.
const SEARCH_LIMIT = 200;

/**
 * A2 — Impact Analyzer.
 *
 * Both entry points are deterministic: a requirement is matched lexically
 * against analyzed artifacts, a diff is matched exactly against file paths.
 * From either seed set the blast radius is expanded over the module dependency
 * graph. Every item carries evidence so the IDE agent can verify the claim.
 */
export class ImpactAnalyzerAgent {
  id = 'impact-analyzer';
  version = '1.0.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const knowledge = request.context?.knowledge ?? this.knowledge;
    if (!knowledge) return agentSkipped('knowledge-store-unavailable');
    if (!(await knowledge.exists())) {
      return agentSkipped('analyze-output-missing', {
        nextActions: [{ capability: 'project-analysis', reason: 'impact analysis needs analyzed project knowledge' }]
      });
    }

    const started = Date.now();
    const root = request.context?.root ?? process.cwd();
    const task = request.context?.task ?? {};
    const isDiff = request.capability === 'change-impact'
      || Boolean(request.input?.diffRef)
      || task.kind === 'diff';

    const seeded = isDiff
      ? await this.#seedFromDiff(root, knowledge, request.input?.diffRef ?? task.diffRef ?? null)
      : await this.#seedFromRequirement(knowledge, request.input?.requirement ?? task.requirement ?? task.goal ?? '');

    if (seeded.error) return agentSkipped(seeded.error);

    const report = await this.#expand(knowledge, seeded);
    const metrics = { duration: Date.now() - started };
    const nextActions = [
      { capability: 'knowledge-validation', reason: 'impact claims should be evidence-checked before use' },
      { capability: 'context-packaging', reason: 'the IDE agent needs a minimal context package' }
    ];

    if (report.affectedModules.length === 0) {
      return agentPartial(report, seeded.emptyReason ?? 'no-matching-modules', { metrics, nextActions });
    }
    return agentSuccess(report, {
      metrics,
      nextActions,
      evidence: report.affectedModules.flatMap((item) => item.evidence.slice(0, 1)).slice(0, 20)
    });
  }

  /**
   * Requirement text -> candidate features, routes, components and modules.
   *
   * Retrieval goes through the search index rather than re-tokenizing every
   * module slice: the previous scan read six JSON files per module on every
   * run, and only a handful of those modules could ever survive the threshold.
   * Module slices are still read, but only for the seeds that made the cut, and
   * only to attach evidence.
   */
  async #seedFromRequirement(knowledge, requirement) {
    const text = String(requirement ?? '').trim();
    if (!text) return { error: 'empty-requirement' };
    if (tokenize(text).size === 0) return { error: 'requirement-has-no-searchable-terms' };

    const index = await knowledge.searchIndex();
    const hits = index.search(text, { limit: SEARCH_LIMIT, minScore: MATCH_THRESHOLD });
    const features = await knowledge.features();
    const featureConfidence = new Map(features.map((feature) => [feature.id, feature.confidence ?? 0.5]));

    const featureMatches = [];
    const fileMatches = [];
    /** @type {Map<string, {score:number, why:string}>} */
    const moduleHits = new Map();

    for (const hit of hits) {
      if (hit.kind === 'feature') {
        featureMatches.push(createImpactItem({
          id: hit.id,
          label: hit.label,
          score: hit.score * (featureConfidence.get(hit.id) ?? 0.5),
          why: `requirement terms match feature vocabulary: ${hit.matched.join(', ')}`,
          evidence: features.find((feature) => feature.id === hit.id)?.evidence ?? []
        }));
        continue;
      }

      if (hit.kind === 'file' && hit.file) {
        fileMatches.push(createImpactItem({
          id: hit.file,
          label: hit.file,
          score: hit.score,
          why: `path terms match requirement: ${hit.matched.join(', ')}`,
          evidence: [createEvidence({ type: 'source', file: hit.file, reason: 'requirement lexical match' })]
        }));
      }

      // A route, component, file or symbol hit is a hit on the module that owns
      // it, scored by whichever of its parts matched best.
      if (!hit.module) continue;
      const existing = moduleHits.get(hit.module);
      if (existing && existing.score >= hit.score) continue;
      moduleHits.set(hit.module, { score: hit.score, why: whyForHit(hit) });
    }

    const ranked = [...moduleHits.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, MAX_SEEDS);

    const moduleMatches = [];
    for (const [moduleId, hit] of ranked) {
      const slice = await knowledge.getModule(moduleId);
      moduleMatches.push(createImpactItem({
        id: moduleId,
        label: moduleId,
        score: hit.score,
        why: hit.why,
        evidence: (slice?.files ?? []).slice(0, 2).map((file) =>
          createEvidence({ type: 'source', file, reason: 'module boundary' }))
      }));
    }

    const featureModules = await this.#modulesForFeatures(knowledge, featureMatches, features);
    const seeds = dedupeById([...moduleMatches, ...featureModules])
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEEDS);

    return {
      source: 'requirement',
      seeds,
      files: dedupeById(fileMatches).sort((a, b) => b.score - a.score).slice(0, 40),
      features: dedupeById(featureMatches).sort((a, b) => b.score - a.score).slice(0, 20),
      emptyReason: seeds.length === 0 ? 'requirement did not match any analyzed module' : null,
      baseConfidence: seeds[0]?.score ?? 0
    };
  }

  /**
   * Changed paths -> owning modules. Exact, so confidence is high.
   */
  async #seedFromDiff(root, knowledge, diffRef) {
    const diff = await collectDiffFacts(root, diffRef);
    if (diff.status !== 'ok') return { error: diff.reason ?? 'diff-unavailable' };
    if (diff.files.length === 0) {
      return { source: 'diff', seeds: [], files: [], features: [], emptyReason: 'diff-is-empty', baseConfidence: 1, diff };
    }

    const seeds = new Map();
    const files = [];
    for (const changed of diff.files) {
      const evidence = [createEvidence({
        type: 'source',
        file: changed.path,
        reason: `${changed.change} (+${changed.added}/-${changed.removed})`
      })];
      files.push(createImpactItem({
        id: changed.path,
        label: `${changed.path} [${changed.change}]`,
        score: 1,
        why: 'file appears in the diff',
        evidence
      }));

      const moduleId = await knowledge.findModuleByFile(changed.path);
      if (!moduleId) continue;
      const existing = seeds.get(moduleId);
      if (existing) {
        existing.evidence.push(...evidence);
        continue;
      }
      seeds.set(moduleId, createImpactItem({
        id: moduleId,
        label: moduleId,
        score: 1,
        why: 'module owns a changed file',
        evidence
      }));
    }

    return {
      source: 'diff',
      seeds: Array.from(seeds.values()).slice(0, MAX_SEEDS * 2),
      files,
      features: [],
      emptyReason: seeds.size === 0 ? 'changed files do not belong to any analyzed module' : null,
      baseConfidence: 1,
      diff
    };
  }

  /**
   * Expand seed modules over the dependency graph and collect the flows,
   * features and tests that ride along.
   */
  async #expand(knowledge, seeded) {
    const [relations, architecture, features] = await Promise.all([
      knowledge.relations(),
      knowledge.architecture(),
      knowledge.features()
    ]);

    const graph = buildModuleGraph(relations.modules);
    const seedIds = seeded.seeds.map((item) => item.id);
    const reached = propagateImpact(graph, seedIds);

    const seedById = new Map(seeded.seeds.map((item) => [item.id, item]));
    const affectedModules = Array.from(reached.entries())
      .map(([id, hop]) => {
        const seed = seedById.get(id);
        if (seed) return { ...seed, score: Math.max(seed.score, 0.9) };
        return createImpactItem({
          id,
          label: id,
          score: hop.score,
          why: `depends on ${hop.via} (${hop.distance} hop${hop.distance > 1 ? 's' : ''} away)`,
          evidence: hop.evidence
        });
      })
      .sort((a, b) => b.score - a.score);

    const moduleIds = affectedModules.map((item) => item.id);
    const affectedDataFlows = flowsForModules(relations.dataflow, moduleIds)
      .slice(0, 40)
      .map((flow) => createImpactItem({
        id: flow.id,
        label: `${flow.moduleId}: ${flow.edges.length} edge(s)`,
        score: 0.6,
        why: 'application flow crosses an affected module',
        evidence: []
      }));

    const affectedFeatures = seeded.features.length > 0
      ? seeded.features
      : await this.#featuresForModules(knowledge, moduleIds.slice(0, 6), features);

    const affectedTests = collectTests(seeded.files, affectedModules, await knowledge.fileToModuleIndex());

    const riskyModules = new Set((architecture.risks ?? []).flatMap((risk) => toModuleIds(risk)));
    const architectureRisks = moduleIds.filter((id) => riskyModules.has(id)).length;

    return createImpactReport({
      source: seeded.source,
      affectedFiles: seeded.files,
      affectedModules,
      affectedFeatures,
      affectedDataFlows,
      affectedBusinessFlows: await this.#businessForModules(knowledge, moduleIds.slice(0, 6)),
      affectedTests,
      risk: deriveRisk({
        moduleCount: affectedModules.length,
        fileCount: seeded.files.length,
        architectureRisks
      }),
      confidence: Number(Math.min(1, seeded.baseConfidence || 0.4).toFixed(2))
    });
  }

  async #modulesForFeatures(knowledge, featureMatches, features) {
    const byId = new Map(features.map((feature) => [feature.id, feature]));
    const items = [];
    for (const match of featureMatches) {
      const feature = byId.get(match.id);
      for (const evidence of (feature?.evidence ?? []).slice(0, 3)) {
        const moduleId = evidence.file ? await knowledge.findModuleByFile(evidence.file) : null;
        if (!moduleId) continue;
        items.push(createImpactItem({
          id: moduleId,
          label: moduleId,
          score: match.score,
          why: `hosts matched feature "${match.label}"`,
          evidence: [evidence]
        }));
      }
    }
    return items;
  }

  async #featuresForModules(knowledge, moduleIds, features) {
    const wanted = new Set(moduleIds.map(normalizeModuleId));
    const items = [];
    for (const feature of features) {
      for (const evidence of feature.evidence ?? []) {
        const moduleId = evidence.file ? await knowledge.findModuleByFile(evidence.file) : null;
        if (!moduleId || !wanted.has(moduleId)) continue;
        items.push(createImpactItem({
          id: feature.id,
          label: feature.name,
          score: 0.5,
          why: `feature lives in affected module ${moduleId}`,
          evidence: [evidence]
        }));
        break;
      }
    }
    return items.slice(0, 20);
  }

  async #businessForModules(knowledge, moduleIds) {
    const wanted = new Set(moduleIds.map(normalizeModuleId));
    const candidates = await knowledge.business();
    const items = [];
    for (const candidate of candidates) {
      for (const evidence of candidate.evidence ?? []) {
        const moduleId = evidence.file ? await knowledge.findModuleByFile(evidence.file) : null;
        if (!moduleId || !wanted.has(moduleId)) continue;
        items.push(createImpactItem({
          id: candidate.id ?? candidate.name,
          label: candidate.name ?? candidate.id,
          score: 0.5,
          why: `business rule anchored in affected module ${moduleId}`,
          evidence: [evidence]
        }));
        break;
      }
    }
    return items.slice(0, 20);
  }
}

/**
 * Test files are reported separately because they are what closes the loop
 * once the IDE agent has made the change.
 */
function collectTests(files, modules, fileIndex) {
  const tests = new Set();
  const isTest = (file) => /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)(__tests__|tests?|e2e)\//.test(file);

  for (const item of files) {
    if (isTest(item.id)) tests.add(item.id);
  }
  const moduleIds = new Set(modules.map((item) => item.id));
  for (const [file, moduleId] of fileIndex) {
    if (tests.size >= 40) break;
    if (moduleIds.has(moduleId) && isTest(file)) tests.add(file);
  }
  return Array.from(tests);
}

/**
 * Names the part of the module that matched, so the reader can tell a module
 * the requirement described from one that merely contains a matching filename.
 */
function whyForHit(hit) {
  const matched = hit.matched.join(', ');
  if (hit.kind === 'module') return `module routes/components match: ${matched}`;
  if (hit.kind === 'route') return `route ${hit.label} matches: ${matched}`;
  if (hit.kind === 'component') return `component ${hit.label} matches: ${matched}`;
  if (hit.kind === 'symbol') return `symbol ${hit.label} matches: ${matched}`;
  return 'module contains files whose paths match the requirement';
}

function toModuleIds(risk) {
  const ids = [];
  if (risk.module) ids.push(normalizeModuleId(risk.module));
  for (const value of risk.modules ?? []) ids.push(normalizeModuleId(value));
  if (Array.isArray(risk.cycle)) ids.push(...risk.cycle.map(normalizeModuleId));
  return ids;
}

function dedupeById(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, evidence: [...(item.evidence ?? [])] });
      continue;
    }
    existing.score = Math.max(existing.score, item.score);
    existing.evidence.push(...(item.evidence ?? []));
  }
  return Array.from(byId.values()).map((item) => ({ ...item, evidence: item.evidence.slice(0, 6) }));
}
