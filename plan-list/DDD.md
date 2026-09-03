可以。这里需要把 **DDD Enablement Gate（DDD 启用门禁）** 放在整个 DDD SKILLS 最前面，作为唯一入口。

核心原则：

> **任何普通开发任务、代码分析、重构、架构分析，都不能因为发现 Entity / Service / Repository / Domain 等关键词而自动触发 DDD SKILLS。只有用户明确要求“使用 DDD / 按 DDD 设计 / DDD 重构 / DDD 优化 / DDD 落地”等意图时，才允许进入后续 DDD Skills。**

下面给出可以直接落地的完整 `Rules + SKILLS` 设计。

---

# 一、最终目录结构

```text
ddd/
├── SKILL.md
│
├── rules/
│   ├── ddd-gate.md
│   ├── ddd-scope.md
│   ├── ddd-strategic-rules.md
│   ├── ddd-tactical-rules.md
│   ├── ddd-architecture-rules.md
│   ├── ddd-code-rules.md
│   ├── ddd-refactoring-rules.md
│   └── ddd-validation-rules.md
│
├── skills/
│   ├── ddd-gate/
│   │   └── SKILL.md
│   ├── ddd-project-discovery/
│   │   └── SKILL.md
│   ├── ddd-domain-discovery/
│   │   └── SKILL.md
│   ├── ddd-strategic-design/
│   │   └── SKILL.md
│   ├── ddd-bounded-context/
│   │   └── SKILL.md
│   ├── ddd-context-map/
│   │   └── SKILL.md
│   ├── ddd-tactical-design/
│   │   └── SKILL.md
│   ├── ddd-aggregate/
│   │   └── SKILL.md
│   ├── ddd-domain-event/
│   │   └── SKILL.md
│   ├── ddd-application-design/
│   │   └── SKILL.md
│   ├── ddd-architecture/
│   │   └── SKILL.md
│   ├── ddd-code-mapping/
│   │   └── SKILL.md
│   ├── ddd-refactoring/
│   │   └── SKILL.md
│   ├── ddd-validation/
│   │   └── SKILL.md
│   └── ddd-documentation/
│       └── SKILL.md
│
└── schemas/
    ├── ddd-gate.schema.json
    ├── project.schema.json
    ├── domain.schema.json
    ├── subdomain.schema.json
    ├── bounded-context.schema.json
    ├── context-map.schema.json
    ├── aggregate.schema.json
    ├── entity.schema.json
    ├── value-object.schema.json
    ├── domain-service.schema.json
    ├── domain-event.schema.json
    ├── use-case.schema.json
    ├── architecture.schema.json
    ├── code-mapping.schema.json
    └── validation.schema.json
```

---

# 二、最高优先级：DDD Gate Rule

整个系统必须遵循：

```text
User Request
     │
     ▼
DDD Gate
     │
     ├── NOT_ENABLED ──────► STOP
     │
     └── ENABLED
            │
            ▼
       DDD Skills
```

也就是说：

**DDD Gate 不是普通 Skill，而是 DDD Skill System 的入口控制器。**

---

# 三、DDD Enablement Rule

`rules/ddd-gate.md`

