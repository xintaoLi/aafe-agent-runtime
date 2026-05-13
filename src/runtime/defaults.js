import { analyzeDDD } from '../ddd/DDDAdvisor.js';
import { analyzePatternFit } from '../patterns/PatternAdvisor.js';
import { AgentRuntime } from './AgentRuntime.js';

export const defaultRouter = {
  routes: {
    feature: { pipeline: 'feature' },
    domainFeature: { pipeline: 'domain-feature' },
    refactor: { pipeline: 'refactor' },
    bugfix: { pipeline: 'bugfix' },
    performance: { pipeline: 'performance' },
    graphFeature: { pipeline: 'graph-feature' },
    patternFeature: { pipeline: 'pattern-feature' }
  }
};

export const defaultGates = {
  ddd_gate: { requires: ['ubiquitous_language', 'bounded_contexts', 'aggregates'] },
  architecture_gate: { requires: ['boundaries', 'decomposition', 'pattern_selection'] },
  pattern_gate: { requires: ['pattern_interview', 'pattern_selection'] },
  implementation_gate: { requires: ['risk_review', 'extension_points'] },
  merge_gate: { requires: ['critic_pass'] }
};

export const defaultPipelines = {
  feature: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'ddd-discovery' }, { gate: 'ddd_gate' }, { skill: 'module-decomposer' }, { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' }, { gate: 'pattern_gate' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { gate: 'implementation_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'domain-feature': { steps: [{ skill: 'memory-recaller' }, { skill: 'ddd-discovery' }, { skill: 'bounded-context-mapper' }, { skill: 'aggregate-designer' }, { skill: 'domain-event-designer' }, { gate: 'ddd_gate' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' }, { gate: 'pattern_gate' }, { skill: 'ddd-implementation-planner' }, { gate: 'implementation_gate' }, { skill: 'adr-generator' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'pattern-feature': { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' }, { gate: 'pattern_gate' }, { skill: 'pattern-implementation-planner' }, { skill: 'adr-generator' }, { gate: 'implementation_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  refactor: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-selector' }, { skill: 'refactor-critic' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  bugfix: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  performance: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'pattern-selector' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'graph-feature': { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'graph-architect' }, { skill: 'layout-strategy-selector' }, { skill: 'runtime-evolution-predictor' }, { skill: 'module-decomposer' }, { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' }, { gate: 'pattern_gate' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] }
};

export const defaultSkills = {
  'memory-recaller': {
    async run(context) {
      return { status: 'pass', summary: 'Project memory recalled', artifacts: { memory_context: context.input?.memoryContext ?? '' }, risks: [], nextHints: [] };
    }
  },
  'ddd-discovery': {
    async run(context) {
      const ddd = analyzeDDD({ prompt: context.input?.request });
      return { status: ddd.status, summary: `DDD discovery: ${ddd.boundedContexts.join(', ') || 'unknown context'}`, artifacts: toDDDArtifacts(ddd), risks: ddd.status === 'warn' ? ['Domain language is unclear; ask DDD discovery questions'] : [], nextHints: ddd.questions };
    }
  },
  'bounded-context-mapper': {
    async run(context) {
      const ddd = analyzeDDD({ prompt: context.input?.request });
      return { status: 'pass', summary: 'Bounded contexts mapped', artifacts: { bounded_contexts: ddd.boundedContexts, context_map: ddd.boundedContexts }, risks: [], nextHints: [] };
    }
  },
  'aggregate-designer': {
    async run(context) {
      const ddd = analyzeDDD({ prompt: context.input?.request });
      return { status: 'pass', summary: 'Aggregates designed', artifacts: { aggregates: ddd.aggregates, entities: ddd.entities, value_objects: ddd.valueObjects, repositories: ddd.repositories }, risks: [], nextHints: ddd.questions };
    }
  },
  'domain-event-designer': {
    async run(context) {
      const ddd = analyzeDDD({ prompt: context.input?.request });
      return { status: 'pass', summary: 'Domain events designed', artifacts: { domain_events: ddd.domainEvents, domain_services: ddd.domainServices }, risks: [], nextHints: [] };
    }
  },
  'ddd-implementation-planner': simpleSkill('DDD implementation plan completed', { extension_points: ['domain-model', 'repository', 'application-service'], ddd_implementation_plan: true }),
  architect: simpleSkill('Architecture analysis completed', { boundaries: ['domain', 'application', 'infrastructure', 'presentation'], risk_review: ['coupling', 'scaling', 'ownership'] }),
  'module-decomposer': simpleSkill('Module decomposition completed', { decomposition: ['domain', 'application', 'infrastructure', 'presentation', 'shared'] }),
  'pattern-interviewer': {
    async run(context) {
      const fit = analyzePatternFit({ prompt: context.input?.request });
      return { status: 'pass', summary: 'Pattern interview prepared', artifacts: { pattern_interview: fit.questions }, risks: [], nextHints: fit.questions };
    }
  },
  'pattern-selector': {
    async run(context) {
      const fit = analyzePatternFit({ prompt: context.input?.request });
      return { status: fit.status, summary: `Recommended pattern: ${fit.recommendation}`, artifacts: { pattern_selection: fit.recommendation, pattern_candidates: fit.candidates }, risks: fit.status === 'warn' ? ['Pattern confidence is low; ask interview questions before implementation'] : [], nextHints: fit.questions };
    }
  },
  'pattern-implementation-planner': simpleSkill('Pattern implementation plan completed', { pattern_implementation_plan: true, extension_points: ['interface', 'registry', 'adapter'] }),
  'evolution-predictor': simpleSkill('Evolution prediction completed', { extension_points: ['provider', 'adapter', 'policy'] }),
  'refactor-critic': simpleSkill('Refactor critique passed', { critic_pass: true }),
  'adr-generator': simpleSkill('ADR generated', { adr: true }),
  'graph-architect': simpleSkill('Graph architecture analysis completed', { graph_boundaries: ['node', 'edge', 'layout', 'runtime'] }),
  'layout-strategy-selector': simpleSkill('Layout strategy selected', { layout_strategy: ['elk', 'layered', 'manual'] }),
  'runtime-evolution-predictor': simpleSkill('Runtime evolution predicted', { runtime_extensions: ['async', 'streaming', 'retry'] }),
  'memory-writer': simpleSkill('Project learning captured', { memory_write: true })
};

export function createDefaultRuntime(overrides = {}) {
  return new AgentRuntime({
    router: overrides.router ?? defaultRouter,
    pipelines: overrides.pipelines ?? defaultPipelines,
    gates: overrides.gates ?? defaultGates,
    skills: { ...defaultSkills, ...(overrides.skills ?? {}) },
    hooks: overrides.hooks,
    memory: overrides.memory,
    root: overrides.root,
    maxReruns: overrides.maxReruns
  });
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
