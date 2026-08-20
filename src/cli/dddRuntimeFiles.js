/**
 * The `ddd/` capability pack: one entry SKILL, eight rule files, fifteen skills
 * and fifteen schemas, emitted under `.ai-agent/ddd/`.
 *
 * Written as data plus a small emitter rather than thirty-nine template
 * functions, so the tree stays legible and the ordering constraints
 * (gate first, rules loaded lazily) live in one place.
 */

const AGENT_PREFIX = '.ai-agent';

/** Rule files, in the mandated loading order. */
const RULES = [
  {
    file: 'ddd-gate',
    title: 'DDD Enablement Gate',
    body: `## Purpose

Control whether DDD-specific skills are allowed to execute.

DDD skills MUST NOT be activated merely because the project contains Entity,
Aggregate, Repository, Service, Domain, Model, ValueObject, DomainEvent,
UseCase, Controller, the Repository pattern, Clean Architecture or Hexagonal
Architecture. The existence of these concepts in the target project is NOT
sufficient to activate DDD skills.

## Activation Principle

DDD skills may only be activated when the user's explicit intent requires
Domain-Driven Design. The decision MUST be based primarily on user intent, not
code structure.

## Explicit Activation Signals

使用 DDD、按 DDD 设计、采用领域驱动设计、DDD 设计、DDD 落地、DDD 重构、DDD 优化、
DDD 架构、DDD 建模、DDD 领域建模、DDD 战略设计、DDD 战术设计、Bounded Context 设计、
Aggregate 设计、Domain Model 设计、Domain Event 设计、Context Map 设计、领域模型重构、
领域驱动重构、将当前项目改造成 DDD、按 DDD 最佳实践优化当前项目、建立当前项目的 DDD 模型。

Equivalent English intent MUST also be recognized: Domain-Driven Design, DDD,
domain-driven architecture, DDD architecture, DDD modeling, DDD refactoring,
DDD migration, DDD optimization, bounded context design, aggregate design,
domain model design, domain event design, context mapping.

## Non-Activation Signals

普通代码分析、架构分析、代码重构、性能优化、Bug 修复、API 设计、数据库设计、模块拆分、
微服务拆分、Clean Architecture、Hexagonal Architecture、Repository 模式、Service 层设计、
Entity 设计、TypeScript 类型设计、前端架构、后端架构、测试设计、自动化测试、代码质量分析
— unless the user explicitly connects the task to DDD.

## Keyword Rule

DDD-related keywords alone MUST NOT activate DDD skills.

"帮我分析这个项目的 Repository 层" MUST NOT activate DDD.
"帮我按照 DDD 分析这个项目的 Repository 层" MUST activate DDD.

## Ambiguous Intent

If the request is ambiguous and DDD activation would materially change the
solution, DO NOT silently activate DDD. Ask whether the user wants DDD.

## Activation Scope

Once DDD is explicitly enabled, only the DDD skills required by the current
request SHOULD execute. Do not automatically execute the entire DDD skill chain
unless the user requests 完整 DDD 分析 / 完整 DDD 设计 / DDD 全量落地 /
DDD 全面重构 / end-to-end DDD implementation.

## Termination Rule

If the DDD Gate returns NOT_ENABLED, do not load DDD strategic rules, do not
load DDD tactical rules, do not perform bounded context analysis, do not perform
aggregate analysis, do not generate domain events, do not introduce DDD
architecture, and do not generate DDD migration plans.

## Tooling

\`aafe ddd gate "<request>"\` returns this decision as JSON.`
  },
  {
    file: 'ddd-scope',
    title: 'DDD Scope Rule',
    body: `DDD activation establishes permission to use DDD skills. It does NOT require
executing every DDD skill. The active skill set MUST be determined by the user's
requested outcome.

## Examples

User: "设计 Aggregate"

Activate: ddd-gate, ddd-project-discovery, ddd-domain-discovery,
ddd-tactical-design, ddd-aggregate.

Do NOT automatically activate: ddd-refactoring, ddd-documentation,
ddd-context-map.

User: "分析当前项目并完整落地 DDD"

Activate the full chain: ddd-gate, ddd-project-discovery, ddd-domain-discovery,
ddd-strategic-design, ddd-bounded-context, ddd-context-map, ddd-tactical-design,
ddd-aggregate, ddd-domain-event, ddd-application-design, ddd-architecture,
ddd-code-mapping, ddd-refactoring, ddd-validation, ddd-documentation.

## Principle

Minimum Required Skill Set. Only activate the minimum skills required to satisfy
the user's DDD request.

## Rules Loading Order

1. ddd-gate
2. ddd-scope
3. relevant strategic rules
4. relevant tactical rules
5. relevant architecture rules
6. relevant code rules
7. relevant refactoring rules
8. relevant validation rules

Loading the full DDD rule set before the gate is forbidden.

## Tooling

\`aafe ddd scope "<request>"\` returns the resolved skill set and rule order.`
  },
  {
    file: 'ddd-strategic-rules',
    title: 'DDD Strategic Design Rules',
    body: numbered('R-STRATEGIC', [
      'Domain boundaries MUST be derived from business capabilities and business semantics.',
      'Subdomains MUST be classified as Core, Supporting or Generic.',
      'Bounded Context MUST represent a semantic model boundary.',
      'A code module MUST NOT automatically become a Bounded Context.',
      'A database schema MUST NOT automatically become a Bounded Context.',
      'Same terminology does NOT imply same domain concept.',
      'Different meanings of the same business term MUST be modeled separately when required by context.',
      'Ubiquitous Language MUST be established inside each Bounded Context.',
      'Context Map MUST explicitly describe relationships between Bounded Contexts.',
      'DDD models MUST be supported by evidence from the target project.',
      'The agent MUST distinguish observed facts from inferred domain concepts.',
      'Low-confidence domain concepts MUST be marked as hypotheses rather than facts.'
    ])
  },
  {
    file: 'ddd-tactical-rules',
    title: 'DDD Tactical Design Rules',
    body: numbered('R-TACTICAL', [
      'Entity MUST have meaningful identity and lifecycle continuity.',
      'Value Object SHOULD be used when identity is not required.',
      'Value Objects SHOULD be immutable where practical.',
      'Aggregate MUST define a consistency boundary.',
      'Aggregate MUST protect business invariants.',
      'Aggregate MUST NOT be created merely by grouping related database tables.',
      'Aggregate SHOULD remain as small as business consistency allows.',
      'Aggregate Root MUST control access to internal Aggregate state.',
      'References between Aggregates SHOULD use identity rather than direct object references.',
      'Cross-Aggregate consistency SHOULD NOT automatically require one transaction.',
      'Domain Service SHOULD only exist when domain behavior does not naturally belong to an Entity or Aggregate.',
      'Application Service MUST NOT become a dumping ground for domain rules.',
      'Repository SHOULD represent persistence access for Aggregate Roots.',
      'Repository abstraction SHOULD belong to the Domain boundary when dependency inversion requires it.',
      'Repository implementation MUST remain outside the Domain layer.',
      'Domain Event MUST represent a meaningful business occurrence.',
      'Factories SHOULD only be introduced when object creation contains meaningful domain logic.',
      'Specification SHOULD only be introduced when reusable domain predicates provide meaningful value.',
      'DDD patterns MUST NOT be introduced only to satisfy pattern completeness.'
    ])
  },
  {
    file: 'ddd-architecture-rules',
    title: 'DDD Architecture Rules',
    body: numbered('R-ARCH', [
      'Domain MUST NOT depend on Infrastructure.',
      'Domain MUST NOT depend on Presentation.',
      'Domain MUST NOT depend on Framework-specific infrastructure unless explicitly justified.',
      'Application Layer MAY depend on Domain.',
      'Infrastructure MAY depend on Application and Domain abstractions.',
      'Presentation MUST NOT directly implement Domain business rules.',
      'Controllers MUST NOT contain core domain invariants.',
      'Persistence models SHOULD NOT leak into Domain models.',
      'External API models SHOULD NOT automatically become Domain models.',
      'ORM entities SHOULD NOT automatically become Domain Entities.',
      'Architecture style MUST be selected based on project constraints.',
      'DDD MUST NOT force Microservices.',
      'DDD MUST NOT require Event Sourcing.',
      'DDD MUST NOT require CQRS.',
      'DDD MUST NOT require a specific programming language or framework.'
    ])
  },
  {
    file: 'ddd-code-rules',
    title: 'DDD Code Rules',
    body: numbered('R-CODE', [
      'Business terminology SHOULD be reflected in code naming.',
      'Business rules SHOULD be located close to the domain concept they govern.',
      'Primitive obsession SHOULD be identified when it hides meaningful domain concepts.',
      'Anemic Domain Model SHOULD be reported when domain behavior is systematically externalized without justification.',
      'God Aggregates MUST be reported.',
      'God Domain Services MUST be reported.',
      'Generic Utility classes MUST NOT become dumping grounds for domain behavior.',
      'Infrastructure concerns MUST NOT be mixed with core domain behavior.',
      'Existing code MUST be analyzed before introducing new DDD abstractions.',
      'DDD refactoring MUST preserve existing business behavior unless behavior change is explicitly requested.',
      'DDD migration MUST be incremental when the existing project is large or business-critical.',
      'Every proposed domain concept SHOULD have traceable evidence from code, tests, API, documentation, or user-provided business knowledge.'
    ])
  },
  {
    file: 'ddd-refactoring-rules',
    title: 'DDD Refactoring Rules',
    body: numbered('R-REFACTOR', [
      'DDD refactoring MUST begin with discovery.',
      'DDD refactoring MUST NOT start with directory restructuring.',
      'Business behavior MUST be preserved by default.',
      'Refactoring SHOULD be incremental.',
      'Each migration step MUST have explicit scope.',
      'Each migration step MUST define validation criteria.',
      'Large-scale DDD migration SHOULD establish characterization tests before moving business logic.',
      'A new DDD model MUST be mapped to existing code before deleting legacy structures.',
      'DDD refactoring MUST NOT introduce artificial abstractions.',
      'Legacy compatibility boundaries SHOULD be introduced when immediate migration is unsafe.',
      'Code deletion MUST only happen after replacement behavior is validated.'
    ])
  },
  {
    file: 'ddd-validation-rules',
    title: 'DDD Validation Rules',
    body: `R-VALIDATE-001

DDD validation MUST distinguish Strategic, Tactical, Architecture, Code and
Migration violations.

${numbered('R-VALIDATE', [
      'Every violation MUST include evidence.',
      'Every inferred violation MUST include confidence.',
      'Validation MUST NOT report a violation solely because a preferred DDD pattern is absent.',
      'Absence of Aggregate MUST NOT automatically be considered a defect.',
      'Absence of Domain Service MUST NOT automatically be considered a defect.',
      'Absence of Domain Event MUST NOT automatically be considered a defect.',
      'CRUD-oriented modules MAY legitimately use simpler architecture.',
      'DDD compliance MUST be evaluated against actual business complexity.',
      'Validation MUST identify false-positive risks.'
    ], 2)}`
  }
];