```text
# DDD Enablement Gate

## Purpose

Control whether DDD-specific skills are allowed to execute.

DDD skills MUST NOT be activated merely because the project contains:
- Entity
- Aggregate
- Repository
- Service
- Domain
- Model
- ValueObject
- DomainEvent
- UseCase
- Controller
- Repository pattern
- Clean Architecture
- Hexagonal Architecture

The existence of these concepts in the target project is NOT sufficient to activate DDD skills.

---

## Activation Principle

DDD skills may only be activated when the user's explicit intent requires Domain-Driven Design.

The activation decision MUST be based primarily on user intent, not code structure.

---

## Explicit Activation Signals

DDD skills SHOULD be activated when the user explicitly requests one or more of:

- 使用 DDD
- 按 DDD 设计
- 采用领域驱动设计
- DDD 设计
- DDD 落地
- DDD 重构
- DDD 优化
- DDD 架构
- DDD 建模
- DDD 领域建模
- DDD 战略设计
- DDD 战术设计
- Bounded Context 设计
- Aggregate 设计
- Domain Model 设计
- Domain Event 设计
- Context Map 设计
- 领域模型重构
- 领域驱动重构
- 将当前项目改造成 DDD
- 按 DDD 最佳实践优化当前项目
- 建立当前项目的 DDD 模型

Equivalent English intent MUST also be recognized:

- Domain-Driven Design
- DDD
- domain-driven architecture
- DDD architecture
- DDD modeling
- DDD refactoring
- DDD migration
- DDD optimization
- bounded context design
- aggregate design
- domain model design
- domain event design
- context mapping

---

## Non-Activation Signals

DDD skills MUST NOT be activated when the user only requests:

- 普通代码分析
- 架构分析
- 代码重构
- 性能优化
- Bug 修复
- API 设计
- 数据库设计
- 模块拆分
- 微服务拆分
- Clean Architecture
- Hexagonal Architecture
- Repository 模式
- Service 层设计
- Entity 设计
- TypeScript 类型设计
- 前端架构
- 后端架构
- 测试设计
- 自动化测试
- 代码质量分析

unless the user explicitly connects the task to DDD.

---

## Keyword Rule

DDD-related keywords alone MUST NOT activate DDD skills.

For example:

"帮我分析这个项目的 Repository 层"

MUST NOT activate DDD.

"帮我按照 DDD 分析这个项目的 Repository 层"

MUST activate DDD.

---

## Ambiguous Intent

If the request is ambiguous and DDD activation would materially change the solution:

DO NOT silently activate DDD.

Ask whether the user wants DDD.

---

## Activation Scope

Once DDD is explicitly enabled:

Only the DDD skills required by the current request SHOULD execute.

Do not automatically execute the entire DDD skill chain unless the user requests:
- 完整 DDD 分析
- 完整 DDD 设计
- DDD 全量落地
- DDD 全面重构
- end-to-end DDD implementation

---

## Termination Rule

If DDD Gate returns NOT_ENABLED:

- Do not load DDD strategic rules.
- Do not load DDD tactical rules.
- Do not perform bounded context analysis.
- Do not perform aggregate analysis.
- Do not generate domain events.
- Do not introduce DDD architecture.
- Do not generate DDD migration plans.
```

---

# 四、DDD Gate Skill

`skills/ddd-gate/SKILL.md`

```text
# DDD Gate Skill

## Purpose

Determine whether the current user request explicitly requires DDD.

This skill MUST execute before every DDD-specific skill.

---

## Input

- user request
- current project context
- previously established task scope

---

## Decision

Return exactly one of:

ENABLED
DISABLED
AMBIGUOUS

---

## ENABLED

Use when the user explicitly requests DDD-related work.

Examples:

- "用 DDD 重构这个项目"
- "按照 DDD 设计这个模块"
- "给当前项目做 DDD 建模"
- "建立 Bounded Context"
- "设计 Aggregate"
- "进行领域驱动设计"

---

## DISABLED

Use when DDD is not explicitly requested.

Examples:

- "分析这个项目架构"
- "帮我重构这个 Service"
- "分析 Repository"
- "设计微服务架构"
- "优化代码结构"

---

## AMBIGUOUS

Use when the request could reasonably mean DDD but does not explicitly establish it.

Example:

"帮我做领域建模"

In this case ask whether the user wants Domain-Driven Design.

---

## Output

{
  "enabled": true,
  "reason": "...",
  "scope": "full|partial",
  "requestedCapabilities": []
}

If disabled:

{
  "enabled": false,
  "reason": "...",
  "scope": "none",
  "requestedCapabilities": []
}
```

---

# 五、DDD Scope Rule

这里还需要增加一个非常重要的 Rule：

> **命中 DDD ≠ 所有 DDD Skills 全部执行。**

`rules/ddd-scope.md`

