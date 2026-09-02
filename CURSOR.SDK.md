可以。基于你前面已经设计的 **AAFE = Analyze → Knowledge → Plan/Router → Agent → Verify → Memory/SKILL** 体系，我建议不要把 Cursor API 简单封装成一个“LLM Provider”，而是把它设计成 **AAFE 的 Coding Agent Runtime**。

目前 Cursor 已经提供比较完整的 Cloud Agents API、Python/TypeScript SDK，以及 SDK Bridge。Cloud Agents API 可以程序化创建和管理运行在代码仓库上的 Agent；SDK 则可以统一调用 local/cloud runtime。([Cursor Documentation][1])

---

# 一、最终目标

你要做的实际上是：

```text
                    AAFE Agent Platform
                           │
                           ▼
                  ┌──────────────────┐
                  │   AAFE Gateway   │
                  │ Agent API Server │
                  └────────┬─────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
        Analyze Agent   Planner       Verify Agent
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                  ┌─────────────────┐
                  │ Cursor Runtime  │
                  │   Adapter       │
                  └────────┬────────┘
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
       Cursor Cloud     Cursor Local    Cursor CLI
        Agent API          SDK          / ACP
             │             │              │
             ▼             ▼              ▼
          Repository / Workspace / Git / Test
```

核心原则：

> **AAFE 负责“决定做什么”，Cursor Agent 负责“把事情做出来”。**

不要让 Cursor Agent 反过来承担 AAFE 的整个规划体系。

---

# 二、AAFE 与 Cursor 的职责边界

这是整个设计里最重要的一层。

## AAFE

负责：

```text
用户需求
   ↓
任务识别
   ↓
Skills 命中
   ↓
Rules 命中
   ↓
项目知识
   ↓
架构分析
   ↓
数据流分析
   ↓
业务功能分析
   ↓
Change Impact
   ↓
Task Plan
   ↓
Cursor Agent
```

也就是说 AAFE 是：

**Orchestrator / Planner / Knowledge Engine**

---

## Cursor

负责：

```text
读取代码
↓
理解代码
↓
修改代码
↓
运行命令
↓
修复错误
↓
执行测试
↓
输出结果
```

Cursor Agent 本身已经具备代码搜索、文件读取、编辑、Terminal、Web、MCP 等工具能力。([Cursor][2])

因此不要重复实现这些能力。

---

# 三、建议设计成 4 层

最终 AAFE Agent 可以拆成：

```text
┌───────────────────────────────────────┐
│             AAFE Agent API            │
│                                       │
│ POST /agents                          │
│ POST /runs                            │
│ GET  /runs/:id                        │
│ POST /runs/:id/cancel                 │
│ GET  /runs/:id/events                 │
└───────────────────┬───────────────────┘
                    │
┌───────────────────▼───────────────────┐
│           AAFE Orchestrator           │
│                                       │
│ Intent Router                         │
│ Skill Router                          │
│ Knowledge Router                      │
│ Planner                               │
│ Agent Scheduler                       │
│ Verify Scheduler                      │
└───────────────────┬───────────────────┘
                    │
┌───────────────────▼───────────────────┐
│             Agent Runtime             │
│                                       │
│ Analyze Agent                         │
│ Change Impact Agent                   │
│ Coding Agent                          │
│ Test Agent                            │
│ Review Agent                          │
│ Verify Agent                          │
└───────────────────┬───────────────────┘
                    │
┌───────────────────▼───────────────────┐
│            Cursor Adapter             │
│                                       │
│ Cursor Cloud API                      │
│ Cursor SDK                            │
│ Cursor CLI                            │
│ ACP / SDK Bridge                      │
└───────────────────────────────────────┘
```

---

# 四、Cursor Adapter 不要直接耦合业务

建议单独建立：

```text
packages/
├── aafe-core/
├── aafe-analyzer/
├── aafe-skills/
├── aafe-memory/
├── aafe-planner/
├── aafe-agent/
└── aafe-cursor/
```

其中：

