可以。基于前面已经确定的 **AAFE + WeCom + 多任务隔离 + Cursor Cloud Agent + Analyze + Skills/Rules/Knowledge/Memory**，我建议这次不要做“接入 OpenSpec”这么简单，而是把 AAFE 升级成：

> **以 SDD/OpenSpec 为研发过程协议，以 AAFE 为 Agent Orchestration Platform，以 Cursor Cloud Agent 为 Coding Runtime 的 AI 原生研发平台。**

OpenSpec 当前的核心已经比较明确：`Explore → Propose → Spec/Design/Tasks → Apply → Verify/Sync → Archive`，并且强调 Brownfield、可迭代、文档版本化和 Spec 作为 AI 与人的协作契约。([GitHub][1])

下面给出一套可以直接进入开发阶段的完整升级方案。

---

# 1. 最终目标架构

最终 AAFE 不应该是：

```text
WeCom
  ↓
AAFE
  ↓
Cursor
```

而应该升级成：

```text
                         ┌──────────────────────┐
                         │       WeCom Bot      │
                         │       CLI / API      │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    AAFE Gateway      │
                         │ Auth / Routing       │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Intent Router      │
                         │ Task Resolver        │
                         └──────────┬───────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │       AAFE Task System       │
                    │                              │
                    │ Task Manager                 │
                    │ Scheduler                   │
                    │ Context Isolation            │
                    │ Recovery                    │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │      SDD Orchestrator        │
                    │                              │
                    │ Explore                      │
                    │ Proposal                     │
                    │ Design                       │
                    │ Spec                         │
                    │ Tasks                        │
                    │ Approval                     │
                    │ Apply                        │
                    │ Verify                       │
                    │ Sync                         │
                    │ Archive                      │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
        ┌──────────┐         ┌──────────┐        ┌──────────┐
        │Knowledge │         │ Skills   │        │  Rules   │
        └──────────┘         └──────────┘        └──────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                                   ▼
                         ┌──────────────────────┐
                         │    Agent Planner     │
                         └──────────┬───────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   ▼                ▼                ▼
              Explore Agent    Spec Agent       Coding Agent
                   │                │                │
                   │                │         Cursor Cloud
                   │                │             Agent
                   │                │                │
                   └────────────────┼────────────────┘
                                    ▼
                              Verification
                                    │
                                    ▼
                              Traceability
                                    │
                                    ▼
                                Archive
```

Cursor Cloud Agent 本身适合放在最底层作为执行 Runtime，因为它运行在隔离 VM 中，具备独立代码环境、依赖、Secrets、网络和测试能力，并支持多个 Agent 并行。([Cursor][2])

---

# 2. AAFE 的核心定位重新定义

升级之后：

```text
AAFE
=
Agent First
+
Task First
+
Spec First
+
Runtime Independent
```

四个核心原则：

### Agent First

所有复杂工作都由 Agent 完成：

```text
Explore
Design
Spec
Coding
Testing
Verification
Review
```

### Task First

所有上下文都属于 Task。

```text
Task
 ├── Context
 ├── SDD
 ├── Agents
 ├── Runtime
 ├── Git
 ├── Events
 └── Result
```

### Spec First

代码修改必须尽量经过：

```text
Requirement
 ↓
Spec
 ↓
Tasks
 ↓
Code
 ↓
Test
```

### Runtime Independent

AAFE 不绑定 Cursor。

```text
AAFE Runtime
├── Cursor Cloud
├── Cursor Local
├── Cursor API
├── Claude Code
├── Codex
└── Future Runtime
```

第一阶段实现：

```text
CursorCloudRuntime
```

即可。

---

# 3. AAFE 项目目录升级

建议直接升级成：