```text
# DDD Scope Rule

DDD activation establishes permission to use DDD skills.

It does NOT require executing every DDD skill.

The active skill set MUST be determined by the user's requested outcome.

---

## Examples

User:
"设计 Aggregate"

Activate:

- ddd-gate
- ddd-domain-discovery
- ddd-aggregate
- ddd-tactical-design

Do NOT automatically activate:

- ddd-refactoring
- ddd-documentation
- ddd-context-map

---

User:
"分析当前项目并完整落地 DDD"

Activate:

- ddd-gate
- ddd-project-discovery
- ddd-domain-discovery
- ddd-strategic-design
- ddd-bounded-context
- ddd-context-map
- ddd-tactical-design
- ddd-aggregate
- ddd-domain-event
- ddd-application-design
- ddd-architecture
- ddd-code-mapping
- ddd-refactoring
- ddd-validation
- ddd-documentation

---

## Principle

Minimum Required Skill Set.

Only activate the minimum skills required to satisfy the user's DDD request.
```

---

# 六、DDD Strategic Rules

`rules/ddd-strategic-rules.md`

```text
# DDD Strategic Design Rules

R-STRATEGIC-001

Domain boundaries MUST be derived from business capabilities and business semantics.

R-STRATEGIC-002

Subdomains MUST be classified as:

- Core
- Supporting
- Generic

R-STRATEGIC-003

Bounded Context MUST represent a semantic model boundary.

R-STRATEGIC-004

A code module MUST NOT automatically become a Bounded Context.

R-STRATEGIC-005

A database schema MUST NOT automatically become a Bounded Context.

R-STRATEGIC-006

Same terminology does NOT imply same domain concept.

R-STRATEGIC-007

Different meanings of the same business term MUST be modeled separately when required by context.

R-STRATEGIC-008

Ubiquitous Language MUST be established inside each Bounded Context.

R-STRATEGIC-009

Context Map MUST explicitly describe relationships between Bounded Contexts.

R-STRATEGIC-010

DDD models MUST be supported by evidence from the target project.

R-STRATEGIC-011

The agent MUST distinguish observed facts from inferred domain concepts.

R-STRATEGIC-012

Low-confidence domain concepts MUST be marked as hypotheses rather than facts.
```

---

# 七、DDD Tactical Rules

`rules/ddd-tactical-rules.md`

```text
# DDD Tactical Design Rules

R-TACTICAL-001

Entity MUST have meaningful identity and lifecycle continuity.

R-TACTICAL-002

Value Object SHOULD be used when identity is not required.

R-TACTICAL-003

Value Objects SHOULD be immutable where practical.

R-TACTICAL-004

Aggregate MUST define a consistency boundary.

R-TACTICAL-005

Aggregate MUST protect business invariants.

R-TACTICAL-006

Aggregate MUST NOT be created merely by grouping related database tables.

R-TACTICAL-007

Aggregate SHOULD remain as small as business consistency allows.

R-TACTICAL-008

Aggregate Root MUST control access to internal Aggregate state.

R-TACTICAL-009

References between Aggregates SHOULD use identity rather than direct object references.

R-TACTICAL-010

Cross-Aggregate consistency SHOULD NOT automatically require one transaction.

R-TACTICAL-011

Domain Service SHOULD only exist when domain behavior does not naturally belong to an Entity or Aggregate.

R-TACTICAL-012

Application Service MUST NOT become a dumping ground for domain rules.

R-TACTICAL-013

Repository SHOULD represent persistence access for Aggregate Roots.

R-TACTICAL-014

Repository abstraction SHOULD belong to the Domain boundary when dependency inversion requires it.

R-TACTICAL-015

Repository implementation MUST remain outside the Domain layer.

R-TACTICAL-016

Domain Event MUST represent a meaningful business occurrence.

R-TACTICAL-017

Factories SHOULD only be introduced when object creation contains meaningful domain logic.

R-TACTICAL-018

Specification SHOULD only be introduced when reusable domain predicates provide meaningful value.

R-TACTICAL-019

DDD patterns MUST NOT be introduced only to satisfy pattern completeness.
```

---

# 八、Architecture Rules

`rules/ddd-architecture-rules.md`