```text
aafe-cursor/
├── src/
│   ├── client/
│   │   ├── cursor-cloud.ts
│   │   ├── cursor-sdk.ts
│   │   └── cursor-cli.ts
│   │
│   ├── runtime/
│   │   ├── cursor-runtime.ts
│   │   ├── local-runtime.ts
│   │   └── cloud-runtime.ts
│   │
│   ├── agent/
│   │   ├── create-agent.ts
│   │   ├── send-prompt.ts
│   │   ├── stream-events.ts
│   │   └── cancel-agent.ts
│   │
│   └── types/
│       └── cursor.ts
│
└── package.json
```

AAFE 上层只依赖：

```ts
interface CodingAgentRuntime {
  create(input: CreateAgentInput): Promise<Agent>;
  run(input: RunAgentInput): Promise<AgentRun>;
  stream(runId: string): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}
```

这样以后即使不用 Cursor，也可以换：

```text
Cursor
Claude Code
Codex
OpenCode
其他 Coding Agent
```

而 AAFE 不需要修改。

---

# 五、推荐优先使用 Cursor SDK，而不是自己封装 HTTP

目前 Cursor 的能力已经分成几种方式：

| 方案                      | 定位           | AAFE  |
| ----------------------- | ------------ | ----- |
| Cursor Cloud Agents API | HTTP 云 Agent | ⭐⭐⭐⭐⭐ |
| Cursor TypeScript SDK   | TS/JS 集成     | ⭐⭐⭐⭐⭐ |
| Cursor Python SDK       | Python       | ⭐⭐⭐⭐  |
| Cursor CLI              | 本地/CI        | ⭐⭐⭐⭐  |
| SDK Bridge              | 非 TS/Python  | ⭐⭐⭐   |

官方现在明确提供 TypeScript/Python SDK，并且 SDK 可以统一 local/cloud runtime。([Cursor][3])

如果 AAFE 本身是 Node/TypeScript：

> **第一选择：`@cursor/sdk`**

而不是：

```text
AAFE
 ↓
自己 axios
 ↓
Cursor REST API
```

---

# 六、为什么我更推荐 SDK

因为你未来需要的不是简单：

```ts
await cursor.chat(prompt)
```

而是：

```text
Agent
 ├── create
 ├── run
 ├── send
 ├── stream
 ├── cancel
 ├── status
 ├── events
 └── repository
```

Cursor 新的 Cloud Agents API 已经采用：

```text
Agent
  +
Run
```

这种长期 Agent + 多次 Run 的模型。([Cursor][4])

这非常适合 AAFE。

---

# 七、AAFE Agent 应该采用 Agent Session

例如：

```text
AAFE Task
   │
   ▼
Agent Session
   │
   ├── Analyze Run
   │
   ├── Plan Run
   │
   ├── Coding Run
   │
   ├── Test Run
   │
   ├── Fix Run
   │
   └── Review Run
```

而不是每一次都：

```text
创建 Cursor Agent
执行
销毁
```

应该：

```text
AAFE Task
    ↓
Create Cursor Agent
    ↓
Run #1
    ↓
Run #2
    ↓
Run #3
    ↓
Run #4
```

这样可以保留 Agent 的连续上下文。

---

# 八、AAFE 的核心执行流程

建议最终：

```text
User
 │
 ▼
AAFE API
 │
 ▼
Intent Analyzer
 │
 ├── coding
 ├── analysis
 ├── bug
 ├── refactor
 ├── test
 └── review
 │
 ▼
Skill Router
 │
 ▼
Knowledge Resolver
 │
 ▼
Impact Analyzer
 │
 ▼
Planner
 │
 ▼
Execution Plan
 │
 ▼
Cursor Agent
 │
 ├── Search
 ├── Read
 ├── Edit
 ├── Terminal
 └── Test
 │
 ▼
Verify Agent
 │
 ├── Static verification
 ├── Test verification
 ├── Diff verification
 └── Architecture verification
 │
 ▼
Memory
 │
 ▼
Result
```

---

# 九、Execution Plan 必须结构化

这是 AAFE 与普通 Cursor Agent 最大的区别。

例如：

