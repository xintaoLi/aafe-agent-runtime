如果按照你现在这个目标——**AAFE 独立部署 + 企微 Bot + 远程代码任务 + 多任务并发 + 严格上下文隔离**——那么 Cursor Cloud Agent 的使用方式可以非常明确。

核心不是“让 AAFE 远程调用 Cursor 写代码”，而是：

> **每一个 AAFE Task 对应一个独立的 Cursor Cloud Agent Runtime；AAFE 负责任务生命周期和上下文，Cursor Cloud Agent 负责代码执行。**

Cursor 当前的 Cloud Agents 运行在独立 VM 中，会 Clone Repository、准备开发环境，并可以构建、测试和提交代码；多个 Cloud Agent 可以并行运行，调用方断线后任务仍可继续。([Cursor][1])

---

# 1. AAFE 和 Cursor Cloud Agent 的关系

最终应该是：

```text
                    企业微信 Bot
                         │
                         ▼
                  ┌─────────────┐
                  │ AAFE Server │
                  └──────┬──────┘
                         │
                  Task Manager
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Task A          Task B          Task C
          │              │              │
          ▼              ▼              ▼
    Cursor Agent A  Cursor Agent B  Cursor Agent C
          │              │              │
        VM A           VM B           VM C
          │              │              │
       Repo A          Repo B          Repo C
```

这里有两个隔离边界：

```text
AAFE Task Isolation
        ↓
Cursor Agent Isolation
        ↓
Cloud VM Isolation
```

这正好解决你的多任务问题。

---

# 2. 最简单的使用方式

如果 AAFE 是 Node/TypeScript：

```bash
npm install @cursor/sdk
```

Cursor 官方 SDK 支持直接创建 Cloud Agent。([Cursor][2])

核心代码类似：

```ts
import { Agent } from "@cursor/sdk";

const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,

  model: {
    id: "composer-2.5"
  },

  cloud: {
    repos: [
      {
        url: "https://github.com/your-org/your-repo",
        startingRef: "main"
      }
    ],

    autoCreatePR: true
  }
});

const run = await agent.send(`
修复用户登录超时问题。

请先分析当前认证流程，
然后实现修复，
最后执行相关测试。
`);

for await (const event of run.stream()) {
  console.log(event);
}
```

Cloud Agent 会：

```text
创建 VM
 ↓
Clone Repo
 ↓
准备 Environment
 ↓
执行 Agent
 ↓
修改代码
 ↓
执行测试
 ↓
提交 Branch / PR
```

Cursor 官方 SDK 的 Cloud Runtime 就是这么设计的。([Cursor][3])

---

# 3. 但是 AAFE 不能直接这么调用

你真正的代码应该是：

```ts
const task = await taskManager.createTask(...);

const runtime = await cursorRuntime.create(task);

await runtime.execute(task.plan);
```

而不是：

```ts
const agent = await Agent.create(...);

agent.send(userMessage);
```

因为你的 AAFE 必须先经过：

```text
企微消息
 ↓
Intent
 ↓
Task Resolver
 ↓
Skill
 ↓
Rule
 ↓
Knowledge
 ↓
Impact Analysis
 ↓
Planner
 ↓
Cursor
```

---

# 4. 一个 Task 应该对应一个 Cursor Agent

例如企微收到：

```text
用户：

帮我修复登录超时问题
```

AAFE：

```text
T001
```

然后：

```text
T001
 │
 ├── repo = account-web
 ├── branch = main
 ├── task context
 ├── skills
 ├── rules
 ├── knowledge
 ├── plan
 │
 └── Cursor Agent A
```

再收到：

```text
用户：

另外检查一下首页为什么加载慢
```

创建：

```text
T002
```

变成：

```text
T001 → Cursor Agent A → VM A

T002 → Cursor Agent B → VM B
```

**绝对不要让 T002 复用 T001 的 Cursor Agent。**

---

# 5. Cursor Agent 的生命周期应该由 AAFE 管

建议：

```text
AAFE Task
   │
   ├── create Cursor Agent
   │
   ├── send initial prompt
   │
   ├── stream events
   │
   ├── wait
   │
   ├── verify
   │
   ├── follow-up
   │
   └── complete
```

Cursor Cloud Agent 当前 API 已经从旧的扁平模型调整为：

