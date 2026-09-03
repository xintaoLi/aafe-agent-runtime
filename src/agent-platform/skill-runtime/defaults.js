import { analyzeDDD, conceptNames } from '../../ddd/DDDAdvisor.js';
import { evaluateDDDGate } from '../../ddd/DDDGate.js';
import { resolveDDDScope } from '../../ddd/DDDScope.js';
import { evaluateMemoryOOMGate } from '../../memory-diagnosis/MemoryOOMGate.js';
import { resolveMemoryScope } from '../../memory-diagnosis/MemoryScope.js';
import {
  analyzeModulePatternFit,
  analyzePatternComposition,
  analyzePatternProblems,
  auditAntiPatterns,
  buildPatternInterview
} from '../../patterns/PatternAdvisor.js';
import { evaluatePatternGate } from '../../patterns/PatternGate.js';
import { AgentRuntime } from './AgentRuntime.js';

export const defaultRouter = {
  routes: {
    feature: { pipeline: 'feature' },
    domainFeature: { pipeline: 'domain-feature' },
    refactor: { pipeline: 'refactor' },
    bugfix: { pipeline: 'bugfix' },
    performance: { pipeline: 'performance' },
    graphFeature: { pipeline: 'graph-feature' },
    patternFeature: { pipeline: 'pattern-feature' },
    memoryDiagnosis: { pipeline: 'memory-diagnosis' }
  }
};

export const defaultGates = {
  sdd_gate: { requires: ['sdd_decision', 'sdd_exploration', 'sdd_proposal', 'sdd_specs', 'sdd_design', 'sdd_tasks', 'sdd_approval'] },
  // Enablement comes first and is separate from modelling completeness: one
  // asks "may we do DDD at all", the other "is the model finished".
  ddd_enablement_gate: { requires: ['ddd_decision', 'ddd_scope'] },
  memory_oom_gate: { requires: ['memory_decision', 'memory_scope'] },
  ddd_gate: { requires: ['ubiquitous_language', 'bounded_contexts', 'aggregates'] },
  // `pattern_selection` used to be required here, which meant every refactor
  // and performance run had to produce a pattern choice before it could pass.
  // Architecture soundness does not depend on having named a pattern.
  architecture_gate: { requires: ['boundaries', 'decomposition'] },
  // Same split as DDD: may we do pattern work at all, versus is the composition
  // complete. The old `pattern_gate` conflated them and ran unconditionally.
  pattern_enablement_gate: { requires: ['pattern_decision'] },
  pattern_gate: { requires: ['pattern_problems', 'pattern_composition', 'pattern_anti_patterns'] },
  implementation_gate: { requires: ['risk_review', 'extension_points'] },
  merge_gate: { requires: ['critic_pass'] }
};