```text
aafe/
├── apps/
│   ├── cli/
│   ├── server/
│   └── worker/
│
├── packages/
│   │
│   ├── core/
│   │   ├── types/
│   │   ├── errors/
│   │   ├── config/
│   │   └── logger/
│   │
│   ├── gateway/
│   │   ├── wecom/
│   │   ├── api/
│   │   └── auth/
│   │
│   ├── task/
│   │   ├── manager/
│   │   ├── resolver/
│   │   ├── scheduler/
│   │   ├── context/
│   │   ├── isolation/
│   │   ├── state/
│   │   └── recovery/
│   │
│   ├── agent/
│   │   ├── planner/
│   │   ├── orchestrator/
│   │   ├── registry/
│   │   └── executor/
│   │
│   ├── sdd/
│   │   ├── engine/
│   │   ├── workflow/
│   │   ├── artifacts/
│   │   ├── parser/
│   │   ├── validator/
│   │   ├── traceability/
│   │   └── archive/
│   │
│   ├── openspec/
│   │   ├── adapter/
│   │   ├── schema/
│   │   ├── templates/
│   │   └── validator/
│   │
│   ├── analyzer/
│   │   ├── ast/
│   │   ├── architecture/
│   │   ├── dataflow/
│   │   ├── business/
│   │   ├── function/
│   │   └── impact/
│   │
│   ├── knowledge/
│   ├── skills/
│   ├── rules/
│   ├── memory/
│   │
│   ├── runtime/
│   │   ├── interface/
│   │   ├── cursor-cloud/
│   │   ├── cursor-local/
│   │   └── cursor-api/
│   │
│   ├── verification/
│   ├── git/
│   ├── events/
│   └── storage/
│
├── templates/
├── docs/
└── tests/
```

其中新增的核心就是：

```text
packages/sdd
packages/openspec
```

---

# 4. SDD Engine 是整个升级的核心

不要直接把 OpenSpec CLI 嵌进 AAFE。

建立：

```ts
interface SDDEngine {
  createChange(input: CreateChangeInput): Promise<SDDChange>;

  explore(changeId: string): Promise<ExploreResult>;

  propose(changeId: string): Promise<ProposalResult>;

  design(changeId: string): Promise<DesignResult>;

  generateSpecs(changeId: string): Promise<SpecResult>;

  generateTasks(changeId: string): Promise<TaskPlanResult>;

  validate(changeId: string): Promise<ValidationResult>;

  apply(changeId: string): Promise<ApplyResult>;

  verify(changeId: string): Promise<VerificationResult>;

  sync(changeId: string): Promise<SyncResult>;

  archive(changeId: string): Promise<ArchiveResult>;
}
```

这样 OpenSpec 只是：

```text
OpenSpecAdapter
```

而不是 AAFE 核心。

---

# 5. OpenSpec Adapter

建立：

```text
packages/openspec/
```

职责：

```text
OpenSpecAdapter
    │
    ├── parse config.yaml
    ├── parse proposal.md
    ├── parse design.md
    ├── parse specs/*
    ├── parse tasks.md
    ├── validate
    ├── create change
    ├── sync
    └── archive
```

OpenSpec 当前 Change 的标准结构就是：

```text
openspec/changes/<change>/
├── .openspec.yaml
├── proposal.md
├── design.md
├── tasks.md
└── specs/
    └── <capability>/
        └── spec.md
```

并且 `proposal.md` 至少要求 `Why` 和 `What Changes`，Spec 使用 Requirement + Scenario 结构。([GitHub][3])

AAFE 第一版应该**兼容这个结构**。

---

# 6. AAFE Task 和 OpenSpec Change 建立 1:1 映射

这是整个系统最重要的设计。

```text
AAFE Task
    │
    └── OpenSpec Change
```

例如：

```text
Task ID:
T-20260903-0001
```

对应：

```text
openspec/changes/
└── T-20260903-0001-fix-login-timeout/
```

同时：

```text
Git Branch
aafe/T-20260903-0001

Cursor Agent
cursor-agent-xxx

Cursor Run
cursor-run-xxx

PR
#123
```

形成：

```text
                       T-20260903-0001
                              │
          ┌───────────┬───────┼───────────┬──────────┐
          ↓           ↓       ↓           ↓          ↓
      AAFE Task    Change    Branch     Agent       PR
                   Spec
```

所有数据都通过 Task ID 关联。

---

# 7. Task Context Isolation

这部分必须作为硬规则。

定义：

```ts
interface TaskContext {
  taskId: string;

  userRequest: string;

  conversationContext: ConversationContext;

  exploration?: ExploreResult;

  proposal?: Proposal;

  design?: Design;

  specs?: Specs;

  taskPlan?: TaskPlan;

  execution?: ExecutionContext;

  verification?: VerificationResult;
}
```

绝对不能：

```text
T001 → 读取 T002 Context
T002 → 读取 T001 Cursor History
```

---

# 8. Context 分成两种

### Shared Context

可以跨 Task：

```text
Project Architecture
Project Knowledge
Project Rules
Project Skills
Master Specs
Repository Metadata
```

### Private Context

绝对隔离：

```text
User Request
WeCom Conversation
Task Plan
Proposal
Design
Change Spec
Agent History
Tool Result
Execution Result
Cursor Conversation
Runtime State
```

