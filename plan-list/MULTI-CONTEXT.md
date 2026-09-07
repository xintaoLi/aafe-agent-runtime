这个问题我建议**不要把“企微消息理解”简单设计成一个 Intent Classifier**。AAFE 这里真正需要解决的是：

> **把“自然语言消息”稳定映射到一个长期存在的 `Task Context`，再由 Task Context 决定 Agent 应该在哪个代码工作空间执行。**

这和普通 Bot 的「意图识别」已经不是一个层级的问题了，而是：

**Conversation → Task → Execution Session → Workspace → Branch → PR**

的一整套上下文编排。

我结合目前 Codex、Cursor、Claude Code 的并行 Agent 方案看，最佳方向非常明确：**Task 必须是一等实体 + 消息引用解析 + Git Worktree 隔离 + 本地 Agent Runtime 调度。**

Codex 目前已经把多 Agent + Worktree 作为核心能力：不同 Agent 在同一 repo 上工作时使用隔离 worktree，避免相互修改本地文件；Cursor 现在也已经原生支持 Agents Window + Worktrees，多任务分别运行在不同 checkout 中。([OpenAI][1]) Claude Code 同样明确把 worktree 作为并行 Agent 编辑同一代码库时的隔离手段。([Claude][2])

---

# 一、AAFE 不应该采用传统的 Intent 模型

传统 Bot 可能这样：

```text
用户消息
   ↓
Intent Classifier
   ↓
NEW_TASK
CONTINUE_TASK
QUERY
...
```

AAFE 不建议这么做。

因为你的场景中：

> 「这个接口还是有问题，把 timeout 改成 10s」

单独看无法判断是什么任务。

但如果前面存在：

```text
Task A：修复登录接口 timeout
Task B：优化首页加载
Task C：增加用户权限
```

那么这句话真正的含义是：

```text
CONTINUE_TASK
task_id = Task A
```

所以真正应该识别的是：

```text
Message
   ↓
Context Resolver
   ↓
Task Resolution
   ↓
Task
```

而不是：

```text
Message
   ↓
Intent
```

---

# 二、我建议 AAFE 建立 4 层上下文模型

核心模型：

```text
┌───────────────────────────────┐
│         WeCom Message         │
│ 用户消息 / 回复 / @ / 引用      │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│      Context Resolver          │
│                               │
│ Message → Task Candidate       │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│         Task Context           │
│                               │
│ task_id                       │
│ title                         │
│ status                        │
│ participants                  │
│ repository                    │
│ branch                        │
│ workspace                     │
│ execution_session             │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│       Agent Execution          │
│                               │
│ Agent / Model / Tools          │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│        Workspace              │
│                               │
│ Git Worktree                  │
│ Branch                        │
│ Runtime                       │
│ Dependencies                  │
└───────────────────────────────┘
```

这四层必须严格分开。

---

# 三、Task 才是整个系统的核心

建议 AAFE 定义：

```typescript
interface AAFETask {
  id: string;

  // 人类可读
  title: string;
  summary?: string;

  // 来源
  source: {
    platform: 'wecom';
    groupId?: string;
    creatorId: string;
    rootMessageId: string;
  };

  // 当前状态
  status:
    | 'pending'
    | 'planning'
    | 'running'
    | 'waiting_input'
    | 'review'
    | 'completed'
    | 'failed'
    | 'cancelled';

  // 上下文
  context: {
    messages: string[];
    participants: string[];
    entities: string[];
    requirements: string[];
  };

  // Git
  repository?: {
    root: string;
    remote?: string;
    baseBranch?: string;
    branch?: string;
  };

  // Execution
  execution?: {
    sessionId: string;
    workspaceId: string;
    runtimeId?: string;
    pid?: number;
  };

  // PR
  pullRequest?: {
    provider: 'github' | 'gitlab' | 'other';
    number?: number;
    url?: string;
  };

  createdAt: number;
  updatedAt: number;
}
```

尤其是：

```text
task.id
```

必须成为整个 AAFE 生命周期的唯一关联 ID。

---

# 四、企微消息必须建立 Message Context

不要只保存文本。