export const defaultPipelines = {
  // Neither DDD nor pattern steps here. An ordinary feature must not be turned
  // into a modelling or pattern exercise because the pipeline happened to
  // include those skills.
  feature: { steps: [{ skill: 'sdd-gate' }, { skill: 'memory-recaller' }, { skill: 'sdd-explore' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'sdd-proposal' }, { skill: 'sdd-specs' }, { skill: 'sdd-design' }, { skill: 'sdd-tasks' }, { skill: 'sdd-approval' }, { gate: 'sdd_gate' }, { skill: 'adr-generator' }, { gate: 'implementation_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  // Gate -> Scope -> Discovery -> Strategic -> Tactical -> Architecture ->
  // Mapping -> Refactor -> Validation, per DDD.md §27. Everything after the
  // scope step self-skips when the request did not ask for it.
  // `architect` and `evolution-predictor` are not DDD skills and never skip;
  // they keep `implementation_gate` satisfiable no matter how narrow the DDD
  // scope turns out to be.
  // The DDD chain composes with patterns rather than duplicating them: DDD
  // decides the boundaries, patterns solve the problems inside them (§15). The
  // pattern steps here self-skip unless the request also asked for pattern work.
  'domain-feature': { steps: [{ skill: 'ddd-gate' }, { skill: 'ddd-scope' }, { gate: 'ddd_enablement_gate' }, { skill: 'memory-recaller' }, { skill: 'ddd-project-discovery' }, { skill: 'ddd-domain-discovery' }, { gate: 'ddd_gate' }, { skill: 'ddd-strategic-design' }, { skill: 'ddd-bounded-context' }, { skill: 'ddd-context-map' }, { skill: 'ddd-tactical-design' }, { skill: 'ddd-aggregate' }, { skill: 'ddd-domain-event' }, { skill: 'ddd-application-design' }, { skill: 'ddd-architecture' }, { skill: 'ddd-code-mapping' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'ddd-pattern-bridge' }, { skill: 'evolution-predictor' }, { skill: 'ddd-refactoring' }, { skill: 'ddd-validation' }, { skill: 'ddd-documentation' }, { gate: 'implementation_gate' }, { skill: 'adr-generator' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  // Gate -> Discovery -> Selection -> Composition -> Validation, per §2 and §16.
  // Discovery runs before anything is named, and the anti-pattern audit runs
  // against the composition this system itself proposed.
  'pattern-feature': { steps: [{ skill: 'pattern-gate' }, { gate: 'pattern_enablement_gate' }, { skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-discovery' }, { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' }, { skill: 'pattern-composer' }, { skill: 'module-pattern-selector' }, { skill: 'pattern-anti-pattern-audit' }, { gate: 'pattern_gate' }, { skill: 'pattern-validator' }, { skill: 'pattern-implementation-planner' }, { skill: 'adr-generator' }, { gate: 'implementation_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'memory-diagnosis': { steps: [{ skill: 'memory-oom-gate' }, { skill: 'memory-scope' }, { gate: 'memory_oom_gate' }, { skill: 'memory-diagnosis' }, { skill: 'memory-agent-selector' }, { skill: 'memory-writer' }] },
  refactor: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'refactor-critic' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  bugfix: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  performance: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'graph-feature': { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'graph-architect' }, { skill: 'layout-strategy-selector' }, { skill: 'runtime-evolution-predictor' }, { skill: 'module-decomposer' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] }
};

export const defaultSkills = {
  'sdd-gate': {
    async run(context) {
      const configured = context.input?.sdd?.enabled !== false;
      const explicit = /\b(?:sdd|openspec|spec-driven)\b|规格驱动|规范驱动/i.test(promptOf(context));
      const enabled = configured || explicit;
      return {
        status: 'pass',
        summary: enabled ? 'SDD planning is fused into the feature pipeline' : 'SDD planning skipped by project opt-out',
        artifacts: { sdd_decision: { enabled, source: explicit ? 'request' : configured ? 'config-default' : 'config-opt-out' } },
        risks: [],
        nextHints: []
      };
    }
  },
  'sdd-explore': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD exploration captured',
    artifacts: {
      sdd_exploration: {
        requirement: promptOf(context),
        hasMemoryContext: Boolean(context.input?.memoryContext),
        hasProjectContext: Boolean(context.input?.projectContext)
      }
    },
    risks: [],
    nextHints: []
  }), { sdd_exploration: null }),
  'memory-recaller': {
    async run(context) {
      return { status: 'pass', summary: 'Project memory recalled', artifacts: { memory_context: context.input?.memoryContext ?? '' }, risks: [], nextHints: [] };
    }
  },
  // --- Memory OOM conditional skill system ----------------------------------
  'memory-oom-gate': {
    async run(context) {
      const decision = evaluateMemoryOOMGate(memoryGateInput(context));
      return {
        status: decision.activated ? 'pass' : 'fail',
        summary: decision.activated ? `Memory diagnosis enabled: ${decision.reason}` : `Memory diagnosis not enabled: ${decision.reason}`,
        artifacts: { memory_decision: decision },
        risks: decision.activated ? [] : ['Memory rules were not loaded because no activation signal was established'],
        nextHints: decision.activated ? [] : ['Continue with the normal analysis pipeline; do not scan memory-specific patterns']
      };
    }
  },
  'memory-scope': {
    async run(context) {
      const decision = context.results?.['memory-oom-gate']?.artifacts?.memory_decision;
      const scope = resolveMemoryScope(memoryGateInput(context), { gate: decision });
      return {
        status: scope.enabled ? 'pass' : 'fail',
        summary: `Memory scope: ${scope.categories.join(', ')}; rules: ${scope.rules.join(', ') || 'none'}`,
        artifacts: { memory_scope: scope, memory_rules: scope.rules },
        risks: [], nextHints: scope.skipped.length ? [`Not loaded: ${scope.skipped.join(', ')}`] : []
      };
    }
  },
  'memory-diagnosis': {
    async run(context) {
      const scope = context.results?.['memory-scope']?.artifacts?.memory_scope;
      if (!scope?.enabled) return { status: 'pass', summary: 'Memory diagnosis skipped: gate is not enabled', artifacts: { skipped: 'memory' }, risks: [], nextHints: [] };
      return {
        status: 'pass',
        summary: `Memory diagnosis prepared for ${scope.categories.join(', ')}`,
        artifacts: { memory_diagnosis: { categories: scope.categories, rules: scope.rules, requireRetentionPath: true, requirePeakAnalysis: true, requireVerification: true } },
        risks: [], nextHints: ['Collect heap/retention or allocation evidence before asserting a root cause']
      };
    }
  },
  'memory-agent-selector': {
    async run(context) {
      const decision = context.results?.['memory-oom-gate']?.artifacts?.memory_decision;
      const selected = decision?.source === 'USER_CONFIGURED_AGENT' && decision.agent ? { mode: 'custom', agent: decision.agent } : { mode: 'default', agent: 'builtin-memory-diagnosis' };
      return { status: 'pass', summary: `Memory agent selected: ${selected.mode}`, artifacts: { memory_agent: selected }, risks: [], nextHints: [] };
    }
  },
  // --- DDD skill system (DDD.md) --------------------------------------------
  // The gate is the only entry. Everything below it self-skips unless the scope
  // plan named it, so activation stays proportional to what was asked.
  'ddd-gate': {
    async run(context) {
      const decision = evaluateDDDGate(promptOf(context));
      if (!decision.enabled) {
        return {
          // Failing halts the pipeline, which is the termination rule: no
          // strategic or tactical rule may load once the gate says no.
          status: 'fail',
          summary: `DDD not enabled: ${decision.reason}`,
          artifacts: { ddd_decision: decision },
          risks: ['DDD skills were requested without explicit DDD intent'],
          nextHints: decision.clarification ? [decision.clarification] : ['Ask the user to state DDD intent explicitly before running DDD skills']
        };
      }
      return {
        status: 'pass',
        summary: `DDD enabled (${decision.scope}): ${decision.reason}`,
        artifacts: { ddd_decision: decision },
        risks: [],
        nextHints: []
      };
    }
  },
  'ddd-scope': {
    async run(context) {
      const decision = context.results?.['ddd-gate']?.artifacts?.ddd_decision ?? null;
      const plan = resolveDDDScope(promptOf(context), { gate: decision });
      return {
        status: plan.enabled ? 'pass' : 'fail',
        summary: `DDD scope: ${plan.intents.join(' / ') || 'none'} (${plan.skills.length} skills)`,
        artifacts: { ddd_scope: plan, ddd_rules: plan.rules },
        risks: [],
        nextHints: plan.skipped.length > 0 ? [`Not activated: ${plan.skipped.join(', ')}`] : []
      };
    }
  },
  'ddd-project-discovery': dddSkill('ddd-project-discovery', async (context) => {
    const knowledge = context.input?.knowledge ?? null;
    const analyzed = knowledge ? await knowledge.exists().catch(() => false) : false;
    return {
      status: analyzed ? 'pass' : 'warn',
      summary: analyzed ? 'Project evidence available from .aafe analysis' : 'No analyzed project evidence; DDD model will be hypothetical',
      artifacts: { ddd_project_evidence: analyzed },
      risks: analyzed ? [] : ['DDD-SYSTEM-007: project evidence must be collected before modelling'],
      nextHints: analyzed ? [] : ['Run `aafe analyze` so domain discovery can read real code']
    };
  }),
  'ddd-domain-discovery': dddSkill('ddd-domain-discovery', async (context) => {
    const model = await analyzeDDD({ prompt: promptOf(context), knowledge: context.input?.knowledge });
    return {
      status: model.status,
      summary: `Domain discovery: ${conceptNames(model.boundedContexts).join(', ') || 'no context identified'} (${model.observedCount} observed / ${model.inferredCount} inferred)`,
      artifacts: { ...toDDDArtifacts(model), ddd_model: model },
      risks: model.evidenceBased ? [] : ['DDD-SYSTEM-008: every concept below is inferred from wording, not observed in the project'],
      nextHints: model.questions
    };
  }),
  'ddd-strategic-design': dddSkill('ddd-strategic-design', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: 'Strategic design drafted',
      artifacts: { subdomains: classifySubdomains(model), ubiquitous_language: model.ubiquitousLanguage },
      risks: [],
      nextHints: ['Confirm which subdomains are Core vs Supporting vs Generic before investing in the model']
    };
  }),
  'ddd-bounded-context': dddSkill('ddd-bounded-context', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: `Bounded contexts: ${conceptNames(model.boundedContexts).join(', ') || 'none'}`,
      artifacts: { bounded_contexts: model.boundedContexts },
      risks: model.boundedContexts.some((item) => item.kind === 'inferred')
        ? ['R-STRATEGIC-004: a code module is not automatically a bounded context']
        : [],
      nextHints: []
    };
  }),
  'ddd-context-map': dddSkill('ddd-context-map', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: 'Context map drafted',
      artifacts: { context_map: model.boundedContexts.map((item) => ({ context: item.name, relationships: [] })) },
      risks: [],
      nextHints: ['Name the relationship for each pair: Partnership / Customer-Supplier / Conformist / ACL / Shared Kernel']
    };
  }),
  'ddd-tactical-design': dddSkill('ddd-tactical-design', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: 'Tactical building blocks drafted',
      artifacts: { entities: model.entities, value_objects: model.valueObjects, repositories: model.repositories, domain_services: model.domainServices },
      risks: [],
      nextHints: []
    };
  }),
  'ddd-aggregate': dddSkill('ddd-aggregate', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: `Aggregates: ${conceptNames(model.aggregates).join(', ') || 'none'}`,
      artifacts: { aggregates: model.aggregates },
      risks: [],
      nextHints: ['R-TACTICAL: an aggregate boundary is a consistency boundary, not a convenience grouping']
    };
  }),
  'ddd-domain-event': dddSkill('ddd-domain-event', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: `Domain events: ${conceptNames(model.domainEvents).join(', ') || 'none'}`,
      artifacts: { domain_events: model.domainEvents },
      risks: [],
      nextHints: ['DDD-SYSTEM-014: do not introduce events unless the domain needs them']
    };
  }),
  'ddd-application-design': dddSkill('ddd-application-design', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: 'Application layer drafted',
      artifacts: {
        use_cases: conceptNames(model.aggregates).map((name) => `Manage${name}`),
        extension_points: ['domain-model', 'repository', 'application-service']
      },
      risks: [],
      nextHints: ['Application services orchestrate; business rules stay in the domain model']
    };
  }),
  'ddd-architecture': dddSkill('ddd-architecture', async () => ({
    status: 'pass',
    summary: 'DDD architecture drafted',
    artifacts: { boundaries: ['domain', 'application', 'infrastructure', 'presentation'], risk_review: ['coupling', 'scaling', 'ownership'] },
    risks: [],
    nextHints: ['DDD-SYSTEM-013: DDD does not mandate a specific architecture']
  })),
  'ddd-code-mapping': dddSkill('ddd-code-mapping', async (context) => {
    const model = dddModel(context);
    return {
      status: 'pass',
      summary: 'Model mapped onto code',
      artifacts: {
        code_mapping: conceptNames(model.aggregates).map((name) => ({ concept: name, suggested: `domain/${name.toLowerCase()}/` }))
      },
      risks: [],
      nextHints: []
    };
  }),
  'ddd-refactoring': dddSkill('ddd-refactoring', async () => ({
    status: 'pass',
    summary: 'Incremental DDD refactoring plan drafted',
    artifacts: { ddd_refactoring_plan: true, extension_points: ['domain-model', 'repository', 'application-service'] },
    risks: [],
    nextHints: ['DDD-SYSTEM-015/016: preserve behaviour and migrate incrementally']
  })),
  'ddd-validation': dddSkill('ddd-validation', async (context) => {
    const model = dddModel(context);
    const unsupported = Object.values(model)
      .filter(Array.isArray)
      .flat()
      .filter((concept) => concept?.kind === 'inferred');
    return {
      status: unsupported.length > 0 ? 'warn' : 'pass',
      summary: `DDD validation: ${unsupported.length} concept(s) lack project evidence`,
      artifacts: { ddd_validation: { unsupported: unsupported.map((concept) => concept.name) } },
      risks: unsupported.length > 0 ? ['DDD-SYSTEM-017: every major decision must be traceable to evidence'] : [],
      nextHints: []
    };
  }),
  'ddd-documentation': dddSkill('ddd-documentation', async () => ({
    status: 'pass',
    summary: 'DDD documentation outline generated',
    artifacts: { ddd_documentation: true },
    risks: [],
    nextHints: ['DDD-SYSTEM-019: document the validated model, not the draft']
  })),
  'sdd-proposal': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD proposal shaped from feature evidence',
    artifacts: {
      sdd_proposal: {
        why: promptOf(context),
        whatChanges: context.results?.['module-decomposer']?.artifacts?.decomposition ?? [],
        source: 'feature-pipeline'
      }
    },
    risks: [],
    nextHints: []
  }), { sdd_proposal: null }),
  'sdd-specs': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD requirements prepared',
    artifacts: {
      sdd_specs: [{
        capability: 'feature',
        requirements: [{ id: 'REQ-001', statement: promptOf(context), scenarios: [] }]
      }]
    },
    risks: [],
    nextHints: ['Complete concrete Given/When/Then scenarios before durable approval']
  }), { sdd_specs: null }),
  'sdd-design': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD design assembled from architecture outputs',
    artifacts: {
      sdd_design: {
        boundaries: context.results?.architect?.artifacts?.boundaries ?? [],
        decomposition: context.results?.['module-decomposer']?.artifacts?.decomposition ?? [],
        extensionPoints: context.results?.['evolution-predictor']?.artifacts?.extension_points ?? []
      }
    },
    risks: [],
    nextHints: []
  }), { sdd_design: null }),
  'sdd-tasks': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD implementation tasks derived',
    artifacts: {
      sdd_tasks: (context.results?.['module-decomposer']?.artifacts?.decomposition ?? [])
        .map((module, index) => ({ id: `TASK-${index + 1}`, module, status: 'pending' }))
    },
    risks: [],
    nextHints: []
  }), { sdd_tasks: null }),
  'sdd-approval': sddSkill(async (context) => ({
    status: 'pass',
    summary: 'SDD approval policy attached to feature plan',
    artifacts: {
      sdd_approval: {
        required: context.input?.sdd?.approvalRequired !== false,
        status: context.input?.sdd?.approvalRequired === false ? 'not-required' : 'pending',
        enforcedBy: 'SDDEngine'
      }
    },
    risks: [],
    nextHints: context.input?.sdd?.approvalRequired === false
      ? []
      : ['Approve the durable SDD change before Task Manager execution']
  }), { sdd_approval: null }),
  architect: simpleSkill('Architecture analysis completed', { boundaries: ['domain', 'application', 'infrastructure', 'presentation'], risk_review: ['coupling', 'scaling', 'ownership'] }),
  'module-decomposer': simpleSkill('Module decomposition completed', { decomposition: ['domain', 'application', 'infrastructure', 'presentation', 'shared'] }),
  // --- Frontend design-pattern system (前端设计模式.md) ----------------------
  // Opt-in, same as DDD. The gate is the only entry and everything downstream
  // reads its decision, so a request about an `adapter` variable never becomes
  // a pattern-composition exercise.
  'pattern-gate': {
    async run(context) {
      const decision = evaluatePatternGate(promptOf(context));
      if (!decision.enabled) {
        return {
          status: 'fail',
          summary: `Design patterns not enabled: ${decision.reason}`,
          artifacts: { pattern_decision: decision },
          risks: ['Pattern skills were requested without explicit design-pattern intent'],
          nextHints: decision.clarification
            ? [decision.clarification]
            : ['Ask the user to state design-pattern intent explicitly before running pattern skills']
        };
      }
      return {
        status: 'pass',
        summary: `Design patterns enabled (${decision.scope}): ${decision.reason}`,
        artifacts: { pattern_decision: decision },
        risks: [],
        nextHints: []
      };
    }
  },
  // §6: describe the problems first. Naming a pattern here would make every
  // later step a rationalization of a choice already made.
  'pattern-discovery': patternSkill(async (context) => {
    const discovery = await analyzePatternProblems({
      prompt: promptOf(context),
      knowledge: context.input?.knowledge
    });
    return {
      status: 'pass',
      summary: `Problem discovery: ${discovery.problems.length} problems, ${discovery.variationPoints.length} variation points, complexity ${discovery.complexity}/3`,
      artifacts: {
        pattern_problems: discovery.problems,
        pattern_variation_points: discovery.variationPoints,
        pattern_complexity: discovery.complexity,
        pattern_evidence_mode: discovery.evidenceMode
      },
      risks: discovery.evidenceMode === 'request-only'
        ? ['问题仅来自请求措辞，未经项目代码验证；运行 `aafe analyze` 可提高可信度']
        : [],
      nextHints: discovery.questions
    };
  }, { pattern_problems: [], pattern_variation_points: [], pattern_complexity: 0 }),
  'pattern-interviewer': patternSkill(async (context) => {
    const questions = buildPatternInterview(promptOf(context));
    return {
      status: 'pass',
      summary: 'Pattern interview prepared',
      artifacts: { pattern_interview: questions },
      risks: [],
      nextHints: questions
    };
  }, { pattern_interview: [] }),
  // Selection and composition share one analysis: scoring candidates without
  // then composing them is what produced single-pattern answers before.
  'pattern-selector': patternSkill(async (context) => {
    const analysis = await analyzePatternComposition({
      prompt: promptOf(context),
      knowledge: context.input?.knowledge
    });
    const selected = analysis.composition.patterns;
    return {
      status: 'pass',
      summary: selected.length > 0
        ? `Selected ${selected.length} patterns: ${selected.map((pattern) => pattern.name).join(', ')}`
        : 'No pattern is justified for this request',
      artifacts: {
        pattern_analysis: analysis,
        pattern_selection: selected.map((pattern) => pattern.id),
        pattern_candidates: selected,
        pattern_rejected: analysis.rejected
      },
      risks: selected.length === 0
        ? ['PATTERN-SYSTEM-002: 缺少设计模式不是缺陷，本次不建议引入任何模式']
        : [],
      nextHints: analysis.questions
    };
  }, { pattern_selection: [], pattern_candidates: [], pattern_rejected: [] }),
  'pattern-composer': patternSkill(async (context) => {
    const analysis = patternAnalysis(context);
    const composition = analysis?.composition;
    if (!composition || composition.patterns.length === 0) {
      return {
        status: 'pass',
        summary: 'Empty composition: no pattern cleared the justification bar',
        artifacts: { pattern_composition: composition ?? null },
        risks: [],
        nextHints: ['直接实现即可，不需要引入设计模式']
      };
    }
    return {
      status: 'pass',
      summary: `Composition of ${composition.patterns.length} patterns, ${composition.relations.length} relations, complexity ${composition.complexity}`,
      artifacts: {
        pattern_composition: composition,
        pattern_relations: composition.relations,
        pattern_responsibilities: composition.responsibilities,
        pattern_conflicts: composition.conflicts,
        pattern_redundant: composition.redundantPatterns
      },
      risks: composition.conflicts.map((conflict) => `Rule 009: ${conflict.reason}`),
      nextHints: composition.rationale
    };
  }, { pattern_composition: null, pattern_relations: [], pattern_conflicts: [] }),
  'module-pattern-selector': patternSkill(async (context) => {
    const fit = await analyzeModulePatternFit({
      prompt: promptOf(context),
      knowledge: context.input?.knowledge
    });
    return {
      status: fit.status,
      summary: `Module-level composition for ${fit.modules.length} modules`,
      artifacts: { module_pattern_selection: fit.modules },
      risks: [],
      nextHints: []
    };
  }, { module_pattern_selection: [] }),
  // §14. Audits the project *and* the composition this system just proposed,
  // which is the only way ANTI-PATTERN-003/004 apply to our own output.
  'pattern-anti-pattern-audit': patternSkill(async (context) => {
    const analysis = patternAnalysis(context);
    const audit = analysis?.antiPatterns ?? await auditAntiPatterns({
      prompt: promptOf(context),
      knowledge: context.input?.knowledge
    });
    const high = audit.findings.filter((finding) => finding.severity === 'high');
    return {
      status: 'pass',
      summary: `Anti-pattern audit: ${audit.findings.length} findings (${high.length} high)`,
      artifacts: { pattern_anti_patterns: audit.findings, pattern_anti_pattern_status: audit.status },
      risks: high.map((finding) => `${finding.rule}: ${finding.name} — ${finding.description}`),
      nextHints: audit.findings.map((finding) => finding.remediation)
    };
  }, { pattern_anti_patterns: [] }),
  'pattern-validator': patternSkill(async (context) => {
    const composition = patternAnalysis(context)?.composition;
    const problems = context.results?.['pattern-discovery']?.artifacts?.pattern_problems ?? [];
    // PATTERN-SYSTEM-001 step 9: every pattern must trace back to a problem,
    // and every problem the user raised should be answered or acknowledged.
    const answered = new Set((composition?.patterns ?? []).flatMap((pattern) =>
      problems.filter((problem) => problem.patterns.includes(pattern.id)).map((problem) => problem.id)
    ));
    const unanswered = problems.filter((problem) => !answered.has(problem.id));
    return {
      status: 'pass',
      summary: `Validation: ${answered.size}/${problems.length} problems covered by the composition`,
      artifacts: { pattern_validation: { answered: [...answered], unanswered: unanswered.map((problem) => problem.id) } },
      risks: unanswered.map((problem) => `未被任何模式覆盖的问题：${problem.text}`),
      nextHints: unanswered.length > 0 ? ['确认这些问题是否用直接实现解决，或需要补充模式'] : []
    };
  }, { pattern_validation: null }),
  // §15: DDD decides boundaries, patterns solve what happens inside them.
  'ddd-pattern-bridge': {
    async run(context) {
      const decision = evaluatePatternGate(promptOf(context));
      const model = dddModel(context);
      const mappings = bridgeDDDToPatterns(model);
      if (mappings.length === 0) {
        return { status: 'pass', summary: 'No DDD building block to map onto patterns', artifacts: { ddd_pattern_bridge: [] }, risks: [], nextHints: [] };
      }
      return {
        status: 'pass',
        summary: `Mapped ${mappings.length} DDD building blocks onto pattern roles`,
        artifacts: { ddd_pattern_bridge: mappings },
        risks: [],
        // Suggestions only unless pattern work was actually requested, so the
        // bridge informs the design without silently activating the pattern chain.
        nextHints: decision.enabled
          ? []
          : ['这些是候选映射；如需完整模式选型与组合，请明确提出设计模式诉求']
      };
    }
  },
  'pattern-implementation-planner': simpleSkill('Pattern implementation plan completed', { pattern_implementation_plan: true, extension_points: ['interface', 'registry', 'adapter'] }),
  'evolution-predictor': simpleSkill('Evolution prediction completed', { extension_points: ['provider', 'adapter', 'policy'] }),
  'refactor-critic': simpleSkill('Refactor critique passed', { critic_pass: true }),
  'adr-generator': simpleSkill('ADR generated', { adr: true }),
  'graph-architect': simpleSkill('Graph architecture analysis completed', { graph_boundaries: ['node', 'edge', 'layout', 'runtime'] }),
  'layout-strategy-selector': simpleSkill('Layout strategy selected', { layout_strategy: ['elk', 'layered', 'manual'] }),
  'runtime-evolution-predictor': simpleSkill('Runtime evolution predicted', { runtime_extensions: ['async', 'streaming', 'retry'] }),
  // Referenced by every generated `.ai-agent/pipelines/*.yaml` but never
  // defined here, so running a pipeline from project config threw
  // "Skill not found" before reaching the merge gate.
  'experience-recorder': simpleSkill('Repeated-problem experience recorded', { experience_record: true }),
  'memory-writer': simpleSkill('Project learning captured', { memory_write: true })
};

