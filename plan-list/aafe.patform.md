下面给出一套可以直接作为 **AAFE Agent Platform Architecture RFC / 实施设计基线** 的完整方案。

核心目标不是做一个“Agent 集合”，而是构建：

> **AAFE = 项目知识层 + Agent Runtime + Planner + Orchestrator + 专业 Agent + CLI + IDE Agent 协作层**

最终形成：

```text
需求 / 代码变更 / 测试请求
        │
        ▼
┌──────────────────────────────────────────┐
│          AAFE Agent Platform             │
│                                          │
│  Planner / Router Agent                  │
│          │                               │
│          ▼                               │
│  Agent Orchestrator                      │
│          │                               │
│    ┌─────┼─────┬─────┬─────┐             │
│    ▼     ▼     ▼     ▼     ▼             │
│   A1    A2    A3    A4    ...            │
│    │     │     │     │                   │
│    └─────┴─────┴─────┴────────┐          │
│                              ▼           │
│                    Project Knowledge     │
└──────────────────────────────────────────┘
                              │
                              ▼
                    AAFE CLI / IDE Bridge
                              │
                              ▼
                       当前 IDE Agent
                              │
                              ▼
                    代码实现 / 修复 / 提交
                              │
                              ▼
                       AAFE Test Loop
```

---



# 1. 总体设计目标

AAFE Agent Platform 解决四类问题：

### ① 理解项目

```text
Source Code
    ↓
AST / Static Analysis
    ↓
Architecture
DataFlow
Feature
Business Flow
Dependency
```



### ② 理解变化

```text
Requirement
      │
      ▼
Impact Analysis
      │
      ├── affected files
      ├── affected modules
      ├── affected data flow
      ├── affected business
      └── affected tests
```

或者：

```text
Git Diff
   ↓
Impact Analysis
   ↓
Actual Impact
```



### ③ 验证变化

```text
Business Knowledge
        +
Impact Knowledge
        ↓
Test Planning
        ↓
Test Case
        ↓
E2E
        ↓
Execution
```



### ④ 分析失败

```text
Test Failure
      ↓
Failure Analysis
      ↓
Root Cause
      ↓
Code Correlation
      ↓
Fix Suggestion
      ↓
Regression Test
```

---



# 2. AAFE Agent Platform 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                     AAFE Agent Platform                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 Planner / Router Agent                 │  │
│  │                                                        │  │
│  │ Task Understanding                                    │  │
│  │ Goal Decomposition                                    │  │
│  │ Agent Selection                                       │  │
│  │ Dynamic Planning                                      │  │
│  │ Re-planning                                           │  │
│  │ Completion Decision                                   │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  Agent Orchestrator                    │  │
│  │                                                        │  │
│  │ Execution Graph                                        │  │
│  │ State Management                                       │  │
│  │ Agent Scheduling                                       │  │
│  │ Retry / Timeout                                        │  │
│  │ Parallel Execution                                     │  │
│  │ Permission / Cost Policy                               │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│       ┌──────────────────┼────────────────────────┐          │
│       │                  │                        │          │
│       ▼                  ▼                        ▼          │
│ ┌────────────┐    ┌────────────┐          ┌────────────┐   │
│ │ Code Agent │    │Impact Agent│          │ Test Agent │   │
│ └────────────┘    └────────────┘          └────────────┘   │
│       │                  │                        │          │
│       │                  │                        ▼          │
│       │                  │                ┌────────────┐   │
│       │                  └───────────────►│  Failure   │   │
│       │                                   │   Agent    │   │
│       │                                   └────────────┘   │
│       │                                          │         │
│       └──────────────────────┬───────────────────┘         │
│                              ▼                             │
│                  ┌────────────────────────┐               │
│                  │ Knowledge Store         │               │
│                  │                        │               │
│                  │ Static Facts           │               │
│                  │ Semantic Knowledge      │               │
│                  │ Prediction Knowledge    │               │
│                  │ Test Knowledge          │               │
│                  │ Failure Knowledge       │               │
│                  └────────────────────────┘               │
│                              │                             │
│                              ▼                             │
│                  ┌────────────────────────┐               │
│                  │ Tool Runtime            │               │
│                  │ AST / Git / FS / E2E   │               │
│                  └────────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---



