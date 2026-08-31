/**
 * Pattern scoring.
 *
 *   score = problemFit + changeIsolation + complexityReduction + reusePotential
 *           + performanceBenefit
 *           - implementationCost - cognitiveCost - couplingRisk - overengineeringRisk
 *
 * Two things make this more than a weighted sum of catalog constants.
 *
 * A benefit only counts when the problem actually asks for it. Virtualization
 * has a real performance benefit, but scoring that benefit for a request about
 * workflow state is how you end up recommending virtualization to everyone.
 *
 * Over-engineering risk is computed, not declared. Each pattern records the
 * problem complexity that justifies it; below that line the risk grows, which
 * is what keeps CQRS and Event Sourcing out of a two-field CRUD form.
 */

import { PATTERN_BY_ID } from './catalog.js';

/** Which detected problem kinds make each benefit dimension relevant. */
const BENEFIT_RELEVANCE = {
  changeIsolation: ['variation', 'coupling', 'extension', 'integration', 'migration'],
  complexityReduction: ['complexity', 'coupling', 'state', 'consistency'],
  reuse: ['duplication', 'variation', 'extension'],
  performance: ['performance', 'scale', 'latency']
};

const MAX_SCORE = 17;

/**
 * @typedef {object} PatternScoreBreakdown
 * @property {number} problemFit
 * @property {number} changeIsolation
 * @property {number} complexityReduction
 * @property {number} reusePotential
 * @property {number} performanceBenefit
 * @property {number} implementationCost
 * @property {number} cognitiveCost
 * @property {number} couplingRisk
 * @property {number} overengineeringRisk
 */

/**
 * @typedef {object} ScoredPattern
 * @property {string} id
 * @property {string} name
 * @property {string} domain
 * @property {string} role
 * @property {number} score            raw score, may be negative
 * @property {number} normalized       0..1, for ranking display
 * @property {PatternScoreBreakdown} breakdown
 * @property {string} problem          the problem this pattern is answering
 * @property {string[]} benefit
 * @property {string[]} cost
 * @property {string[]} risk
 * @property {string[]} alternatives
 * @property {Array<{kind:string, detail:string}>} evidence
 */

/**
 * @param {object} pattern            entry from PATTERN_INDEX
 * @param {object} context
 * @param {Array<{kind:string, text:string, evidence?:object[]}>} context.problems
 * @param {number} context.complexity 1 simple, 2 moderate, 3 complex
 * @param {string[]} [context.matchedSignals]
 * @param {object[]} [context.evidence]
 * @returns {ScoredPattern}
 */
export function scorePattern(pattern, context = {}) {
  const problems = context.problems ?? [];
  const complexity = clamp(context.complexity ?? 1, 1, 3);
  const matchedSignals = context.matchedSignals ?? [];
  const problemKinds = new Set(problems.map((problem) => problem.kind));

  const problemFit = computeProblemFit(pattern, problems, matchedSignals);
  const changeIsolation = relevantBenefit(pattern.benefit.changeIsolation, 'changeIsolation', problemKinds);
  const complexityReduction = relevantBenefit(pattern.benefit.complexityReduction, 'complexityReduction', problemKinds);
  const reusePotential = relevantBenefit(pattern.benefit.reuse, 'reuse', problemKinds);
  const performanceBenefit = relevantBenefit(pattern.benefit.performance, 'performance', problemKinds);

  const overengineeringRisk = computeOverengineeringRisk(pattern, complexity, problemFit);

  const breakdown = {
    problemFit,
    changeIsolation,
    complexityReduction,
    reusePotential,
    performanceBenefit,
    implementationCost: pattern.cost.implementation,
    cognitiveCost: pattern.cost.cognitive,
    couplingRisk: pattern.cost.coupling,
    overengineeringRisk
  };

  const score =
    breakdown.problemFit +
    breakdown.changeIsolation +
    breakdown.complexityReduction +
    breakdown.reusePotential +
    breakdown.performanceBenefit -
    breakdown.implementationCost -
    breakdown.cognitiveCost -
    breakdown.couplingRisk -
    breakdown.overengineeringRisk;

  const answering = problems.find((problem) => matchesProblem(pattern, problem));

  return {
    id: pattern.id,
    name: pattern.name,
    domain: pattern.domain,
    role: pattern.role,
    score,
    normalized: Math.round(Math.max(0, score) / MAX_SCORE * 100) / 100,
    breakdown,
    problem: answering?.text ?? pattern.problem,
    benefit: describeBenefit(breakdown),
    cost: describeCost(breakdown),
    risk: describeRisk(pattern, breakdown, complexity),
    alternatives: [...pattern.alternatives],
    evidence: buildEvidence(pattern, matchedSignals, answering, context.evidence)
  };
}

/**
 * Scores every catalog pattern and returns them ranked, best first.
 * @returns {ScoredPattern[]}
 */