/**
 * Pre-DDD.md skill ids. Projects installed before this change still have them
 * in their `.ai-agent/pipelines/*.yaml`, and an unknown skill is a hard error in
 * `SkillRegistry`, so they stay resolvable until those projects run `aafe update`.
 */
const LEGACY_DDD_ALIASES = Object.freeze({
  'ddd-discovery': 'ddd-domain-discovery',
  'bounded-context-mapper': 'ddd-bounded-context',
  'aggregate-designer': 'ddd-aggregate',
  'domain-event-designer': 'ddd-domain-event',
  'ddd-implementation-planner': 'ddd-refactoring'
});

for (const [legacy, canonical] of Object.entries(LEGACY_DDD_ALIASES)) {
  defaultSkills[legacy] = defaultSkills[canonical];
}

export function createDefaultRuntime(overrides = {}) {
  return new AgentRuntime({
    router: overrides.router ?? defaultRouter,
    pipelines: overrides.pipelines ?? defaultPipelines,
    gates: overrides.gates ?? defaultGates,
    skills: { ...defaultSkills, ...(overrides.skills ?? {}) },
    hooks: overrides.hooks,
    memory: overrides.memory,
    knowledge: overrides.knowledge,
    sdd: overrides.sdd,
    root: overrides.root,
    maxReruns: overrides.maxReruns
  });
}