```text
Agent
 +
Run
```

也就是说，一个 durable Agent 可以有多个 Run。([Cursor][4])

因此 AAFE 可以这样映射：

```text
AAFE Task
    │
    ▼
Cursor Agent
    │
    ├── Run 1：Implementation
    ├── Run 2：Fix test
    ├── Run 3：Review
    └── Run 4：Final verification
```

这比每次重新创建 Agent 更适合连续任务。

---

# 6. 但这里有一个非常重要的上下文策略

虽然 Cursor Agent 支持多次 Run：

```text
Agent
 ├── Run 1
 ├── Run 2
 └── Run 3
```

**AAFE 也不能把所有企微消息都直接发送给这个 Agent。**

应该由 AAFE 决定：

```text
WeCom Conversation
       │
       ▼
Task Resolver
       │
       ├── 属于 T001？
       │
       ├── 属于 T002？
       │
       └── 创建新 Task？
```

例如：

```text
T001：
修复登录超时

用户：
继续刚才的问题，把测试也补一下
```

AAFE：

```text
→ T001
→ Cursor Agent A
→ Run #2
```

而：

```text
用户：
再帮我优化首页性能
```

AAFE：

```text
→ T002
→ Cursor Agent B
```

---

# 7. 每个 Task 必须独立 Workspace

Cursor Cloud Agent 本身会在独立 VM 中 Clone Repository 并工作在独立分支。([Cursor][1])

所以：

```text
T001
 ↓
VM A
 ↓
repo
 ↓
branch-a

T002
 ↓
VM B
 ↓
repo
 ↓
branch-b
```

即使：

```text
T001 repo = project-a
T002 repo = project-a
```

也应该：

```text
T001 → Agent A → VM A → branch task/T001
T002 → Agent B → VM B → branch task/T002
```

这样两个任务不会互相覆盖工作目录。

---

# 8. AAFE 应该自己生成 Branch

不要完全依赖 Cursor 自动处理。

建议：

```text
aafe/task/T001
aafe/task/T002
aafe/task/T003
```

例如：

```text
repository:
    github.com/company/project

base:
    main

task:
    T001

branch:
    aafe/task/T001
```

这样 AAFE 自己拥有任务与代码变更之间的确定映射。

---

# 9. Environment 是 Cursor Cloud Agent 的关键

这是使用 Cloud Agent 时你必须提前准备好的。

Cursor Cloud Agent 的 Environment 可以配置：

```text
Node
pnpm
npm
Python
Java
Docker
Database
Environment Variables
Secrets
Startup Commands
```

环境准备完成后，Agent 启动时直接使用这个环境。Cursor 官方目前支持通过 Environment、snapshot 或 Dockerfile 配置，并通过 `.cursor/environment.json` 管理环境。([Cursor][1])

例如：

```text
.cursor/
└── environment.json
```

里面定义：

```text
install
start
terminals
```

其中：

```text
install
```

负责：

```text
npm install
生成代码
构建依赖
准备环境
```

而：

```text
start
```

负责：

```text
数据库
Docker
服务
Dev Server
```

Cursor 官方也明确建议把可重复的准备工作放在 install，长期运行进程放到 start/terminals。([Cursor][5])

---

# 10. 项目本身还应该有 AGENTS.md

这个对你的 AAFE 非常重要。

例如：

```text
AGENTS.md
```

负责告诉 Cursor：

```text
项目架构
代码规范
测试方式
构建方式
禁止修改区域
数据库启动方式
特殊约束
Cloud Agent 注意事项
```

Cursor Cloud Agent 会读取 `AGENTS.md`；官方也建议把 Cloud-specific instructions 放进去。([Cursor][5])

但是：

> **AAFE 的动态 Task Context 不应该写进 AGENTS.md。**

应该：

```text
AGENTS.md
    ↓
Project-level static knowledge
```

而：

```text
AAFE Task Context
    ↓
Dynamic runtime context
```

两者分离。

---

# 11. AAFE 给 Cursor 的 Prompt 应该长这样

不是：

```text
帮我修复登录问题
```

而应该是：

