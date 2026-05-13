import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTemplatePlan, packageRecommendations } from '../templates/TemplateSystem.js';

export async function bootstrapProject(root, detection, options = {}) {
  const plan = createTemplatePlan(detection, options);
  await writeRuntime(root, detection, options, plan);
  await writeConfig(root, detection, options, plan);
  await writeEditorAdapters(root, detection, options, plan);
  await writePackageManifest(root, options, plan);
}

async function writeRuntime(root, detection, options, plan) {
  const files = runtimeFiles(detection, plan);
  for (const [rel, content] of Object.entries(files)) {
    await writeIfAllowed(path.join(root, rel), content, options);
  }
}

async function writeConfig(root, _detection, options, plan) {
  const config = {
    runtime: '.ai-agent',
    template: options.template ?? 'complex',
    memory: {
      enabled: plan.memory,
      path: '.ai-agent/memory',
      categories: ['design', 'component', 'habit', 'convention', 'decision', 'learning'],
      dedupe: true,
      summary: true
    },
    framework: plan.framework,
    frameworks: plan.frameworks,
    scenarios: plan.scenarios,
    editors: plan.editors,
    packs: plan.packs,
    recommendedPackages: packageRecommendations(plan),
    rerun: {
      enabled: true,
      maxReruns: 1,
      triggers: ['refactor-critic:fail', 'merge_gate:fail']
    },
    hooks: {
      enabled: true,
      sessionStart: '.cursor/hooks/aafe-session-start',
      failClosed: false
    },
    gates: ['ddd_gate', 'architecture_gate', 'pattern_gate', 'implementation_gate', 'merge_gate']
  };
  await writeIfAllowed(path.join(root, '.aafe.config.json'), `${JSON.stringify(config, null, 2)}\n`, options);
}