```json
{
  "taskId": "TASK-001",
  "intent": "feature",
  "objective": "优化头像切换性能",
  "scope": {
    "include": [
      "src/avatar/**"
    ],
    "exclude": [
      "node_modules/**"
    ]
  },
  "skills": [
    "frontend-performance",
    "react-performance",
    "image-rendering"
  ],
  "rules": [
    "avoid-unnecessary-render",
    "preload-assets"
  ],
  "knowledge": [
    "avatar-editor-architecture",
    "image-switch-flow"
  ],
  "impact": {
    "files": [
      "src/avatar/AvatarEditor.tsx",
      "src/avatar/ImageLayer.tsx"
    ]
  },
  "steps": [
    {
      "id": "step-1",
      "type": "analyze",
      "description": "分析图片切换流程"
    },
    {
      "id": "step-2",
      "type": "implement",
      "description": "实现图片预加载"
    },
    {
      "id": "step-3",
      "type": "test",
      "description": "执行相关测试"
    }
  ]
}
```

然后才生成 Cursor Prompt。

---

# 十、不要直接把所有 Knowledge 塞给 Cursor

这一点非常重要。

不要：

```text
AAFE Knowledge
    ↓
全部拼接
    ↓
Cursor Prompt
```

应该：

```text
Task
 ↓
Knowledge Router
 ↓
Relevant Knowledge
 ↓
Context Builder
 ↓
Cursor Prompt
```

例如：

```text
用户：
优化头像切换闪烁问题

命中：

SKILL
├── react-performance
├── image-rendering
└── async-resource

RULE
├── no-unnecessary-render
└── preload-before-switch

MEMORY
└── AvatarEditor 当前图片架构
```

只把这些发送给 Cursor。

---

# 十一、Cursor Prompt 应该由 AAFE 生成

例如：

```text
You are the implementation agent of AAFE.

## Task

Optimize avatar asset switching to eliminate visible flicker
and reduce frame drops.

## Project Knowledge

[Architecture]
...

[Data Flow]
...

[Impact Analysis]
...

## Required Skills

...

## Rules

...

## Implementation Constraints

1. Do not change public APIs.
2. Do not rewrite unrelated components.
3. Preserve existing behavior.
4. Prefer minimal changes.
5. Add tests where appropriate.

## Execution

1. Inspect the identified files.
2. Validate the existing implementation.
3. Implement the optimization.
4. Run relevant tests.
5. Fix failures.
6. Report changed files and verification results.

## Completion Criteria

...
```

Cursor 只负责执行。

---

# 十二、Cursor Agent 的权限必须由 AAFE 控制

Cursor 本身支持 Agent 权限/工具控制，例如可以限制：

```text
Read
Write
Shell
MCP
Web
Git
```

官方也建议生产 CI 场景使用权限限制，而不是默认给 Agent 完全自主权。([Cursor][5])

所以 AAFE 应该再加一层：

```json
{
  "permissions": {
    "read": true,
    "write": true,
    "shell": true,
    "git": false,
    "network": false,
    "mcp": false
  }
}
```

例如：

### Analyze Agent

```json
{
  "read": true,
  "write": false,
  "shell": false
}
```

### Coding Agent

```json
{
  "read": true,
  "write": true,
  "shell": true,
  "git": false
}
```

### Release Agent

```json
{
  "read": true,
  "write": true,
  "shell": true,
  "git": true
}
```

---

# 十三、部署形态

你说的：

> 支持部署为一个 Agent，内置 Cursor API

我建议最终做成：

```text
                Internet
                   │
                   ▼
          ┌─────────────────┐
          │   AAFE Agent    │
          │                 │
          │ HTTP / WS / SSE │
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │ AAFE Orchestrator│
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │ Cursor Runtime  │
          └────────┬────────┘
                   │
             Cursor API
                   │
                   ▼
            Cursor Cloud
                   │
                   ▼
              Repository
```

比如：

```text
aafe-agent
```

直接部署：

```bash
docker run \
  -e CURSOR_API_KEY=xxx \
  -e AAFE_CONFIG=/etc/aafe/config.json \
  aafe-agent
```

然后：

```http
POST /v1/tasks
```

提交：

```json
{
  "repository": "owner/repo",
  "branch": "feature/avatar",
  "task": "优化头像切换闪烁问题"
}
```

---

# 十四、API 层建议

第一版只需要：