建议：

```typescript
interface WeComMessageContext {
  messageId: string;

  groupId: string;

  senderId: string;

  timestamp: number;

  content: string;

  mentions: string[];

  replyTo?: {
    messageId: string;
  };

  quote?: {
    messageId: string;
    content: string;
    senderId: string;
  };

  taskRefs?: string[];

  resolvedTaskId?: string;

  resolutionConfidence?: number;
}
```

尤其注意：

```text
replyTo
quote
mentions
resolvedTaskId
```

这几个字段对于多任务场景极其重要。

---

# 五、消息识别建议采用「确定性优先 + LLM 补充」

这是整个设计里面我认为非常重要的一点。

**不要每一条消息都交给 LLM 判断。**

应该：

```text
                 WeCom Message
                       │
                       ↓
              ┌─────────────────┐
              │ Deterministic   │
              │ Resolver        │
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
    Explicit        Reply          Task ID
    Reference       Message        Reference
        │              │              │
        └──────────────┴──────────────┘
                       │
                  命中 Task
                       │
                      YES
                       ↓
                  CONTINUE_TASK

                       NO
                       ↓
              Candidate Resolver
                       ↓
                     LLM
                       ↓
                Task Candidates
                       ↓
                Confidence Check
```

---

# 六、第一优先级：显式任务引用

例如 AAFE 回复：

```text
🤖 Task #A102
修复登录接口 timeout

分支：aafe/task/A102
状态：执行中
```

用户：

> 「把 timeout 改成 10 秒」

最好允许用户：

```text
@AAFE #A102 把 timeout 改成 10 秒
```

或者：

```text
继续 A102，把 timeout 改成 10 秒
```

这是：

```text
Explicit Reference
```

直接：

```text
taskId = A102
```

**0 Token。**

---

# 七、第二优先级：企微 Reply / Quote

这是你这个系统最应该利用的能力。

例如群里：

```text
用户A：
@AAFE 修复登录超时问题

AAFE：
[TASK A102]
已创建任务……

用户B：
> AAFE：已创建任务 A102
把 timeout 调整成 10s
```

系统看到：

```text
replyTo.messageId = M100
```

然后：

```text
M100
 ↓
Task A102
```

所以：

```text
reply message
       ↓
original message
       ↓
task
```

这时候甚至**不需要 LLM**。

---

# 八、第三优先级：当前用户的 Active Task

例如：

```text
用户A

Task A：
修复登录

Task B：
增加权限
```

用户刚刚操作：

```text
Task A
```

下一句话：

> 「这个接口也顺便加一下日志」

可以把：

```text
userId + groupId
```

作为 context。

建立：

```typescript
UserTaskContext
```

例如：

```text
user: U100
group: G200

recentTasks:

A102  ← 30 seconds ago
B301  ← 2 hours ago
C888  ← yesterday
```

那么：

```text
最近活跃 Task
+
消息语义相似度
+
当前 Agent 状态
```

进行候选排序。

---

# 九、第四优先级：群级 Task Context

这里是 AAFE 和普通 AI Bot 最大的区别之一。

建议建立：

```text
GroupContext
```

例如：

```typescript
interface GroupContext {
  groupId: string;

  activeTasks: string[];

  participants: {
    userId: string;
    activeTaskIds: string[];
  }[];

  recentMessages: string[];

  updatedAt: number;
}
```

于是群里可以同时存在：

```text
G001

├── A102 登录接口
│   ├── userA
│   └── userB
│
├── B203 首页性能
│   └── userC
│
└── C304 权限系统
    ├── userA
    └── userD
```

---

# 十、最终 Task Resolution 应该是打分制

我建议不要让 LLM 直接输出：

```json
{
  "task": "A102"
}
```

而应该产生：

```typescript
interface TaskCandidate {
  taskId: string;

  score: number;

  reasons: {
    type:
      | 'explicit_reference'
      | 'reply_reference'
      | 'recent_task'
      | 'semantic_similarity'
      | 'participant_match'
      | 'branch_context'
      | 'message_thread';

    score: number;
  }[];
}
```

例如：