export function scoreAll(context = {}) {
  const patterns = context.patterns ?? [...PATTERN_BY_ID.values()];
  return patterns
    .map((pattern) => scorePattern(pattern, context))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * A pattern earns a place only when it clears the bar on its own terms.
 * Ranking alone would always produce a "top 3", which is exactly the
 * "every project gets N patterns" behaviour the spec forbids.
 */
export function isJustified(scored, { minScore = 2, minProblemFit = 2 } = {}) {
  return scored.score >= minScore && scored.breakdown.problemFit >= minProblemFit;
}

/**
 * Fit is dominated by whether this specific pattern answers an identified
 * problem. Sharing a domain with a problem is far weaker evidence — every
 * structural pattern shares a domain with every integration problem — so it
 * caps out below the selection bar on its own.
 */
function computeProblemFit(pattern, problems, matchedSignals) {
  let fit = 0;
  let domainOnly = false;

  for (const problem of problems) {
    const rank = problem.patterns?.indexOf(pattern.id) ?? -1;
    if (rank >= 0) {
      // Stated in the request beats inferred from the codebase.
      fit += problem.source === 'request' ? 3 : 2;
      // The first pattern listed is the problem's primary answer; the rest are
      // alternatives that should not outrank it on a tie.
      if (rank === 0) fit += 1;
      continue;
    }
    if (problem.domains?.includes(pattern.domain)) domainOnly = true;
  }

  if (fit === 0 && (domainOnly || ownSignalsMatched(pattern, matchedSignals))) fit = 1;
  return clamp(fit, 0, 5);
}

function ownSignalsMatched(pattern, matchedSignals) {
  return pattern.signals.some((signal) => matchedSignals.includes(signal));
}

function matchesProblem(pattern, problem) {
  if (!problem) return false;
  return Boolean(problem.patterns?.includes(pattern.id));
}

function relevantBenefit(value, dimension, problemKinds) {
  if (!value) return 0;
  const relevant = BENEFIT_RELEVANCE[dimension].some((kind) => problemKinds.has(kind));
  return relevant ? value : 0;
}

function computeOverengineeringRisk(pattern, complexity, problemFit) {
  // Below the complexity that justifies it, every step down costs two points.
  let risk = Math.max(0, pattern.justifiedAt - complexity) * 2;
  // No identified problem is the definition of over-engineering, whatever the
  // pattern's intrinsic merits.
  if (problemFit === 0) risk += 3;
  else if (problemFit === 1) risk += 1;
  return risk;
}

function describeBenefit(breakdown) {
  const out = [];
  if (breakdown.changeIsolation > 0) out.push(`隔离变化 (+${breakdown.changeIsolation})`);
  if (breakdown.complexityReduction > 0) out.push(`降低复杂度 (+${breakdown.complexityReduction})`);
  if (breakdown.reusePotential > 0) out.push(`提升复用 (+${breakdown.reusePotential})`);
  if (breakdown.performanceBenefit > 0) out.push(`性能收益 (+${breakdown.performanceBenefit})`);
  return out;
}

function describeCost(breakdown) {
  const out = [];
  if (breakdown.implementationCost > 0) out.push(`实现成本 (-${breakdown.implementationCost})`);
  if (breakdown.cognitiveCost > 0) out.push(`理解成本 (-${breakdown.cognitiveCost})`);
  if (breakdown.couplingRisk > 0) out.push(`耦合风险 (-${breakdown.couplingRisk})`);
  return out;
}

function describeRisk(pattern, breakdown, complexity) {
  const out = [];
  if (breakdown.overengineeringRisk > 0) {
    out.push(
      breakdown.problemFit === 0
        ? `未识别到该模式要解决的问题，引入即过度设计 (-${breakdown.overengineeringRisk})`
        : `问题复杂度 ${complexity} 低于该模式的适用门槛 ${pattern.justifiedAt} (-${breakdown.overengineeringRisk})`
    );
  }
  if (pattern.cost.coupling >= 3) out.push('该模式本身会引入强耦合或隐式依赖，需要额外治理');
  if (pattern.requires.length > 0) out.push(`需要配套模式：${pattern.requires.join(', ')}`);
  return out;
}

function buildEvidence(pattern, matchedSignals, answering, extra = []) {
  const evidence = [];
  if (matchedSignals.length > 0) {
    evidence.push({ kind: 'signal', detail: `请求中命中信号：${matchedSignals.join(', ')}` });
  }
  if (answering) {
    evidence.push({ kind: 'problem', detail: `对应问题：${answering.text}` });
    for (const item of answering.evidence ?? []) {
      evidence.push({ kind: 'project', detail: typeof item === 'string' ? item : JSON.stringify(item) });
    }
  }
  for (const item of extra) {
    evidence.push({ kind: 'project', detail: typeof item === 'string' ? item : JSON.stringify(item) });
  }
  if (evidence.length === 0) {
    evidence.push({ kind: 'catalog-default', detail: `目录默认适用场景：${pattern.problem}` });
  }
  return evidence;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
