这个补充非常关键。**在你现在明确的目标下，我会调整上一轮的结论：不建议把“Cursor SDK 本地 Runtime”作为核心，应该以“Cursor SDK + Cloud Runtime”为核心，并把 Bridge 放到 Runtime 隔离层作为可选实现。**

因为你的产品已经不是一个普通的 Coding SDK Wrapper，而是：

> **一个独立部署的 AAFE Remote Coding Agent，通过企微 Bot 接收任务，进行多任务并发派发，并保证每个任务拥有独立的代码、Agent Session、上下文和执行环境。**

Cursor 官方现在的 Cloud Agents 正好支持独立 VM、多 Agent 并行、任务在调用方断开后继续运行；SDK 的 Cloud Runtime 也是针对“调用方没有 repo / 需要大量并行 Agent / 任务需要脱离调用方继续运行”的场景。([Cursor][1])

---

# 一、你的目标实际上应该重新定义成

```text
                         企业微信 Bot
                              │
                              ▼
                     ┌─────────────────┐
                     │    AAFE Agent   │
                     │                 │
                     │ Remote Coding   │
                     │ Agent Platform  │
                     └────────┬────────┘
                              │
                     Task Orchestrator
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
          Task A           Task B           Task C
             │                │                │
             ▼                ▼                ▼
        Cursor Agent     Cursor Agent     Cursor Agent
             │                │                │
             ▼                ▼                ▼
        Cloud VM A        Cloud VM B        Cloud VM C
             │                │                │
          Repo A            Repo B            Repo C
```

这里最重要的不是 Cursor API。

而是：

# **Task Isolation**

你的 AAFE 必须把：

```text
企业微信上下文
任务上下文
Agent Session
Repository
Branch
Workspace
Memory
Execution
Logs
Artifacts
```

全部绑定到一个 `Task`。

---

# 二、因此不要设计成“一个 AAFE Agent = 一个 Cursor Agent”

这是最大的架构误区。

错误：

```text
企微 Bot
   │
   ▼
AAFE Agent
   │
   ▼
一个 Cursor Agent
   │
   ├── Task A
   ├── Task B
   ├── Task C
   └── Task D
```

这样非常容易发生：

```text
Task A Context
      ↓
Task B
      ↓
Task C
```

也就是你说的：

> **多任务上下文污染。**

---

# 三、正确模型应该是 AAFE = Agent Manager

```text
                         AAFE
                          │
                    Agent Manager
                          │
               ┌──────────┼──────────┐
               ▼          ▼          ▼
            Task A      Task B      Task C
               │          │          │
          Context A   Context B   Context C
               │          │          │
          Cursor A    Cursor B    Cursor C
               │          │          │
           Cloud A     Cloud B     Cloud C
```

即：

> **AAFE 自己不是“干活的 Agent”，AAFE 是管理大量 Coding Agent 的 Agent Manager。**

这个定位会非常适合你之前的 AAFE 架构。

---

# 四、我建议把 AAFE 核心对象改成 Task

核心数据模型：

```ts
interface AAFETask {
  id: string;

  userId: string;

  source: {
    type: 'wecom';
    conversationId: string;
    messageId: string;
  };

  repository: {
    provider: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
    branch: string;
  };

  intent: TaskIntent;

  context: TaskContext;

  execution: ExecutionContext;

  agent: AgentContext;

  status: TaskStatus;

  result?: TaskResult;
}
```

---

# 五、Task Context 必须是第一等公民

建议：

```ts
interface TaskContext {
  userRequest: string;

  conversation: {
    messages: string[];
  };

  project: {
    architecture?: string;
    business?: string;
    dataFlow?: string;
  };

  skills: string[];

  rules: string[];

  memories: string[];

  plan?: ExecutionPlan;

  constraints: string[];
}
```

注意：

**这个 Context 不能使用全局共享 Session。**

必须：

```text
Task A
 └── Context A

Task B
 └── Context B
```

---

# 六、企微上下文也必须做“任务切片”

这是你这个场景非常重要的一层。

假设企微：

```text
用户：

帮我修复登录超时问题

Bot：

创建任务 T001

用户：

另外把首页加载慢的问题也看看

Bot：

创建任务 T002
```

不能简单：

```text
WeCom Conversation
        ↓
Cursor Conversation
```

而应该：