```text
Task A102
score = 0.96

reply_reference       +0.50
semantic_similarity   +0.25
recent_task           +0.15
participant_match     +0.06
```

---

# 十一、建议定义 5 种 Resolution 结果

不要只有：

```text
NEW / CONTINUE
```

而应该：

```typescript
type ResolutionType =
  | 'NEW_TASK'
  | 'CONTINUE_TASK'
  | 'TASK_REFERENCE'
  | 'MULTIPLE_TASK'
  | 'AMBIGUOUS';
```

实际再增加：

```text
IGNORE
QUERY
CONTROL
```

所以完整一点：

```text
NEW_TASK

CONTINUE_TASK

TASK_REFERENCE

MULTIPLE_TASK

AMBIGUOUS

QUERY

CONTROL

IGNORE
```

---

# 十二、最关键：AMBIGUOUS 必须阻止 Agent 执行

比如：

```text
Task A：登录接口
Task B：首页
Task C：权限

用户：

“这个也改一下”
```

如果：

```text
A = 0.61
B = 0.59
```

千万不能：

```text
LLM 猜 A
↓
直接修改代码
```

而应该：

```text
AAFE：

你这条消息可能对应两个任务：

1. #A102 登录接口
2. #B203 首页性能

请回复：
“A102”
或
“B203”
```

这是 Agent Bot 必须有的**安全门禁**。

---

# 十三、我建议采用这样的置信度策略

```text
score >= 0.90
        ↓
自动绑定 Task

0.75 ~ 0.90
        ↓
如果存在明确 Reply / Quote
自动绑定
否则确认

0.50 ~ 0.75
        ↓
要求用户确认

< 0.50
        ↓
NEW_TASK / ASK
```

但是有一个例外：

```text
涉及代码修改
```

阈值必须提高。

例如：

```text
只查询：
0.75 可以执行

修改代码：
0.90

删除 / merge / push：
0.95 + explicit confirmation
```

---

# 十四、LLM Resolver 的职责应该非常窄

不要让一个大 Agent 同时：

```text
理解消息
找任务
规划
写代码
执行
```

建议单独建立：

# `Context Resolver Agent`

输入：

```json
{
  "message": "...",
  "group": {...},
  "recentTasks": [...],
  "candidateTasks": [...],
  "replyContext": {...}
}
```

输出：

```json
{
  "type": "CONTINUE_TASK",
  "taskId": "A102",
  "confidence": 0.96,
  "reason": [
    "message refers to timeout configuration",
    "matches task A102"
  ],
  "requiresConfirmation": false
}
```

它不允许：

```text
写文件
执行 shell
修改 Git
```

只是 Resolver。

---

# 十五、然后进入真正的 Agent Orchestrator

整体结构：

```text
                         WeCom
                           │
                           ↓
                  Message Gateway
                           │
                           ↓
                  Context Resolver
                           │
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
          NEW TASK     EXISTING       MULTI TASK
                           │
                           ↓
                      Task Manager
                           │
                           ↓
                    Agent Orchestrator
                           │
              ┌────────────┼────────────┐
              ↓            ↓            ↓
           Planner       Coder       Tester
              │            │            │
              └────────────┼────────────┘
                           ↓
                    Execution Manager
                           │
                           ↓
                    Workspace Manager
                           │
                           ↓
                      Git Worktree
```

---

# 十六、然后解决你提出的最重要问题：三个任务共用一个本地目录

这个问题：

> Agent 跑在本地，指向同一个本地代码目录，同时三个任务修改代码。

**绝对不能让三个 Agent 直接共享目录。**

例如：

```text
/data/project

Agent A → 修改 src/login.ts
Agent B → 修改 src/home.ts
Agent C → 修改 src/auth.ts
```

即使现在文件没有冲突，也存在：

```text
git checkout
npm install
build
generated files
node_modules
.env
git status
git commit
```

等大量全局状态冲突。

---

# 十七、正确方案就是 Git Worktree

这是 Codex / Cursor / Claude Code 当前共同采用的核心思想。