最终：

```text
Project
│
├── Shared Knowledge
│
├── T001
│   ├── Context
│   ├── SDD
│   └── Cursor Agent
│
├── T002
│   ├── Context
│   ├── SDD
│   └── Cursor Agent
│
└── T003
    ├── Context
    ├── SDD
    └── Cursor Agent
```

---

# 9. SDD Workflow State Machine

不要让 Agent 自由决定状态。

由 AAFE State Machine 管理：

```text
CREATED
   ↓
EXPORING
   ↓
PROPOSING
   ↓
DESIGNING
   ↓
SPEC_GENERATING
   ↓
TASK_PLANNING
   ↓
WAITING_APPROVAL
   ↓
READY
   ↓
IMPLEMENTING
   ↓
VERIFYING
   ↓
SYNCING
   ↓
ARCHIVING
   ↓
COMPLETED
```

异常：

```text
FAILED
CANCELLED
PAUSED
WAITING_USER
WAITING_DEPENDENCY
RECOVERING
```

---

# 10. 允许“流式 SDD”，不要做死板瀑布

这里要遵循 OpenSpec 当前的思想。

OpenSpec 明确强调：

> Fluid, not rigid
> Iterative, not waterfall

即设计、Spec、实现过程中允许反向调整。([GitHub][3])

因此 AAFE 不应该：

```text
Design 完成
↓
禁止修改
```

而应该：

```text
Design
 ↓
Spec
 ↓
Implementation
 ↓
发现问题
 ↓
修改 Design
 ↓
修改 Spec
 ↓
继续 Implementation
```

但必须记录：

```text
SDD Revision
```

例如：

```text
spec v1
spec v2
spec v3
```

---

# 11. Analyze Agent 升级为 Explore Agent

你之前的：

```text
npx aafe analyze
```

直接保留。

但是内部升级：

```text
Analyze Engine
       ↓
Explore Agent
```

分析：

```text
Architecture
Data Flow
Business
Function
Dependency
Impact
```

输出：

```ts
interface ExploreResult {
  architecture: ArchitectureAnalysis;

  dataFlow: DataFlowAnalysis;

  businessFunctions: BusinessFunction[];

  functions: FunctionAnalysis[];

  dependencies: DependencyGraph;

  impactedFiles: ImpactedFile[];

  risks: Risk[];

  recommendations: Recommendation[];
}
```

然后：

```text
ExploreResult
      ↓
Proposal Agent
      ↓
Design Agent
      ↓
Spec Agent
```

这会把你之前的 Analyze 体系完整复用起来。

---

# 12. Agent 体系最终调整

建议第一版确定 7 个 Agent。

## Agent 01 — Task Router

职责：

```text
判断：
新 Task？
继续 Task？
修改 Spec？
执行 Task？
验证？
归档？
```

---

## Agent 02 — Explore Agent

职责：

```text
代码理解
架构分析
数据流
业务功能
影响范围
风险
```

---

## Agent 03 — Proposal Agent

输入：

```text
User Request
ExploreResult
Knowledge
Rules
```

输出：

```text
proposal.md
```

---

## Agent 04 — Design Agent

输入：

```text
proposal
architecture
knowledge
rules
```

输出：

```text
design.md
```

---

## Agent 05 — Spec Agent

输出：

```text
specs/*/spec.md
```

核心格式：

```text
Requirement
Scenario
Given
When
Then
```

---

## Agent 06 — Task Planning Agent

输出：

```text
tasks.md
```

例如：

```text
M1 Foundation

- [ ] 1.1 修改 LoginService
- [ ] 1.2 增加 OTP API
- [ ] 1.3 修改 Login UI

M2 Testing

- [ ] 2.1 Unit Test
- [ ] 2.2 Integration Test
- [ ] 2.3 E2E Test
```

---

## Agent 07 — Coding Agent

这里：

```text
Cursor Cloud Agent
```

Cursor Cloud Agent API 当前已经采用“durable Agent + per-prompt Run”的模型，非常适合映射 AAFE Task：一个 Task 对应一个持久 Agent，后续每次执行/修复可以产生新的 Run。([Cursor][4])

---

# 13. Coding Runtime 设计

AAFE 不直接依赖 Cursor SDK。

定义：