```text
You are the coding execution agent of AAFE.

## Task

T001

## User Request

修复登录超时问题。

## Project Context

Authentication flow:
...

Relevant files:
...

## Architecture Knowledge

...

## Impact Analysis

Potential files:
...

## Skills

- frontend-performance
- authentication
- typescript

## Rules

- Do not modify public API
- Do not modify unrelated modules
- Preserve existing behavior

## Execution Plan

1. Inspect authentication flow.
2. Identify timeout handling.
3. Implement fix.
4. Add/update tests.
5. Run tests.
6. Fix failures.

## Completion Criteria

...

## Reporting

Return:
- changed files
- implementation summary
- tests executed
- test results
- unresolved issues
```

这时候 Cursor Agent 才真正变成：

**AAFE 的 Coding Executor。**

---

# 12. 多任务调度应该在 AAFE，不应该在 Cursor

例如：

```text
用户同时提交：

T001 登录问题
T002 首页性能
T003 E2E 测试
T004 API 重构
```

AAFE：

```text
                 Scheduler
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      T001        T002        T003
        │           │           │
     Cursor A    Cursor B    Cursor C
        │           │           │
       VM A        VM B        VM C
```

然后根据：

```text
maxConcurrentAgents
```

控制并发。

例如：

```json
{
  "maxConcurrentTasks": 5
}
```

---

# 13. AAFE 应该维护自己的 Task Database

例如：

```text
tasks
```

```text
id
user_id
conversation_id
repository
base_branch
task_branch
cursor_agent_id
cursor_run_id
status
created_at
updated_at
```

再：

```text
task_context
```

```text
task_id
user_request
conversation_context
plan
skills
rules
knowledge
impact
```

以及：

```text
task_events
```

```text
task_id
event_type
payload
created_at
```

这样即使：

```text
AAFE 重启
```

也可以：

```text
读取 Task
 ↓
恢复 Cursor Agent
 ↓
恢复 Run
 ↓
继续任务
```

Cursor 当前 Cloud Agent API 本身支持 run status、streaming、reconnect 和 cancellation，这正适合 AAFE 做 durable task management。([Cursor][4])

---

# 14. 企微 Bot 不应该一直等待 Cursor

这是远程 Agent 场景非常重要的一点。

不要：

```text
企微请求
 ↓
HTTP Request
 ↓
等待 Cursor 20 分钟
 ↓
返回
```

应该：

```text
企微
 ↓
AAFE
 ↓
创建 T001
 ↓
立即返回

任务 T001 已创建，开始执行。
```

后台：

```text
T001
 ↓
Cursor Agent
 ↓
执行
 ↓
事件
 ↓
Verification
 ↓
完成
```

然后：

```text
AAFE
 ↓
WeCom
```

推送：

```text
T001 已完成

修改：
- xxx.ts
- xxx.vue

测试：
✓ npm test

PR：
xxx
```

---

# 15. Cursor Stream 要接入 AAFE Event Bus

Cursor：

```text
run.stream()
```

得到：

```text
AgentEvent
```

AAFE 转成：

```text
TaskEvent
```

例如：

```text
Cursor Event
      ↓
AAFE Event Adapter
      ↓
Task Event
      ↓
Event Bus
      ├── Web UI
      ├── WeCom
      ├── Log
      └── Task DB
```

最终：

```text
agent.started
agent.tool_call
agent.file_changed
agent.test_started
agent.test_failed
agent.completed
```

统一为 AAFE 自己的事件协议。

---

# 16. 一个非常关键的地方：不要让 Cursor 成为 AAFE 的状态中心

应该：

```text
AAFE
 │
 ├── Task State
 ├── Context
 ├── Plan
 ├── Knowledge
 ├── Memory
 └── Cursor Agent ID
```

Cursor：

```text
Cursor
 │
 ├── Agent Runtime
 ├── Run
 ├── Tool Execution
 ├── Workspace
 └── Code Changes
```

也就是说：

> **Cursor 是执行状态源，不是业务任务状态源。**

AAFE 必须拥有自己的 Task State。

---

# 17. 这样可以实现真正的“远程开发团队”

最终你在企微里可以直接：

```text
@AAFE

创建一个任务：

项目：wealth-web
需求：
优化首页首屏加载性能
```

AAFE：