```text
# DDD Architecture Rules

R-ARCH-001

Domain MUST NOT depend on Infrastructure.

R-ARCH-002

Domain MUST NOT depend on Presentation.

R-ARCH-003

Domain MUST NOT depend on Framework-specific infrastructure unless explicitly justified.

R-ARCH-004

Application Layer MAY depend on Domain.

R-ARCH-005

Infrastructure MAY depend on Application and Domain abstractions.

R-ARCH-006

Presentation MUST NOT directly implement Domain business rules.

R-ARCH-007

Controllers MUST NOT contain core domain invariants.

R-ARCH-008

Persistence models SHOULD NOT leak into Domain models.

R-ARCH-009

External API models SHOULD NOT automatically become Domain models.

R-ARCH-010

ORM entities SHOULD NOT automatically become Domain Entities.

R-ARCH-011

Architecture style MUST be selected based on project constraints.

R-ARCH-012

DDD MUST NOT force Microservices.

R-ARCH-013

DDD MUST NOT require Event Sourcing.

R-ARCH-014

DDD MUST NOT require CQRS.

R-ARCH-015

DDD MUST NOT require a specific programming language or framework.
```

---

# 九、Code Rules

`rules/ddd-code-rules.md`

```text
# DDD Code Rules

R-CODE-001

Business terminology SHOULD be reflected in code naming.

R-CODE-002

Business rules SHOULD be located close to the domain concept they govern.

R-CODE-003

Primitive obsession SHOULD be identified when it hides meaningful domain concepts.

R-CODE-004

Anemic Domain Model SHOULD be reported when domain behavior is systematically externalized without justification.

R-CODE-005

God Aggregates MUST be reported.

R-CODE-006

God Domain Services MUST be reported.

R-CODE-007

Generic Utility classes MUST NOT become dumping grounds for domain behavior.

R-CODE-008

Infrastructure concerns MUST NOT be mixed with core domain behavior.

R-CODE-009

Existing code MUST be analyzed before introducing new DDD abstractions.

R-CODE-010

DDD refactoring MUST preserve existing business behavior unless behavior change is explicitly requested.

R-CODE-011

DDD migration MUST be incremental when the existing project is large or business-critical.

R-CODE-012

Every proposed domain concept SHOULD have traceable evidence from code, tests, API, documentation, or user-provided business knowledge.
```

---

# 十、Refactoring Rules

`rules/ddd-refactoring-rules.md`

```text
# DDD Refactoring Rules

R-REFACTOR-001

DDD refactoring MUST begin with discovery.

R-REFACTOR-002

DDD refactoring MUST NOT start with directory restructuring.

R-REFACTOR-003

Business behavior MUST be preserved by default.

R-REFACTOR-004

Refactoring SHOULD be incremental.

R-REFACTOR-005

Each migration step MUST have explicit scope.

R-REFACTOR-006

Each migration step MUST define validation criteria.

R-REFACTOR-007

Large-scale DDD migration SHOULD establish characterization tests before moving business logic.

R-REFACTOR-008

A new DDD model MUST be mapped to existing code before deleting legacy structures.

R-REFACTOR-009

DDD refactoring MUST NOT introduce artificial abstractions.

R-REFACTOR-010

Legacy compatibility boundaries SHOULD be introduced when immediate migration is unsafe.

R-REFACTOR-011

Code deletion MUST only happen after replacement behavior is validated.
```

---

# 十一、Validation Rules

`rules/ddd-validation-rules.md`

```text
# DDD Validation Rules

R-VALIDATE-001

DDD validation MUST distinguish:

- Strategic violations
- Tactical violations
- Architecture violations
- Code violations
- Migration violations

R-VALIDATE-002

Every violation MUST include evidence.

R-VALIDATE-003

Every inferred violation MUST include confidence.

R-VALIDATE-004

Validation MUST NOT report a violation solely because a preferred DDD pattern is absent.

R-VALIDATE-005

Absence of Aggregate MUST NOT automatically be considered a defect.

R-VALIDATE-006

Absence of Domain Service MUST NOT automatically be considered a defect.

R-VALIDATE-007

Absence of Domain Event MUST NOT automatically be considered a defect.

R-VALIDATE-008

CRUD-oriented modules MAY legitimately use simpler architecture.

R-VALIDATE-009

DDD compliance MUST be evaluated against actual business complexity.

R-VALIDATE-010

Validation MUST identify false-positive risks.
```

