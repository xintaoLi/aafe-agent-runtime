/**
 * The `frontend-engineering/` capability pack, emitted under `.ai-agent/`.
 *
 * Same shape as the DDD pack: one entry SKILL, the cross-cutting rules, one
 * skill per stage and per pattern domain, schemas and references.
 *
 * The sixteen domain rule files are generated from `PATTERN_DOMAINS` rather
 * than retyped here. They are the same 155 rules the scorer and the composer
 * enforce, so keeping a second copy in prose would guarantee the two drift.
 */

import { PATTERN_DOMAINS, PATTERN_INDEX } from '../patterns/catalog.js';
import { ANTI_PATTERN_CATALOG, ANTI_PATTERN_RULES } from '../patterns/AntiPatternDetector.js';

const AGENT_PREFIX = '.ai-agent';
const PACK = 'frontend-engineering';

/** Cross-cutting rules, in the order they must be loaded. */
const CORE_RULES = [
  {
    file: 'pattern-gate',
    title: 'Frontend Pattern Enablement Gate',
    body: `## Purpose

Control whether frontend design-pattern skills may be activated.

## Activation Principle

Frontend design-pattern skills are opt-in.

They MUST NOT be activated merely because the project contains: class,
interface, factory, service, observer, event, store, reducer, hook, component,
adapter, strategy, singleton, facade, command, middleware.

The existence of a pattern-like implementation MUST NOT activate pattern skills.

## Explicit Activation

设计模式、前端设计模式、设计模式优化、设计模式重构、设计模式落地、使用设计模式、
按设计模式设计、模式组合、前端架构模式、设计模式分析、识别设计模式、
重构成某种设计模式、优化模式组合。

Equivalent English intent: design patterns, frontend design patterns,
pattern-based architecture, pattern refactoring, pattern optimization,
design pattern analysis, pattern composition.

Naming a specific pattern with intent — "用 Strategy Pattern 重构计价"、"策略模式"
— also activates the system.

## Non-Activation

普通代码重构、性能优化、Bug 修复、组件开发、API 开发、状态管理、React 开发、
Vue 开发、TypeScript 开发、CSS 优化、构建优化、架构分析 — unless design-pattern
intent is explicit.

## Important

Architecture analysis MUST NOT automatically become pattern analysis.
Performance optimization MUST NOT automatically become performance-pattern analysis.
State management MUST NOT automatically activate State Pattern Skills.

Only explicit pattern intent activates this system.

## Decision

Run \`aafe pattern gate "<request>"\`:

- \`disabled\` → 按普通任务处理，不做模式识别、选型或组合
- \`ambiguous\` → 先问用户是否要按设计模式做，不要静默启用
- \`enabled\` → 进入 Discovery，而不是直接选型`
  },
  {
    file: 'pattern-composition',
    title: 'Pattern Composition Rules',
    body: `## PATTERN-SYSTEM-001

Design patterns are composable problem-solving mechanisms.

A frontend project MUST NOT be designed by selecting one design pattern and
applying it globally.

The system MUST:

1. identify problems first;
2. identify boundaries and variation points;
3. select multiple patterns where necessary;
4. assign each pattern an explicit responsibility;
5. define interactions between patterns;
6. detect conflicts and redundant patterns;
7. evaluate total architectural complexity;
8. select the minimum sufficient pattern composition;
9. validate the resulting architecture against actual project requirements.

A pattern is successful only when the composition improves changeability,
maintainability, isolation, extensibility, correctness, performance and
testability without introducing unnecessary complexity.

## PATTERN-SYSTEM-002

No pattern is mandatory.

The absence of a design pattern is NOT a defect.

A pattern MUST only be introduced when a concrete problem, variation point,
architectural boundary, or measurable constraint justifies its use.

## PATTERN-SYSTEM-003

Pattern selection is contextual.

The same problem MAY require different pattern compositions in different
projects because of framework, runtime, application size, team size, business
complexity, performance constraints, deployment model, existing architecture,
migration cost and testing requirements.

## CORE PRINCIPLE

A real frontend architecture SHOULD be composed of multiple patterns.

A single design pattern MUST NOT be treated as a complete project architecture.

## Rules

RULE-001
Pattern selection MUST begin from architectural and business problems.
Not "which pattern should I use?" but "what problems must this system solve?".

RULE-002
Multiple patterns MAY be combined when they solve different problems.

RULE-003
Every selected pattern MUST have an explicit responsibility.

RULE-004
A pattern MUST NOT be introduced merely because it is a recognized design pattern.

RULE-005
Patterns MUST NOT overlap responsibilities without justification.

RULE-006
The system MUST distinguish Pattern, Architecture, Framework and Implementation Technique.

RULE-007
A pattern combination MUST define responsibility, boundary, input, output,
dependency, interaction, lifecycle and failure behavior.

RULE-008
The selected patterns MUST form a coherent composition.

RULE-009
The agent MUST identify pattern conflicts.

RULE-010
The agent MUST identify unnecessary patterns.

RULE-011
The simplest sufficient composition SHOULD be preferred.

RULE-012
Pattern count MUST NOT be used as a quality metric.

RULE-013
A system using fewer patterns MAY be architecturally superior to a system using
more patterns.

RULE-014
Patterns SHOULD be selected according to the problem's volatility. Stable code
SHOULD NOT receive unnecessary abstraction. Frequently changing behavior SHOULD
receive appropriate variation-isolation patterns.`
  },
  {
    file: 'pattern-selection',
    title: 'Pattern Selection Rules',
    body: `## Workflow

Problem → Requirement → Variation Point → Boundary → Candidate Patterns →
Trade-off Analysis → Selected Patterns.

Selection MUST NOT start at "candidate patterns". Discovery runs first and
describes problems without naming solutions.

## Scoring

Every candidate MUST be scored, and the score MUST be shown:

\`\`\`
PatternScore = ProblemFit + ChangeIsolation + ComplexityReduction
             + ReusePotential + PerformanceBenefit
             - ImplementationCost - CognitiveCost - CouplingRisk
             - OverengineeringRisk
\`\`\`

Each selected pattern MUST report score, problem, benefit, cost, risk,
alternatives and evidence.

A benefit only counts when the identified problem asks for it. Performance
benefit MUST NOT be credited to a pattern selected for a non-performance problem.

## Justification Bar

A pattern is selected only when it answers an identified problem and its score
is positive. Ranking alone MUST NOT produce a selection: "top 3 candidates" is
not a justification.

An empty selection is a valid and sometimes correct outcome.

## Command

\`aafe pattern discover "<request>"\` → problems only
\`aafe pattern select "<request>"\`   → scored composition
\`aafe pattern audit "<request>"\`    → anti-pattern findings`
  },
  {
    file: 'pattern-boundary',
    title: 'Pattern Boundary Rules',
    body: `## Purpose

Keep each pattern inside the responsibility it was selected for.

BOUNDARY-001
Every pattern MUST declare its boundary: what is inside it and what is not.

BOUNDARY-002
A pattern MUST NOT absorb responsibilities belonging to another selected pattern.

BOUNDARY-003
Patterns MUST NOT be layered purely to satisfy a naming convention.

BOUNDARY-004
Cross-boundary communication MUST be explicit; implicit coupling through shared
mutable state is not a pattern relation.

BOUNDARY-005
A pattern's failure behavior MUST be defined at its boundary.

BOUNDARY-006
DDD decides boundaries; patterns operate inside them. A pattern MUST NOT be used
to redraw a bounded context.`
  },
  {
    file: 'pattern-overengineering',
    title: 'Over-engineering Rules',
    body: `## Purpose

Prevent the pattern system from becoming an abstraction generator.

OVERENG-001
A pattern whose justifying complexity is absent MUST NOT be introduced.

OVERENG-002
Abstraction count MUST NOT exceed the number of variation points it isolates.

OVERENG-003
"可能以后会变" is not a variation point. Wait for the second concrete case.

OVERENG-004
Every abstraction layer MUST name the change it absorbs.

OVERENG-005
When two compositions solve the problem, the one with lower total cognitive cost
MUST be preferred.

OVERENG-006
The proposed composition MUST itself be audited for anti-patterns before it is
recommended.

${ANTI_PATTERN_RULES.map((rule) => `${rule.id}\n${rule.text}`).join('\n\n')}`
  },
  {
    file: 'anti-pattern',
    title: 'Anti-Pattern Catalog',
    body: `## Purpose

Name what has gone wrong, with evidence, and say how to resolve it.

Detection MUST distinguish:

- **observed** — the project demonstrably does this
- **predicted** — the composition we are about to recommend would cause this

Accusing a codebase of an anti-pattern without evidence is itself a defect.

## Catalog

${ANTI_PATTERN_CATALOG.map((entry) =>
  `### ${entry.name}\n\n- 违反：${entry.rule}\n- 表现：${entry.description}\n- 处理：${entry.remediation}`
).join('\n\n')}`
  }
];

/** Stage skills, in execution order. */
const STAGE_SKILLS = [
  {
    id: 'frontend-pattern-gate',
    title: 'Frontend Pattern Gate',
    purpose: 'Decide whether the frontend design-pattern system may run at all.',
    rules: ['pattern-gate'],
    steps: [
      'Run `aafe pattern gate "<request>"`.',
      'disabled → stop. Handle the task as ordinary development work.',
      'ambiguous → ask the user whether they want design-pattern analysis. Do not activate silently.',
      'enabled → record the decision and continue to Discovery, not to Selection.'
    ],
    output: ['PatternGateDecision { enabled, decision, scope, requestedCapabilities, signals }']
  },
  {
    id: 'frontend-pattern-discovery',
    title: 'Frontend Pattern Discovery',
    purpose: 'Identify the architectural and business problems, before any pattern is named.',
    rules: ['pattern-selection'],
    steps: [
      'Analyze module boundaries, component boundaries, state boundaries, data flow, event flow, async flow, dependency graph, rendering flow, API boundaries, business logic, UI logic, infrastructure logic, extension points, variation points and performance bottlenecks.',
      'Describe the actual problems. Do NOT immediately assign design patterns.',
      'Separate problems observed in the codebase from problems inferred from the request wording.',
      'Assess problem complexity; it sets the over-engineering bar for every later step.'
    ],
    output: ['ProblemModel', 'DependencyModel', 'VariationModel', 'DataFlowModel', 'StateModel', 'InteractionModel', 'ArchitectureModel']
  },
  {
    id: 'frontend-pattern-selection',
    title: 'Frontend Pattern Selection',
    purpose: 'Score candidate patterns against the identified problems.',
    rules: ['pattern-selection', 'pattern-overengineering'],
    steps: [
      'For each problem, collect candidate patterns from the relevant domains.',
      'Score every candidate with the formula in `rules/pattern-selection.md`.',
      'Select only candidates that answer an identified problem and score positively.',
      'Record rejected candidates and why; the reasoning matters more than the shortlist.',
      'Selecting nothing is a valid result (PATTERN-SYSTEM-002).'
    ],
    output: ['PatternCandidate[]', 'SelectedPattern[]', 'RejectedPattern[]', 'Reasons[]']
  },
  {
    id: 'frontend-pattern-composition',
    title: 'Frontend Pattern Composition',
    purpose: 'Compose the selected patterns into a coherent architecture.',
    rules: ['pattern-composition', 'pattern-boundary'],
    steps: [
      'Assign every pattern an explicit responsibility and boundary.',
      'Pull in required collaborators: a pattern missing its dependency is an incomplete design.',
      'Detect conflicts — two patterns claiming the same responsibility — and resolve them explicitly.',
      'Detect redundancy — interchangeable alternatives to the same problem — and drop the weaker one.',
      'Draw the composition graph: relations, flows, lifecycle and failure behavior.',
      'Report total complexity. Pattern count is not a quality metric (RULE-012).'
    ],
    output: ['PatternComposition { patterns, relations, responsibilities, boundaries, flows, conflicts, redundantPatterns, rationale }']
  },
  {
    id: 'frontend-pattern-validation',
    title: 'Frontend Pattern Validation',
    purpose: 'Check the composition against the problems it claims to solve.',
    rules: ['pattern-composition', 'pattern-overengineering'],
    steps: [
      'Every selected pattern MUST trace back to an identified problem.',
      'Every identified problem MUST be either answered by a pattern or explicitly left to direct implementation.',
      'Run the anti-pattern audit against the composition itself, not only against the project.',
      'Confirm the composition is the minimum sufficient one (RULE-011).'
    ],
    output: ['PatternValidation { answered, unanswered, antiPatterns, verdict }']
  },
  {
    id: 'frontend-pattern-anti-pattern',
    title: 'Frontend Anti-Pattern Detection',
    purpose: 'Identify anti-patterns in the project and in the proposed composition.',
    rules: ['anti-pattern', 'pattern-overengineering'],
    steps: [
      'Match the project against the anti-pattern catalog. Findings need evidence.',
      'Audit the proposed composition for Pattern Overuse and Premature Abstraction.',
      'Report severity: project evidence outranks a passing mention in the request.',
      'Every finding MUST carry a remediation direction.'
    ],
    output: ['AntiPatternFinding[] { id, rule, kind, severity, description, remediation, evidence }']
  },
  {
    id: 'ddd-pattern-bridge',
    title: 'DDD ↔ Pattern Bridge',
    purpose: 'Map DDD building blocks onto pattern roles (§15).',
    rules: ['pattern-boundary'],
    steps: [
      'Bounded Context → module / feature boundary (Feature Module, Public API).',
      'Aggregate → State Machine, Command, Repository.',
      'Domain Service → Strategy, Specification.',
      'Domain Event → Domain Event, Observer, Pub/Sub.',
      'Application Service → Facade, Mediator.',
      'These are candidates, not conclusions: a Domain Service becomes a Strategy only when something actually varies.',
      'DDD 决定业务模型和边界，设计模式负责解决这些边界内部的变化、协作、状态、创建、通信、数据访问和性能问题。'
    ],
    output: ['DDDPatternBridge[] { dddBlock, name, candidatePatterns, role, note }']
  }
];

/**
 * @param {string} [agentPrefix]
 * @returns {Record<string,string>} path → contents
 */
export function patternRuntimeFiles(agentPrefix = AGENT_PREFIX) {
  const base = `${agentPrefix}/${PACK}`;
  const files = { [`${base}/SKILL.md`]: entrySkill(agentPrefix) };

  for (const rule of CORE_RULES) {
    files[`${base}/rules/${rule.file}.md`] = `# ${rule.title}\n\n${rule.body}\n`;
  }

  // One rule file and one skill per pattern domain, both generated from the
  // catalog so the pack and the engine cannot disagree.
  for (const domain of PATTERN_DOMAINS) {
    files[`${base}/rules/${domain.id}-rules.md`] = domainRuleDoc(domain);
    files[`${base}/skills/${domain.id}/SKILL.md`] = domainSkillDoc(domain, agentPrefix);
  }

  for (const skill of STAGE_SKILLS) {
    files[`${base}/skills/${skill.id}/SKILL.md`] = stageSkillDoc(skill, agentPrefix);
  }

  for (const [name, schema] of Object.entries(schemas())) {
    files[`${base}/schemas/${name}.schema.json`] = `${JSON.stringify(schema, null, 2)}\n`;
  }

  for (const [name, contents] of Object.entries(references())) {
    files[`${base}/references/${name}.md`] = contents;
  }

  return files;
}