/**
 * The request text. `input.request` is whatever the caller passed to
 * `runtime.execute`, which is usually `{ prompt }` rather than a bare string.
 */
function promptOf(context) {
  const request = context?.input?.request;
  return String(request?.prompt ?? request ?? '');
}

function memoryGateInput(context) {
  const request = context?.input?.request ?? {};
  const findings = request?.findings ?? context?.input?.findings ?? [];
  const currentAnalysis = request?.currentAnalysis ?? context?.input?.currentAnalysis ?? '';
  return {
    prompt: promptOf(context),
    findings,
    currentAnalysis,
    customAgentRequested: request?.customAgentRequested ?? context?.input?.customAgentRequested ?? false,
    agent: request?.memoryAgent ?? context?.input?.memoryAgent ?? null
  };
}

/**
 * Wraps a DDD skill so it only runs when the scope plan named it.
 *
 * Skipping returns `pass` rather than `fail`: the skill was not required, which
 * is a different thing from the skill being unable to do its job.
 */
function dddSkill(id, run) {
  return {
    async run(context) {
      const plan = context.results?.['ddd-scope']?.artifacts?.ddd_scope ?? null;
      if (plan && !plan.skills.includes(id)) {
        return { status: 'pass', summary: `${id} not in DDD scope`, artifacts: { skipped: id }, risks: [], nextHints: [] };
      }
      return run(context, plan);
    }
  };
}

