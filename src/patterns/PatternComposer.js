/**
 * Pattern composition.
 *
 * This is the piece that makes the system something other than a pattern
 * lookup table. The output is a composition — several patterns, each with an
 * explicit responsibility, wired into a graph — because PATTERN-SYSTEM-001
 * forbids designing a frontend by picking one pattern and applying it globally.
 *
 * The pipeline is:
 *
 *   problems → variation points → scored candidates → justified selection
 *   → required collaborators → conflict resolution → redundancy elimination
 *   → composition graph → complexity verdict
 *
 * Two properties are worth calling out because they are easy to lose:
 *
 * An empty composition is a legitimate result. If nothing clears the
 * justification bar the answer is "no pattern needed", not "here are the top
 * three anyway".
 *
 * Conflict and redundancy resolution *removes* patterns and says why. Rule 011
 * asks for the simplest sufficient composition, so the last step shrinks the
 * set rather than padding it.
 */

import { PATTERN_BY_ID } from './catalog.js';
import { scoreAll, isJustified } from './PatternScore.js';
import { detectProblems, assessComplexity, variationPoints } from './PatternProblems.js';

/**
 * @typedef {object} PatternComposition
 * @property {string} name
 * @property {import('./PatternProblems.js').DetectedProblem[]} problem
 * @property {Array<{id:string, name:string, role:string, responsibility:string, score:number, evidence:object[]}>} patterns
 * @property {Array<{from:string, to:string, kind:string}>} relations
 * @property {Array<{pattern:string, responsibility:string}>} responsibilities
 * @property {Array<{pattern:string, boundary:string}>} boundaries
 * @property {Array<{name:string, steps:string[]}>} flows
 * @property {Array<{between:string[], reason:string, resolution:string}>} conflicts
 * @property {Array<{pattern:string, reason:string}>} redundantPatterns
 * @property {Array<{pattern:string, reason:string}>} rejected
 * @property {string[]} rationale
 * @property {'none'|'low'|'medium'|'high'} complexity
 */

/**
 * @param {object} input
 * @param {string} input.prompt
 * @param {string} [input.name]
 * @param {Array<{text:string, evidence?:string[]}>} [input.projectFacts]
 * @param {number} [input.declaredComplexity]
 * @param {object[]} [input.evidence]
 * @returns {PatternComposition}
 */
export function composePatterns(input = {}) {
  const prompt = String(input.prompt ?? '');
  const problems = detectProblems(prompt, { projectFacts: input.projectFacts });
  const complexity = assessComplexity(problems, { declaredComplexity: input.declaredComplexity });
  const variations = variationPoints(problems);

  const matchedSignals = collectSignals(prompt);
  const scored = scoreAll({ problems, complexity, matchedSignals, evidence: input.evidence ?? [] });

  const rationale = [];
  const rejected = [];

  let selected = scored.filter((candidate) => isJustified(candidate));
  for (const candidate of scored) {
    if (selected.includes(candidate)) continue;
    if (candidate.breakdown.problemFit >= 2) {
      rejected.push({
        pattern: candidate.id,
        reason: `识别到相关问题但收益不抵成本（score ${candidate.score}）：${[...candidate.cost, ...candidate.risk].join('；') || '无净收益'}`
      });
    }
  }

  if (selected.length === 0) {
    rationale.push(
      problems.length === 0
        ? '未识别到需要设计模式解决的问题。PATTERN-SYSTEM-002：缺少设计模式不是缺陷，不引入任何模式。'
        : '识别到问题，但没有模式的收益能抵过其实现与认知成本，建议先用直接实现解决。'
    );
    return emptyComposition(input.name, problems, variations, rejected, rationale);
  }

  selected = addRequiredCollaborators(selected, rationale, { problems, complexity, matchedSignals });

  const { kept: afterConflicts, conflicts } = resolveConflicts(selected);
  const { kept: afterRedundancy, redundant } = removeRedundancy(afterConflicts, problems);

  const patterns = afterRedundancy
    .slice()
    .sort((a, b) => domainOrder(a) - domainOrder(b) || b.score - a.score);

  const relations = buildRelations(patterns);

  rationale.push(
    `识别到 ${problems.length} 个问题、${variations.length} 个变化点，问题复杂度评级 ${complexity}/3。`,
    `按 problemFit 与成本收益筛选后保留 ${patterns.length} 个模式，每个模式对应一个明确职责。`
  );
  if (conflicts.length > 0) rationale.push(`检测到 ${conflicts.length} 处职责冲突并已裁决。`);
  if (redundant.length > 0) rationale.push(`剔除 ${redundant.length} 个冗余模式（Rule 011：优先最小充分组合）。`);
  if (patterns.length === 1) {
    rationale.push('本次只有一个模式成立。这是合理结果，不需要为了“组合”而补足模式（Rule 012）。');
  }

  return {
    name: input.name ?? deriveName(prompt),
    problem: problems,
    variationPoints: variations,
    patterns: patterns.map((pattern) => ({
      id: pattern.id,
      name: pattern.name,
      domain: pattern.domain,
      role: pattern.role,
      responsibility: responsibilityOf(pattern),
      score: pattern.score,
      benefit: pattern.benefit,
      cost: pattern.cost,
      risk: pattern.risk,
      alternatives: pattern.alternatives,
      evidence: pattern.evidence
    })),
    relations,
    responsibilities: patterns.map((pattern) => ({ pattern: pattern.id, responsibility: responsibilityOf(pattern) })),
    boundaries: patterns.map((pattern) => ({ pattern: pattern.id, boundary: boundaryOf(pattern) })),
    flows: buildFlows(patterns, relations),
    conflicts,
    redundantPatterns: redundant,
    rejected,
    rationale,
    complexity: compositionComplexity(patterns)
  };
}