/** Paths `aafe doctor` should find once the pack is installed. */
export function patternRuntimePaths(agentPrefix = AGENT_PREFIX) {
  return Object.keys(patternRuntimeFiles(agentPrefix));
}

/**
 * Editor pointer rule. Short on purpose: a long rule full of pattern names is
 * itself an activation hazard, which is the mistake this system exists to fix.
 */
export function patternPointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? AGENT_PREFIX;
  const globs = ctx.globs ? `globs: ${ctx.globs}\n` : '';
  return `---
description: 前端设计模式是显式启用能力；只有用户明确表达设计模式诉求时才加载模式规则与技能，代码里出现 factory/adapter/observer/strategy 等一律不算触发。
alwaysApply: true
${globs}---

# AAFE 前端设计模式门禁（Pointer）

Source of truth:

1. Gate rule: \`${agentPrefix}/${PACK}/rules/pattern-gate.md\`
2. Composition rule: \`${agentPrefix}/${PACK}/rules/pattern-composition.md\`
3. Pack entry: \`${agentPrefix}/${PACK}/SKILL.md\`

**Design patterns are opt-in.** 在用户明确表达设计模式意图之前，不要读取
\`${agentPrefix}/${PACK}/\` 下的任何其他文件。

- 判定：\`aafe pattern gate "<request>"\` → enabled / disabled / ambiguous
- disabled → 按普通任务处理，不做模式识别、选型与组合
- ambiguous → 先问用户是否要按设计模式做，不要静默启用
- enabled → 先 \`aafe pattern discover\` 识别问题，再 \`aafe pattern select\` 出组合

最高优先级：**PATTERN-SYSTEM-001**，一个项目不是"选一个设计模式"，而是针对问题选出
最小充分的模式组合；**PATTERN-SYSTEM-002**，不用设计模式不是缺陷。

Do not duplicate project knowledge here.
`;
}