```text
POST   /v1/tasks
GET    /v1/tasks/:id
POST   /v1/tasks/:id/cancel
GET    /v1/tasks/:id/events
POST   /v1/tasks/:id/message
```

其中：

```text
POST /v1/tasks
```

返回：

```json
{
  "taskId": "task_xxx",
  "agentId": "agent_xxx",
  "runId": "run_xxx",
  "status": "queued"
}
```

事件：

```text
task.created
task.analyzing
skill.matched
knowledge.loaded
plan.created
agent.started
agent.tool_call
agent.file_changed
agent.test_started
agent.test_failed
agent.fixing
agent.completed
verification.started
verification.completed
task.completed
```

---

# 十五、AAFE Agent 内部状态机

建议明确设计：

```text
CREATED
   ↓
ANALYZING
   ↓
PLANNING
   ↓
READY
   ↓
EXECUTING
   ↓
VERIFYING
   ↓
       ┌───────────────┐
       │               │
       ▼               │
    FAILED ────────────┘
       │
       ▼
    FIXING
       │
       ▼
   VERIFYING
       │
       ▼
   COMPLETED
```

这样以后做 Web UI 非常容易。

---

# 十六、AAFE Memory / Skill 体系继续保留

你之前设计的：

```text
SKILL
Memory
Rule
Hit Count
Last Used
```

可以直接接入。

例如：

```json
{
  "skill": "frontend-performance",
  "hitCount": 182,
  "lastHitAt": "2026-09-01T20:10:00Z"
}
```

而这个计数：

> **不要交给 Cursor / LLM。**

依然由 AAFE Runtime 本地代码：

```ts
skillRegistry.hit(skillId)
memoryRegistry.hit(memoryId)
```

完成。

这样可以继续实现你之前要求的：

```text
命中
 ↓
counter++
 ↓
lastHitAt
 ↓
ranking
 ↓
Skill lifecycle
```

---

# 十七、建议增加 Cursor Agent Profile

这是整个系统最终非常关键的配置。

例如：

```text
.aafe/
├── config.json
├── agents/
│   ├── analyze.json
│   ├── coding.json
│   ├── testing.json
│   ├── review.json
│   └── architect.json
│
├── skills/
├── rules/
├── memory/
└── knowledge/
```

---

## coding.json

```json
{
  "id": "coding-agent",
  "runtime": "cursor",
  "mode": "cloud",
  "permissions": {
    "read": true,
    "write": true,
    "shell": true,
    "git": false
  },
  "skills": [
    "frontend-development",
    "typescript",
    "architecture"
  ],
  "verification": {
    "required": true,
    "test": true,
    "diff": true
  }
}
```

---

# 十八、不同 Agent 最终可以统一成这种 Schema

```ts
interface AAFEAgent {
  id: string;

  type:
    | 'analyzer'
    | 'planner'
    | 'coder'
    | 'tester'
    | 'reviewer';

  runtime: 'cursor';

  capabilities: string[];

  skills: string[];

  rules: string[];

  permissions: AgentPermissions;

  inputSchema: JSONSchema;

  outputSchema: JSONSchema;

  execute(
    context: AgentContext
  ): Promise<AgentResult>;
}
```

这样：

```text
AnalyzeAgent
ChangeImpactAgent
CodingAgent
TestAgent
ReviewAgent
```

全部统一。

---

# 十九、推荐的 Agent 分工

结合你之前 AAFE 的设计，我建议最终是：

```text
                   AAFE Router
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Analyze Agent   Change Agent   Knowledge Agent
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                  Planner Agent
                       │
                       ▼
                  Coding Agent
                  (Cursor)
                       │
                       ▼
                   Test Agent
                       │
                       ▼
                  Review Agent
                       │
                       ▼
                  Memory Agent
```

但这里有一个重要调整：

**不是每个 Agent 都必须调用 Cursor。**

例如：

```text
Analyze Agent
    ↓
AAFE Static Engine

Change Impact Agent
    ↓
AAFE AST Engine

Planner Agent
    ↓
LLM

Coding Agent
    ↓
Cursor

Test Agent
    ↓
Cursor + Test Runner

Review Agent
    ↓
Cursor / LLM
```