/** Skills, in execution order. */
const SKILLS = [
  {
    id: 'ddd-gate',
    title: 'DDD Gate Skill',
    schema: 'ddd-gate',
    sections: {
      Purpose: 'Determine whether the current user request explicitly requires DDD. This skill MUST execute before every DDD-specific skill.',
      Input: list(['user request', 'current project context', 'previously established task scope']),
      Decision: 'Return exactly one of ENABLED, DISABLED, AMBIGUOUS.',
      ENABLED: `Use when the user explicitly requests DDD-related work.\n\n${list(['"用 DDD 重构这个项目"', '"按照 DDD 设计这个模块"', '"给当前项目做 DDD 建模"', '"建立 Bounded Context"', '"设计 Aggregate"', '"进行领域驱动设计"'])}`,
      DISABLED: `Use when DDD is not explicitly requested.\n\n${list(['"分析这个项目架构"', '"帮我重构这个 Service"', '"分析 Repository"', '"设计微服务架构"', '"优化代码结构"'])}`,
      AMBIGUOUS: 'Use when the request could reasonably mean DDD but does not explicitly establish it, for example "帮我做领域建模". Ask whether the user wants Domain-Driven Design.'
    }
  },
  {
    id: 'ddd-project-discovery',
    title: 'DDD Project Discovery',
    schema: 'project',
    sections: {
      Activation: 'Only execute when DDD Gate = ENABLED.',
      Purpose: 'Understand the existing project before DDD modeling.',
      Analyze: list(['project structure', 'language', 'framework', 'modules', 'packages', 'APIs', 'persistence', 'existing architecture', 'business entry points', 'business workflows', 'tests', 'existing domain abstractions']),
      'Do Not': list(['redesign architecture', 'create aggregates', 'create bounded contexts', 'modify code']),
      Output: list(['ProjectModel', 'ArchitectureModel', 'BusinessCandidateModel', 'DDDReadinessModel'])
    }
  },
  {
    id: 'ddd-domain-discovery',
    title: 'DDD Domain Discovery',
    schema: 'domain',
    sections: {
      Activation: 'DDD Gate MUST be ENABLED.',
      Purpose: 'Discover business concepts from the existing project.',
      Analyze: list(['business verbs', 'business nouns', 'state transitions', 'business rules', 'invariants', 'workflows', 'commands', 'events', 'business terminology', 'external actors']),
      'Evidence Sources': `Priority order:\n\n1. User-provided business knowledge\n2. Existing documentation\n3. Tests\n4. API contracts\n5. Business logic\n6. Code naming\n7. Database structure`,
      Output: list(['Business Concepts', 'Business Rules', 'Business Processes', 'Domain Candidates', 'Evidence', 'Confidence'])
    }
  },
  {
    id: 'ddd-strategic-design',
    title: 'DDD Strategic Design',
    schema: 'subdomain',
    sections: {
      Activation: 'DDD Gate MUST be ENABLED.',
      Responsibilities: list(['identify Domains', 'identify Subdomains', 'classify Core / Supporting / Generic', 'establish Ubiquitous Language', 'identify Bounded Context candidates', 'identify semantic boundaries']),
      Constraints: `Do not derive Bounded Context solely from:\n\n${list(['directory', 'database', 'service', 'package', 'microservice'])}`,
      Output: 'StrategicModel'
    }
  },
  {
    id: 'ddd-bounded-context',
    title: 'DDD Bounded Context',
    schema: 'bounded-context',
    sections: {
      Purpose: 'Define explicit model boundaries.',
      Analyze: list(['language boundaries', 'business responsibility', 'model ownership', 'data ownership', 'business invariants', 'lifecycle', 'team ownership where available', 'integration boundaries']),
      Output: 'BoundedContextModel'
    }
  },
  {
    id: 'ddd-context-map',
    title: 'DDD Context Map',
    schema: 'context-map',
    sections: {
      Purpose: 'Model relationships between Bounded Contexts.',
      'Supported Relationships': list(['Partnership', 'Shared Kernel', 'Customer Supplier', 'Conformist', 'Anti-Corruption Layer', 'Open Host Service', 'Published Language', 'Separate Ways']),
      Output: list(['ContextMapModel', 'IntegrationModel'])
    }
  },
  {
    id: 'ddd-tactical-design',
    title: 'DDD Tactical Design',
    schema: 'entity',
    sections: {
      Purpose: 'Transform strategic domain concepts into tactical domain models.',
      Identify: list(['Entity', 'Value Object', 'Aggregate', 'Aggregate Root', 'Domain Service', 'Domain Event', 'Repository', 'Factory', 'Specification']),
      Rules: 'Use the minimum number of tactical patterns required. Do not introduce patterns merely for structural completeness.',
      Output: 'TacticalModel'
    }
  },
  {
    id: 'ddd-aggregate',
    title: 'DDD Aggregate Design',
    schema: 'aggregate',
    sections: {
      Purpose: 'Define consistency boundaries.',
      Analyze: list(['invariants', 'transaction boundaries', 'lifecycle', 'concurrency', 'consistency requirements', 'command boundaries', 'state transitions']),
      Questions: `1. What must change atomically?\n2. What must remain consistent?\n3. What can become eventually consistent?\n4. What is the Aggregate Root?\n5. Is the Aggregate too large?\n6. Are relationships incorrectly modeled?\n7. Is the Aggregate derived from business behavior or database tables?`,
      Output: 'AggregateModel'
    }
  },
  {
    id: 'ddd-domain-event',
    title: 'DDD Domain Event',
    schema: 'domain-event',
    sections: {
      Purpose: 'Identify business-significant occurrences.',
      Distinguish: list(['Domain Event', 'Application Event', 'Integration Event', 'Technical Event']),
      Rules: 'A Domain Event MUST describe something that happened. It MUST NOT merely represent a command or technical notification.',
      Output: 'DomainEventModel'
    }
  },
  {
    id: 'ddd-application-design',
    title: 'DDD Application Design',
    schema: 'use-case',
    sections: {
      Purpose: 'Define application-level use cases.',
      Identify: list(['Commands', 'Queries', 'Use Cases', 'Application Services', 'Transactions', 'Authorization boundaries', 'Idempotency requirements', 'Orchestration']),
      Rule: 'Application layer coordinates domain behavior. It MUST NOT become the location of core business invariants.',
      Output: 'ApplicationModel'
    }
  },
  {
    id: 'ddd-architecture',
    title: 'DDD Architecture',
    schema: 'architecture',
    sections: {
      Purpose: "Map DDD concepts into the project's actual architecture.",
      Supported: list(['Layered Architecture', 'Hexagonal Architecture', 'Clean Architecture', 'Onion Architecture', 'Modular Monolith', 'Microservices']),
      Rules: 'Do not force a specific architecture. First identify the existing architecture, then determine the minimum architecture changes required by the DDD model.',
      Output: list(['CurrentArchitecture', 'TargetArchitecture', 'ArchitectureGap'])
    }
  },
  {
    id: 'ddd-code-mapping',
    title: 'DDD Code Mapping',
    schema: 'code-mapping',
    sections: {
      Purpose: 'Map the DDD model to the existing implementation.',
      Mapping: '```text\nDomain Concept -> Existing Code -> Current Responsibility -> DDD Gap -> Target Responsibility\n```',
      Output: list(['DomainToCodeMapping', 'CodeToDomainMapping', 'ResponsibilityViolations', 'ArchitectureViolations', 'RefactoringCandidates'])
    }
  },
  {
    id: 'ddd-refactoring',
    title: 'DDD Refactoring',
    schema: 'code-mapping',
    sections: {
      Activation: `Only execute when all of the following hold:\n\n1. DDD is enabled\n2. The user requests implementation / migration / refactoring\n3. Code mapping is available`,
      Workflow: '```text\nDiscovery -> DDD Model -> Code Mapping -> Migration Plan -> Implementation -> Validation\n```',
      Rules: 'Never directly perform large-scale DDD restructuring without an intermediate migration plan.'
    }
  },
  {
    id: 'ddd-validation',
    title: 'DDD Validation',
    schema: 'validation',
    sections: {
      Purpose: 'Validate the DDD implementation.',
      Validate: list(['Strategic', 'Tactical', 'Architecture', 'Code', 'Dependency', 'Business Rules', 'Aggregate', 'Bounded Context', 'Integration']),
      Output: '```json\n{\n  "status": "PASS|WARNING|FAIL",\n  "violations": [],\n  "warnings": [],\n  "evidence": [],\n  "confidence": 0\n}\n```'
    }
  },
  {
    id: 'ddd-documentation',
    title: 'DDD Documentation',
    schema: 'validation',
    sections: {
      Purpose: 'Persist the DDD model as project knowledge.',
      Generate: list(['Domain Model', 'Subdomains', 'Bounded Contexts', 'Context Map', 'Ubiquitous Language', 'Aggregates', 'Domain Events', 'Use Cases', 'Architecture', 'Code Mapping', 'Migration Plan', 'Validation Report']),
      Rule: 'Documentation MUST be derived from the current validated model. Do not generate independent documentation that can diverge from the DDD model.'
    }
  }
];