```ts
interface AgentRuntime {
  createAgent(input: CreateAgentInput): Promise<AgentHandle>;

  run(
    agent: AgentHandle,
    input: AgentRunInput
  ): Promise<RunHandle>;

  stream(
    run: RunHandle
  ): AsyncIterable<AgentEvent>;

  cancel(
    run: RunHandle
  ): Promise<void>;

  getStatus(
    run: RunHandle
  ): Promise<RunStatus>;
}
```

然后：

```text
AgentRuntime
├── CursorCloudRuntime
├── CursorLocalRuntime
└── CursorApiRuntime
```

第一阶段只实现：

```text
CursorCloudRuntime
```

---

# 14. Cursor Cloud Agent 和 AAFE Task 的关系

建议：

```text
AAFE Task T001
       │
       ↓
Cursor Agent A
       │
       ├── Run 001
       │
       ├── Run 002
       │
       └── Run 003
```

例如：

```text
Run 001
Implement tasks

Run 002
Fix failed tests

Run 003
Address review comments
```

而：

```text
T002
 ↓
Cursor Agent B
```

绝不能：

```text
T001 → Agent A
T002 → Agent A
```

因为这样很容易造成动态上下文污染。

Cursor Cloud Agent 的 VM 本身也是独立隔离的，因此非常适合作为 AAFE Task 的 Runtime Boundary。([Cursor][2])

---

# 15. Cursor Prompt 必须由 AAFE 组装

不要直接把 WeCom 原始消息扔给 Cursor。

建立：

```ts
interface CodingPromptContext {
  taskId: string;

  userRequest: string;

  proposal: Proposal;

  design: Design;

  specs: Specs;

  tasks: TaskPlan;

  architecture: Architecture;

  impact: ImpactAnalysis;

  skills: Skill[];

  rules: Rule[];

  constraints: Constraint[];

  completionCriteria: CompletionCriteria[];
}
```

最终生成：

```text
You are the Coding Agent of AAFE.

Task:
T-20260903-0001

User Request:
...

Project Context:
...

Architecture:
...

Impact Analysis:
...

Proposal:
...

Design:
...

Specs:
...

Implementation Tasks:
...

Rules:
...

Skills:
...

Constraints:
...

Completion Criteria:
...

You MUST:
1. Follow the provided specifications.
2. Only modify files within the identified scope unless necessary.
3. Run required tests.
4. Report implementation status.
5. Do not modify the SDD intent without updating the corresponding artifacts.
```

---

# 16. SDD Artifact 必须和 Code 建立 Traceability

新增：

```text
traceability.json
```

例如：

```json
{
  "taskId": "T-20260903-0001",
  "specs": [
    {
      "id": "auth.login.otp",
      "requirements": [
        "REQ-001",
        "REQ-002"
      ],
      "files": [
        "src/auth/login.ts",
        "src/api/login.ts"
      ],
      "tests": [
        "tests/auth/login.test.ts"
      ]
    }
  ]
}
```

形成：

```text
Requirement
     ↓
Spec
     ↓
Task
     ↓
File
     ↓
Test
     ↓
Verification
```

这是 AAFE 后续最有价值的数据资产之一。

---

# 17. Verification Agent

Verification 不应该简单执行：

```bash
npm test
```

而应该验证：

```text
Spec
 ↓
Requirement
 ↓
Scenario
 ↓
Code
 ↓
Test
 ↓
Runtime
```

输出：

```ts
interface VerificationResult {
  status: 'passed' | 'failed' | 'partial';

  requirements: RequirementVerification[];

  tests: TestResult[];

  changedFiles: FileChange[];

  uncoveredRequirements: string[];

  regressions: Regression[];

  risks: Risk[];
}
```

例如：

```text
REQ-001 ✓
REQ-002 ✓
REQ-003 ✗

Unit Test ✓
Integration Test ✓
E2E Test ✗

Result: FAILED
```

然后自动：

```text
Verification Failed
        ↓
Task Planner
        ↓
Fix Task
        ↓
Cursor Agent Run N+1
```

---

# 18. WeCom 交互升级

最终企业微信不是简单的：

```text
用户 → Prompt
```

而是：

```text
用户
 ↓
Task
 ↓
SDD
 ↓
Approval
 ↓
Implementation
 ↓
Verification
```

例如：

```text
用户：

帮我修复登录超时问题
```

AAFE：

```text
已创建任务 T001

正在分析项目……
```

然后：

```text
T001 分析完成

发现：
- LoginService
- AuthMiddleware
- TokenRefresh
- Login API

影响 8 个文件。

建议方案：
......

Spec 已生成。

是否开始实施？
```

