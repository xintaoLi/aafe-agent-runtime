import { evaluateDDDGate } from './DDDGate.js';

/**
 * DDD Scope — turns an activated request into the minimum skill set that
 * satisfies it.
 *
 * Passing the gate grants permission to use DDD skills; it does not order the
 * whole chain. Running all fifteen skills for "设计 Aggregate" buries the answer
 * in context maps and migration plans the user never asked for, so the scope
 * rule keeps activation proportional to the request.
 */

/** Canonical skill ids, in the order DDD.md requires them to execute. */
export const DDD_SKILL_ORDER = Object.freeze([
  'ddd-gate',
  'ddd-project-discovery',
  'ddd-domain-discovery',
  'ddd-strategic-design',
  'ddd-bounded-context',
  'ddd-context-map',
  'ddd-tactical-design',
  'ddd-aggregate',
  'ddd-domain-event',
  'ddd-application-design',
  'ddd-architecture',
  'ddd-code-mapping',
  'ddd-refactoring',
  'ddd-validation',
  'ddd-documentation'
]);

/** Rule files, in the mandated loading order (DDD.md §27). */
export const DDD_RULE_ORDER = Object.freeze([
  'ddd-gate',
  'ddd-scope',
  'ddd-strategic-rules',
  'ddd-tactical-rules',
  'ddd-architecture-rules',
  'ddd-code-rules',
  'ddd-refactoring-rules',
  'ddd-validation-rules'
]);

/**
 * The dispatch matrix from DDD.md §26, keyed by the capability the gate
 * reported. `required` always runs; `optional` runs only when the request also
 * asks for it.
 */
const CAPABILITY_MATRIX = Object.freeze({
  analysis: {
    intent: 'DDD 分析',
    required: [
      'ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design',
      'ddd-bounded-context', 'ddd-context-map', 'ddd-tactical-design',
      'ddd-architecture', 'ddd-code-mapping'
    ],
    optional: ['ddd-aggregate', 'ddd-application-design', 'ddd-validation']
  },
  'strategic-design': {
    intent: 'DDD 战略设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design', 'ddd-bounded-context'],
    optional: ['ddd-context-map']
  },
  'bounded-context': {
    intent: 'Bounded Context 设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design', 'ddd-bounded-context'],
    optional: ['ddd-context-map']
  },
  'context-mapping': {
    intent: 'Context Map 设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design', 'ddd-bounded-context', 'ddd-context-map'],
    optional: []
  },
  'aggregate-design': {
    intent: 'Aggregate 设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-tactical-design', 'ddd-aggregate'],
    optional: ['ddd-validation']
  },
  'domain-event': {
    intent: 'Domain Event 设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-tactical-design', 'ddd-domain-event'],
    optional: ['ddd-aggregate', 'ddd-validation']
  },
  'tactical-design': {
    intent: 'DDD 战术设计',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-tactical-design', 'ddd-aggregate'],
    optional: ['ddd-domain-event', 'ddd-validation']
  },
  architecture: {
    intent: 'DDD 架构设计',
    required: [
      'ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design',
      'ddd-bounded-context', 'ddd-tactical-design', 'ddd-application-design', 'ddd-architecture'
    ],
    optional: ['ddd-aggregate', 'ddd-validation']
  },
  refactoring: {
    intent: 'DDD 重构',
    required: [
      'ddd-project-discovery', 'ddd-domain-discovery', 'ddd-strategic-design',
      'ddd-bounded-context', 'ddd-context-map', 'ddd-tactical-design', 'ddd-aggregate',
      'ddd-application-design', 'ddd-architecture', 'ddd-code-mapping', 'ddd-refactoring', 'ddd-validation'
    ],
    optional: []
  },
  validation: {
    intent: 'DDD 验证',
    // DDD.md §26 marks discovery optional here, but DDD-SYSTEM-007 requires
    // project evidence before any modeling claim. Validating a model against
    // nothing is how a clean report gets produced for a broken domain.
    required: [
      'ddd-project-discovery', 'ddd-domain-discovery', 'ddd-tactical-design',
      'ddd-aggregate', 'ddd-application-design', 'ddd-architecture',
      'ddd-code-mapping', 'ddd-validation'
    ],
    optional: ['ddd-strategic-design', 'ddd-bounded-context']
  },
  documentation: {
    intent: 'DDD 文档',
    required: ['ddd-project-discovery', 'ddd-domain-discovery', 'ddd-validation', 'ddd-documentation'],
    optional: []
  },
  full: {
    intent: 'DDD 完整落地',
    required: DDD_SKILL_ORDER.filter((skill) => skill !== 'ddd-gate'),
    optional: []
  }
});

