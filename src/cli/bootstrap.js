import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function bootstrapProject(root, detection, options = {}) {
  await writeRuntime(root, detection, options);
  await writeConfig(root, detection, options);
  await writeEditorAdapters(root, detection, options);
}

async function writeRuntime(root, detection, options) {
  const files = runtimeFiles(detection);
  for (const [rel, content] of Object.entries(files)) {
    await writeIfAllowed(path.join(root, rel), content, options);
  }
}

async function writeConfig(root, detection, options) {
  const config = {
    runtime: '.ai-agent',
    memory: {
      enabled: true,
      path: '.ai-agent/memory',
      categories: ['design', 'component', 'habit', 'convention', 'decision', 'learning']
    },
    framework: detection.framework,
    scenarios: detection.scenarios,
    editors: detection.editors,
    gates: ['architecture_gate', 'implementation_gate', 'merge_gate']
  };
  await writeIfAllowed(path.join(root, '.aafe.config.json'), `${JSON.stringify(config, null, 2)}\n`, options);
}

async function writeEditorAdapters(root, detection, options) {
  const editors = new Set(detection.editors);
  if (editors.has('cursor')) {
    await writeIfAllowed(path.join(root, '.cursor/rules/aafe-architecture-runtime.mdc'), cursorRules(), options);
  }
  if (editors.has('claude')) {
    await writeIfAllowed(path.join(root, 'CLAUDE.md'), claudeRules(), { ...options, append: true });
  }
  if (editors.has('codebuddy')) {
    await writeIfAllowed(path.join(root, '.codebuddy/aafe.md'), genericEditorRules('CodeBuddy'), options);
  }
  if (editors.has('codex')) {
    await writeIfAllowed(path.join(root, '.codex/aafe.md'), genericEditorRules('CodeX'), options);
  }
  if (editors.has('trace')) {
    await writeIfAllowed(path.join(root, '.trace/aafe.md'), genericEditorRules('Trace'), options);
  }
}

function runtimeFiles(detection) {
  const files = {
    '.ai-agent/runtime/engine.md': engine(),
    '.ai-agent/runtime/router.yaml': router(),
    '.ai-agent/runtime/gates.yaml': gates(),
    '.ai-agent/runtime/protocol.md': protocol(),
    '.ai-agent/runtime/memory.md': memoryRuntime(),
    '.ai-agent/skills/memory-recaller.md': memoryRecallerSkill(),
    '.ai-agent/skills/memory-writer.md': memoryWriterSkill(),
    '.ai-agent/memory/index.md': memoryIndex(),
    '.ai-agent/memory/project-design.md': memoryProjectDesign(),
    '.ai-agent/memory/components.md': memoryComponents(),
    '.ai-agent/memory/development-habits.md': memoryDevelopmentHabits(),
    '.ai-agent/memory/conventions.md': memoryConventions(),
    '.ai-agent/memory/decisions.md': memoryDecisions(),
    '.ai-agent/memory/learnings.jsonl': '',
    '.ai-agent/skills/architect.md': architectSkill(),
    '.ai-agent/skills/module-decomposer.md': decomposerSkill(),
    '.ai-agent/skills/pattern-selector.md': selectorSkill(),
    '.ai-agent/skills/evolution-predictor.md': predictorSkill(),
    '.ai-agent/skills/refactor-critic.md': criticSkill(),
    '.ai-agent/skills/adr-generator.md': adrSkill(),
    '.ai-agent/pipelines/feature.yaml': featurePipeline(),
    '.ai-agent/pipelines/refactor.yaml': refactorPipeline(),
    '.ai-agent/pipelines/bugfix.yaml': bugfixPipeline(),
    '.ai-agent/pipelines/performance.yaml': performancePipeline(),
    '.ai-agent/frameworks/react.md': reactPack(),
    '.ai-agent/frameworks/next.md': nextPack(),
    '.ai-agent/frameworks/vue.md': vuePack(),
    '.ai-agent/frameworks/monorepo.md': monorepoPack(),
    '.ai-agent/scenarios/admin.md': adminPack(),
    '.ai-agent/scenarios/dashboard.md': dashboardPack(),
    '.ai-agent/scenarios/workflow.md': workflowPack(),
    '.ai-agent/scenarios/graph.md': graphPack()
  };

  if (!detection.scenarios.includes('graph')) {
    files['.ai-agent/pipelines/graph-feature.yaml'] = graphFeaturePipeline();
  }
  return files;
}

async function writeIfAllowed(filePath, content, options) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (options.append) {
    const previous = await safeRead(filePath);
    if (previous.includes('AAFE Architecture Runtime')) return;
    await writeFile(filePath, `${previous.trimEnd()}\n\n${content}`.trimStart());
    return;
  }
  if (!options.force && await exists(filePath)) return;
  await writeFile(filePath, content);
}