# 3. 最核心的架构原则

必须严格区分以下几个概念：

```text
Planner Agent
    ↓
决定“应该做什么”

Orchestrator
    ↓
负责“如何可靠执行”

Specialized Agent
    ↓
负责“具体领域怎么做”

Tool
    ↓
负责“实际能力”

Knowledge
    ↓
负责“项目已经知道什么”

IDE Agent
    ↓
负责“真正修改代码 / 实现功能”
```

不能把这些全部塞进一个 Agent。

---



# 4. Planner / Router Agent

Planner 是 AAFE 的“大脑”。

但是它**不能直接操作文件、Shell、Git、Playwright**。

它只能做决策。

---



## 4.1 Planner 输入

```typescript
interface PlannerContext {
  task: Task

  project: ProjectContext

  knowledge: KnowledgeSnapshot

  executionState: ExecutionState

  history: ExecutionHistory

  availableAgents: AgentCapability[]

  constraints: ExecutionConstraints
}
```

---



## 4.2 Planner 输出

例如：

```typescript
interface PlannerDecision {
  action:
    | 'invoke_agent'
    | 'parallel'
    | 'replan'
    | 'complete'
    | 'need_user_input'
    | 'fail'

  agent?: string

  input?: unknown

  reason: string

  expectedOutput?: string[]

  confidence?: number
}
```

例如：

```json
{
  "action": "invoke_agent",
  "agent": "impact-analyzer",
  "reason": "当前需求需要先确定影响模块及数据流",
  "expectedOutput": [
    "affectedFiles",
    "affectedModules",
    "affectedDataFlows"
  ]
}
```

---



# 5. Planner 必须是循环，而不是一次性生成 Workflow

正确方式：

```text
Task
 ↓
Planner
 ↓
Decision
 ↓
Orchestrator
 ↓
Agent
 ↓
Result
 ↓
Knowledge Update
 ↓
State Update
 ↓
Planner
 ↓
Decision
 ↓
...
```

即：

```text
Observe
 ↓
Plan
 ↓
Act
 ↓
Observe
 ↓
Re-plan
 ↓
Act
 ↓
...
```

这样才能支持：

- Agent 交叉调用
- Agent 重复调用
- 条件分支
- Agent 回退
- Agent 并行
- 局部 Agent
- 中途停止
- 根据结果追加分析

---



# 6. Agent Orchestrator

Orchestrator 不负责“思考”。

它负责执行 Planner 的决定。

核心：

```typescript
interface AgentOrchestrator {
  execute(task: Task): Promise<TaskResult>

  invoke(agent: string, input: unknown): Promise<AgentResult>

  parallel(tasks: AgentTask[]): Promise<AgentResult[]>

  updateState(result: AgentResult): Promise<void>

  replan(): Promise<PlannerDecision>

  cancel(taskId: string): Promise<void>
}
```

---



# 7. Orchestrator 必须管理 Execution Graph

不要只有：

```text
currentAgent
```

而应该保存：

```typescript
interface ExecutionNode {
  id: string

  agent: string

  status:
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'skipped'

  inputRef: string

  outputRef?: string

  parent?: string

  dependencies?: string[]

  startedAt?: number

  finishedAt?: number
}
```

整个执行过程：

```text
N1 A2
│
├── N2 A1
│
└── N3 A2
      │
      └── N4 A3
            │
            └── N5 A4
```

这样才能真正记录 Agent Graph。

---



# 8. Agent Registry

所有 Agent 不应该硬编码。

建立：

```typescript
interface AgentDefinition {
  id: string

  name: string

  description: string

  endpoint: AgentEndpoint

  capabilities: string[]

  inputSchema: Schema

  outputSchema: Schema

  tools?: string[]

  constraints?: AgentConstraint[]

  execution?: AgentExecutionConfig
}
```

---



# 9. `.aafe.agents.json`