---

# 十二、Project Discovery Skill

```text
# DDD Project Discovery

## Activation

Only execute when DDD Gate = ENABLED.

## Purpose

Understand the existing project before DDD modeling.

## Analyze

- project structure
- language
- framework
- modules
- packages
- APIs
- persistence
- existing architecture
- business entry points
- business workflows
- tests
- existing domain abstractions

## Do Not

- redesign architecture
- create aggregates
- create bounded contexts
- modify code

## Output

ProjectModel
ArchitectureModel
BusinessCandidateModel
DDDReadinessModel
```

---

# 十三、Domain Discovery Skill

```text
# DDD Domain Discovery

## Activation

DDD Gate MUST be ENABLED.

## Purpose

Discover business concepts from the existing project.

## Analyze

- business verbs
- business nouns
- state transitions
- business rules
- invariants
- workflows
- commands
- events
- business terminology
- external actors

## Evidence Sources

Priority:

1. User-provided business knowledge
2. Existing documentation
3. Tests
4. API contracts
5. Business logic
6. Code naming
7. Database structure

## Output

- Business Concepts
- Business Rules
- Business Processes
- Domain Candidates
- Evidence
- Confidence
```

---

# 十四、Strategic Design Skill

```text
# DDD Strategic Design

## Activation

DDD Gate MUST be ENABLED.

## Responsibilities

- identify Domains
- identify Subdomains
- classify Core / Supporting / Generic
- establish Ubiquitous Language
- identify Bounded Context candidates
- identify semantic boundaries

## Constraints

Do not derive Bounded Context solely from:

- directory
- database
- service
- package
- microservice

## Output

StrategicModel
```

---

# 十五、Bounded Context Skill

```text
# DDD Bounded Context

## Purpose

Define explicit model boundaries.

## Analyze

- language boundaries
- business responsibility
- model ownership
- data ownership
- business invariants
- lifecycle
- team ownership where available
- integration boundaries

## Output

BoundedContextModel
```

---

# 十六、Context Map Skill

```text
# DDD Context Map

## Purpose

Model relationships between Bounded Contexts.

## Supported Relationships

- Partnership
- Shared Kernel
- Customer Supplier
- Conformist
- Anti-Corruption Layer
- Open Host Service
- Published Language
- Separate Ways

## Output

ContextMapModel
IntegrationModel
```

---

# 十七、Tactical Design Skill

```text
# DDD Tactical Design

## Purpose

Transform strategic domain concepts into tactical domain models.

## Identify

- Entity
- Value Object
- Aggregate
- Aggregate Root
- Domain Service
- Domain Event
- Repository
- Factory
- Specification

## Rules

Use the minimum number of tactical patterns required.

Do not introduce patterns merely for structural completeness.

## Output

TacticalModel
```

---

# 十八、Aggregate Skill

```text
# DDD Aggregate Design

## Purpose

Define consistency boundaries.

## Analyze

- invariants
- transaction boundaries
- lifecycle
- concurrency
- consistency requirements
- command boundaries
- state transitions

## Questions

1. What must change atomically?
2. What must remain consistent?
3. What can become eventually consistent?
4. What is the Aggregate Root?
5. Is the Aggregate too large?
6. Are relationships incorrectly modeled?
7. Is the Aggregate derived from business behavior or database tables?

## Output

AggregateModel
```

---

# 十九、Domain Event Skill

```text
# DDD Domain Event

## Purpose

Identify business-significant occurrences.

## Distinguish

- Domain Event
- Application Event
- Integration Event
- Technical Event

## Rules

A Domain Event MUST describe something that happened.

It MUST NOT merely represent a command or technical notification.

## Output

DomainEventModel
```

---

# 二十、Application Design Skill