/** The twenty system-level constraints, reproduced for the entry SKILL. */
const SYSTEM_CONSTRAINTS = [
  'DDD is opt-in, not opt-out.',
  'Explicit user intent is required to activate DDD.',
  'DDD terminology in the project MUST NOT activate DDD.',
  'Architecture analysis MUST NOT automatically become DDD analysis.',
  "DDD activation MUST be scoped to the user's requested capability.",
  'DDD patterns MUST NOT be introduced without domain justification.',
  'Existing project evidence MUST be collected before DDD modeling.',
  'Observed facts and inferred models MUST be distinguished.',
  'Strategic design MUST precede tactical design when performing full DDD design.',
  'Bounded Context MUST be based on semantic boundaries.',
  'Aggregate MUST be based on consistency boundaries.',
  'Business rules MUST remain close to the domain model.',
  'DDD MUST NOT force a specific architecture.',
  'DDD MUST NOT force Microservices, CQRS, Event Sourcing, or Domain Events.',
  'DDD refactoring MUST preserve existing behavior by default.',
  'DDD migration MUST be incremental for existing systems.',
  'Every major DDD decision MUST be traceable to evidence.',
  'DDD validation MUST detect both violations and false positives.',
  'DDD documentation MUST be generated from the validated model.',
  'If DDD is not explicitly requested, DDD skills MUST NOT execute.'
];