function entrySkill(agentPrefix) {
  const base = `${agentPrefix}/${PACK}`;
  return `---
name: frontend-engineering
description: 前端设计模式工程体系。显式启用；先识别问题，再选出最小充分的模式组合。
---

# Frontend Architecture & Design Pattern System

> 设计模式是可组合能力，不是项目架构。

## 第一原则

**PATTERN-SYSTEM-001**：一个前端项目不能通过"选定一个设计模式并全局套用"来设计。
必须先识别问题与变化点，再为每个问题选出承担明确职责的模式，并检查组合的冲突、
冗余与总复杂度。

**PATTERN-SYSTEM-002**：没有用设计模式不是缺陷。只有当具体问题、变化点、架构边界
或可度量的约束成立时，才引入模式。

## 执行顺序

\`\`\`text
User Request
   ↓
Pattern Gate ──── disabled ──→ 不加载任何 Pattern Skill
   ↓ enabled
Pattern Discovery      识别问题，不点名模式
   ↓
Pattern Selection      评分候选
   ↓
Pattern Composition    组合、冲突、冗余、最小充分
   ↓
Anti-Pattern Audit     审计项目，也审计我们自己的建议
   ↓
Validation
\`\`\`

## 加载顺序

1. \`${base}/rules/pattern-gate.md\` — 只有它可以在启用判定前读取
2. \`${base}/rules/pattern-composition.md\`
3. \`${base}/rules/pattern-selection.md\`
4. \`${base}/rules/pattern-boundary.md\`、\`pattern-overengineering.md\`、\`anti-pattern.md\`
5. 命中的模式域规则：\`${base}/rules/<domain>-rules.md\`

不要预读全部规则。命中哪个域读哪个。

## 16 个模式域

${PATTERN_DOMAINS.map((domain) => `- \`${domain.id}\` ${domain.name}（${domain.patterns.length} 个模式，${domain.rules.length} 条规则）`).join('\n')}