```text
WeCom Conversation
        │
        ▼
AAFE Intent Router
        │
        ├───────────────┐
        ▼               ▼
     Task T001        Task T002
        │               │
   Login Timeout    Home Performance
        │               │
   Context A         Context B
```

---

# 七、甚至同一个企微会话，也必须支持多个 Task Context

最终应该：

```text
WeCom Conversation
│
├── T001
│   ├── User Request
│   ├── Relevant Messages
│   ├── Repository
│   ├── Branch
│   ├── Skills
│   ├── Rules
│   ├── Plan
│   └── Cursor Agent
│
├── T002
│   ├── User Request
│   ├── Relevant Messages
│   ├── Repository
│   ├── Branch
│   ├── Skills
│   ├── Rules
│   ├── Plan
│   └── Cursor Agent
│
└── T003
```

**而不是一个 WeCom Conversation 对应一个 Cursor Session。**

---

# 八、Cursor 在这个架构里应该变成 Task Runtime

我建议最终抽象：

```ts
interface CodingRuntime {
  createTaskRuntime(
    task: AAFETask
  ): Promise<RuntimeSession>;

  run(
    session: RuntimeSession,
    prompt: string
  ): Promise<Run>;

  stream(
    runId: string
  ): AsyncIterable<AgentEvent>;

  cancel(
    runId: string
  ): Promise<void>;
}
```

然后：

```text
CodingRuntime
     │
     ├── CursorCloudRuntime
     │
     ├── CursorLocalRuntime
     │
     └── CursorBridgeRuntime
```

---

# 九、在你的场景下，Cursor Cloud Runtime 是第一选择

原因非常直接。

Cursor Cloud Agent：

* 每个 Agent 有独立 VM
* 可以并行运行多个 Agent
* 不依赖用户本地机器在线
* 可以 Clone Repository
* 可以 Build/Test
* 可以配置环境、Secrets、网络
* 支持多 repo
* 可以持续执行远程任务

官方文档明确说明 Cloud Agents 可以并行运行，并且每个 Agent 使用自己的 VM；SDK 文档也明确把 Cloud Runtime 定位在“需要大量并行 Agent”以及“调用方断线后任务继续运行”的场景。([Cursor][2])

这和你的：

> **企微 → 远程任务 → 多任务并发**

高度匹配。

---

# 十、所以这里我反而不推荐 Bridge 作为核心

现在重新回答你上一问：

## SDK

```text
AAFE
 │
 ▼
Cursor SDK
 │
 ▼
Cloud Agent
 │
 ▼
VM
```

非常适合。

---

## Bridge

```text
AAFE
 │
 ▼
Bridge
 │
 ▼
Cursor SDK
 │
 ▼
Cloud Agent
 │
 ▼
VM
```

你多增加了一层：

```text
AAFE
 ↓
Bridge Process
 ↓
SDK
 ↓
Cloud
```

而 Bridge 官方定位本身就是：

> 没有 first-party SDK 的语言，以及 platform teams 使用；TypeScript/JavaScript 应用应直接使用 `@cursor/sdk`。([Cursor][3])

你现在是 Node/TypeScript，所以没必要为了“独立部署”强行引入 Bridge。

---

# 十一、真正应该做隔离的不是 Bridge，而是 Task Runtime

这是非常关键的设计思想：

```text
错误：

Task Isolation
    ↓
Bridge Process
```

应该：

```text
Task Isolation
    ↓
Cursor Cloud Agent
    ↓
Dedicated VM
```

即：

```text
AAFE
 │
 ├── Task A ───── Cursor Cloud Agent A ── VM A
 │
 ├── Task B ───── Cursor Cloud Agent B ── VM B
 │
 └── Task C ───── Cursor Cloud Agent C ── VM C
```

这才是真正意义上的：

**上下文隔离 + Workspace 隔离 + 执行隔离。**

---

# 十二、AAFE 应该增加一个 Task Runtime Manager

这是我认为你现在最应该新增的模块：

```text
packages/
├── aafe-core
├── aafe-analyzer
├── aafe-skills
├── aafe-memory
├── aafe-planner
├── aafe-agent
│
├── aafe-task
│   ├── task-manager
│   ├── task-context
│   ├── task-state
│   ├── task-lock
│   └── task-recovery
│
└── aafe-runtime
    ├── cursor-cloud
    ├── cursor-local
    └── cursor-bridge
```

---

# 十三、Task Manager