/**
 * @returns {Record<string, string>} Relative path -> file contents.
 */
export function dddRuntimeFiles(agentPrefix = AGENT_PREFIX) {
  const files = { [`${agentPrefix}/ddd/SKILL.md`]: entrySkill(agentPrefix) };

  for (const rule of RULES) {
    files[`${agentPrefix}/ddd/rules/${rule.file}.md`] = `# ${rule.title}\n\n${rule.body}\n`;
  }

  for (const skill of SKILLS) {
    files[`${agentPrefix}/ddd/skills/${skill.id}/SKILL.md`] = skillDoc(skill, agentPrefix);
  }

  for (const [name, schema] of Object.entries(schemas())) {
    files[`${agentPrefix}/ddd/schemas/${name}.schema.json`] = `${JSON.stringify(schema, null, 2)}\n`;
  }

  return files;
}

/** Paths `aafe doctor` should find once the pack is installed. */
export function dddRuntimePaths(agentPrefix = AGENT_PREFIX) {
  return Object.keys(dddRuntimeFiles(agentPrefix));
}

/**
 * Editor pointer rule. Deliberately short and `alwaysApply`, because its whole
 * job is to stop the agent from reading the rest of the pack: a long rule full
 * of DDD vocabulary is itself an activation hazard.
 */