你的这个设计是正确的。

不要把 Agent 配置继续塞进：

```text
.aafe.config.json
```

应该独立：

```text
.aafe/
├── config.json
├── agents.json
├── knowledge/
├── cache/
└── runs/
```

或者保持你要求的：

```text
.aafe.config.json
.aafe.agents.json
```

我更推荐后者作为第一阶段，简单明确。

---



# 10. `.aafe.agents.json` 推荐结构

```json
{
  "version": 1,

  "planner": {
    "provider": "openai",
    "endpoint": "http://localhost:3001/agent/planner",
    "model": "xxx"
  },

  "agents": {
    "code-intelligence": {
      "enabled": true,
      "endpoint": "http://localhost:3001/agent/code-intelligence",
      "capabilities": [
        "architecture-analysis",
        "data-flow-analysis",
        "feature-analysis",
        "business-analysis"
      ]
    },

    "impact-analyzer": {
      "enabled": true,
      "endpoint": "http://localhost:3002/agent/impact",
      "capabilities": [
        "change-impact",
        "requirement-impact",
        "change-scope-prediction",
        "risk-analysis"
      ]
    },

    "test-agent": {
      "enabled": true,
      "endpoint": "http://localhost:3003/agent/test",
      "capabilities": [
        "test-planning",
        "test-generation",
        "e2e-execution"
      ]
    },

    "failure-analyzer": {
      "enabled": true,
      "endpoint": "http://localhost:3004/agent/failure",
      "capabilities": [
        "failure-analysis",
        "root-cause-analysis",
        "fix-analysis",
        "regression-analysis"
      ]
    }
  }
}
```

---



# 11. 为什么配置 Capability，而不是只配置 Agent 名称？

因为 Planner 不应该知道：

```text
“用户列表需求应该调用 Agent2”
```

它应该知道：

```text
需要：

requirement-impact
```

然后：

```text
Capability Registry
        ↓
impact-analyzer
```

这样未来：

```text
impact-analyzer-v2
```

可以直接替换。

---



# 12. Agent 1：Code Intelligence Agent

这个 Agent 是知识生产核心。

建议能力：

```text
code-intelligence
├── project-analysis
├── architecture-analysis
├── dependency-analysis
├── data-flow-analysis
├── feature-analysis
├── business-flow-analysis
└── business-rule-analysis
```

输入：

```text
AST
+
Static Facts
+
Source Code
+
Existing Knowledge
```

输出：

```text
Architecture Knowledge
DataFlow Knowledge
Feature Knowledge
Business Knowledge
Dependency Knowledge
```

---



# 13. Agent 1 不应该自己做 AST

架构应该：

```text
Source
 ↓
AST Parser
 ↓
Static Analyzer
 ↓
Normalized Facts
 ↓
Code Intelligence Agent
```

Agent 负责：

> 语义理解。

Static Analyzer 负责：

> 事实提取。

这样可以显著降低 LLM 幻觉。

---



# 14. Agent 2：Impact Analyzer

支持两个入口：

### Requirement → Impact

```text
Requirement
 ↓
Feature Knowledge
 ↓
Architecture
 ↓
DataFlow
 ↓
Code
 ↓
Prediction
```



### Diff → Impact

```text
Git Diff
 ↓
Static Facts
 ↓
Dependency
 ↓
DataFlow
 ↓
Feature
 ↓
Impact
```

输出：

```typescript
interface ImpactReport {
  affectedFiles: ImpactItem[]
  affectedModules: ImpactItem[]
  affectedFeatures: ImpactItem[]
  affectedDataFlows: ImpactItem[]
  affectedBusinessFlows: ImpactItem[]

  affectedTests: string[]

  risk: RiskLevel

  confidence: number
}
```

---



# 15. Agent 3：Test Agent

建议拆内部能力：

```text
Test Agent
├── Test Planner
├── Test Case Generator
├── Test Code Generator
└── Test Executor
```

但从 AAFE Platform 看，它仍然可以注册成一个：

```text
test-agent
```

内部再自行编排。

输入：