function sddSkill(run, emptyArtifacts) {
  return {
    async run(context) {
      const decision = context.results?.['sdd-gate']?.artifacts?.sdd_decision;
      if (!decision?.enabled) {
        return {
          status: 'pass',
          summary: 'SDD skill skipped by project opt-out',
          artifacts: { skipped: 'sdd', ...emptyArtifacts },
          risks: [],
          nextHints: []
        };
      }
      return run(context, decision);
    }
  };
}

/**
 * Wraps a pattern skill so it only runs once the gate has said yes.
 *
 * A missing decision means the pipeline never ran the gate — for instance the
 * DDD pipeline reaching a pattern step — so the skill skips rather than
 * assuming permission.
 *
 * `emptyArtifacts` is what the skill still publishes when it skips. Projects
 * that upgraded the package but have not run `aafe update` yet still have the
 * old `pattern_gate` on disk requiring `pattern_interview` and friends; without
 * these keys their feature pipeline would halt on a gate for work it correctly
 * decided not to do. The values are empty, so nothing downstream mistakes a
 * skip for a result.
 */
function patternSkill(run, emptyArtifacts = {}) {
  return {
    async run(context) {
      const decision = context.results?.['pattern-gate']?.artifacts?.pattern_decision ?? null;
      if (!decision?.enabled) {
        return {
          status: 'pass',
          summary: 'Pattern skill skipped: design-pattern intent was not established',
          artifacts: { skipped: 'pattern', ...emptyArtifacts },
          risks: [],
          nextHints: []
        };
      }
      return run(context, decision);
    }
  };
}