这样成本和 Token 都会明显降低。

---

# 二十、Cursor 只应该成为 Coding Runtime

最终：

```text
AAFE
│
├── Static Analysis
├── AST
├── Knowledge
├── Skills
├── Rules
├── Memory
├── Planner
├── Router
├── Impact Analysis
│
└── Cursor Runtime
      │
      ├── Code Search
      ├── File Read
      ├── File Edit
      ├── Terminal
      ├── Test
      └── Fix
```

这是我认为最合理的架构。

---

# 二十一、第一阶段不要实现太多

建议直接做一个：

```text
@aafe/cursor
```

然后只实现：

```text
CursorRuntime
       │
       ├── create()
       ├── run()
       ├── send()
       ├── stream()
       ├── cancel()
       └── status()
```

然后：

```text
AAFE CLI

npx aafe analyze
npx aafe plan
npx aafe run
```

其中：

```bash
npx aafe run "优化用户登录流程"
```

内部：

```text
aafe run
   ↓
Intent
   ↓
Skill
   ↓
Rule
   ↓
Knowledge
   ↓
Impact
   ↓
Plan
   ↓
Cursor Agent
   ↓
Verify
   ↓
Memory
```

---

# 二十二、最终我建议的 AAFE Cursor Architecture

```text
                           ┌──────────────┐
                           │    User      │
                           └──────┬───────┘
                                  │
                                  ▼
                       ┌────────────────────┐
                       │    AAFE Gateway    │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │   Intent Router    │
                       └─────────┬──────────┘
                                 │
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
             Skill Engine   Rule Engine   Memory Engine
                  │              │              │
                  └──────────────┼──────────────┘
                                 ▼
                       ┌────────────────────┐
                       │ Knowledge Resolver │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │  Impact Analyzer   │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │      Planner       │
                       └─────────┬──────────┘
                                 │
                         Execution Plan
                                 │
                                 ▼
                       ┌────────────────────┐
                       │  Agent Scheduler   │
                       └─────────┬──────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   Cursor Agent Runtime │
                    │                        │
                    │  Cursor SDK / Cloud    │
                    └───────────┬────────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Repository / VM     │
                     │                     │
                     │ Read / Edit / Shell │
                     │ Test / Fix          │
                     └──────────┬──────────┘
                                │
                                ▼
                       ┌────────────────────┐
                       │ Verification Agent │
                       └─────────┬──────────┘
                                 │
                          ┌──────┴──────┐
                          │             │
                       PASS            FAIL
                          │             │
                          ▼             ▼
                       Memory        Cursor Fix
                          │             │
                          └──────┬──────┘
                                 ▼
                              Result
```

**核心结论：**

> **不要做“AAFE + Cursor API Wrapper”，而应该做“AAFE Agent Runtime + Cursor Runtime Adapter”。**

这样 Cursor 只是 AAFE 的一个可插拔 Coding Runtime，而 AAFE 才是真正的 Agent Platform。

而且 Cursor 当前已经提供 Cloud Agents API、TypeScript/Python SDK，以及 CLI/ACP 等能力，这个架构可以直接建立在官方能力之上，而无需自己重新实现 Coding Agent。([Cursor][3])

如果直接进入落地阶段，下一步应该定义 **`@aafe/cursor` 的完整 TypeScript Interface + Agent Schema + `.aafe/agents/*.json` 配置规范 + `/v1/tasks` API Schema**，这样就可以直接开始编码，而不是继续停留在架构层。

[1]: https://docs.cursor.com/background-agent/api/overview?utm_source=chatgpt.com "Cursor – Overview"
[2]: https://cursor.com/docs/agent/overview?utm_source=chatgpt.com "Overview | Cursor Docs"
[3]: https://prod.cursor.com/docs/sdk/bridge?utm_source=chatgpt.com "Cursor SDK Bridge | Cursor Documentation"
[4]: https://prod.cursor.com/docs/cloud-agent/api/endpoints?utm_source=chatgpt.com "Cloud Agents API | Cursor Docs"
[5]: https://cursor.com/docs/cli/github-actions?utm_source=chatgpt.com "GitHub Actions | Cursor Docs"