用户：

```text
开始实施
```

AAFE：

```text
T001 开始实施

Cursor Agent:
RUN-001

当前：
✓ 修改 LoginService
✓ 修改 TokenRefresh
⏳ 执行测试
```

最终：

```text
T001 完成

修改：
12 files

测试：
32 passed
2 skipped

Spec：
validated

PR：
#123

状态：
COMPLETED
```

---

# 19. Task Scheduler

由于你明确需要：

> 多任务 dispatch

AAFE 必须自己管理调度。

例如：

```ts
interface TaskScheduler {
  enqueue(taskId: string): Promise<void>;

  dispatch(): Promise<void>;

  pause(taskId: string): Promise<void>;

  cancel(taskId: string): Promise<void>;

  retry(taskId: string): Promise<void>;
}
```

配置：

```yaml
scheduler:
  maxConcurrentTasks: 5
  maxConcurrentAgents: 10
  retry:
    maxAttempts: 3
```

调度器负责：

```text
T001 RUNNING
T002 RUNNING
T003 RUNNING
T004 QUEUED
T005 QUEUED
```

而不是依赖 Cursor 自己控制。

---

# 20. Task Database

建议第一版 PostgreSQL。

核心表：

```text
projects
tasks
task_contexts
task_events

sdd_changes
sdd_artifacts
sdd_revisions

agents
agent_runs

skills
rules
knowledge

verification_results

git_operations
pull_requests
```

核心关系：

```text
Project
   │
   ├── Tasks
   │     │
   │     ├── Context
   │     ├── SDD Change
   │     ├── Agent
   │     │     └── Runs
   │     ├── Verification
   │     └── Git
   │
   └── Knowledge
```

---

# 21. Task Event Store

所有 Agent 行为事件化。

例如：

```text
task.created
task.exploring
task.proposal.created
task.design.created
task.spec.created
task.tasks.created

agent.created
agent.started
agent.tool_call
agent.file_changed
agent.test_started
agent.test_failed
agent.completed

verification.started
verification.failed
verification.passed

task.waiting_approval
task.completed
task.failed
```

最终：

```text
Task Timeline
```

可以完整还原一次 AI Coding。

---

# 22. Skills / Rules / Memory 继续保持原来的设计

你之前规划的：

> Skill / Memory 命中次数 + lastHitAt 用本地代码记录，不交给 LLM。

这个设计继续保留。

但现在增加：

```text
SDD Skill
```

例如：

```text
skills/
├── sdd/
│   ├── explore/
│   ├── proposal/
│   ├── design/
│   ├── spec/
│   ├── tasks/
│   ├── implementation/
│   ├── verification/
│   └── archive/
│
├── frontend/
├── performance/
├── ddd/
└── testing/
```

命中：

```text
SDD Skill
+
Frontend Skill
+
Vue Skill
+
Testing Skill
```

然后由 AAFE deterministic loader 统计：

```json
{
  "skill": "sdd/spec",
  "hitCount": 183,
  "lastHitAt": "2026-09-03T..."
}
```

---

# 23. Rules 必须加入 SDD Rules

例如：

```text
rules/
├── sdd/
│   ├── proposal.md
│   ├── design.md
│   ├── spec.md
│   ├── tasks.md
│   ├── implementation.md
│   └── verification.md
│
├── architecture/
├── frontend/
├── testing/
└── security/
```

关键规则：

```text
Rule: coding-before-spec

如果任务属于：
- 新功能
- 架构修改
- 高风险 Bug
- 跨模块修改

必须先产生 Spec。
```

但：

```text
Rule: trivial-change

如果：
- typo
- 单行配置
- 文档修正
- 明确指定的小型机械修改

可以跳过完整 SDD。
```

这样才符合 OpenSpec 的“Fluid / Simple”思想，而不是把所有修改都强制套成重量级流程。([GitHub][3])

---

# 24. SDD Routing Policy

这是非常关键的一层。

AAFE 收到请求后：

```text
User Request
      ↓
Task Router
      ↓
┌──────────────────────┐
│ 是否需要 SDD？       │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ↓           ↓
    NO          YES
     │           │
Direct Agent   SDD Workflow
```

建议：

### Direct Mode

```text
修复 typo
调整 README
修改一个配置
简单查询
```

直接：

```text
Cursor
```

### SDD Mode

```text
新增功能
重构
架构调整
跨模块修改
复杂 Bug
业务逻辑变更
API 修改
数据库修改
```

