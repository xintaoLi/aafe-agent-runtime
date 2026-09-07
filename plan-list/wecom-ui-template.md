可以。基于你给出的两个企微入口，以及目前能够检索到的企业微信智能机器人协议资料，我建议 **AAFE Agent Bot 不要简单做成“企微 Markdown 回复”**，而是设计成一套类似 **Codex Agent 的任务状态 UI**：**思考过程可折叠、最终结论独立、运行中可终止、任务状态可持续更新**。

先说一个关键结论：

> **企微智能机器人目前的 WebSocket 长连接 + Stream + Template Card 组合，非常适合实现这套 UI。**
>
> Stream 负责 Agent 的实时状态/思考内容，Template Card 负责“终止”等可交互控制。企微支持模板卡片按钮事件回调，并可以更新卡片状态。([GitHub][1])

另外，企微 Stream 是**全量替换**模型，而不是简单 append token：同一个 `stream.id` 后续发送的内容会替换之前的显示内容。因此 AAFE 应该自己维护一个“当前 Agent UI 状态”，再周期性把完整状态发送给企微。([Tencent Cloud][2])

---

# 一、AAFE Agent Bot 最终 UI

建议把一次 Agent 执行设计成：

```text
用户
│
├── 需求：帮我分析 xxx 问题
│
▼
┌──────────────────────────────────┐
│ 🤖 AAFE Agent                    │
│                                  │
│ ● 思考中                         │
│                                  │
│   正在分析项目结构...             │
│   正在定位相关模块...             │
│   正在分析调用链...               │
│                                  │
│   ▼ 查看完整思考过程              │
│                                  │
├──────────────────────────────────┤
│                                  │
│ ✅ 最终结论                       │
│                                  │
│ 已定位到问题主要来自 XXX。        │
│ 建议修改：                        │
│ 1. xxx                            │
│ 2. xxx                            │
│ 3. xxx                            │
│                                  │
└──────────────────────────────────┘

          ⛔ 终止
```

但这里我建议稍微调整：

**“终止”不要直接放到 Stream 内容里面。**

应该采用：

```text
Stream Message
      │
      ├── Agent 思考区域
      │
      └── 最终结果区域

Template Card
      │
      └── ⛔ 终止
```

原因是 **Stream 本身主要负责展示，Template Card 才是交互事件载体**。企微模板卡片支持 `button_interaction`，点击后会产生 `template_card_event`，后台能够拿到 `event_key`、`task_id` 等信息。([UNPKG][3])

---

# 二、推荐的 Codex 风格 UI

我建议 AAFE 固定成下面四种状态。

## 1. Thinking

用户刚发送消息：

```text
🤖 AAFE Agent

⌛ 思考中

正在分析你的请求...
正在定位相关代码...
正在构建任务上下文...

▼ 查看完整思考过程

──────────────

⛔ 终止
```

默认只展示 **3 行**。

这是你要求的核心行为。

---

# 三、3 行不是截断 Agent 思考，而是 UI Preview

这一点非常重要。

不要让 Agent 真正只生成 3 行。

应该：

```text
Agent
 │
 ├── thinking_event 1
 ├── thinking_event 2
 ├── thinking_event 3
 ├── thinking_event 4
 ├── thinking_event 5
 └── ...
```

后台完整保存：

```json
{
  "thinking": [
    "分析用户需求",
    "定位相关模块",
    "读取项目结构",
    "分析调用关系",
    "检查历史任务",
    "判断修改范围"
  ]
}
```

企微 UI 只展示：

```text
分析用户需求
定位相关模块
读取项目结构

▼ 查看完整思考过程
```

点击展开以后：

```text
⌛ 思考过程

✓ 分析用户需求
✓ 定位相关模块
✓ 读取项目结构
✓ 分析调用关系
✓ 检查历史任务
✓ 判断修改范围
✓ 生成执行方案

▲ 收起
```

这样才能真正接近 Codex / Cursor Agent 的体验。

---

# 四、最终结果必须与 Thinking 完全分离

不要最终变成：

```text
思考：
...
...
...

结论：
...
```

而应该是两个明确的 UI Section：

```text
┌──────────────────────────────┐
│ ⌛ 思考过程                   │
│                              │
│ 正在分析...                   │
│ 正在定位...                   │
│ 正在检查...                   │
│                              │
│ ▼ 查看完整思考过程            │
└──────────────────────────────┘


┌──────────────────────────────┐
│ ✅ 最终结论                   │
│                              │
│ 问题定位：XXX                 │
│                              │
│ 原因：                        │
│ XXX                           │
│                              │
│ 建议：                        │
│ 1. XXX                        │
│ 2. XXX                        │
└──────────────────────────────┘
```