## 与 DDD 的关系

DDD 决定业务模型和边界，设计模式负责解决这些边界内部的具体变化、协作、状态、创建、
通信、数据访问和性能问题。映射见 \`${base}/skills/ddd-pattern-bridge/SKILL.md\`。

## 命令

\`\`\`bash
aafe pattern gate "<request>"      # 是否启用
aafe pattern discover "<request>"  # 只识别问题
aafe pattern select "<request>"    # 评分 + 组合
aafe pattern audit "<request>"     # 反模式审计
aafe pattern catalog               # 模式目录
\`\`\`
`;
}

function domainRuleDoc(domain) {
  return `# ${domain.name}

覆盖 ${domain.patterns.length} 个模式：

${domain.patterns.map((name) => `- ${name}`).join('\n')}

## Rules

${domain.rules.map((rule) => `${rule.id}\n${rule.text}`).join('\n\n')}
`;
}

function domainSkillDoc(domain, agentPrefix) {
  const scorable = PATTERN_INDEX.filter((pattern) => pattern.domain === domain.id);
  return `---
name: ${domain.id}
description: ${domain.name} — 该域的模式选型与约束。仅在 Pattern Gate 启用且问题命中该域时加载。
---

# ${domain.name}

## Prerequisite

只有 \`aafe pattern gate\` 判定为 enabled，且 Discovery 识别出的问题落在本域时才加载。

## Rules

必读：\`${agentPrefix}/${PACK}/rules/${domain.id}-rules.md\`（${domain.rules.length} 条）

## 可评分模式

以下模式带有成本收益模型，可直接进入评分与组合：

${scorable.map((pattern) =>
  `- **${pattern.name}** — ${pattern.problem}\n  - 职责：${pattern.role}\n  - 适用复杂度门槛：${pattern.justifiedAt}/3${pattern.conflictsWith.length ? `\n  - 职责冲突：${pattern.conflictsWith.join(', ')}` : ''}${pattern.requires.length ? `\n  - 必需配套：${pattern.requires.join(', ')}` : ''}`
).join('\n')}

## 完整清单

${domain.patterns.map((name) => `- ${name}`).join('\n')}

## 约束

- 本域模式只解决本域的问题；越界承担其他模式的职责即为 RULE-005 违规。
- 未识别到对应问题时，本域不产出任何模式建议。
`;
}