进入：

```text
Explore
Proposal
Design
Spec
Tasks
Implementation
Verification
```

---

# 25. SDD Mode 也应该支持三种级别

### Level 0

```text
Direct
```

### Level 1

```text
Light SDD

Explore
↓
Tasks
↓
Implementation
↓
Verify
```

### Level 2

```text
Full SDD

Explore
↓
Proposal
↓
Design
↓
Spec
↓
Tasks
↓
Approval
↓
Implementation
↓
Verify
↓
Archive
```

### Level 3

```text
Enterprise SDD

Full SDD
+
Architecture Review
+
Security Review
+
Human Approval
+
Multi-Agent Review
+
Traceability
```

---

# 26. CLI 最终应该长这样

保留：

```bash
npx aafe analyze
```

新增：

```bash
npx aafe task create
npx aafe task list
npx aafe task show T001
npx aafe task cancel T001
npx aafe task retry T001
```

SDD：

```bash
npx aafe sdd explore
npx aafe sdd propose
npx aafe sdd design
npx aafe sdd spec
npx aafe sdd tasks
npx aafe sdd validate
npx aafe sdd apply
npx aafe sdd verify
npx aafe sdd sync
npx aafe sdd archive
```

完整：

```bash
npx aafe run "增加用户手机号登录"
```

AAFE 自动：

```text
Intent
 ↓
Task
 ↓
SDD
 ↓
Agent
 ↓
Cursor
 ↓
Verification
```

---

# 27. 项目级配置

根目录：

```text
.aafe/
├── config.yaml
├── agents.yaml
├── skills/
├── rules/
├── knowledge/
└── project.json
```

例如：

```yaml
version: 1

project:
  name: wealth-web
  language: typescript
  framework: vue2

sdd:
  enabled: true
  defaultMode: full

  modes:
    trivial: direct
    normal: light
    complex: full
    architecture: enterprise

runtime:
  provider: cursor-cloud

scheduler:
  maxConcurrentTasks: 5

verification:
  required:
    - unit
    - integration
```

OpenSpec 本身的 `config.yaml` 已经用于项目上下文和规则注入，因此 AAFE 可以兼容并将其作为 SDD 配置来源之一。([GitHub][3])

---

# 28. `.aafe` 和 `openspec` 的关系

建议不要互相替代。

项目：

```text
project/
│
├── .aafe/
│   ├── config.yaml
│   ├── agents.yaml
│   ├── skills/
│   ├── rules/
│   └── knowledge/
│
├── openspec/
│   ├── config.yaml
│   ├── specs/
│   └── changes/
│
└── src/
```

职责：

```text
.aafe
=
Agent Platform Configuration

openspec
=
SDD Project Specification
```

这样以后即使不用 AAFE：

```text
openspec/
```

依然可以被其他 AI Coding Tool 使用。

这也是非常重要的开放性设计。

---

# 29. Cursor 配置和 AAFE 配置也不要混

建议：

```text
.cursor/
    ↓
Cursor-specific

.aafe/
    ↓
AAFE-specific

openspec/
    ↓
SDD-specific
```

例如：

```text
.cursor/
├── rules/
└── environment.json

.aafe/
├── agents.yaml
├── skills/
├── rules/
└── knowledge/

openspec/
├── config.yaml
├── specs/
└── changes/
```

这样不会出现：

```text
Cursor Rule
AAFE Rule
OpenSpec Rule
```

互相覆盖的问题。

---

# 30. Agent Prompt 层级

最终 Prompt 不应该只有一个 Prompt。

应该：

```text
System Prompt
      ↓
AAFE Agent Prompt
      ↓
SDD Skill
      ↓
SDD Rule
      ↓
Project Knowledge
      ↓
Task Context
      ↓
Spec
      ↓
Task
```

优先级：

```text
System
  >
AAFE
  >
Rule
  >
Spec
  >
Task
  >
Knowledge
```

---

# 31. Memory 和 SDD 的关系

不要把 Spec 放 Memory。

错误：

```text
Memory
 └── 登录系统 Spec
```

正确：

```text
Project Spec
 └── openspec/specs/auth
```

Memory：

```text
用户偏好
Agent经验
失败经验
历史决策
```

Knowledge：

```text
Architecture
Business
Data Flow
Project structure
```

Spec：

```text
Current Product Contract
```

Task Context：

```text
Current Task State
```

四者彻底分开。

---

# 32. Archive 后的数据生命周期

当：