**Thinking 是过程信息，Final 是结果信息。**

这对你前面设计的 AAFE Agent 架构尤其重要，因为以后可以把：

```text
Thinking
Planning
Execution
Result
```

做成统一 Agent Event。

---

# 五、建议不要把“真实 Chain of Thought”直接暴露

这里建议 AAFE 的“思考”定义为：

> **Agent Progress / Reasoning Summary**

而不是模型原始 Chain-of-Thought。

例如：

❌ 不建议：

```text
我现在考虑是不是应该先调用 AST Agent，
但是又需要判断当前文件是否...
```

推荐：

```text
正在分析项目架构
正在定位目标模块
正在检查依赖关系
正在分析影响范围
```

也就是说：

```text
LLM Internal Reasoning
        ↓
Reasoning Summary
        ↓
AAFE Agent Event
        ↓
企微 UI
```

这样 UI 更稳定，也避免把内部推理细节直接作为产品能力暴露。

---

# 六、Agent UI 状态机

建议直接定义：

```text
CREATED
   │
   ▼
THINKING
   │
   ▼
PLANNING
   │
   ▼
EXECUTING
   │
   ├───────────────┐
   │               │
   ▼               ▼
COMPLETED       CANCELING
                   │
                   ▼
                CANCELED

任何阶段
   │
   ▼
FAILED
```

对应企微展示：

| Agent 状态    | UI      |
| ----------- | ------- |
| `created`   | 准备任务    |
| `thinking`  | ⌛ 思考中   |
| `planning`  | 🧠 制定方案 |
| `executing` | ⚙️ 执行中  |
| `completed` | ✅ 已完成   |
| `canceling` | ⏹ 正在终止  |
| `canceled`  | ⛔ 已终止   |
| `failed`    | ❌ 执行失败  |

---

# 七、真正关键：终止机制

这里不要设计成：

```text
用户点击终止
 ↓
企微
 ↓
AAFE
 ↓
告诉 Agent 停止
```

这么简单。

应该设计成：

```text
                  ┌───────────────┐
                  │  Agent Runtime │
                  └───────┬───────┘
                          │
                     task_id
                          │
             ┌────────────▼────────────┐
             │     Task Controller      │
             │                          │
             │ status                   │
             │ cancellationToken        │
             │ currentAgent             │
             └────────────┬────────────┘
                          │
              ┌───────────▼───────────┐
              │      Agent Worker      │
              │                       │
              │ Planner               │
              │ Code Agent            │
              │ Test Agent            │
              │ Analysis Agent        │
              └───────────────────────┘
```

点击：

```text
⛔ 终止
```

发送：

```json
{
  "event": "agent.cancel",
  "task_id": "task_xxx",
  "stream_id": "stream_xxx",
  "operator": "userid"
}
```

然后：

```text
企微
 ↓
template_card_event
 ↓
AAFE Bot
 ↓
TaskController.cancel(task_id)
 ↓
CancellationToken.abort()
 ↓
Agent Runtime
 ↓
停止当前 Agent
 ↓
释放 SubAgent
 ↓
关闭工具调用
 ↓
更新任务状态
```

---

# 八、终止不是“立即杀进程”

推荐定义：

```text
RUNNING
   │
   │ cancel()
   ▼
CANCELING
   │
   ├── 当前 Tool 可取消 → 立即停止
   │
   ├── 当前 LLM 请求可取消 → Abort
   │
   └── 当前不可取消操作 → 等待安全点
                     │
                     ▼
                  CANCELED
```

最终显示：

```text
⛔ 已终止

Agent 执行已被用户终止。

已执行：
- 项目结构分析
- 依赖关系分析
- 文件定位

未执行：
- 代码修改
- 测试执行
```

这个对于 AAFE 后面的多 Agent 架构非常重要。

---

# 九、企微层建议采用 Stream + Template Card

从目前可检索到的企微智能机器人实现资料来看，这个组合是比较匹配的。

企业微信智能机器人通过 WebSocket 长连接接收消息，并支持 Stream 回复；同时支持模板卡片及按钮交互事件。([GitHub][1])

所以 AAFE 推荐：