Codex 的当前产品明确提供多 Agent + Worktree，使多个 Agent 可以在同一个 repo 上并行而不互相污染；Cursor 的 Worktrees 也是“每个 task 一个独立 checkout”。([OpenAI][1])

所以 AAFE 应该直接原生实现：

```text
/data/projects/aafe-demo
```

作为：

```text
MAIN
```

然后：

```text
/data/projects/.aafe/worktrees/

├── A102/
│   └── repo/
│
├── B203/
│   └── repo/
│
└── C304/
    └── repo/
```

对应：

```text
Task A102
   ↓
branch: aafe/task/A102
   ↓
worktree: .aafe/worktrees/A102
```

```text
Task B203
   ↓
branch: aafe/task/B203
   ↓
worktree: .aafe/worktrees/B203
```

```text
Task C304
   ↓
branch: aafe/task/C304
   ↓
worktree: .aafe/worktrees/C304
```

---

# 十八、AAFE Workspace Manager

我建议把它做成独立模块：

```text
WorkspaceManager
```

API：

```typescript
interface WorkspaceManager {
  create(taskId: string): Promise<Workspace>;

  remove(taskId: string): Promise<void>;

  get(taskId: string): Promise<Workspace>;

  status(taskId: string): Promise<WorkspaceStatus>;

  execute(
    taskId: string,
    command: string
  ): Promise<CommandResult>;

  commit(
    taskId: string,
    message: string
  ): Promise<CommitResult>;

  push(taskId: string): Promise<PushResult>;

  createPR(taskId: string): Promise<PullRequest>;
}
```

核心原则：

> **Agent 永远不直接决定工作目录。**

Agent 只知道：

```text
workspaceId = W-A102
```

然后：

```text
Execution Manager
        ↓
Workspace Manager
        ↓
/.aafe/worktrees/A102
```

---

# 十九、Task → Workspace 必须是一对一

这是我强烈建议你固定下来的规则：

```text
1 Task
  ↓
1 Execution Session
  ↓
1 Workspace
  ↓
1 Branch
  ↓
0..1 PR
```

即：

```text
Task A102
    │
    ├── Session S102
    │
    ├── Workspace W102
    │
    ├── Branch aafe/task/A102
    │
    └── PR #102
```

这样整个生命周期非常清晰。

---

# 二十、三个任务的最终运行效果

群里：

```text
用户A：
@AAFE 修复登录超时

AAFE：
已创建 #A102
```

然后：

```text
用户B：
@AAFE 首页加载太慢，优化一下

AAFE：
已创建 #B203
```

然后：

```text
用户C：
@AAFE 增加权限校验

AAFE：
已创建 #C304
```

AAFE 本地：

```text
main
│
├── .aafe/worktrees/A102
│      └── aafe/task/A102
│
├── .aafe/worktrees/B203
│      └── aafe/task/B203
│
└── .aafe/worktrees/C304
       └── aafe/task/C304
```

三个 Agent：

```text
Agent A → A102
Agent B → B203
Agent C → C304
```

完全隔离。

---

# 二十一、每个 Worktree 甚至应该拥有独立 Runtime

这里比 Git Worktree 更进一步。

因为：

```text
git worktree
```

只解决：

```text
代码文件
```

但是不能完全解决：

```text
node_modules
.env
port
build cache
generated files
database
```

所以建议：

```text
Workspace
+
Runtime
```

例如：

```text
A102

workspace:
.aafe/worktrees/A102

runtime:
port = 41001
node_modules = isolated
cache = isolated
env = task scoped
```

B：

```text
B203

port = 41002
```

C：

```text
C304

port = 41003
```

如果任务需要启动 dev server：

```text
A102 → localhost:41001
B203 → localhost:41002
C304 → localhost:41003
```

这样才是真正意义上的并行。

---

# 二十二、Worktree 创建建议

例如：

```bash
git worktree add \
  .aafe/worktrees/A102 \
  -b aafe/task/A102 \
  main
```

B：

```bash
git worktree add \
  .aafe/worktrees/B203 \
  -b aafe/task/B203 \
  main
```

C：

```bash
git worktree add \
  .aafe/worktrees/C304 \
  -b aafe/task/C304 \
  main
```