```text
T001 COMPLETED
```

执行：

```text
Verify
 ↓
Sync
 ↓
Archive
```

最终：

```text
openspec/
├── specs/
│   └── auth/
│       └── spec.md
│
└── changes/
    └── archive/
        └── T001-fix-login/
```

同时：

```text
AAFE Task
status = COMPLETED
```

Cursor Agent：

```text
retained
```

但不再参与动态 Task。

这样：

```text
Current Spec
```

成为新的：

> Single Source of Truth

OpenSpec 的 Archive 本身就是将 Change 中的 Spec Delta 合并回主 `openspec/specs/`，再清理临时 Change 的生命周期机制。([GitHub][3])

---

# 33. Recovery 机制

这是远程 Agent 必须具备的。

例如：

```text
AAFE Server Crash
```

恢复：

```text
DB
 ↓
Task
 ↓
Cursor Agent ID
 ↓
Cursor Run ID
 ↓
恢复状态
```

绝不能：

```text
AAFE restart
 ↓
重新 create Cursor Agent
 ↓
重复执行
```

应该：

```text
load Task
 ↓
load Agent
 ↓
load Run
 ↓
check status
 ↓
resume / continue
```

Cursor Cloud Agent 的 durable Agent + Run 模型特别适合这一点。([Cursor][4])

---

# 34. 并发隔离最终方案

假设：

```text
WeCom
```

同时出现：

```text
T001 登录问题
T002 首页性能
T003 用户导出
```

最终：

```text
                 AAFE
                   │
       ┌───────────┼───────────┐
       ↓           ↓           ↓
     T001        T002        T003
       │           │           │
    Change1     Change2     Change3
       │           │           │
    Agent A     Agent B     Agent C
       │           │           │
    VM A         VM B        VM C
       │           │           │
   Branch A     Branch B    Branch C
```

做到：

> **Task / Change / Agent / VM / Branch 五层隔离。**

这就是这套架构真正能够支持多任务并发而不污染上下文的基础。

---

# 35. 第一阶段不要实现太多 Agent

第一版实际只需要：

```text
1. Task Router
2. Explore Agent
3. SDD Planner
4. Coding Agent
5. Verification Agent
```

其中：

```text
SDD Planner
```

内部可以包含：

```text
Proposal
Design
Spec
Tasks
```

后续再拆成独立 Agent。

否则一开始：

```text
Proposal Agent
Design Agent
Spec Agent
Task Agent
Review Agent
Security Agent
Test Agent
...
```

会造成 Orchestration 本身过度复杂。

---

# 36. 推荐的第一期 MVP

我建议第一期只实现：

```text
             WeCom
                ↓
           AAFE Gateway
                ↓
           Task Manager
                ↓
          Task Resolver
                ↓
           SDD Planner
                ↓
       ┌────────┴────────┐
       ↓                 ↓
   Explore          Generate SDD
       │                 │
       └────────┬────────┘
                ↓
          Human Approval
                ↓
        Cursor Cloud Agent
                ↓
           Verification
                ↓
             Result
                ↓
             WeCom
```

支持：

```text
✓ Task
✓ Task Isolation
✓ OpenSpec
✓ Explore
✓ Proposal
✓ Design
✓ Spec
✓ Tasks
✓ Cursor Cloud
✓ Verification
✓ Git Branch
✓ Multi-task
✓ WeCom
✓ Event
✓ Recovery
```

暂时不做：

```text
✗ 多模型自动路由
✗ 多 Agent Review
✗ 企业级权限
✗ 大规模 Knowledge Graph
✗ 自研 Sandbox
✗ 自研 Coding Runtime
```

---

# 37. 实施顺序

建议严格按照下面顺序开发。

## Phase 1 — Task Foundation

```text
Task Manager
Task State
Task Context
Task Event
Task Isolation
Task Scheduler
```

完成：

```bash
npx aafe task create
npx aafe task show
npx aafe task list
```

---

## Phase 2 — SDD Core

```text
aafe-sdd
OpenSpec Adapter
Artifact Manager
Validator
Change Manager
```

实现：

```bash
npx aafe sdd propose
npx aafe sdd validate
npx aafe sdd archive
```

---

## Phase 3 — Analyze / Explore

把已有：

```bash
npx aafe analyze
```

升级为：

```text
Explore Agent
```

---

## Phase 4 — Cursor Cloud Runtime

实现：

```text
CursorCloudRuntime
```

建立：

```text
Task
 ↓
Cursor Agent
 ↓
Run
 ↓
Events
```