```text
Feature
+
Business Flow
+
Data Flow
+
Impact
+
Requirement
```

输出：

```text
Test Plan
Test Case
Test Code
Test Result
```

---



# 16. Agent 4：Failure Analyzer

输入：

```text
Test Result
+
Trace
+
Screenshot
+
Console
+
Network
+
Git Diff
+
Project Knowledge
```

输出：

```text
Failure Classification
Root Cause
Related Files
Related DataFlow
Risk
Fix Suggestion
Regression Test
```

---



# 17. 还需要其他 Agent 吗？

需要。

但不建议一开始继续增加很多“业务 Agent”。

真正应该补充的是两个基础能力 Agent。

---



# 18. Agent 5：Knowledge Validator Agent

非常建议增加。

原因是：

```text
Agent 1
 ↓
Knowledge
```

如果知识错误：

```text
Agent 2 错
 ↓
Agent 3 错
 ↓
Agent 4 错
```

整个链路都会被污染。

所以：

```text
Code Intelligence
        ↓
Knowledge Validator
        ↓
Knowledge Store
```

Validator 检查：

```text
文件是否存在
Symbol 是否存在
依赖是否真实
DataFlow 是否可追踪
Feature 是否有代码证据
Business Flow 是否有证据
```

它可以大量使用确定性规则，不需要完全依赖 LLM。

---



# 19. Agent 6：Evidence / Context Agent

第二个推荐 Agent。

职责不是“分析”，而是：

> 为其他 Agent 准备最小、精准、可追溯的上下文。

例如 Agent 2 需要：

```text
UserList
```

Context Agent 不应该把整个项目塞过去。

而应该：

```text
UserList
 ↓
相关 Component
 ↓
相关 Store
 ↓
相关 Service
 ↓
相关 API
 ↓
相关 DataFlow
 ↓
相关 Test
```

形成：

```typescript
interface AgentContextPackage {
  task: unknown

  facts: StaticFact[]

  knowledge: KnowledgeItem[]

  codeSnippets: CodeSnippet[]

  relations: Relation[]

  evidence: Evidence[]

  tokenEstimate: number
}
```

这是解决 Agent Token 爆炸的关键。

---



# 20. 因此最终 Agent Matrix


| Agent               | 职责          | 推荐         |
| ------------------- | ----------- | ---------- |
| Planner/Router      | 动态规划        | 必须         |
| Code Intelligence   | 项目理解        | 必须         |
| Impact Analyzer     | 影响分析        | 必须         |
| Test Agent          | 测试设计/执行     | 必须         |
| Failure Analyzer    | 失败分析        | 必须         |
| Knowledge Validator | 知识验证        | **必须**     |
| Context/Evidence    | 上下文裁剪       | **强烈建议**   |
| Developer Agent     | 代码实现        | 不放进核心 AAFE |
| Review Agent        | Code Review | 后续         |
| Security Agent      | 安全分析        | 后续         |
| Performance Agent   | 性能分析        | 后续         |


---



# 21. 为什么 Developer Agent 不应该成为 AAFE 固定 Agent？

这是整个设计里另一个重要决策。

你提出：

> 代码修复、功能实现等环节，用户可以使用内置通用 Agent，也可以使用当前 IDE Agent。

我建议**严格这样设计**。

AAFE 不负责成为“代码开发 IDE”。

AAFE 负责：

```text
理解
分析
预测
验证
测试
诊断
```

而：

```text
实现代码
修改代码
重构
修复
```

交给：

```text
Built-in Developer Agent
        OR
Current IDE Agent
```

---



# 22. Developer Agent Provider

设计：

```text
Developer Provider
│
├── builtin
├── cursor
├── claude-code
├── codex
├── vscode-agent
└── custom
```

例如：

```json
{
  "developer": {
    "provider": "ide",
    "mode": "current"
  }
}
```

或者：

```json
{
  "developer": {
    "provider": "builtin",
    "endpoint": "http://localhost:4000/agent/developer"
  }
}
```

---



# 23. AAFE 与 IDE Agent 的关系