```text
# DDD Application Design

## Purpose

Define application-level use cases.

## Identify

- Commands
- Queries
- Use Cases
- Application Services
- Transactions
- Authorization boundaries
- Idempotency requirements
- Orchestration

## Rule

Application layer coordinates domain behavior.

Application layer MUST NOT become the location of core business invariants.

## Output

ApplicationModel
```

---

# 二十一、Architecture Skill

```text
# DDD Architecture

## Purpose

Map DDD concepts into the project's actual architecture.

## Supported

- Layered Architecture
- Hexagonal Architecture
- Clean Architecture
- Onion Architecture
- Modular Monolith
- Microservices

## Rules

Do not force a specific architecture.

First identify the existing architecture.

Then determine the minimum architecture changes required by the DDD model.

## Output

CurrentArchitecture
TargetArchitecture
ArchitectureGap
```

---

# 二十二、Code Mapping Skill

```text
# DDD Code Mapping

## Purpose

Map DDD model to existing implementation.

## Mapping

Domain Concept
        ↓
Existing Code
        ↓
Current Responsibility
        ↓
DDD Gap
        ↓
Target Responsibility

## Output

- DomainToCodeMapping
- CodeToDomainMapping
- ResponsibilityViolations
- ArchitectureViolations
- RefactoringCandidates
```

---

# 二十三、Refactoring Skill

```text
# DDD Refactoring

## Activation

Only execute when:

1. DDD is enabled
2. User requests implementation / migration / refactoring
3. Code mapping is available

## Workflow

Discovery
↓
DDD Model
↓
Code Mapping
↓
Migration Plan
↓
Implementation
↓
Validation

## Rules

Never directly perform large-scale DDD restructuring without an intermediate migration plan.
```

---

# 二十四、Validation Skill

```text
# DDD Validation

## Purpose

Validate DDD implementation.

## Validate

Strategic
Tactical
Architecture
Code
Dependency
Business Rules
Aggregate
Bounded Context
Integration

## Output

{
  "status": "PASS|WARNING|FAIL",
  "violations": [],
  "warnings": [],
  "evidence": [],
  "confidence": 0
}
```

---

# 二十五、Documentation Skill

```text
# DDD Documentation

## Purpose

Persist the DDD model as project knowledge.

## Generate

- Domain Model
- Subdomains
- Bounded Contexts
- Context Map
- Ubiquitous Language
- Aggregates
- Domain Events
- Use Cases
- Architecture
- Code Mapping
- Migration Plan
- Validation Report

## Rule

Documentation MUST be derived from the current validated model.

Do not generate independent documentation that can diverge from the DDD model.
```

---

# 二十六、完整 Skill 调度矩阵

最终不要简单地“DDD 开关打开后全部加载”。

应该按照任务动态命中：

| 用户意图        | Gate | Discovery | Strategic | Context | Tactical | Aggregate | Application | Architecture | Mapping | Refactor | Validate |
| ----------- | ---: | --------: | --------: | ------: | -------: | --------: | ----------: | -----------: | ------: | -------: | -------: |
| 普通开发        |    ❌ |         ❌ |         ❌ |       ❌ |        ❌ |         ❌ |           ❌ |            ❌ |       ❌ |        ❌ |        ❌ |
| 普通架构分析      |    ❌ |         ❌ |         ❌ |       ❌ |        ❌ |         ❌ |           ❌ |            ❌ |       ❌ |        ❌ |        ❌ |
| DDD分析       |    ✅ |         ✅ |         ✅ |       ✅ |        ✅ |        可选 |          可选 |            ✅ |       ✅ |        ❌ |       可选 |
| DDD战略设计     |    ✅ |         ✅ |         ✅ |       ✅ |        ❌ |         ❌ |           ❌ |            ❌ |       ❌ |        ❌ |        ❌ |
| Aggregate设计 |    ✅ |         ✅ |         ❌ |       ❌ |        ✅ |         ✅ |           ❌ |            ❌ |       ❌ |        ❌ |       可选 |
| DDD架构设计     |    ✅ |         ✅ |         ✅ |       ✅ |        ✅ |        可选 |           ✅ |            ✅ |       ❌ |        ❌ |       可选 |
| DDD重构       |    ✅ |         ✅ |         ✅ |       ✅ |        ✅ |         ✅ |           ✅ |            ✅ |       ✅ |        ✅ |        ✅ |
| DDD完整落地     |    ✅ |         ✅ |         ✅ |       ✅ |        ✅ |         ✅ |           ✅ |            ✅ |       ✅ |        ✅ |        ✅ |
| DDD验证       |    ✅ |        可选 |        可选 |      可选 |        ✅ |         ✅ |           ✅ |            ✅ |       ✅ |        ❌ |        ✅ |