---

## Phase 5 — SDD + Cursor

打通：

```text
Explore
 ↓
Proposal
 ↓
Design
 ↓
Spec
 ↓
Tasks
 ↓
Cursor
 ↓
Verify
```

---

## Phase 6 — WeCom

增加：

```text
WeCom Gateway
Task Resolver
Async Event Push
Approval
```

---

## Phase 7 — Recovery + Multi-task

实现：

```text
5 concurrent tasks
+
failure recovery
+
agent reconnect
+
retry
+
cancel
```

---

# 38. 最终 AAFE 形成的产品形态

最终用户看到的不是：

> “一个调用 Cursor API 的 Agent。”

而是：

> **一个可以通过企业微信远程管理 AI 软件研发任务的 SDD Agent Platform。**

用户只需要：

```text
@AAFE

新增用户登录验证码功能
```

AAFE 自动完成：

```text
                    User
                     │
                     ▼
                  Task T001
                     │
                     ▼
                  Explore
                     │
                     ▼
                  Proposal
                     │
                     ▼
                   Design
                     │
                     ▼
                    Spec
                     │
                     ▼
                   Tasks
                     │
                     ▼
                 Approval
                     │
                     ▼
              Cursor Cloud Agent
                     │
                     ▼
                   Code
                     │
                     ▼
                   Tests
                     │
                     ▼
               Verification
                     │
                     ▼
                  Review
                     │
                     ▼
                    PR
                     │
                     ▼
                  Archive
```

最终沉淀：

```text
Requirement
    ↓
Spec
    ↓
Architecture
    ↓
Code
    ↓
Test
    ↓
Verification
    ↓
Knowledge
```

这才是 AAFE 真正的长期价值。

---

# 39. 最终版本的核心模型

如果让我给这次 AAFE 升级做最终抽象，我会定成下面这 8 个核心 Domain：

```text
AAFE
│
├── Task
│   └── 一切工作的基本隔离单元
│
├── SDD
│   └── 一切研发工作的规范协议
│
├── Agent
│   └── 一切智能决策和执行能力
│
├── Runtime
│   └── Cursor / Claude / Codex 等执行环境
│
├── Knowledge
│   └── 项目长期知识
│
├── Skill
│   └── 专业能力
│
├── Rule
│   └── 强约束
│
└── Verification
    └── 最终质量保证
```

关系：

```text
                 ┌─────────────┐
                 │    Task     │
                 └──────┬──────┘
                        │
          ┌─────────────┼──────────────┐
          ↓             ↓              ↓
        SDD           Agent         Context
          │             │
          │             ↓
          │          Runtime
          │             │
          ↓             ↓
       Spec           Code
          │             │
          └──────┬──────┘
                 ↓
            Verification
                 │
                 ↓
              Archive
```

**其中 Task 是中心，SDD 是过程，Agent 是智能，Runtime 是执行，Knowledge/Skills/Rules 是能力来源，Verification 是质量闭环。**

这套结构可以完整承接你前面已经设计的 AAFE 能力，而且不会把 AAFE 锁死在 Cursor 或 OpenSpec 上。OpenSpec 作为当前 SDD 实现标准，Cursor Cloud Agent 作为第一种 Coding Runtime，都只是这套平台中的可替换实现层。([GitHub][1])

如果按工程落地优先级，我建议**下一步直接进入 RFC 级设计**：先把 `aafe-sdd`、`Task Domain`、`AgentRuntime`、`CursorCloudRuntime` 四个核心模块的 **TypeScript Interface + DB Schema + 状态机 + Agent Schema + Prompt + 目录结构 + CLI/API 契约**一次性定死，再开始编码。

[1]: https://github.com/ForceInjection/OpenSpec-practise?utm_source=chatgpt.com "GitHub - ForceInjection/OpenSpec-practise: OpenSpec Practical Guide · GitHub"
[2]: https://cursor.com/docs/cloud-agent?utm_source=chatgpt.com "Cloud Agents | Cursor Docs"
[3]: https://github.com/ForceInjection/OpenSpec-practise/blob/main/docs-en/openspec-user-manual.md?utm_source=chatgpt.com "OpenSpec-practise/docs-en/openspec-user-manual.md at main · ForceInjection/OpenSpec-practise · GitHub"
[4]: https://prod.cursor.com/docs/cloud-agent/api/endpoints?utm_source=chatgpt.com "Cloud Agents API | Cursor Docs"