export function dddPointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? AGENT_PREFIX;
  const globs = ctx.globs ? `globs: ${ctx.globs}\n` : '';
  return `---
description: DDD 是显式启用能力；只有用户明确要求领域驱动设计时才加载 DDD 规则与技能，代码里出现 Entity/Repository/Aggregate 等术语一律不算触发。
alwaysApply: true
${globs}---

# AAFE DDD 启用门禁（Pointer）

Source of truth:

1. Gate rule: \`${agentPrefix}/ddd/rules/ddd-gate.md\`
2. Scope rule: \`${agentPrefix}/ddd/rules/ddd-scope.md\`
3. Pack entry: \`${agentPrefix}/ddd/SKILL.md\`

**DDD is opt-in.** 在用户明确表达 DDD 意图之前，不要读取 \`${agentPrefix}/ddd/\` 下的任何其他文件。

- 判定：\`aafe ddd gate "<request>"\` → enabled / disabled / ambiguous
- disabled → 按普通任务处理，不做限界上下文、聚合、领域事件分析
- ambiguous → 先问用户是否要按 DDD 做，不要静默启用
- enabled → \`aafe ddd scope "<request>"\` 取最小技能集与规则加载顺序，只加载命中的部分

Do not duplicate project knowledge here.
`;
}