```text
                  AAFE Agent
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
   Stream Message             Template Card
        │                           │
        │                           │
        ▼                           ▼
  Thinking / Result             终止按钮
```

---

# 十、为什么不能把所有东西塞到 Template Card

因为你的 Agent 输出可能非常长。

比如：

```text
分析
2000 字

执行日志
5000 字

最终结果
3000 字
```

模板卡片不适合承担整个 Agent 输出。

所以：

### Stream

负责：

* Thinking
* Progress
* Final Result
* Markdown
* 长文本
* 实时刷新

### Template Card

负责：

* 终止
* 后续操作
* 重试
* 查看详情
* 继续执行
* 接受方案
* 拒绝方案

这就形成：

```text
Stream = Content Layer

Card = Control Layer
```

这个架构非常适合 AAFE。

---

# 十一、建议进一步升级成 Agent UI Protocol

不要在业务代码里直接：

```ts
sendWecomMessage(...)
```

应该建立统一协议：

```ts
interface AgentUIState {
  taskId: string;

  status:
    | 'thinking'
    | 'planning'
    | 'executing'
    | 'completed'
    | 'canceling'
    | 'canceled'
    | 'failed';

  thinking: {
    preview: string[];
    full: string[];
    expanded: boolean;
  };

  result?: {
    title: string;
    content: string;
  };

  actions: AgentAction[];
}
```

Action：

```ts
interface AgentAction {
  key: string;
  label: string;
  type:
    | 'cancel'
    | 'retry'
    | 'continue'
    | 'approve'
    | 'reject';

  enabled: boolean;
}
```

这样未来就不只是：

```text
⛔ 终止
```

而可以变成：

```text
┌──────────────────────────────┐
│ ⌛ Agent 执行中               │
│                              │
│ 正在分析代码...               │
│ 正在定位问题...               │
│ 正在生成修改方案...           │
│                              │
│ ▼ 查看完整过程                │
│                              │
│        ⛔ 终止                │
└──────────────────────────────┘
```

完成后：

```text
┌──────────────────────────────┐
│ ✅ Agent 已完成               │
│                              │
│ 最终结论                      │
│                              │
│ 已完成 xxx 修改。             │
│                              │
│ ▼ 查看执行过程                │
│                              │
│   🔄 重新执行    📋 继续      │
└──────────────────────────────┘
```

---

# 十二、Stream 更新策略

这里有一个很重要的实现细节。

**不要每个 token 都发送企微。**

因为 Stream 是全量内容替换模型，而且 SDK 侧也存在回复队列/ACK 管理。([GitHub][1])

推荐：

```text
Agent Event
     │
     ▼
UI State Store
     │
     ▼
Debounce 300~800ms
     │
     ▼
WeCom Stream
```

例如 Agent 连续产生：

```text
正在
正在分析
正在分析项目
正在分析项目结构
正在分析项目结构...
```

AAFE 不需要全部发送。

可以：

```text
300ms
 ↓
正在分析项目结构...
```

再：

```text
500ms
 ↓
正在分析项目结构
正在定位入口文件
正在分析调用关系
```

这样能够显著降低企微消息更新压力。

---

# 十三、Thinking Preview 算法

建议固定：

```ts
function getThinkingPreview(
  thinking: string[],
  limit = 3,
) {
  return thinking.slice(-limit);
}
```

注意这里应该取：

> **最后 3 个状态**

而不是最前面 3 个。

例如：

```text
完整：

✓ 分析用户需求
✓ 分析项目结构
✓ 定位入口
✓ 分析依赖
✓ 分析调用链
✓ 判断影响范围
✓ 生成修改方案
```

Preview：

```text
✓ 分析调用链
✓ 判断影响范围
✓ 生成修改方案
```

这样用户永远看到**当前 Agent 在干什么**。

---

# 十四、完成之后自动改变 UI

Thinking：

```text
⌛ 思考中

分析项目结构
定位目标模块
检查依赖关系

▼ 查看完整思考过程

⛔ 终止
```

↓

Completed：

```text
┌──────────────────────────────┐
│ ⌛ 思考过程                   │
│                              │
│ 已完成 7 个分析步骤           │
│                              │
│ ▼ 查看完整思考过程            │
└──────────────────────────────┘

┌──────────────────────────────┐
│ ✅ 最终结论                   │
│                              │
│ 问题位于 xxx 模块。            │
│                              │
│ 建议修改：                    │
│ 1. xxx                        │
│ 2. xxx                        │
└──────────────────────────────┘
```

**终止按钮消失。**