/**
 * A pattern whose collaborator is missing is an incomplete design, so pull in
 * what `requires` declares. Undo/Redo without Command is the canonical case.
 */
function addRequiredCollaborators(selected, rationale, context) {
  const byId = new Map(selected.map((pattern) => [pattern.id, pattern]));
  const queue = [...selected];

  while (queue.length > 0) {
    const current = queue.shift();
    const definition = PATTERN_BY_ID.get(current.id);
    for (const requiredId of definition?.requires ?? []) {
      if (byId.has(requiredId)) continue;
      const required = PATTERN_BY_ID.get(requiredId);
      if (!required) continue;
      const [scored] = scoreAll({ ...context, patterns: [required] });
      const promoted = { ...scored, promotedBy: current.id };
      byId.set(requiredId, promoted);
      queue.push(promoted);
      rationale.push(`补入 ${required.name}：${current.name} 缺少它无法成立。`);
    }
  }

  return [...byId.values()];
}

/**
 * Rule 005 and Rule 009: two patterns claiming the same responsibility is a
 * conflict, and the composition must name it rather than ship both.
 */
function resolveConflicts(selected) {
  const byId = new Map(selected.map((pattern) => [pattern.id, pattern]));
  const conflicts = [];
  const dropped = new Set();

  for (const pattern of selected) {
    if (dropped.has(pattern.id)) continue;
    const definition = PATTERN_BY_ID.get(pattern.id);
    for (const otherId of definition?.conflictsWith ?? []) {
      if (!byId.has(otherId) || dropped.has(otherId) || dropped.has(pattern.id)) continue;
      const other = byId.get(otherId);
      const loser = pattern.score >= other.score ? other : pattern;
      const winner = loser === pattern ? other : pattern;
      dropped.add(loser.id);
      conflicts.push({
        between: [winner.id, loser.id],
        reason: `${winner.name} 与 ${loser.name} 都在承担「${winner.role} / ${loser.role}」，职责重叠`,
        resolution: `保留 ${winner.name}（score ${winner.score} ≥ ${loser.score}），移除 ${loser.name}`
      });
    }
  }

  return { kept: selected.filter((pattern) => !dropped.has(pattern.id)), conflicts };
}

/**
 * Rule 010: patterns that are alternatives of one another, or that answer a
 * problem already covered by a stronger pick, add cost without adding coverage.
 */
function removeRedundancy(selected, problems) {
  const redundant = [];
  const dropped = new Set();
  const ranked = [...selected].sort((a, b) => b.score - a.score);

  for (const pattern of ranked) {
    if (dropped.has(pattern.id)) continue;
    const definition = PATTERN_BY_ID.get(pattern.id);
    for (const alternativeId of definition?.alternatives ?? []) {
      if (dropped.has(alternativeId)) continue;
      const alternative = ranked.find((candidate) => candidate.id === alternativeId);
      if (!alternative || alternative.id === pattern.id) continue;
      // Alternatives solving the same single problem are interchangeable, so
      // keeping both is redundancy rather than composition.
      if (!sharesProblem(pattern, alternative, problems)) continue;
      dropped.add(alternative.id);
      redundant.push({
        pattern: alternative.id,
        reason: `与 ${pattern.name} 是同一问题的可替代方案，同时引入不会增加覆盖面，仅增加认知成本`
      });
    }
  }

  return { kept: selected.filter((pattern) => !dropped.has(pattern.id)), redundant };
}