function entrySkill(agentPrefix) {
  return `# DDD Skill System

Domain-Driven Design capability pack. **DDD is opt-in.** Nothing in this
directory may run until the gate says the user explicitly asked for DDD.

## Entry Point

\`\`\`text
User Request -> DDD Gate -> DISABLED ? STOP
                         -> ENABLED  -> Scope -> Load Rules -> Execute Skills -> Validate
\`\`\`

The gate is not an ordinary skill; it is the entry controller for this pack.
Read \`${agentPrefix}/ddd/rules/ddd-gate.md\` before anything else here.

## Rules Loading Order

${RULES.map((rule, index) => `${index + 1}. \`rules/${rule.file}.md\``).join('\n')}

Rules 3-8 load only when a selected skill needs them. Loading the full rule set
before the gate is forbidden: it is what causes ordinary tasks to drift into DDD
because a skill description mentioned Domain, Entity, Aggregate or Repository.

## Skills

${SKILLS.map((skill) => `- \`skills/${skill.id}/SKILL.md\` — ${firstSentence(skill.sections.Purpose ?? skill.sections.Decision ?? skill.title)}`).join('\n')}

## Dispatch Matrix

| 用户意图 | Gate | Discovery | Strategic | Context | Tactical | Aggregate | Application | Architecture | Mapping | Refactor | Validate |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 普通开发 | - | - | - | - | - | - | - | - | - | - | - |
| 普通架构分析 | - | - | - | - | - | - | - | - | - | - | - |
| DDD 分析 | Y | Y | Y | Y | Y | opt | opt | Y | Y | - | opt |
| DDD 战略设计 | Y | Y | Y | Y | - | - | - | - | - | - | - |
| Aggregate 设计 | Y | Y | - | - | Y | Y | - | - | - | - | opt |
| DDD 架构设计 | Y | Y | Y | Y | Y | opt | Y | Y | - | - | opt |
| DDD 重构 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| DDD 完整落地 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| DDD 验证 | Y | Y | opt | opt | Y | Y | Y | Y | Y | - | Y |

## Tooling