async function exists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function engine() {
  return `# AAFE Architecture Runtime Engine

ROLE: Skill Orchestrator for frontend engineering agents.

Responsibilities:
1. Classify every request before implementation.
2. Select the matching architecture pipeline.
3. Execute skills in order and preserve structured state.
4. Enforce gates before code generation or merge.
5. Compose implementation plans from architecture outputs.
6. Run critique after implementation and request rerun on failure.

Never:
- Skip architecture analysis for feature, refactor or performance work.
- Implement before architecture_gate passes.
- Hide tradeoffs or future extension risks.
- Mix domain, infrastructure and presentation responsibilities.
`;
}

function router() {
  return `routes:
  feature:
    pipeline: feature
  refactor:
    pipeline: refactor
  bugfix:
    pipeline: bugfix
  performance:
    pipeline: performance
  graphFeature:
    pipeline: graph-feature
`;
}

function gates() {
  return `gates:
  architecture_gate:
    requires:
      - boundaries
      - decomposition
      - pattern_selection
  implementation_gate:
    requires:
      - risk_review
      - extension_points
  merge_gate:
    requires:
      - critic_pass
`;
}

function protocol() {
  return `# Skill State Protocol

Every skill must output:

\`\`\`json
{
  "status": "pass | warn | fail",
  "summary": "short decision summary",
  "artifacts": {},
  "risks": [],
  "nextHints": []
}
\`\`\`

Artifacts should expose stable keys used by gates, such as boundaries, decomposition, pattern_selection, risk_review, extension_points and critic_pass.
`;
}

function memoryRuntime() {
  return `# Project Memory Runtime

AAFE Memory gives each project a self-growing learning layer.

Before architecture work:
- recall relevant project design memory
- recall component contracts and conventions
- apply development habits and team rules

After work:
- capture durable project design learnings
- record component contracts and reusable patterns
- record coding habits, conventions and architecture decisions

Memory categories:
- design: project architecture and module boundaries
- component: component contracts, composition and usage rules
- habit: development habits and preferences
- convention: naming, layout, testing and review standards
- decision: ADR-like durable decisions and tradeoffs
- learning: general project-specific lessons
`;
}

function memoryRecallerSkill() {
  return `# Skill: Memory Recaller

Before architecture analysis, retrieve relevant project memory from .ai-agent/memory.

Use memory to understand:
- project design
- existing component contracts
- team development habits
- coding conventions
- previous architecture decisions

Required artifacts:
- memory_context
`;
}

function memoryWriterSkill() {
  return `# Skill: Memory Writer

After implementation or critique, write durable learnings into .ai-agent/memory.

Capture only stable project knowledge:
- project design rules
- component contracts
- reusable patterns
- development habits
- conventions
- architecture decisions and tradeoffs

Avoid writing temporary task details or noisy logs.

Required artifacts:
- memory_write
`;
}

function memoryIndex() {
  return `# Project Memory

This directory stores project-specific learning for AI agents.

Memory categories:
- project-design: architecture, module boundaries and domain concepts
- components: reusable components, props contracts and composition rules
- development-habits: team preferences and recurring implementation habits
- conventions: naming, file layout, coding rules and review standards
- decisions: architecture decisions and tradeoffs
- learnings.jsonl: append-only structured memory log
`;
}

function memoryProjectDesign() {
  return `# Project Design Memory

Record architecture, domain boundaries, module ownership, state ownership and long-term design constraints here.
`;
}

function memoryComponents() {
  return `# Component Memory

Record component contracts, composition rules, reusable patterns, anti-patterns and usage examples here.
`;
}

function memoryDevelopmentHabits() {
  return `# Development Habits Memory

Record team habits, preferred implementation style, review preferences and recurring workflow choices here.
`;
}

function memoryConventions() {
  return `# Conventions Memory

Record naming rules, folder layout, import rules, testing expectations and style conventions here.
`;
}

function memoryDecisions() {
  return `# Architecture Decisions Memory

Record durable decisions, alternatives, tradeoffs and consequences here.
`;
}

function architectSkill() {
  return `# Skill: Architect

Analyze the request as a senior frontend architect before coding.

Output must include:
- domain boundaries
- impacted modules
- scaling risks
- coupling risks
- architecture decision summary

Required artifacts:
- boundaries
- risk_review
`;
}

function decomposerSkill() {
  return `# Skill: Module Decomposer

Decompose work into clear layers:
- domain
- application
- infrastructure
- presentation
- shared

Check that responsibilities do not leak across layers.

Required artifacts:
- decomposition
`;
}

