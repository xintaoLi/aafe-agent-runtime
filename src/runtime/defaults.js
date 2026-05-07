import { AgentRuntime } from './AgentRuntime.js';

export const defaultRouter = {
  routes: {
    feature: { pipeline: 'feature' },
    refactor: { pipeline: 'refactor' },
    bugfix: { pipeline: 'bugfix' },
    performance: { pipeline: 'performance' },
    graphFeature: { pipeline: 'graph-feature' }
  }
};

export const defaultGates = {
  architecture_gate: { requires: ['boundaries', 'decomposition', 'pattern_selection'] },
  implementation_gate: { requires: ['risk_review', 'extension_points'] },
  merge_gate: { requires: ['critic_pass'] }
};

export const defaultPipelines = {
  feature: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-selector' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { gate: 'implementation_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  refactor: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'pattern-selector' }, { skill: 'refactor-critic' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  bugfix: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'module-decomposer' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  performance: { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'pattern-selector' }, { skill: 'evolution-predictor' }, { gate: 'architecture_gate' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] },
  'graph-feature': { steps: [{ skill: 'memory-recaller' }, { skill: 'architect' }, { skill: 'graph-architect' }, { skill: 'layout-strategy-selector' }, { skill: 'runtime-evolution-predictor' }, { skill: 'module-decomposer' }, { skill: 'pattern-selector' }, { gate: 'architecture_gate' }, { skill: 'adr-generator' }, { skill: 'refactor-critic' }, { skill: 'memory-writer' }, { gate: 'merge_gate' }] }
};

export const defaultSkills = {
  'memory-recaller': {
    async run(context) {
      return { status: 'pass', summary: 'Project memory recalled', artifacts: { memory_context: context.input?.memoryContext ?? '' }, risks: [], nextHints: [] };
    }
  },
  architect: simpleSkill('Architecture analysis completed', { boundaries: ['domain', 'application', 'infrastructure', 'presentation'], risk_review: ['coupling', 'scaling', 'ownership'] }),
  'module-decomposer': simpleSkill('Module decomposition completed', { decomposition: ['domain', 'application', 'infrastructure', 'presentation', 'shared'] }),
  'pattern-selector': simpleSkill('Pattern selection completed', { pattern_selection: ['strategy', 'registry', 'pipeline'] }),
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
    memory: overrides.memory,
    root: overrides.root
  });
}

function simpleSkill(summary, artifacts) {
  return {
    async run() {
      return { status: 'pass', summary, artifacts, risks: [], nextHints: [] };
    }
  };
}