async function writeEditorAdapters(root, detection, options, plan) {
  const editors = new Set(plan.editors);
  if (editors.has('cursor')) {
    await writeIfAllowed(path.join(root, '.cursor/rules/aafe-architecture-runtime.mdc'), cursorRules(), options);
    await writeIfAllowed(path.join(root, '.cursor/hooks.json'), cursorHooks(), options);
    await writeIfAllowed(path.join(root, '.cursor/hooks/run-hook.cmd'), cursorHookRunner(), options);
    await writeIfAllowed(path.join(root, '.cursor/hooks/aafe-session-start'), cursorSessionStartHook(), options);
    await makeExecutable(path.join(root, '.cursor/hooks/aafe-session-start'));
    await makeExecutable(path.join(root, '.cursor/hooks/run-hook.cmd'));
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
  if (editors.has('windsurf')) {
    await writeIfAllowed(path.join(root, '.windsurfrules'), genericEditorRules('Windsurf'), options);
  }
  if (editors.has('vscode')) {
    await writeIfAllowed(path.join(root, '.vscode/aafe.instructions.md'), genericEditorRules('VS Code'), options);
  }
}

async function writePackageManifest(root, options, plan) {
  const content = `# AAFE Publishable Packs\n\nRecommended packages for this project:\n\n${packageRecommendations(plan).map((name) => `- ${name}`).join('\n')}\n\nThis file is generated from .aafe.config.json and documents the independent framework/scenario/editor packs that can be published later.\n`;
  await writeIfAllowed(path.join(root, '.ai-agent/packs.md'), content, options);
}

function runtimeFiles(_detection, plan) {
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
    '.ai-agent/skills/ddd-discovery.md': dddDiscoverySkill(),
    '.ai-agent/skills/bounded-context-mapper.md': boundedContextMapperSkill(),
    '.ai-agent/skills/aggregate-designer.md': aggregateDesignerSkill(),
    '.ai-agent/skills/domain-event-designer.md': domainEventDesignerSkill(),
    '.ai-agent/skills/ddd-implementation-planner.md': dddImplementationPlannerSkill(),
    '.ai-agent/scenarios/ddd.md': dddPack(),
    '.ai-agent/skills/architect.md': architectSkill(),
    '.ai-agent/skills/module-decomposer.md': decomposerSkill(),
    '.ai-agent/skills/pattern-interviewer.md': patternInterviewerSkill(),
    '.ai-agent/skills/pattern-selector.md': selectorSkill(),
    '.ai-agent/skills/module-pattern-selector.md': modulePatternSelectorSkill(),
    '.ai-agent/skills/pattern-implementation-planner.md': patternImplementationPlannerSkill(),
    '.ai-agent/scenarios/patterns.md': patternsPack(),
    '.ai-agent/scenarios/complex.md': complexPack(),
    '.ai-agent/skills/evolution-predictor.md': predictorSkill(),
    '.ai-agent/skills/refactor-critic.md': criticSkill(),
    '.ai-agent/skills/adr-generator.md': adrSkill(),
    '.ai-agent/pipelines/feature.yaml': featurePipeline(),
    '.ai-agent/pipelines/domain-feature.yaml': domainFeaturePipeline(),
    '.ai-agent/pipelines/pattern-feature.yaml': patternFeaturePipeline(),
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

  if (!plan.scenarios.includes('graph')) {
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

async function makeExecutable(filePath) {
  try {
    await chmod(filePath, 0o755);
  } catch {
    // Hook files are best-effort on platforms that support executable bits.
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
  domainFeature:
    pipeline: domain-feature
  refactor:
    pipeline: refactor
  bugfix:
    pipeline: bugfix
  performance:
    pipeline: performance
  graphFeature:
    pipeline: graph-feature
  patternFeature:
    pipeline: pattern-feature
`;
}

function gates() {
  return `gates:
  ddd_gate:
    requires:
      - ubiquitous_language
      - bounded_contexts
      - aggregates
  architecture_gate:
    requires:
      - boundaries
      - decomposition
      - pattern_selection
  pattern_gate:
    requires:
      - pattern_interview
      - pattern_selection
      - module_pattern_selection
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

function dddDiscoverySkill() {
  return `# Skill: DDD Discovery

Discover domain knowledge before implementation.

Output:
- ubiquitous language
- business subdomains
- bounded contexts
- core domain rules and invariants
- candidate aggregates

Required artifacts:
- ubiquitous_language
- bounded_contexts
- aggregates
`;
}

function boundedContextMapperSkill() {
  return `# Skill: Bounded Context Mapper

Map business capabilities into bounded contexts.

Output:
- context names
- responsibilities
- upstream/downstream relationships
- anti-corruption boundaries

Required artifacts:
- bounded_contexts
- context_map
`;
}

function aggregateDesignerSkill() {
  return `# Skill: Aggregate Designer

Design aggregates around business invariants.

Output:
- aggregate roots
- entities
- value objects
- invariants
- repository boundaries

Required artifacts:
- aggregates
- entities
- value_objects
- repositories
`;
}

function domainEventDesignerSkill() {
  return `# Skill: Domain Event Designer

Identify domain events that represent meaningful business changes.

Output:
- event names
- event payload ownership
- event consumers
- consistency model

Required artifacts:
- domain_events
`;
}

function dddImplementationPlannerSkill() {
  return `# Skill: DDD Implementation Planner

Turn DDD model into frontend/application architecture.

Output:
- domain model files
- application services/use cases
- repositories/ports
- infrastructure adapters
- presentation boundaries
- testing strategy

Required artifacts:
- ddd_implementation_plan
- extension_points
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

function patternInterviewerSkill() {
  return `# Skill: Pattern Interviewer

Before selecting a design pattern, analyze the feature and ask targeted questions when constraints are unclear.

Question dimensions:
- Will this feature need multiple interchangeable implementations?
- Is there complex state transition or lifecycle control?
- Does the operation need undo/redo/replay/audit?
- Is the process a multi-step pipeline with reusable stages?
- Does it need plugin/registry-based extension?

Required artifacts:
- pattern_interview
`;
}

function selectorSkill() {
  return `# Skill: Pattern Selector

Select architecture patterns only when feature constraints justify them.

Candidate patterns:
- Strategy
- Factory
- Registry
- State Machine
- Command
- Pipeline
- Observer
- Adapter
- Composition

Selection rules:
1. Prefer simple composition when no pattern is justified.
2. Ask pattern interview questions before implementation when confidence is low.
3. Output selected pattern, rejected alternatives, tradeoffs and landing plan.
4. Do not use patterns only because they are familiar.

Required artifacts:
- pattern_selection
`;
}

function modulePatternSelectorSkill() {
  return `# Skill: Module Pattern Selector

For complex frontend features, select design patterns per module instead of forcing one global pattern.

Module dimensions:
- domain: invariants, entities, value objects and repository ports
- application: use cases, orchestration and command flow
- infrastructure: API adapters, providers and extension registries
- presentation: UI composition, interaction state and view contracts

Selection rules:
1. Each module must choose the simplest sufficient pattern for its responsibility.
2. Different modules may use different patterns when business behavior differs.
3. Pattern landing must include contract, implementation boundary and verification.
4. Do not leak infrastructure or presentation pattern choices into domain logic.

Required artifacts:
- module_pattern_selection
`;
}

function patternImplementationPlannerSkill() {
  return `# Skill: Pattern Implementation Planner

Turn the selected design pattern into an implementation plan.

Output:
- interfaces/contracts to introduce
- modules/files to create or change
- extension points
- migration impact
- testing strategy

Required artifacts:
- pattern_implementation_plan
- extension_points
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
  - skill: ddd-discovery
  - gate: ddd_gate
  - skill: module-decomposer
  - skill: pattern-interviewer
  - skill: pattern-selector
  - skill: module-pattern-selector
  - gate: pattern_gate
  - skill: evolution-predictor
  - gate: architecture_gate
  - skill: adr-generator
  - gate: implementation_gate
  - skill: refactor-critic
  - skill: memory-writer
  - gate: merge_gate
`;
}

function domainFeaturePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: ddd-discovery
  - skill: bounded-context-mapper
  - skill: aggregate-designer
  - skill: domain-event-designer
  - gate: ddd_gate
  - skill: architect
  - skill: module-decomposer
  - skill: pattern-interviewer
  - skill: pattern-selector
  - skill: module-pattern-selector
  - gate: pattern_gate
  - skill: ddd-implementation-planner
  - gate: implementation_gate
  - skill: adr-generator
  - skill: refactor-critic
  - skill: memory-writer
  - gate: merge_gate
`;
}

function patternFeaturePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: pattern-interviewer
  - skill: pattern-selector
  - skill: module-pattern-selector
  - gate: pattern_gate
  - skill: pattern-implementation-planner
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
  - skill: memory-writer
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
  - skill: pattern-interviewer
  - skill: pattern-selector
  - skill: module-pattern-selector
  - gate: pattern_gate
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

function dddPack() {
  return `# Scenario Pack: Domain-Driven Design

Use this pack for business-heavy features where domain language and business invariants matter.

Workflow:
1. Discover ubiquitous language.
2. Identify bounded contexts and context map.
3. Design aggregates around invariants.
4. Identify entities, value objects, repositories and domain services.
5. Identify domain events and consistency boundaries.
6. Map domain model to frontend/application architecture.

DDD building blocks:
- Ubiquitous Language
- Subdomain
- Bounded Context
- Context Map
- Aggregate Root
- Entity
- Value Object
- Repository
- Domain Service
- Domain Event
- Anti-Corruption Layer
`;
}

function patternsPack() {
  return `# Scenario Pack: Design Patterns

Use this pack when implementing new features that may need a design pattern.

Workflow:
1. Analyze feature variability, lifecycle, state, extensibility and operation history.
2. Ask pattern interview questions if constraints are unclear.
3. Select the simplest sufficient pattern.
4. Produce a concrete landing plan before coding.
5. Record the decision and tradeoffs in Memory/ADR.

Pattern map:
- Strategy: interchangeable algorithms/providers
- Factory: complex object creation
- Registry: plugin or extension point
- State Machine: complex lifecycle and illegal states
- Command: undo/redo/replay/audit
- Pipeline: multi-stage processing
- Observer: decoupled event notification
- Adapter: third-party or compatibility boundary
- Composition: UI behavior composition
`;
}

function complexPack() {
  return `# Scenario Pack: Complex Frontend

Use this pack as the default scenario for non-trivial frontend systems.

Workflow:
1. Split the feature by real business modules before selecting patterns.
2. Select patterns independently for domain, application, infrastructure and presentation modules.
3. Keep each selected pattern inside its module boundary.
4. Land each pattern with contract, implementation and verification.
5. Reject one global pattern when module responsibilities differ.

Module pattern map:
- domain: State Machine, Repository Port, Domain Service, Specification
- application: Command, Pipeline, Use Case Orchestrator
- infrastructure: Adapter, Registry, Strategy
- presentation: Composition, Observer, State Machine
- graph-runtime: Command, Strategy, Registry, Observer
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
5. Use framework, DDD, design-pattern and scenario packs when relevant.
6. For business-heavy features, run DDD Discovery before module decomposition.
7. For new features, run Pattern Interview before Pattern Selection.
8. For complex frontend work, select and land patterns per module based on real business responsibility.
9. Output DDD Model, Architecture, Module Boundaries, Pattern Interview, Pattern Selection, Module Pattern Selection, Tradeoffs, Implementation and Critique.
`;
}

function cursorHooks() {
  return `${JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [
        {
          command: '.cursor/hooks/run-hook.cmd aafe-session-start',
          timeout: 5,
          failClosed: false
        }
      ]
    }
  }, null, 2)}\n`;
}

function cursorHookRunner() {
  return `: << 'CMDBLOCK'
@echo off
if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)
set "HOOK_DIR=%~dp0"
if exist "C:\\Program Files\\Git\\bin\\bash.exe" (
    "C:\\Program Files\\Git\\bin\\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\\Program Files (x86)\\Git\\bin\\bash.exe" (
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
exit /b 0
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec bash "\${SCRIPT_DIR}/\${SCRIPT_NAME}" "$@"
`;
}

function cursorSessionStartHook() {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "\${SCRIPT_DIR}/../.." && pwd)"

read_text() {
  if [ -f "$1" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      printf '%s\\n' "$line"
    done < "$1"
  fi
}

escape_for_json() {
  local s="$1"
  s="\${s//\\\\/\\\\\\\\}"
  s="\${s//\\"/\\\\\\"}"
  s="\${s//$'\\n'/\\\\n}"
  s="\${s//$'\\r'/\\\\r}"
  s="\${s//$'\\t'/\\\\t}"
  printf '%s' "$s"
}

engine="$(read_text "\${PROJECT_ROOT}/.ai-agent/runtime/engine.md")"
router="$(read_text "\${PROJECT_ROOT}/.ai-agent/runtime/router.yaml")"
gates="$(read_text "\${PROJECT_ROOT}/.ai-agent/runtime/gates.yaml")"

context="<AAFE_RUNTIME>\\nAAFE Architecture Runtime is active for this repository.\\n\\nEngine:\\n\${engine}\\n\\nRouter:\\n\${router}\\n\\nGates:\\n\${gates}\\n</AAFE_RUNTIME>"
escaped_context="$(escape_for_json "$context")"
printf '{\\n  "additional_context": "%s"\\n}\\n' "$escaped_context"
exit 0
`;
}

function claudeRules() {
  return `# AAFE Architecture Runtime

Load .ai-agent/runtime/engine.md for frontend engineering tasks. Classify requests, follow the matching pipeline, run DDD discovery for business-heavy features, run pattern interview for new features, select patterns per module for complex frontend work, enforce gates, and only implement after DDD, architecture and pattern gates pass.
`;
}

function genericEditorRules(name) {
  return `# AAFE Architecture Runtime for ${name}

Use .ai-agent as the project architecture runtime. Route requests through runtime/router.yaml, run DDD discovery for business-heavy features, run pattern interview for new features, select patterns per module for complex frontend work, execute pipeline steps, enforce gates, and run refactor critique before finalizing code.
`;
}