function selectorSkill() {
  return `# Skill: Pattern Selector

Select architecture patterns only when constraints justify them.

Candidate patterns:
- Strategy
- Factory
- Registry
- State Machine
- Event Bus
- CQRS
- Pipeline
- Observer

Always explain why simpler alternatives are insufficient.

Required artifacts:
- pattern_selection
`;
}

function predictorSkill() {
  return `# Skill: Evolution Predictor

Predict likely changes in the next 3-12 months.

Output:
- 3 likely feature expansions
- extension points
- anti-fragile abstractions
- risks of over-engineering

Required artifacts:
- extension_points
`;
}

function criticSkill() {
  return `# Skill: Refactor Critic

Review generated or proposed code for:
- hidden coupling
- poor extensibility
- mixed concerns
- abstraction leakage
- state ownership ambiguity
- framework-specific pitfalls

Required artifacts:
- critic_pass
`;
}

function adrSkill() {
  return `# Skill: ADR Generator

Generate Architecture Decision Records for non-trivial decisions.

Format:
# Decision
# Context
# Alternatives
# Tradeoffs
# Consequences
# Follow-ups
`;
}

function featurePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: pattern-selector
  - skill: evolution-predictor
  - gate: architecture_gate
  - skill: adr-generator
  - gate: implementation_gate
  - skill: refactor-critic
  - skill: memory-writer
  - gate: merge_gate
`;
}

function refactorPipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: refactor-critic
  - gate: architecture_gate
  - skill: adr-generator
  - skill: memory-writer
  - gate: merge_gate
`;
}

function bugfixPipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: refactor-critic
  - skill: memory-writer
  - gate: merge_gate
`;
}

function performancePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: pattern-selector
  - skill: evolution-predictor
  - gate: architecture_gate
  - skill: refactor-critic
  - gate: merge_gate
`;
}

function graphFeaturePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: graph-architect
  - skill: layout-strategy-selector
  - skill: runtime-evolution-predictor
  - skill: module-decomposer
  - skill: pattern-selector
  - gate: architecture_gate
  - skill: adr-generator
  - skill: refactor-critic
  - skill: memory-writer
  - gate: merge_gate
`;
}

function reactPack() {
  return `# Framework Pack: React

Focus:
- hooks boundary
- context overuse
- state slicing
- render optimization
- server state vs client state ownership
`;
}

function nextPack() {
  return `# Framework Pack: Next.js

Focus:
- server/client boundary
- route segmentation
- cache strategy
- data fetching ownership
- edge/runtime constraints
`;
}

function vuePack() {
  return `# Framework Pack: Vue

Focus:
- composable design
- reactive ownership
- store boundaries
- component responsibility split
`;
}

function monorepoPack() {
  return `# Framework Pack: Monorepo

Focus:
- package boundary
- dependency graph
- public contract governance
- build pipeline ownership
`;
}

function adminPack() {
  return `# Scenario Pack: Admin

Focus:
- RBAC/ABAC evolution
- route permissions
- auditability
- form/table abstraction boundaries
`;
}

function dashboardPack() {
  return `# Scenario Pack: Dashboard

Focus:
- data model ownership
- visualization composition
- cache refresh strategy
- metric definition governance
`;
}

function workflowPack() {
  return `# Scenario Pack: Workflow

Focus:
- state machine modeling
- approval lifecycle
- event history
- rollback and audit requirements
`;
}

function graphPack() {
  return `# Scenario Pack: Graph

Focus:
- graph boundary
- node lifecycle
- edge ownership
- layout strategy
- execution semantics
- command history
`;
}

function cursorRules() {
  return `---
description: AAFE Architecture Runtime
alwaysApply: true
---

# AAFE Architecture Runtime

For every non-trivial frontend task:
1. Read .ai-agent/runtime/engine.md.
2. Classify the task using .ai-agent/runtime/router.yaml.
3. Follow the selected .ai-agent/pipelines/*.yaml.
4. Enforce .ai-agent/runtime/gates.yaml before implementation.
5. Use framework and scenario packs when relevant.
6. Output Architecture, Module Boundaries, Pattern Selection, Tradeoffs, Implementation and Critique.
`;
}

function claudeRules() {
  return `# AAFE Architecture Runtime

Load .ai-agent/runtime/engine.md for frontend engineering tasks. Classify requests, follow the matching pipeline, enforce gates, and only implement after architecture analysis passes.
`;
}

function genericEditorRules(name) {
  return `# AAFE Architecture Runtime for ${name}

Use .ai-agent as the project architecture runtime. Route requests through runtime/router.yaml, execute pipeline steps, enforce gates, and run refactor critique before finalizing code.
`;
}