不要让 IDE Agent 直接理解 AAFE 的所有内部状态。

应该：

```text
AAFE
 ↓
Context Builder
 ↓
Minimal Context
 ↓
IDE Agent
```

例如：

```text
AAFE Analysis

Feature:
用户列表手机号搜索

Affected Files:
UserList.vue
UserFilter.vue
user.ts

Data Flow:
UserList
 → UserFilter
 → UserService
 → /api/users

Risk:
Medium

Recommended Changes:
1. UserFilter 增加 phone 参数
2. UserService 支持 phone
3. UserList 触发查询

Relevant Tests:
user-list-search.spec.ts
```

然后交给 IDE Agent。

而不是把：

```text
几十 MB AST
几千条 Knowledge
所有源码
```

全部塞给 IDE Agent。

---



# 24. AAFE CLI 成为 Agent Bridge

这一层非常重要。

最终：

```text
IDE Agent
   │
   │ CLI
   ▼
AAFE
   │
   ▼
Planner
   │
   ▼
Agents
   │
   ▼
Knowledge
```

例如：

```bash
npx aafe context \
  --task "implement phone search" \
  --format ai
```

输出：

```text
Task Context
============

Requirement:
...

Impact:
...

Affected Files:
...

Architecture:
...

Data Flow:
...

Business Rules:
...

Tests:
...

Constraints:
...
```

IDE Agent 只需要读取这个结果。

---



# 25. CLI 应该提供一套 AI Bridge 命令

建议：

```bash
npx aafe analyze
```

项目分析。

```bash
npx aafe impact
```

影响分析。

```bash
npx aafe context
```

给 IDE Agent 提供上下文。

```bash
npx aafe test
```

测试。

```bash
npx aafe diagnose
```

失败诊断。

```bash
npx aafe plan
```

开发计划。

```bash
npx aafe run
```

运行 Planner + Orchestrator。

---



# 26. 最重要的是增加 `aafe context`

这个命令实际上是 AAFE 与 Cursor / Claude Code / Codex 等 IDE Agent 的核心桥梁。

例如：

```bash
npx aafe context \
  --requirement "增加用户手机号搜索"
```

内部：

```text
Planner
 ↓
Impact Agent
 ↓
Context Agent
 ↓
Knowledge
 ↓
Context Package
```

输出：

```json
{
  "task": "...",

  "architecture": {},

  "affectedFiles": [],

  "dataFlows": [],

  "businessFlows": [],

  "constraints": [],

  "tests": [],

  "evidence": []
}
```

IDE Agent 拿这个上下文执行开发。

---



# 27. 开发实现后的闭环

假设 IDE Agent 修改了代码。

```text
IDE Agent
   ↓
修改代码
   ↓
Git Diff
   ↓
npx aafe impact --diff
   ↓
Impact Agent
   ↓
重新分析
   ↓
npx aafe test
   ↓
Test Agent
   ↓
E2E
```

如果失败：

```text
Test
 ↓
Failure Agent
 ↓
Root Cause
 ↓
npx aafe context --failure
 ↓
IDE Agent
 ↓
Fix
 ↓
Test
```

直到：

```text
PASS
```

---



# 28. 完整的 AI Development Loop

最终可以形成：

```text
                    ┌──────────────┐
                    │ Requirement  │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    Planner   │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │ Impact Agent │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │   Context    │
                    │    Agent     │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  IDE Agent   │
                    │ / Developer  │
                    └──────┬───────┘
                           ▼
                       Git Diff
                           │
                           ▼
                    ┌──────────────┐
                    │ Impact Agent │
                    │ Re-Analysis  │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  Test Agent  │
                    └──────┬───────┘
                           ▼
                        E2E Test
                           │
                 ┌─────────┴─────────┐
                 │                   │
                PASS                FAIL
                 │                   │
                 ▼                   ▼
              Complete        Failure Agent
                                     │
                                     ▼
                               Root Cause
                                     │
                                     ▼
                               Context Agent
                                     │
                                     ▼
                                 IDE Agent
                                     │
                                     ▼
                                   Fix
                                     │
                                     └──────→ Test
```