```text
TaskManager
│
├── createTask()
├── getTask()
├── updateTask()
├── cancelTask()
├── pauseTask()
├── resumeTask()
├── retryTask()
└── recoverTask()
```

---

# 十四、Task Scheduler

因为你明确要求：

> 支持多任务派发

所以需要：

```text
                 Task Scheduler
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
       Queue A       Queue B       Queue C
         │             │             │
       Task A         Task B         Task C
```

建议任务状态：

```text
CREATED
   ↓
QUEUED
   ↓
PLANNING
   ↓
READY
   ↓
RUNNING
   ↓
VERIFYING
   ↓
COMPLETED
```

异常：

```text
RUNNING
   │
   ├── FAILED
   ├── CANCELLED
   └── WAITING
```

---

# 十五、特别要做“Task Lock”

例如：

```text
Task A
repo = project-a
branch = feature/login
```

用户又发送：

```text
继续修改登录功能
```

AAFE 必须判断：

```text
是否属于 T001？
```

而不是直接创建：

```text
T002
```

因此需要：

```text
Task Resolver
     │
     ├── New Task
     ├── Existing Task
     └── Related Task
```

例如：

```text
用户：
继续刚才登录超时的问题

AAFE：
→ T001

用户：
另外首页也很慢

AAFE：
→ T002
```

---

# 十六、这里可以设计 Task Thread

企微 Bot 里不要只有：

```text
conversationId
```

而是：

```text
WeCom Conversation
        │
        ▼
     AAFE
        │
        ├── Task Thread #001
        │
        ├── Task Thread #002
        │
        └── Task Thread #003
```

每个 Task Thread 都有：

```text
Task ID
Repository
Branch
Agent
Context
Status
Result
```

这样用户可以：

```text
继续 T001
查看 T002
取消 T003
```

---

# 十七、最重要的上下文规则

我建议 AAFE 强制执行：

## Rule 1

**不同 Task 不共享 Cursor Conversation。**

---

## Rule 2

**不同 Task 不共享 Workspace。**

---

## Rule 3

**不同 Task 不共享动态 Memory。**

---

## Rule 4

**只允许共享 Project Knowledge。**

例如：

```text
                 Project Knowledge
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
           Task A     Task B     Task C
```

但是：

```text
Task A Runtime State
          X
Task B Runtime State
```

禁止互相读取。

---

# 十八、Knowledge 和 Context 必须彻底分开

这是你原来 AAFE 架构里非常重要的一次升级。

```text
Knowledge
    │
    ├── Architecture
    ├── Business
    ├── Data Flow
    ├── Rules
    └── Skills
```

可以共享。

但是：

```text
Task Context
    │
    ├── User Request
    ├── Conversation
    ├── Plan
    ├── Agent History
    ├── Tool Result
    └── Runtime State
```

**必须隔离。**

---

# 十九、最终上下文结构应该是

```text
                    Cursor Agent
                         │
              ┌──────────┴──────────┐
              │                     │
       Project Knowledge       Task Context
              │                     │
       ┌──────┼──────┐        ┌─────┼─────┐
       │      │      │        │     │     │
   Arch    Rules  Skills    User  Plan  History
```

Cursor Agent 得到：

```text
Global Project Knowledge
+
Task-specific Context
```

但：

```text
Task A History
```

绝不能进入：

```text
Task B
```

---

# 二十、这时候 AAFE 的真正架构就非常清晰了

```text
                         企业微信 Bot
                              │
                              ▼
                     ┌─────────────────┐
                     │   AAFE Gateway  │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Intent Router   │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │  Task Resolver  │
                     └────────┬────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              Task A       Task B       Task C
                 │            │            │
          Context A     Context B     Context C
                 │            │            │
                 ▼            ▼            ▼
              Planner      Planner      Planner
                 │            │            │
                 ▼            ▼            ▼
           Cursor Agent Cursor Agent Cursor Agent
                 │            │            │
              VM A          VM B         VM C
                 │            │            │
              Repo A        Repo B       Repo C
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                       Verification
                              │
                              ▼
                         Task Result
                              │
                              ▼
                          WeCom Bot
```

---

# 二十一、因此我现在对 SDK / Bridge 的最终判断