/** The analysis produced by `pattern-selector`, shared by downstream steps. */
function patternAnalysis(context) {
  return context.results?.['pattern-selector']?.artifacts?.pattern_analysis ?? null;
}

/**
 * §15: DDD building blocks map onto pattern roles. The mapping is fixed by the
 * spec, but it stays a set of candidates — a Domain Service does not become a
 * Strategy until something varies.
 */
const DDD_PATTERN_BRIDGE = Object.freeze({
  boundedContexts: { blocks: 'Bounded Context', patterns: ['feature-module', 'public-api'], role: 'module / feature boundary' },
  aggregates: { blocks: 'Aggregate', patterns: ['state-machine', 'command', 'repository'], role: 'state, operation and persistence of one consistency boundary' },
  domainServices: { blocks: 'Domain Service', patterns: ['strategy', 'specification'], role: 'business policy that varies independently of the model' },
  domainEvents: { blocks: 'Domain Event', patterns: ['domain-event', 'observer'], role: 'propagating a business occurrence across boundaries' },
  entities: { blocks: 'Entity', patterns: ['data-mapper'], role: 'translating between persisted shape and domain shape' }
});

function bridgeDDDToPatterns(model) {
  const mappings = [];
  for (const [key, mapping] of Object.entries(DDD_PATTERN_BRIDGE)) {
    for (const concept of model?.[key] ?? []) {
      mappings.push({
        dddBlock: mapping.blocks,
        name: concept.name,
        confidence: concept.confidence,
        candidatePatterns: [...mapping.patterns],
        role: mapping.role,
        note: concept.kind === 'observed'
          ? '基于项目证据的映射候选'
          : '该领域概念本身是推断的，模式映射同样需要确认'
      });
    }
  }
  return mappings;
}