---



# 29. AAFE Platform 最终模块划分

建议最终目录直接按照下面组织：

```text
aafe/
│
├── packages/
│
│   ├── cli/
│   │   ├── analyze
│   │   ├── impact
│   │   ├── context
│   │   ├── test
│   │   ├── diagnose
│   │   ├── plan
│   │   └── run
│   │
│   ├── agent-platform/
│   │   │
│   │   ├── planner/
│   │   │
│   │   ├── orchestrator/
│   │   │
│   │   ├── registry/
│   │   │
│   │   ├── runtime/
│   │   │
│   │   ├── scheduler/
│   │   │
│   │   ├── state/
│   │   │
│   │   └── policy/
│   │
│   ├── agents/
│   │   │
│   │   ├── code-intelligence/
│   │   ├── impact-analyzer/
│   │   ├── test-agent/
│   │   ├── failure-analyzer/
│   │   ├── knowledge-validator/
│   │   └── context-agent/
│   │
│   ├── knowledge/
│   │   ├── model/
│   │   ├── store/
│   │   ├── graph/
│   │   ├── index/
│   │   └── validator/
│   │
│   ├── static-analysis/
│   │   ├── ast/
│   │   ├── dependency/
│   │   ├── symbol/
│   │   └── git/
│   │
│   ├── testing/
│   │   ├── playwright/
│   │   ├── executor/
│   │   └── artifacts/
│   │
│   └── ide-bridge/
│       ├── context/
│       ├── builtin/
│       └── adapters/
│
├── .aafe.config.json
└── .aafe.agents.json
```

---



# 30. `.aafe.config.json` 与 `.aafe.agents.json` 职责严格分离



### `.aafe.config.json`

只负责：

```json
{
  "version": 1,

  "project": {},

  "analysis": {},

  "knowledge": {},

  "testing": {},

  "runtime": {},

  "ide": {}
}
```



### `.aafe.agents.json`

只负责：

```json
{
  "version": 1,

  "planner": {},

  "agents": {},

  "developer": {},

  "policies": {}
}
```

这样以后 Agent 增加到 20 个，也不会污染主配置。

---



# 31. Agent 调用方式也应该抽象

不要在代码里写：

```typescript
fetch('http://localhost:3001/agent/xxx')
```

统一：

```typescript
interface AgentProvider {
  invoke(
    definition: AgentDefinition,
    context: AgentContext
  ): Promise<AgentResult>
}
```

然后：

```text
HTTP Agent
Local Agent
MCP Agent
CLI Agent
IDE Agent
Builtin Agent
```

都可以成为 Provider。

---



# 32. Agent 调用协议

建议所有 Agent 统一：

```typescript
interface AgentRequest {
  taskId: string

  runId: string

  agentId: string

  goal: string

  input: unknown

  context: AgentContext

  constraints: ExecutionConstraints
}
```

统一返回：

```typescript
interface AgentResponse {
  status: 'success' | 'failed' | 'partial'

  result: unknown

  knowledgeUpdates?: KnowledgeUpdate[]

  evidence?: Evidence[]

  nextActions?: SuggestedAction[]

  metrics?: {
    tokens?: number
    duration?: number
    cost?: number
  }
}
```

---



# 33. Agent 可以建议下一步，但不能直接决定

例如 Agent 4：

```json
{
  "status": "success",
  "result": {
    "rootCause": "UserService 参数错误"
  },
  "nextActions": [
    {
      "capability": "change-impact",
      "reason": "修复后需要重新评估影响范围"
    }
  ]
}
```

然后：

```text
Agent 4
 ↓
Suggested Action
 ↓
Planner
 ↓
是否执行
```

最终决策权永远在 Planner。

---



# 34. Planner 也需要安全边界

Planner 可以：

```text
调用 Agent
停止任务
重新规划
并行任务
请求上下文
```

Planner 不应该默认：

```text
rm
git reset
git push
修改生产环境
```

代码修改能力必须由 Developer Provider / IDE Agent 控制。