然后 Agent 所有 command 都必须：

```bash
cd .aafe/worktrees/A102
```

或者更好：

```typescript
spawn(command, {
  cwd: workspace.path
});
```

**禁止 Agent 自己 `cd` 到主目录。**

---

# 二十三、还需要增加 Workspace Lock

这是 AAFE 很容易遗漏的。

即：

```text
Workspace A102
```

只能被：

```text
Session S102
```

使用。

建立：

```typescript
interface WorkspaceLock {
  workspaceId: string;
  taskId: string;
  sessionId: string;
  pid?: number;
  acquiredAt: number;
  heartbeatAt: number;
}
```

如果：

```text
A102
```

已经被 Agent 占用：

```text
Agent B
```

不能进入。

---

# 二十四、但是 Git Branch 也需要 Lock

Git 本身不允许同一个 branch 被多个 worktree 同时 checkout。

这反而是好事。

AAFE 应该利用这个机制。

规则：

```text
Task A102
→ branch aafe/task/A102
→ workspace A102
```

branch 与 workspace 一一对应。

---

# 二十五、PR 生命周期也应该绑定 Task

最终：

```text
Task
 ↓
Workspace
 ↓
Branch
 ↓
Commit
 ↓
PR
```

例如：

```text
A102

status:
REVIEW

branch:
aafe/task/A102

commit:
9a82fd

PR:
#102

review:
pending
```

群里：

```text
AAFE：

#A102 已完成

PR #102
修改文件：8
测试：passed
```

---

# 二十六、群消息的多任务引用，我建议增加 Task Card

不要完全依赖自然语言。

AAFE 每个任务创建之后，在群里形成一个稳定的 Task Card：

```text
┌──────────────────────────────┐
│ 🤖 AAFE Task #A102           │
│                              │
│ 修复登录接口 timeout          │
│                              │
│ 👤 @张三                     │
│ 🌿 aafe/task/A102             │
│ ⚙️ Running                   │
│                              │
│ [查看] [暂停] [继续] [取消]   │
└──────────────────────────────┘
```

之后用户回复这个 Card：

```text
把 timeout 改成 10s
```

Resolver：

```text
replyTo → A102
```

几乎 100% 准确。

---

# 二十七、甚至可以设计 Task Mention

建议 AAFE 自己定义：

```text
#A102
```

或者：

```text
@AAFE[A102]
```

用户：

```text
#A102 把 timeout 改成 10 秒
```

这样是最可靠的。

自然语言理解只是 fallback。

---

# 二十八、多人协作也应该绑定 Task Participant

例如：

```text
A102

participants:

userA = owner
userB = collaborator
userC = reviewer
```

这样：

```text
userA：继续处理
userB：把 timeout 调一下
```

都可以进入 A102。

但是：

```text
userD
```

如果完全没有 Task 关系：

```text
不要直接允许修改 A102
```

可以：

```text
@AAFE 申请加入 A102
```

或者由 Owner 授权。

---

# 二十九、建议建立 Task Permission

例如：

```typescript
type TaskRole =
  | 'owner'
  | 'collaborator'
  | 'reviewer'
  | 'observer';
```

权限：

```text
owner
  ├── modify
  ├── execute
  ├── cancel
  └── merge

collaborator
  ├── modify
  └── execute

reviewer
  ├── read
  └── review

observer
  └── read
```

这样多人群聊不会出现：

> 任意一个群成员的一句话都能控制正在运行的代码 Agent。

---

# 三十、Context Resolver 最终决策流程

我建议 AAFE 最终固定成：

```text
                    WeCom Message
                           │
                           ↓
                  Message Normalizer
                           │
                           ↓
                ┌────────────────────┐
                │ Explicit Resolver  │
                └─────────┬──────────┘
                          │
                 task id / reply / quote
                          │
                    ┌─────┴─────┐
                    │           │
                   YES          NO
                    │           │
                    ↓           ↓
                  Task      Candidate Search
                                │
                   ┌────────────┼────────────┐
                   ↓            ↓            ↓
                UserTask    GroupTask     Semantic
                                │
                                ↓
                         Candidate Ranking
                                │
                                ↓
                          Context Agent
                                │
                                ↓
                         Confidence Gate
                                │
               ┌────────────────┼────────────────┐
               ↓                ↓                ↓
          CONTINUE          AMBIGUOUS         NEW TASK
               │                │                │
               ↓                ↓                ↓
             Task             ASK              Create
```