\`\`\`bash
aafe ddd gate "<request>"      # enabled | disabled | ambiguous, with reasons
aafe ddd scope "<request>"     # minimum skill set + rule loading order
aafe ddd analyze "<request>"   # domain model, each concept observed or inferred
aafe ddd ask "<request>"       # discovery questions
\`\`\`

The \`domain-feature\` pipeline runs this chain end to end and is only reachable
when the gate passes.

## Core Constraints

${SYSTEM_CONSTRAINTS.map((text, index) => `- **DDD-SYSTEM-${String(index + 1).padStart(3, '0')}** ${text}`).join('\n')}

The load-bearing ones are 001, 002, 003 and 005: DDD is an explicitly enabled
capability, not a code-feature-triggered one.
`;
}

function skillDoc(skill, agentPrefix) {
  const sections = Object.entries(skill.sections)
    .map(([heading, body]) => `## ${heading}\n\n${body}`)
    .join('\n\n');
  return `# ${skill.title}

${sections}

## Schema

\`${agentPrefix}/ddd/schemas/${skill.schema}.schema.json\`
`;
}

function schemas() {
  const evidence = {
    type: 'array',
    description: 'Traceable support for this claim. Empty means the concept is inferred.',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['source', 'test', 'doc', 'api', 'database', 'user'] },
        file: { type: 'string' },
        id: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['type']
    }
  };
  const confidence = { type: 'number', minimum: 0, maximum: 1 };
  const kind = { type: 'string', enum: ['observed', 'inferred'] };

  // Every domain concept carries the same provenance triple, because
  // DDD-SYSTEM-008 makes "where did this come from" part of the model itself.
  const concept = (extra = {}, required = []) => ({
    type: 'object',
    properties: { name: { type: 'string' }, kind, confidence, rationale: { type: 'string' }, evidence, ...extra },
    required: ['name', 'kind', 'confidence', ...required]
  });
  const conceptList = (extra, required) => ({ type: 'array', items: concept(extra, required) });
  const schema = (id, title, properties, required) => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://aafe.dev/ddd/${id}.schema.json`,
    title,
    type: 'object',
    properties,
    required
  });

  return {
    'ddd-gate': schema('ddd-gate', 'DDD Gate Decision', {
      enabled: { type: 'boolean' },
      decision: { type: 'string', enum: ['enabled', 'disabled', 'ambiguous'] },
      reason: { type: 'string' },
      scope: { type: 'string', enum: ['full', 'partial', 'none'] },
      requestedCapabilities: { type: 'array', items: { type: 'string' } },
      clarification: { type: ['string', 'null'] }
    }, ['enabled', 'decision', 'reason', 'scope', 'requestedCapabilities']),

    project: schema('project', 'Project Model', {
      language: { type: 'array', items: { type: 'string' } },
      frameworks: { type: 'array', items: { type: 'string' } },
      modules: { type: 'array', items: { type: 'string' } },
      entryPoints: { type: 'array', items: { type: 'string' } },
      persistence: { type: 'array', items: { type: 'string' } },
      existingArchitecture: { type: 'string' },
      dddReadiness: { type: 'string', enum: ['none', 'partial', 'established'] },
      evidence
    }, ['modules', 'dddReadiness']),

    domain: schema('domain', 'Domain Discovery Model', {
      ubiquitousLanguage: conceptList(),
      businessRules: conceptList(),
      businessProcesses: conceptList(),
      domainCandidates: conceptList(),
      observedCount: { type: 'integer', minimum: 0 },
      inferredCount: { type: 'integer', minimum: 0 }
    }, ['ubiquitousLanguage', 'domainCandidates']),

    subdomain: schema('subdomain', 'Subdomain Model', {
      subdomains: conceptList({
        classification: { type: 'string', enum: ['core', 'supporting', 'generic', 'core-candidate', 'unclassified'] }
      }, ['classification'])
    }, ['subdomains']),

    'bounded-context': schema('bounded-context', 'Bounded Context Model', {
      contexts: conceptList({
        responsibility: { type: 'string' },
        ownedData: { type: 'array', items: { type: 'string' } },
        modules: { type: 'array', items: { type: 'string' } },
        ubiquitousLanguage: { type: 'array', items: { type: 'string' } }
      })
    }, ['contexts']),

    'context-map': schema('context-map', 'Context Map Model', {
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            upstream: { type: 'string' },
            downstream: { type: 'string' },
            type: {
              type: 'string',
              enum: ['partnership', 'shared-kernel', 'customer-supplier', 'conformist', 'anti-corruption-layer', 'open-host-service', 'published-language', 'separate-ways']
            },
            kind, confidence, evidence
          },
          required: ['upstream', 'downstream', 'type']
        }
      }
    }, ['relationships']),

    aggregate: schema('aggregate', 'Aggregate Model', {
      aggregates: conceptList({
        root: { type: 'string' },
        invariants: { type: 'array', items: { type: 'string' } },
        members: { type: 'array', items: { type: 'string' } },
        transactionBoundary: { type: 'string' },
        eventualConsistency: { type: 'array', items: { type: 'string' } }
      })
    }, ['aggregates']),

    entity: schema('entity', 'Entity Model', {
      entities: conceptList({
        identity: { type: 'string' },
        lifecycle: { type: 'string' },
        aggregate: { type: 'string' }
      })
    }, ['entities']),

    'value-object': schema('value-object', 'Value Object Model', {
      valueObjects: conceptList({
        attributes: { type: 'array', items: { type: 'string' } },
        immutable: { type: 'boolean' },
        replaces: { type: 'string', description: 'Primitive this value object removes obsession over.' }
      })
    }, ['valueObjects']),

    'domain-service': schema('domain-service', 'Domain Service Model', {
      domainServices: conceptList({
        justification: { type: 'string', description: 'Why this behaviour belongs to no single entity or aggregate.' },
        operations: { type: 'array', items: { type: 'string' } }
      }, ['justification'])
    }, ['domainServices']),

    'domain-event': schema('domain-event', 'Domain Event Model', {
      domainEvents: conceptList({
        category: { type: 'string', enum: ['domain', 'application', 'integration', 'technical'] },
        occurredWhen: { type: 'string' },
        payload: { type: 'array', items: { type: 'string' } }
      }, ['category'])
    }, ['domainEvents']),

    'use-case': schema('use-case', 'Application Model', {
      useCases: conceptList({
        type: { type: 'string', enum: ['command', 'query'] },
        aggregate: { type: 'string' },
        transactional: { type: 'boolean' },
        idempotent: { type: 'boolean' },
        authorization: { type: 'string' }
      }, ['type'])
    }, ['useCases']),

    architecture: schema('architecture', 'Architecture Model', {
      current: { type: 'string' },
      target: {
        type: 'string',
        enum: ['layered', 'hexagonal', 'clean', 'onion', 'modular-monolith', 'microservices', 'unchanged']
      },
      gap: {
        type: 'array',
        items: {
          type: 'object',
          properties: { change: { type: 'string' }, rationale: { type: 'string' }, required: { type: 'boolean' } },
          required: ['change', 'rationale']
        }
      },
      boundaries: { type: 'array', items: { type: 'string' } }
    }, ['current', 'target', 'gap']),

    'code-mapping': schema('code-mapping', 'Code Mapping Model', {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            concept: { type: 'string' },
            file: { type: 'string' },
            currentResponsibility: { type: 'string' },
            gap: { type: 'string' },
            targetResponsibility: { type: 'string' },
            confidence, evidence
          },
          required: ['concept']
        }
      },
      refactoringCandidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            step: { type: 'string' },
            scope: { type: 'string' },
            validation: { type: 'string' },
            behaviourPreserving: { type: 'boolean' }
          },
          required: ['step', 'scope', 'validation']
        }
      }
    }, ['mappings']),

    validation: schema('validation', 'Validation Report', {
      status: { type: 'string', enum: ['PASS', 'WARNING', 'FAIL'] },
      violations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule: { type: 'string', description: 'Rule id, e.g. R-TACTICAL-004.' },
            category: { type: 'string', enum: ['strategic', 'tactical', 'architecture', 'code', 'migration'] },
            message: { type: 'string' },
            confidence, evidence,
            // R-VALIDATE-010: a report that cannot be wrong is not a report.
            falsePositiveRisk: { type: 'string', enum: ['low', 'medium', 'high'] }
          },
          required: ['rule', 'category', 'message', 'evidence']
        }
      },
      warnings: { type: 'array', items: { type: 'string' } },
      confidence
    }, ['status', 'violations', 'confidence'])
  };
}

function numbered(prefix, items, startAt = 1) {
  return items
    .map((text, index) => `${prefix}-${String(index + startAt).padStart(3, '0')}\n\n${text}`)
    .join('\n\n');
}

function list(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function firstSentence(text) {
  return String(text).split(/(?<=\.)\s/)[0];
}