```text
T20260903001

✓ 已识别项目
✓ 已分析架构
✓ 已匹配 Skills
✓ 已完成影响分析
✓ 已生成执行计划
✓ 已启动 Cursor Cloud Agent
```

然后后台：

```text
T001
 │
 ├── Analyze
 ├── Plan
 ├── Coding
 ├── Test
 ├── Fix
 ├── Review
 └── Complete
```

最后：

```text
T001 已完成

修改 7 个文件
新增 4 个测试
测试全部通过

已创建 PR：
...
```

---

# 18. 你现在真正需要实现的 Cursor 层其实很小

不要把大量代码写在 Cursor Adapter。

只需要：

```text
packages/aafe-cursor/
│
├── client.ts
├── runtime.ts
├── agent.ts
├── run.ts
├── stream.ts
└── types.ts
```

核心接口：

```ts
interface CursorCloudRuntime {
  createTaskAgent(
    task: AAFETask
  ): Promise<CursorAgent>;

  run(
    agent: CursorAgent,
    prompt: string
  ): Promise<CursorRun>;

  stream(
    run: CursorRun
  ): AsyncIterable<CursorEvent>;

  continue(
    agent: CursorAgent,
    prompt: string
  ): Promise<CursorRun>;

  cancel(
    run: CursorRun
  ): Promise<void>;
}
```

真正复杂的是：

```text
Task Manager
Context Manager
Scheduler
Task Resolver
Event Bus
Recovery
Verification
```

而不是 Cursor SDK。

---

# 19. 最终架构

我建议你现在就按照下面这个架构定型：

```text
                         ┌───────────────┐
                         │    企业微信    │
                         └───────┬───────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │   AAFE Gateway   │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Intent Router   │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Task Resolver   │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Task Scheduler  │
                       └────────┬─────────┘
                                │
               ┌────────────────┼────────────────┐
               ▼                ▼                ▼
             Task A           Task B           Task C
               │                │                │
          Context A        Context B        Context C
               │                │                │
             Plan A           Plan B           Plan C
               │                │                │
               ▼                ▼                ▼
        Cursor Agent A   Cursor Agent B   Cursor Agent C
               │                │                │
              VM A             VM B             VM C
               │                │                │
            Repo A           Repo B           Repo C
               │                │                │
               └────────────────┼────────────────┘
                                ▼
                         Verification
                                │
                                ▼
                           Task Result
                                │
                                ▼
                            WeCom Bot
```

### 所以 Cursor Cloud Agent 在 AAFE 中的定位最终就是：

```text
Cursor Cloud Agent
=
AAFE Task 的远程代码执行沙箱
```

而不是：

```text
Cursor Cloud Agent
=
AAFE Agent
```

**这两个概念一定要分开。**

另外，Cursor Cloud Agent 当前支持 GitHub、GitLab、Azure DevOps、Bitbucket 等代码仓库连接，并且 Cloud Agent 环境、Secrets、网络、MCP 等都可以在 Cursor 侧配置。([Cursor][1])

因此你下一步如果开始实际落地，我建议直接定义这 **5 个核心模块**：

```text
1. WeCom Gateway
2. Task Manager
3. Task Context Manager
4. Cursor Cloud Runtime
5. Task Scheduler
```

然后再接你原来已经设计好的：

```text
Analyze
→ Skill
→ Rule
→ Knowledge
→ Impact
→ Planner
→ Cursor
→ Verify
→ Memory
```

这样第一版就可以真正做到 **“企微发一句话 → AAFE 自动创建隔离 Task → Cursor Cloud 独立执行 → 完成后企微通知”**。

[1]: https://cursor.com/docs/cloud-agent?utm_source=chatgpt.com "Cloud Agents | Cursor Docs"
[2]: https://cursor.com/changelog/sdk-release?utm_source=chatgpt.com "Build programmatic agents with the Cursor SDK · Cursor"
[3]: https://prod.cursor.com/docs/sdk/python?utm_source=chatgpt.com "Cursor Python SDK | Cursor Documentation"
[4]: https://prod.cursor.com/docs/cloud-agent/api/endpoints?utm_source=chatgpt.com "Cloud Agents API | Cursor Docs"
[5]: https://prod.cursor.com/docs/cloud-agent/setup?utm_source=chatgpt.com "Cloud Environment Setup | Cursor Docs"