function stageSkillDoc(skill, agentPrefix) {
  return `---
name: ${skill.id}
description: ${skill.purpose}
---

# ${skill.title}

## Purpose

${skill.purpose}

## Required Rules

${skill.rules.map((rule) => `- \`${agentPrefix}/${PACK}/rules/${rule}.md\``).join('\n')}

## Steps

${skill.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## Output

${skill.output.map((item) => `- ${item}`).join('\n')}
`;
}

function schemas() {
  const evidence = {
    type: 'array',
    description: 'Where this came from. A finding without evidence is a guess.',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['signal', 'problem', 'project', 'catalog-default'] },
        detail: { type: 'string' }
      },
      required: ['kind', 'detail']
    }
  };

  const score = {
    type: 'object',
    description: 'The §13 breakdown. Benefits only count when the problem asks for them.',
    properties: {
      problemFit: { type: 'number' },
      changeIsolation: { type: 'number' },
      complexityReduction: { type: 'number' },
      reusePotential: { type: 'number' },
      performanceBenefit: { type: 'number' },
      implementationCost: { type: 'number' },
      cognitiveCost: { type: 'number' },
      couplingRisk: { type: 'number' },
      overengineeringRisk: { type: 'number' }
    },
    required: ['problemFit', 'overengineeringRisk']
  };

  const domainEnum = PATTERN_DOMAINS.map((domain) => domain.id);

  return {
    pattern: schema('pattern', 'A single design pattern in the catalog', {
      id: { type: 'string' },
      name: { type: 'string' },
      domain: { type: 'string', enum: domainEnum },
      role: { type: 'string', description: 'The responsibility this pattern takes in a composition.' },
      problem: { type: 'string' },
      justifiedAt: { type: 'integer', minimum: 1, maximum: 3, description: 'Minimum problem complexity below which this pattern is over-engineering.' },
      requires: { type: 'array', items: { type: 'string' } },
      conflictsWith: { type: 'array', items: { type: 'string' } },
      alternatives: { type: 'array', items: { type: 'string' } }
    }, ['id', 'name', 'domain', 'role', 'problem']),

    'pattern-candidate': schema('pattern-candidate', 'A scored candidate', {
      id: { type: 'string' },
      name: { type: 'string' },
      domain: { type: 'string', enum: domainEnum },
      score: { type: 'number' },
      breakdown: score,
      problem: { type: 'string' },
      benefit: { type: 'array', items: { type: 'string' } },
      cost: { type: 'array', items: { type: 'string' } },
      risk: { type: 'array', items: { type: 'string' } },
      alternatives: { type: 'array', items: { type: 'string' } },
      evidence
    }, ['id', 'score', 'breakdown', 'problem', 'evidence']),

    'pattern-composition': schema('pattern-composition', 'The composition, §12', {
      name: { type: 'string' },
      problem: { type: 'array', items: { $ref: 'problem.schema.json' } },
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string' },
            responsibility: { type: 'string' },
            score: { type: 'number' }
          },
          required: ['id', 'role', 'responsibility']
        }
      },
      relations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            kind: { type: 'string', enum: ['delegates-to', 'depends-on'] }
          },
          required: ['from', 'to']
        }
      },
      boundaries: { type: 'array', items: { type: 'object' } },
      flows: { type: 'array', items: { type: 'object' } },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            between: { type: 'array', items: { type: 'string' }, minItems: 2 },
            reason: { type: 'string' },
            resolution: { type: 'string' }
          },
          required: ['between', 'reason', 'resolution']
        }
      },
      redundantPatterns: { type: 'array', items: { type: 'object' } },
      rationale: { type: 'array', items: { type: 'string' } },
      complexity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] }
    }, ['name', 'problem', 'patterns', 'relations', 'complexity']),

    problem: schema('problem', 'A problem identified before any pattern is named', {
      id: { type: 'string' },
      kind: { type: 'string' },
      text: { type: 'string' },
      source: { type: 'string', enum: ['request', 'project'] },
      domains: { type: 'array', items: { type: 'string', enum: domainEnum } },
      complexity: { type: 'integer', minimum: 1, maximum: 3 },
      evidence: { type: 'array', items: { type: 'string' } }
    }, ['id', 'kind', 'text', 'source']),

    architecture: schema('architecture', 'Target architecture produced from the composition', {
      style: { type: 'string' },
      layers: { type: 'array', items: { type: 'string' } },
      dependencyDirection: { type: 'array', items: { type: 'string' } },
      modules: { type: 'array', items: { type: 'object' } },
      rationale: { type: 'array', items: { type: 'string' } }
    }, ['style', 'dependencyDirection']),

    'state-model': schema('state-model', 'State ownership and transitions', {
      stores: { type: 'array', items: { type: 'object' } },
      serverState: { type: 'array', items: { type: 'string' } },
      derived: { type: 'array', items: { type: 'string' } },
      machines: { type: 'array', items: { type: 'object' } },
      illegalStates: { type: 'array', items: { type: 'string' } }
    }, []),

    'component-model': schema('component-model', 'Component responsibilities and contracts', {
      components: { type: 'array', items: { type: 'object' } },
      boundaries: { type: 'array', items: { type: 'string' } },
      contracts: { type: 'array', items: { type: 'object' } }
    }, []),

    'data-flow': schema('data-flow', 'Data and event flow across the composition', {
      sources: { type: 'array', items: { type: 'string' } },
      transforms: { type: 'array', items: { type: 'object' } },
      sinks: { type: 'array', items: { type: 'string' } },
      caching: { type: 'array', items: { type: 'object' } }
    }, []),

    'performance-model': schema('performance-model', 'Measured constraints the composition must meet', {
      budgets: { type: 'array', items: { type: 'object' } },
      bottlenecks: { type: 'array', items: { type: 'object' } },
      appliedPatterns: { type: 'array', items: { type: 'string' } },
      measurement: { type: 'string', description: 'How the benefit will be verified. Unmeasured performance work is speculation.' }
    }, ['measurement']),

    'anti-pattern': schema('anti-pattern', 'An anti-pattern finding, §14', {
      id: { type: 'string' },
      name: { type: 'string' },
      rule: { type: 'string', enum: ANTI_PATTERN_RULES.map((rule) => rule.id) },
      kind: { type: 'string', enum: ['observed', 'predicted'] },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      description: { type: 'string' },
      remediation: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } }
    }, ['id', 'rule', 'kind', 'severity', 'description', 'remediation']),

    'pattern-validation': schema('pattern-validation', 'Validation of the composition against the problems', {
      answered: { type: 'array', items: { type: 'string' } },
      unanswered: { type: 'array', items: { type: 'string' } },
      antiPatterns: { type: 'array', items: { $ref: 'anti-pattern.schema.json' } },
      verdict: { type: 'string', enum: ['PASS', 'WARNING', 'FAIL'] }
    }, ['answered', 'unanswered'])
  };
}

function schema(id, title, properties, required) {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `${id}.schema.json`,
    title,
    type: 'object',
    properties,
    required,
    additionalProperties: true
  };
}

function references() {
  return {
    'pattern-catalog': `# Pattern Catalog

${PATTERN_DOMAINS.reduce((total, domain) => total + domain.patterns.length, 0)} patterns across ${PATTERN_DOMAINS.length} domains.

${PATTERN_DOMAINS.map((domain) => `## ${domain.order}. ${domain.name}\n\n${domain.patterns.map((name) => `- ${name}`).join('\n')}`).join('\n\n')}
`,

    'pattern-composition': `# Pattern Composition Reference

## 一个真实业务模块的组合图

\`\`\`text
                    ┌───────────────┐
                    │   Facade      │
                    └───────┬───────┘
                            │
             ┌──────────────┼──────────────┐
             ↓              ↓              ↓
        Command         Strategy        State
             │              │              │
             ↓              ↓              ↓
        Application      Policy        State Machine
             │
             ↓
        Repository
             │
       ┌─────┴─────┐
       ↓           ↓
     Cache       API Adapter
       │           │
       └─────┬─────┘
             ↓
        Async Pipeline
             │
             ↓
       Retry / Timeout
             │
             ↓
        Rendering
             │
       ┌─────┴──────┐
       ↓            ↓
 Virtualization   Memoization
\`\`\`

这是 Skill 应该生成的结果，而不是 "OrderPage → Strategy Pattern"。

## 正确的工作方式

\`\`\`text
业务问题 → 变化点 → 边界
   ↓
State + Command + Strategy + Repository + Adapter + Facade + Event + Async + Cache + Rendering
   ↓
组合架构 → 项目现有代码映射 → 渐进式落地 → Validation
\`\`\`

## 组合检查清单

- 每个模式是否有明确职责？（RULE-003）
- 是否存在职责重叠？（RULE-005 / RULE-009）
- 是否存在冗余模式？（RULE-010）
- 是否是最小充分组合？（RULE-011）
- 模式数量是否被当成质量指标？（RULE-012）
`,

    'frontend-architecture': `# Frontend Architecture Reference

## 三个顶级能力

\`\`\`text
Frontend Engineering
│
├── DDD System            业务模型 / 边界 / 领域行为
├── Design Pattern System 变化隔离 / 协作 / 状态 / 创建 / 数据 / 异步
└── Architecture System   模块边界 / 依赖方向 / 技术架构
\`\`\`

## 组合方式

\`\`\`text
            Frontend Engineering
                   │
     ┌─────────────┼─────────────┐
     ↓             ↓             ↓
    DDD       Architecture    Patterns
     └─────────────┼─────────────┘
                   ↓
          Pattern Composition
                   ↓
           Target Architecture
                   ↓
            Existing Project
                   ↓
              Code Mapping
                   ↓
                Refactor
                   ↓
              Validation
\`\`\`

## DDD → Pattern 映射

| DDD 构造块 | 候选模式 | 承担的职责 |
| --- | --- | --- |
| Bounded Context | Feature Module, Public API | 模块 / 特性边界 |
| Aggregate | State Machine, Command, Repository | 一致性边界内的状态、操作与持久化 |
| Domain Service | Strategy, Specification | 独立于模型变化的业务策略 |
| Domain Event | Domain Event, Observer, Pub/Sub | 跨边界传播业务事实 |
| Application Service | Facade, Mediator | 用例入口与协作编排 |

映射是候选而非结论：Domain Service 只有在确实存在多种策略时才成为 Strategy。
`,

    'anti-patterns': `# Anti-Patterns Reference

${ANTI_PATTERN_RULES.map((rule) => `**${rule.id}** ${rule.text}`).join('\n\n')}

## 目录

| 反模式 | 违反 | 表现 | 处理 |
| --- | --- | --- | --- |
${ANTI_PATTERN_CATALOG.map((entry) => `| ${entry.name} | ${entry.rule} | ${entry.description} | ${entry.remediation} |`).join('\n')}

## 检测原则

- **observed** 与 **predicted** 必须区分：前者是项目确实存在的问题，后者是我们即将
  给出的建议会造成的问题。
- 没有证据的反模式指控本身就是缺陷。
- 对自己提出的组合做审计，是 ANTI-PATTERN-003 / 004 唯一诚实的执行方式。
`
  };
}