function sharesProblem(a, b, problems) {
  return problems.some((problem) => problem.patterns.includes(a.id) && problem.patterns.includes(b.id));
}

/** Draws the composition graph from declared collaborations, §11. */
function buildRelations(patterns) {
  const present = new Set(patterns.map((pattern) => pattern.id));
  const relations = [];

  for (const pattern of patterns) {
    const definition = PATTERN_BY_ID.get(pattern.id);
    for (const target of definition?.flowsTo ?? []) {
      if (present.has(target)) relations.push({ from: pattern.id, to: target, kind: 'delegates-to' });
    }
    for (const target of definition?.requires ?? []) {
      if (present.has(target)) relations.push({ from: pattern.id, to: target, kind: 'depends-on' });
    }
  }

  return dedupeRelations(relations);
}

/**
 * Walks the relation graph into readable chains. Isolated patterns are listed
 * as single-step flows so nothing silently disappears from the output.
 */
function buildFlows(patterns, relations) {
  const outgoing = new Map();
  for (const relation of relations) {
    if (!outgoing.has(relation.from)) outgoing.set(relation.from, []);
    outgoing.get(relation.from).push(relation.to);
  }

  const hasIncoming = new Set(relations.map((relation) => relation.to));
  const roots = patterns.filter((pattern) => !hasIncoming.has(pattern.id));
  const flows = [];

  for (const root of roots) {
    const steps = [];
    const seen = new Set();
    let current = root.id;
    while (current && !seen.has(current)) {
      seen.add(current);
      steps.push(PATTERN_BY_ID.get(current)?.name ?? current);
      current = (outgoing.get(current) ?? [])[0];
    }
    flows.push({ name: `${root.name} 链路`, steps });
  }

  return flows;
}

function responsibilityOf(pattern) {
  const definition = PATTERN_BY_ID.get(pattern.id);
  return `承担「${pattern.role}」：${definition?.problem ?? pattern.problem}`;
}

function boundaryOf(pattern) {
  const definition = PATTERN_BY_ID.get(pattern.id);
  return `作用范围限定在 ${definition?.domain ?? pattern.domain} 层，不得越界承担其他模式的职责`;
}

/**
 * Rule 012 and Rule 013: pattern count is not a quality metric, so this reports
 * the cost of the composition rather than praising its size.
 */
function compositionComplexity(patterns) {
  if (patterns.length === 0) return 'none';
  const cognitiveLoad = patterns.reduce((total, pattern) => {
    const definition = PATTERN_BY_ID.get(pattern.id);
    return total + (definition?.cost.cognitive ?? 0) + (definition?.cost.implementation ?? 0);
  }, 0);
  if (patterns.length <= 2 && cognitiveLoad <= 4) return 'low';
  if (patterns.length <= 5 && cognitiveLoad <= 12) return 'medium';
  return 'high';
}

function emptyComposition(name, problems, variations, rejected, rationale) {
  return {
    name: name ?? 'no-pattern-needed',
    problem: problems,
    variationPoints: variations,
    patterns: [],
    relations: [],
    responsibilities: [],
    boundaries: [],
    flows: [],
    conflicts: [],
    redundantPatterns: [],
    rejected,
    rationale,
    complexity: 'none'
  };
}

function collectSignals(prompt) {
  const text = prompt.toLowerCase();
  const matched = new Set();
  for (const pattern of PATTERN_BY_ID.values()) {
    for (const signal of pattern.signals) {
      if (text.includes(signal.toLowerCase())) matched.add(signal);
    }
  }
  return [...matched];
}

const DOMAIN_ORDER = [
  'architecture', 'module', 'structural', 'behavioral', 'state', 'component',
  'data', 'async', 'event', 'integration', 'rendering', 'performance',
  'resilience', 'creational', 'testing', 'migration'
];

function domainOrder(pattern) {
  const index = DOMAIN_ORDER.indexOf(pattern.domain);
  return index === -1 ? DOMAIN_ORDER.length : index;
}

function dedupeRelations(relations) {
  const seen = new Set();
  return relations.filter((relation) => {
    const key = `${relation.from}->${relation.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveName(prompt) {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : (trimmed || 'pattern-composition');
}