---

# 三十一、这里还有一个非常重要的优化：Task Candidate Cache

不要每次把群里的几十个任务全部塞给 LLM。

建立：

```text
Task Index
```

例如：

```text
A102
keywords:
login
timeout
auth
登录
接口
超时

files:
src/auth/*
src/login/*

participants:
userA
userB
```

B203：

```text
keywords:
home
performance
loading
首页
性能
加载
```

C304：

```text
keywords:
permission
role
auth
权限
角色
```

消息：

```text
timeout 改成 10s
```

先做本地：

```text
Keyword
+
Task metadata
+
Participant
+
Recent task
```

筛到：

```text
A102 0.81
B203 0.12
C304 0.05
```

再让 LLM 判断。

这样 Token 消耗会非常低。

---

# 三十二、Task Context 也不要完全放数据库

建议：

```text
.aafe/
│
├── tasks/
│   ├── A102.json
│   ├── B203.json
│   └── C304.json
│
├── messages/
│   └── ...
│
├── workspaces/
│   ├── A102.json
│   └── B203.json
│
├── runtime/
│   └── ...
│
└── index/
    └── tasks.json
```

或者：

```text
SQLite
```

我更推荐：

**SQLite + JSON artifact**

组合：

```text
SQLite
    ↓
运行态 / 索引 / Lock / Message relation

JSON / Markdown
    ↓
Task specification / Agent context / execution history
```

这和你之前 AAFE 的 Skills / Memory 本地化思路也是一致的。

---

# 三十三、AAFE 的核心数据库关系

可以直接按照这个模型落地：

```text
Group
 │
 ├── Message
 │      │
 │      └── Task
 │
 └── Task
       │
       ├── Participants
       │
       ├── Conversation
       │
       ├── ExecutionSession
       │
       ├── Workspace
       │       │
       │       ├── GitBranch
       │       ├── Runtime
       │       └── Lock
       │
       ├── Commit
       │
       └── PullRequest
```

---

# 三十四、和 Codex / Cursor 的设计对比

| 能力             | Codex  | Cursor     | Claude Code | **AAFE 建议**           |
| -------------- | ------ | ---------- | ----------- | --------------------- |
| 多 Agent        | ✅      | ✅          | ✅           | ✅                     |
| Worktree       | ✅      | ✅          | ✅           | ✅                     |
| 并行任务           | ✅      | ✅          | ✅           | ✅                     |
| Task Context   | Thread | Agent/Task | Session     | **Task 一等实体**         |
| 群聊上下文          | ❌      | ❌          | ❌           | **核心能力**              |
| 消息引用           | ❌      | ❌          | ❌           | **核心能力**              |
| 多人协作           | 有限     | 有限         | Agent Teams | **群级协作**              |
| Task Resolver  | 内部     | 内部         | 内部          | **独立 Resolver Agent** |
| 本地 Worktree    | ✅      | ✅          | ✅           | **必须**                |
| Task → Branch  | ✅      | ✅          | ✅           | **强绑定**               |
| Task → PR      | ✅      | ✅          | 可           | **强绑定**               |
| Ambiguous Gate | 内部     | 内部         | 内部          | **显式门禁**              |
| WeCom          | ❌      | ❌          | ❌           | **AAFE核心差异化**         |

目前 Codex 的方向已经非常接近你需要的后半段：**多 Agent + 独立 Worktree + 长任务管理**。OpenAI 对 Codex 的定位也已经明确转向多 Agent 并行、Worktree 和持续后台任务。([OpenAI][1]) Cursor 同样已经把 Worktree 和 Multitask 做成 Agents Window 的核心能力。([Cursor][3])

所以 AAFE **没必要重新发明 Agent Workspace**，应该直接借鉴这一层；真正需要自己创新的是：