/** Rules each skill needs, so nothing beyond the gate loads before it is due. */
const SKILL_RULES = Object.freeze({
  'ddd-project-discovery': [],
  'ddd-domain-discovery': ['ddd-strategic-rules'],
  'ddd-strategic-design': ['ddd-strategic-rules'],
  'ddd-bounded-context': ['ddd-strategic-rules'],
  'ddd-context-map': ['ddd-strategic-rules'],
  'ddd-tactical-design': ['ddd-tactical-rules'],
  'ddd-aggregate': ['ddd-tactical-rules'],
  'ddd-domain-event': ['ddd-tactical-rules'],
  'ddd-application-design': ['ddd-tactical-rules', 'ddd-architecture-rules'],
  'ddd-architecture': ['ddd-architecture-rules'],
  'ddd-code-mapping': ['ddd-code-rules'],
  'ddd-refactoring': ['ddd-refactoring-rules'],
  'ddd-validation': ['ddd-validation-rules'],
  'ddd-documentation': ['ddd-validation-rules']
});

/**
 * @typedef {object} DDDScopePlan
 * @property {boolean} enabled
 * @property {'enabled'|'disabled'|'ambiguous'} decision
 * @property {string} reason
 * @property {'full'|'partial'|'none'} scope
 * @property {string[]} intents Human-readable names of the matched matrix rows.
 * @property {string[]} skills Skills to execute, in mandated order.
 * @property {string[]} rules Rule files to load, in mandated order.
 * @property {string[]} skipped DDD skills deliberately not activated.
 * @property {string|null} clarification
 */

/**
 * @param {string|{prompt?:string, request?:string}} input
 * @param {{gate?: object, includeOptional?: boolean}} [options]
 * @returns {DDDScopePlan}
 */
export function resolveDDDScope(input = {}, { gate = null, includeOptional = false } = {}) {
  const text = String(input?.prompt ?? input?.request ?? input ?? '');
  const decision = gate ?? evaluateDDDGate(text);

  if (!decision.enabled) {
    // The termination rule: nothing downstream of the gate may load.
    return {
      enabled: false,
      decision: decision.decision,
      reason: decision.reason,
      scope: 'none',
      intents: [],
      skills: [],
      rules: [],
      skipped: DDD_SKILL_ORDER.filter((skill) => skill !== 'ddd-gate'),
      clarification: decision.clarification ?? null
    };
  }

  const selected = new Set();
  const intents = [];
  for (const capability of decision.requestedCapabilities) {
    const row = CAPABILITY_MATRIX[capability];
    if (!row) continue;
    intents.push(row.intent);
    for (const skill of row.required) selected.add(skill);
    if (includeOptional || decision.scope === 'full') {
      for (const skill of row.optional) selected.add(skill);
    }
  }

  // A capability the matrix does not model still deserves the baseline chain
  // rather than an empty plan.
  if (selected.size === 0) {
    for (const skill of CAPABILITY_MATRIX.analysis.required) selected.add(skill);
    intents.push(CAPABILITY_MATRIX.analysis.intent);
  }

  const skills = DDD_SKILL_ORDER.filter((skill) => skill === 'ddd-gate' || selected.has(skill));
  const rules = orderedRules(skills);

  return {
    enabled: true,
    decision: decision.decision,
    reason: decision.reason,
    scope: decision.scope,
    intents: [...new Set(intents)],
    skills,
    rules,
    skipped: DDD_SKILL_ORDER.filter((skill) => !skills.includes(skill)),
    clarification: null
  };
}

/**
 * Gate and scope rules always load first; everything else only if a selected
 * skill needs it. Loading the full rule set before the gate is what lets
 * ordinary tasks drift into DDD.
 */
function orderedRules(skills) {
  const needed = new Set(['ddd-gate', 'ddd-scope']);
  for (const skill of skills) {
    for (const rule of SKILL_RULES[skill] ?? []) needed.add(rule);
  }
  return DDD_RULE_ORDER.filter((rule) => needed.has(rule));
}