| 能力           |       SDK |  Bridge |   你的需求 |
| ------------ | --------: | ------: | -----: |
| Node/TS      |     ⭐⭐⭐⭐⭐ |     ⭐⭐⭐ |     必须 |
| 独立部署         |     ⭐⭐⭐⭐⭐ |    ⭐⭐⭐⭐ |     必须 |
| Cloud Agent  |     ⭐⭐⭐⭐⭐ |   ⭐⭐⭐⭐⭐ |     必须 |
| 多任务          |     ⭐⭐⭐⭐⭐ |   ⭐⭐⭐⭐⭐ |     必须 |
| Task 隔离      |     ⭐⭐⭐⭐⭐ |    ⭐⭐⭐⭐ |     必须 |
| Context 隔离   |   AAFE 实现 | AAFE 实现 | **必须** |
| 远程执行         |     ⭐⭐⭐⭐⭐ |   ⭐⭐⭐⭐⭐ |     必须 |
| 本地 Runtime   |     ⭐⭐⭐⭐⭐ |    ⭐⭐⭐⭐ |     次要 |
| 跨语言          |        ⭐⭐ |   ⭐⭐⭐⭐⭐ |  暂时不需要 |
| Runtime 独立进程 |       ⭐⭐⭐ |   ⭐⭐⭐⭐⭐ |     次要 |
| 架构复杂度        |     **低** |       高 |    低优先 |
| 推荐度          | **★★★★★** |     ★★★ |        |

---

# 二十二、所以最终架构我建议定为

```text
                ┌──────────────────────┐
                │      WeCom Bot       │
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │     AAFE Gateway     │
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │    Task Manager      │
                └──────────┬───────────┘
                           │
                ┌──────────▼───────────┐
                │     Task Scheduler    │
                └──────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
        TaskRuntime     TaskRuntime     TaskRuntime
            │              │              │
            ▼              ▼              ▼
       Cursor SDK      Cursor SDK      Cursor SDK
            │              │              │
            ▼              ▼              ▼
       Cloud Agent     Cloud Agent     Cloud Agent
            │              │              │
           VM A           VM B           VM C
            │              │              │
         Repo A          Repo B          Repo C
```

AAFE 内部：

```text
┌─────────────────────────────────────────┐
│                  AAFE                   │
│                                         │
│  WeCom Gateway                          │
│       ↓                                 │
│  Intent Router                          │
│       ↓                                 │
│  Task Manager                           │
│       ↓                                 │
│  Task Scheduler                         │
│       ↓                                 │
│  Context Manager                        │
│       ↓                                 │
│  Skill / Rule / Knowledge               │
│       ↓                                 │
│  Planner                                │
│       ↓                                 │
│  Cursor Runtime                         │
│       ↓                                 │
│  Verification                           │
│       ↓                                 │
│  Memory                                 │
└─────────────────────────────────────────┘
```

---

## 最关键的设计原则

我建议你把这个项目的核心定义直接定成：

> **AAFE = Remote Multi-Agent Task Orchestrator**
>
> **Cursor = Coding Execution Runtime**
>
> **WeCom = Human/AI Interaction Channel**
>
> **Task = Context Isolation Boundary**
>
> **Cursor Cloud Agent = Execution Isolation Boundary**
>
> **Project Knowledge = Cross-Task Shared Knowledge**
>
> **Task Context = Strictly Isolated State**

这样整个系统的职责就非常干净。

而且 Cursor 官方目前的 Cloud Agents 已经提供独立 VM、多 Agent 并行、远程 Repository、环境、Secrets、MCP 等能力；Cloud Agents API v1 也已经采用 **durable Agent + per-prompt Run** 模型，非常适合作为 AAFE 的远程执行层。([Cursor][2])

**所以现在我不会再建议你围绕 Bridge 设计 AAFE。**

第一版直接：

```text
AAFE
 ↓
@cursor/sdk
 ↓
Cursor Cloud Agent
```

把真正的工程重点放在：

```text
Task Manager
+
Task Context Isolation
+
Multi-task Scheduler
+
WeCom Context Resolver
+
Agent Lifecycle
+
Task Recovery
+
Verification
```

这几个才是这个 AAFE Agent 真正的核心壁垒。

[1]: https://prod.cursor.com/docs/sdk/python?utm_source=chatgpt.com "Cursor Python SDK | Cursor Documentation"
[2]: https://cursor.com/docs/cloud-agent?utm_source=chatgpt.com "Cloud Agents | Cursor Docs"
[3]: https://prod.cursor.com/docs/sdk/bridge?utm_source=chatgpt.com "Cursor SDK Bridge | Cursor Documentation"