/** The model produced by `ddd-domain-discovery`, or an empty one. */
function dddModel(context) {
  return context.results?.['ddd-domain-discovery']?.artifacts?.ddd_model ?? {
    ubiquitousLanguage: [], boundedContexts: [], aggregates: [], entities: [],
    valueObjects: [], domainEvents: [], repositories: [], domainServices: []
  };
}

/**
 * Core / Supporting / Generic per R-STRATEGIC-002. Only observed contexts can
 * be called Core: claiming a competitive differentiator from a guess is exactly
 * the kind of unsupported decision DDD-SYSTEM-017 rules out.
 */
function classifySubdomains(model) {
  return model.boundedContexts.map((context) => ({
    name: context.name,
    classification: context.kind === 'observed' ? 'core-candidate' : 'unclassified',
    confidence: context.confidence,
    evidence: context.evidence ?? []
  }));
}

function toDDDArtifacts(ddd) {
  return {
    ubiquitous_language: ddd.ubiquitousLanguage,
    bounded_contexts: ddd.boundedContexts,
    aggregates: ddd.aggregates,
    entities: ddd.entities,
    value_objects: ddd.valueObjects,
    domain_events: ddd.domainEvents,
    repositories: ddd.repositories,
    domain_services: ddd.domainServices
  };
}

function simpleSkill(summary, artifacts) {
  return {
    async run() {
      return { status: 'pass', summary, artifacts, risks: [], nextHints: [] };
    }
  };
}