---

# 二十七、最重要的 Agent 调度规则

最终 Orchestrator 必须遵循：

```text
User Request
     │
     ▼
┌─────────────────┐
│   DDD Gate       │
└────────┬────────┘
         │
     ┌───┴────┐
     │        │
 DISABLED   ENABLED
     │        │
     ▼        ▼
   STOP    Scope Analysis
                │
                ▼
         Required Skills
                │
                ▼
         Load Rules
                │
                ▼
          Execute Skills
                │
                ▼
           Validate
```

并且：

```text
Rules Loading Order

1. ddd-gate.md
2. ddd-scope.md
3. relevant strategic rules
4. relevant tactical rules
5. relevant architecture rules
6. relevant code rules
7. relevant refactoring rules
8. relevant validation rules
```

**禁止在 Gate 之前加载完整 DDD Rules。**

这样可以从机制上避免普通任务因为 Skill description 中存在：

```text
Domain
Entity
Aggregate
Repository
Architecture
Service
```

而产生无效命中。

---

# 二十八、最终 DDD SKILL 的核心约束

最终整个体系可以压缩成下面这组最高优先级原则：

```text
DDD-SYSTEM-001
DDD is opt-in, not opt-out.

DDD-SYSTEM-002
Explicit user intent is required to activate DDD.

DDD-SYSTEM-003
DDD terminology in the project MUST NOT activate DDD.

DDD-SYSTEM-004
Architecture analysis MUST NOT automatically become DDD analysis.

DDD-SYSTEM-005
DDD activation MUST be scoped to the user's requested capability.

DDD-SYSTEM-006
DDD patterns MUST NOT be introduced without domain justification.

DDD-SYSTEM-007
Existing project evidence MUST be collected before DDD modeling.

DDD-SYSTEM-008
Observed facts and inferred models MUST be distinguished.

DDD-SYSTEM-009
Strategic design MUST precede tactical design when performing full DDD design.

DDD-SYSTEM-010
Bounded Context MUST be based on semantic boundaries.

DDD-SYSTEM-011
Aggregate MUST be based on consistency boundaries.

DDD-SYSTEM-012
Business rules MUST remain close to the domain model.

DDD-SYSTEM-013
DDD MUST NOT force a specific architecture.

DDD-SYSTEM-014
DDD MUST NOT force Microservices, CQRS, Event Sourcing, or Domain Events.

DDD-SYSTEM-015
DDD refactoring MUST preserve existing behavior by default.

DDD-SYSTEM-016
DDD migration MUST be incremental for existing systems.

DDD-SYSTEM-017
Every major DDD decision MUST be traceable to evidence.

DDD-SYSTEM-018
DDD validation MUST detect both violations and false positives.

DDD-SYSTEM-019
DDD documentation MUST be generated from the validated model.

DDD-SYSTEM-020
If DDD is not explicitly requested, DDD skills MUST NOT execute.
```

其中最关键的就是 **`DDD-SYSTEM-001 + 002 + 003 + 005`**：

> **DDD 是显式启用能力，而不是代码特征触发能力。**

这样这套 SKILLS 才适合做成一个真正的**通用 DDD 工程能力包**，安装到任何项目后不会污染普通开发任务；一旦用户明确要求 DDD，则再按照 `Gate → Scope → Discovery → Strategic → Tactical → Architecture → Mapping → Refactor → Validation` 的链路逐级加载能力。