---



# 35. 多 Agent 并行

Planner 可以输出：

```json
{
  "action": "parallel",
  "tasks": [
    {
      "agent": "architecture-analyzer"
    },
    {
      "agent": "dependency-analyzer"
    },
    {
      "agent": "feature-analyzer"
    }
  ]
}
```

Orchestrator：

```text
        Planner
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
    A1    A1    A1
     │     │     │
     └─────┼─────┘
           ▼
       Merge Result
```

然后再：

```text
Planner
```

重新决策。

---



# 36. 最终 AAFE Agent Platform 的核心数据流

```text
                    Task
                     │
                     ▼
              Planner Agent
                     │
                     ▼
              Execution Plan
                     │
                     ▼
             Agent Orchestrator
                     │
                     ▼
              Agent Runtime
                     │
                     ▼
                Specialized
                   Agent
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Result     Evidence    Knowledge
          │          │          │
          └──────────┼──────────┘
                     ▼
                 State Store
                     │
                     ▼
                  Planner
                     │
                  ┌──┴──┐
                  ▼     ▼
               Continue Complete
```

---



# 37. 最终推荐的 Agent 清单

第一期建议直接定义这 **7 个逻辑 Agent**：

```text
A0 Planner / Router
│
├── A1 Code Intelligence
│
├── A2 Impact Analyzer
│
├── A3 Test Agent
│
├── A4 Failure Analyzer
│
├── A5 Knowledge Validator
│
└── A6 Context / Evidence Agent
```

其中：

```text
A0 = 大脑
A1 = 项目理解
A2 = 变化理解
A3 = 验证
A4 = 故障诊断
A5 = 知识质量
A6 = 上下文供应
```

而：

```text
Developer Agent
```

**不作为固定核心 Agent**，采用：

```text
Developer Provider
├── builtin
└── current-ide
```

---



# 38. 最终形成三层 Agent 架构

这是整个方案最重要的抽象。

```text
┌───────────────────────────────────────────┐
│              Decision Layer               │
│                                           │
│          Planner / Router Agent           │
│                                           │
│       “下一步应该做什么？”                │
└─────────────────────┬─────────────────────┘
                      │
┌─────────────────────▼─────────────────────┐
│              Execution Layer              │
│                                           │
│             Agent Orchestrator            │
│                                           │
│      “如何可靠地执行这个决定？”            │
└─────────────────────┬─────────────────────┘
                      │
┌─────────────────────▼─────────────────────┐
│             Capability Layer              │
│                                           │
│ Code / Impact / Test / Failure / Context │
│ Validator / Developer / ...              │
│                                           │
│         “具体事情应该怎么做？”             │
└───────────────────────────────────────────┘
```

再下面：

```text
Knowledge Layer
Tool Layer
IDE Layer
```

共同提供底层能力。

---



# 39. 最终的 AAFE 定位

因此，AAFE 最终不应该只是：

```text
npx aafe analyze
```

而应该逐渐成为：

```text
                    AAFE
                     │
       ┌─────────────┼──────────────┐
       │             │              │
   Understand      Predict       Verify
       │             │              │
       ▼             ▼              ▼
    Analyze        Impact          Test
       │             │              │
       └─────────────┼──────────────┘
                     ▼
                  Diagnose
                     │
                     ▼
                  Context
                     │
                     ▼
                 IDE Agent
                     │
                     ▼
                  Develop
                     │
                     ▼
                  Validate
                     │
                     └───────────────┐
                                     ▼
                                  Knowledge
```

即：

> **AAFE 不负责替代 IDE Agent 写所有代码，而负责成为 IDE Agent 背后的“项目认知、影响分析、测试验证和问题诊断基础设施”。**

这样设计以后，Cursor、Claude Code、Codex、VS Code Agent，甚至未来其他 IDE Agent，都只是 AAFE 的 **Developer Consumer**。

而 AAFE 自己掌握的是最核心的：

**Project Knowledge + Agent Orchestration + Impact Intelligence + Testing Intelligence。**

这也是这套架构最值得长期投入的地方。