这是很关键的生命周期行为。

---

# 十五、终止后的 UI

点击：

```text
⛔ 终止
```

立即更新：

```text
⏹ 正在终止 Agent...

正在停止当前任务...
```

后台完成：

```text
⛔ Agent 已终止

任务已被用户终止。

已完成：
✓ 项目结构分析
✓ 文件定位
✓ 依赖分析

未完成：
○ 代码修改
○ 测试执行
```

然后把 Card 更新成：

```text
⛔ 已终止
```

不再显示可点击的“终止”。

---

# 十六、和你之前 AAFE 多任务上下文设计结合

这个 UI 最终应该绑定：

```text
conversation_id
        │
        ├── task_id
        │      │
        │      ├── stream_id
        │      ├── agent_run_id
        │      ├── parent_task_id
        │      └── status
        │
        └── message_id
```

因此：

```text
用户消息
   │
   ▼
Intent Router
   │
   ▼
Task Resolver
   │
   ▼
Agent Task
   │
   ├── task_id
   ├── stream_id
   └── agent_run_id
           │
           ▼
       Agent Runtime
           │
           ▼
       UI Event
           │
           ├── thinking
           ├── progress
           ├── result
           └── action
```

这样你前面提到的：

* 新任务
* 已有任务补充
* 群聊引用任务
* 多任务并行
* 当前回复对应哪个任务

都可以和这里统一起来。

---

# 十七、最终建议的 AAFE UI 协议

我建议最终直接定成：

```text
AAFE Agent UI Protocol
```

核心事件：

```ts
type AgentUIEvent =
  | AgentThinkingEvent
  | AgentProgressEvent
  | AgentResultEvent
  | AgentActionEvent
  | AgentStatusEvent;
```

例如：

```json
{
  "type": "thinking",
  "task_id": "task_001",
  "status": "thinking",
  "steps": [
    "正在分析项目结构",
    "正在定位目标模块",
    "正在分析调用关系"
  ]
}
```

最终：

```json
{
  "type": "result",
  "task_id": "task_001",
  "status": "completed",
  "result": {
    "title": "分析完成",
    "content": "问题主要位于 xxx 模块..."
  }
}
```

终止：

```json
{
  "type": "action",
  "action": "cancel",
  "task_id": "task_001"
}
```

---

## 最终架构我建议确定为

```text
                         企业微信
                            │
             ┌──────────────┴──────────────┐
             │                             │
       Stream Message                Template Card
             │                             │
             │                             │
       Agent UI Content              Agent Controls
             │                             │
     ┌───────┼────────┐                    │
     │       │        │                    │
 Thinking Progress  Result             ⛔ 终止
     │       │        │                    │
     └───────┴────────┘                    │
             │                             │
             └──────────────┬──────────────┘
                            │
                       AAFE Agent UI
                            │
                     Task Controller
                            │
                     Agent Runtime
                            │
               ┌────────────┼────────────┐
               │            │            │
            Planner       Agents       Tools
```

**一句话定方案：**

> **Stream 做 Codex 风格 Agent 内容面，Template Card 做 Agent 控制面；Thinking 默认只展示最后 3 条，完整思考可展开；Final Result 永远独立展示；“终止”通过 Template Card Event → TaskController → CancellationToken/AbortSignal → Agent Runtime 实现真正的任务取消。**

这套方案与企微当前智能机器人支持的 WebSocket、Stream、模板卡片、卡片事件机制是匹配的；现有 SDK 也已经验证了 `replyStreamWithCard`、`template_card_event`、`updateTemplateCard` 这一组合方式。([GitHub][1])

如果直接进入 AAFE 实现，我建议下一步就按这套方案继续细化成 **「企微 Agent UI Protocol + WebSocket 消息 Schema + Template Card Schema + Agent TaskController + 状态机 + 前后端完整时序图」**，这样可以直接作为 AAFE Agent Bot 的开发设计文档。

[1]: https://github.com/WecomTeam/aibot-node-sdk?utm_source=chatgpt.com "GitHub - WecomTeam/aibot-node-sdk: 企业微信智能机器人 Node.js SDK · GitHub"
[2]: https://cloud.tencent.com/document/product/1831/137051?utm_source=chatgpt.com "WorkBuddy Enterprise 企业微信智能机器人接入"
[3]: https://app.unpkg.com/%40wecom/aibot-node-sdk%401.0.7/files/README.md?utm_source=chatgpt.com "UNPKG"