> **WeCom Message → Task Context Resolution → Group Collaboration → Local Workspace Orchestration**

---

# 三十五、我认为 AAFE 最佳最终架构

```text
┌────────────────────────────────────────────────────────────┐
│                        WeCom Bot                            │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                    Message Gateway                          │
│                                                            │
│  message / reply / quote / @ / sender / group              │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                  Context Resolver                           │
│                                                            │
│  1. Explicit Task ID                                        │
│  2. Reply / Quote                                           │
│  3. User Active Task                                        │
│  4. Group Active Tasks                                      │
│  5. Semantic Search                                         │
│  6. LLM Resolver                                            │
│  7. Confidence Gate                                         │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                     Task Manager                            │
│                                                            │
│  Task / Participant / Message / State / History             │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                  Agent Orchestrator                         │
│                                                            │
│ Planner → Coder → Tester → Reviewer → PR                    │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                 Execution Manager                           │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                  Workspace Manager                           │
│                                                            │
│ Task A ── Worktree A ── Branch A ── Runtime A              │
│ Task B ── Worktree B ── Branch B ── Runtime B              │
│ Task C ── Worktree C ── Branch C ── Runtime C              │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│                       Git / PR                              │
│                                                            │
│ Commit → Push → PR → Review → Merge                         │
└────────────────────────────────────────────────────────────┘
```

---

# 三十六、最终我建议 AAFE 直接落地这 8 个核心模块

```text
packages/
├── wecom-gateway/
│
├── message-context/
│
├── context-resolver/
│
├── task-manager/
│
├── agent-orchestrator/
│
├── execution-manager/
│
├── workspace-manager/
│
└── git-provider/
```

其中最重要的不是 Agent 本身，而是：

```text
context-resolver
task-manager
workspace-manager
```

这三个模块决定了 AAFE 能不能真正成为一个**企微里的 Agent Development Platform**。

---

## 最终原则可以压缩成一句话

**不要让 AAFE 把“企微消息”直接交给 Agent；必须先把消息解析成 Task，再把 Task 映射成独立 Workspace，最后让 Agent 在 Workspace 中执行。**

也就是：

```text
企微消息
   ↓
Context Resolver
   ↓
Task
   ↓
Execution Session
   ↓
Worktree
   ↓
Branch
   ↓
Agent
   ↓
Commit
   ↓
PR
```

而你提出的“三个任务同时跑、三个分支、三个 PR、但 Agent 都运行在同一台本地机器”这个场景，**标准答案就是 3 个 Git Worktree + 3 个独立 Execution Session，而不是 3 个 Agent 共用一个代码目录**。这正是目前 Codex、Cursor、Claude Code 多 Agent 并行设计的共同核心。([OpenAI][1])

**如果作为 AAFE 下一阶段开发，我建议优先实现顺序是：**

```text
P0
Message Context
      ↓
Task Context
      ↓
Task Resolver
      ↓
Task ID / Reply / Quote

P1
Task Manager
      ↓
Task State Machine
      ↓
Task ↔ Agent Session

P2
Workspace Manager
      ↓
Git Worktree
      ↓
Branch Isolation
      ↓
Workspace Lock

P3
Runtime Isolation
      ↓
Port / ENV / Cache / Process Isolation

P4
PR Manager
      ↓
Commit / Push / PR / Review

P5
Group Collaboration
      ↓
多人 Task Participant
      ↓
Task 权限
      ↓
跨 Task 协作
```

这个顺序比较关键：**先把“消息属于哪个 Task”解决，再解决“Task 在哪里执行”，最后才是多 Agent 协作。** 否则前面上下文关联不稳定，后面的多 Agent 越强，反而越容易把错误任务执行得非常彻底。

[1]: https://openai.com/index/introducing-the-codex-app/?utm_source=chatgpt.com "Introducing the Codex app | OpenAI"
[2]: https://code.claude.com/docs/en/agents?utm_source=chatgpt.com "Run agents in parallel - Claude Code Docs"
[3]: https://cursor.com/changelog/04-24-26?utm_source=chatgpt.com "Multitask, Worktrees, and Multi-root Workspaces · Cursor"
