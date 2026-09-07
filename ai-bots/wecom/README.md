# AAFE 企微长连接机器人

企微是 AAFE 的会话入口。长连接接收文本、引用和媒体消息，经规则与意图分类后直接回答，或交给 TaskManager 异步执行。一个 Bot 应只运行一个常驻进程。

## 公共接入与启动

在 `ai-bots/wecom` 下安装依赖，复制 `wecom.local.json.example` 为 `wecom.local.json`，然后运行 `npm start`。

首次使用还需在项目根安装依赖（包含 Cursor SDK），再在本目录安装企微 SDK。准备好企微智能机器人的长连接 Bot ID 和 Secret，由服务环境注入 `WECOM_BOT_ID`、`WECOM_BOT_SECRET`，或填写本地 JSON 的 `botId`、`secret`。下面的 JSON 示例均假设这两个凭证已从服务环境注入。

`npm start` 从本目录运行时将项目根设为 `../..`，工作区的相对 cwd 也以该项目根解析；示例使用绝对路径避免歧义。不要同时启动两个连接同一 Bot 的进程。替换配置前保留旧文件，并先结束运行任务；切换配置后重启现有服务。

本地配置至少需要 `botId`、`secret`。默认 Cursor 后端还需要 `apiKey`；环境变量 `WECOM_BOT_ID`、`WECOM_BOT_SECRET`、`CURSOR_API_KEY` 优先。不要提交凭证文件。

也可运行 `aafe wecom --root=/path/to/project --config=/path/to/wecom.local.json`。选定本地目录使用 local runtime，远程 repository 使用 Cursor Cloud。无选定仓库时，仓库分析和代码修改都会询问目标，不默认分析 Bot 自己的代码。

## 配置分组与兼容性

顶层仅放公共设置：`provider`、企微凭证、工作区、日志、`intent`（独立 HTTP 分类/问答）、`repo`（Git 凭证）和 TAPD。两套引擎配置独立保留，切换只需修改 `provider` 并重启。

`wecom.local.json` 分组示例（企微凭证由服务环境注入）：

```json
{
  "provider": "codex",
  "cursor": {
    "apiKey": null,
    "apiKeyEnv": "CURSOR_API_KEY",
    "model": null,
    "models": { "rules": [] },
    "autoCreatePR": false
  },
  "codex": {
    "CODEX_API_KEY": "",
    "executable": "codex",
    "model": null,
    "timeoutMs": 1800000
  },
  "currentWorkspace": "local",
  "workspaces": [{ "id": "local", "cwd": "/absolute/path/to/local-git-repo" }]
}
```

`cursor` 支持 `apiKey`、`apiKeyEnv`、`model`、`models`、`mcp`、`autoCreatePR`、`skipReviewerRequest`；`codex` 支持 `CODEX_API_KEY`（兼容旧 `apiKey`）、`executable`、`model`、`timeoutMs`。原有顶层 `apiKey/model/models` 作为 Cursor 兼容字段，`codexApiKey` 作为 Codex 兼容字段；新配置优先使用分组，不要两处重复填写。

同一参数优先使用进程环境，然后是分组字段，再回退旧字段或项目默认值。已有项目级 Cursor Key 仍优先于旧顶层 `apiKey`，保持旧行为；分组 `cursor.apiKey` 优先于项目 Key。多份本地文件中的同名引擎分组按字段合并，高优先级文件覆盖同名字段；嵌套的 models/mcp 整块覆盖，不拼接规则数组。

## Cursor：接入配置

Cursor 通过项目依赖中的 `@cursor/sdk` 执行，Bot 使用 Cursor API Key，不使用 Codex 的登录态。将 `CURSOR_API_KEY` 注入服务进程；也支持本地 JSON 的 `cursor.apiKey`，但不要提交真实凭证。

### 本地工作区

`wecom.local.json`：

```json
{
  "provider": "cursor",
  "currentWorkspace": "app",
  "workspaces": [
    { "id": "app", "name": "本地项目", "cwd": "/absolute/path/to/local-git-repo" }
  ]
}
```

在本目录启动（先由密钥管理器或服务环境提供企微凭证和 `CURSOR_API_KEY`）：

```sh
AAFE_WECOM_PROVIDER=cursor npm start
```

本地任务默认尝试使用独立 Git worktree；不能建立时回退到同目录互斥执行。`cursor.model` / `AAFE_WECOM_CURSOR_MODEL` 是默认模型配置，不会覆盖所有 `cursor.models.rules` 命中结果。企微任务、分类和问答按规则选模型；模型是否可用以本账号为准，可用本目录的 `npm run check:models` 检查 Cursor 模型规则（该命令不是 OpenAI 模型检查）。

### Cursor Cloud 工作区

将上面的工作区列表与当前工作区替换为：

```json
{
  "provider": "cursor",
  "currentWorkspace": "cloud-app",
  "workspaces": [
    { "id": "cloud-app", "name": "远程项目", "repository": "owner/repo", "baseBranch": "main" }
  ]
}
```

Cloud 还要求 Cursor 账号有目标仓库访问权限，并通过项目运行就绪检查；API Key 本身不等于仓库授权。仓库 GitHub/工蜂凭证与模型 Key 分开配置在 `repo` 中。不要把此远程工作区直接用于下文的 Codex 引擎。

## OpenAI（Codex / ChatGPT）：接入配置

已接入官方 `codex exec --json`，支持创建、独立会话续跑、取消、进度和用量记录。`ChatGPT：` 是 Codex 别名，不是 ChatGPT 网页自动化；所用账号由服务进程的 CLI 登录方式决定。

先安装官方 Codex CLI，在运行 Bot 的同一系统用户下执行 `codex login` 用 ChatGPT 账号登录，再执行 `codex login status` 检查。也可通过 `codex login --with-api-key` 的 stdin 登录方式使用 API Key。参见 [官方认证说明](https://learn.chatgpt.com/docs/auth)。不要将登录文件或 Key 发到群里。

### 工作区配置

`provider` 必须填写 `codex`，不是 `openai` 或 `chatgpt`；后两者不是当前代码支持的 provider 值。在现有 `wecom.local.json` 合并以下配置，保留 botId/secret（或从环境注入）：

```json
{
  "provider": "codex",
  "workspaces": [{ "id": "app", "cwd": "/absolute/path/to/local-git-repo" }],
  "currentWorkspace": "app"
}
```

### 方式 A：ChatGPT 账号登录

在服务所用的同一系统用户、同一 CODEX_HOME 下执行：

```sh
codex login
codex login status
```

完成浏览器登录后，在本目录启动：

```sh
AAFE_WECOM_PROVIDER=codex npm start
```

希望使用 ChatGPT 登录态时，清除服务环境中不需要的 `CODEX_API_KEY`、`OPENAI_API_KEY`，并移除本地文件中的 `codex.CODEX_API_KEY` / `codex.apiKey` / `codexApiKey` / OpenAI Key 配置，避免显式 Key 改变认证方式。仅更换 `ChatGPT：` 消息前缀不会切换认证方式。

### 方式 B：OpenAI API Key

直接在本目录的 `wecom.local.json` 中填写 `codex.CODEX_API_KEY`，无需 export，也无需执行 API Key 登录命令。当前配置和示例已预留空字段：

```json
{
  "provider": "codex",
  "codex": {
    "CODEX_API_KEY": "",
    "executable": "codex",
    "model": null,
    "timeoutMs": 1800000
  }
}
```

将空字符串替换为你的实际 Key，保留原有企微凭证和工作区配置，然后在本目录运行（已有实例需先停止）：

```sh
npm start
```

Key 持久保存在本地配置文件中，重启后重新读取；Bot 仅将解析后的 Key 传给 Codex 子进程，不写入 CLI 登录文件，不复用 Cursor Key。这仍是 CLI 执行后端，并非新增通用 OpenAI API provider。空字符串表示未配置 Key，会回退其他兼容来源或已有 CLI 登录态。

为兼容旧部署，进程环境 `CODEX_API_KEY` / `OPENAI_API_KEY` 仍优先；之后依次读取 `codex.CODEX_API_KEY`、旧 `codex.apiKey`、旧顶层 `codexApiKey`（顶层 OpenAI Key 别名仍兼容）。若希望以文件值为准，请清理服务中遗留的环境 Key。不要在多个位置重复填写。

此文件包含明文凭证，不要提交 Git、发到群里或放进日志；限制文件访问权限，仅让服务账号读取。示例文件始终保留空 Key。认证与计费差异见 [OpenAI 官方认证说明](https://learn.chatgpt.com/docs/auth)。

### CLI 路径、模型与超时

| 配置项 | 当前生效方式 |
| --- | --- |
| 执行引擎 | JSON `provider: "codex"` 或进程环境 `AAFE_WECOM_PROVIDER=codex` |
| CLI 路径 | 进程环境 `AAFE_WECOM_CODEX_EXECUTABLE` → `codex.executable`；默认从 PATH 找 `codex` |
| Codex 模型 | 进程环境 `AAFE_WECOM_CODEX_MODEL` → `codex.model`，独立于 Cursor 模型 |
| 模型后备值 | 默认 provider 为 Codex 时可读进程环境 `AAFE_WECOM_MODEL` / `WECOM_MODEL`，或项目 `agent.provider=codex` 下显式 `agent.model`；未指定则由 CLI 决定 |
| 任务超时 | `codex.timeoutMs`（正数，毫秒），默认 30 分钟 |

例如服务 PATH 不含 Codex 时，在本目录启动：

```sh
AAFE_WECOM_PROVIDER=codex \
AAFE_WECOM_CODEX_EXECUTABLE=/absolute/path/to/codex \
npm start
```

JSON 的 `codex` 分组现已完整保留并生效，修复了早期版本丢弃该分组的问题。Bot 的 `.env` 文件也支持 `AAFE_WECOM_CODEX_EXECUTABLE` / `AAFE_WECOM_CODEX_MODEL`；进程环境仍优先。

### 支持范围与安全

仅面向可信成员、可信仓库部署，建议独立服务账号及隔离环境。模型工具能读取沙箱允许访问的文件，沙箱不是凭证保险箱。

当前仅支持已克隆的本地 Git 工作区；远程 repository 配置明确报 `codex-local-workspace-required`。不支持 Codex Cloud 调度、自动 PR 元数据提取或 Cursor MCP 配置转换。Codex 使用自身本机配置的 MCP；外部 MCP 写操作不受文件只读沙箱约束，必须另外限制。Bot 不自动登录、不自动重试付费失败、不绕过沙箱。

默认 Codex 时，意图由规则处理，普通问答在临时目录以只读 ephemeral 模式执行。若配置 `intent.endpoint/model`，分类和问答仍优先使用 HTTP。任务分析使用 `read-only`，编码使用 `workspace-write`，权限不足时失败而非自动提权。

会话 ID 保存于 `task.codex.agentId`，续跑只发增量并指定该 ID；CLI 会话文件必须保留在同一服务账号的 CODEX_HOME。会话丢失时失败，不盲目重建。取消终止所拥有的进程组，2 秒后仍未结束则强制终止。Bot 异常退出后将运行中的 Codex 任务标记中断，不自动重放。若服务被强杀，明确续跑前需确认遗留进程已结束；生产进程管理器应清理整个服务进程组。

`codex.runs[].usage` 保存输入、缓存输入、输出和总 Token；费用未知为 null。任务提示预算默认 12000，不包含 CLI 自动加载内容、历史、工具及输出，不是计费总额上限。Codex 不提供此实现可用的输出硬上限。

## Cursor 与 OpenAI：切换配置

### 切换默认引擎（重启后对新任务生效）

在本目录选择一个命令启动现有 Bot，不要并行启动两个实例：

```sh
# Cursor：先准备 CURSOR_API_KEY
AAFE_WECOM_PROVIDER=cursor npm start
```

```sh
# OpenAI / Codex：先准备 CLI 登录态或 OpenAI Key，并选定本地 Git 工作区
AAFE_WECOM_PROVIDER=codex npm start
```

也可修改 JSON 的 `provider` 为 `cursor` / `codex` 后重启。引擎优先级：进程环境 `AAFE_WECOM_PROVIDER` → `WECOM_PROVIDER` → 本地配置 `provider` → 项目 `agent.provider` → 默认 Cursor。如果环境变量仍指向旧引擎，仅改 JSON 不会切换。

两套凭证可以同时保留，但彼此不通用；切换到 ChatGPT 登录方式需额外清理 OpenAI Key 来源。不要使用通用 `AAFE_WECOM_MODEL` / `WECOM_MODEL` 同时承载两家的模型 ID：切换前检查或清除它们，Codex 优先使用 `AAFE_WECOM_CODEX_MODEL`。本地 JSON 的 `cursor.model`、`cursor.models.rules`（以及旧顶层兼容字段） 不用于选择 Codex 任务模型。

Cursor Cloud 切到 Codex 时，还需将 `currentWorkspace` 改成本地工作区；若同一会话已经用仓库卡片选择过远程仓库，应在企微重新选择本地仓库。引擎切换不会自动克隆仓库。

### 单条消息选择引擎（不重启）

默认 Cursor 时，准备好 Codex 登录态/Key 和本地工作区后，发送 `Codex：修复登录` 或 `ChatGPT：分析当前项目`，只为该新任务选择 Codex。普通 `做：需求` 仍使用默认引擎；普通问答和意图分类也不会因此切换后端。

当前没有对应的 `Cursor：需求` 强制选择命令，也没有 `/provider` 热切换命令。默认 Codex 时，要新建 Cursor 任务需修改默认配置并重启。已有任务保存自己的 provider，`继续 <TaskID>：补充` 保持原引擎，不会迁移会话；仍需保留该引擎所需的配置与认证。

### 接入自检

1. 确认服务环境的 provider、凭证来源、模型和工作区，避免旧环境变量覆盖 JSON。
2. Cursor 用 `npm run check:models` 检查模型配置；Codex 在同一服务账号下用 `codex login status` 检查已有登录，使用环境 Key 时还需确认服务实际收到 Key（不要打印 Key）。
3. 启动后在企微发送 `仓库` 核对当前目标，先发送一个只读分析请求，再按需验证 `继续 <TaskID>：补充`、`状态 <TaskID>`、`取消 <TaskID>`。真实分析/问答会消耗对应账号额度。
4. `codex-cli-not-found` 检查 PATH/可执行文件路径；`codex-local-workspace-required` 改选本地仓库；登录/权限错误检查服务账号与 CODEX_HOME。不要通过关闭沙箱解决配置问题。

## 消息与任务

| 输入 | 行为 |
| --- | --- |
| `做：增加手机号搜索` 或明确自然语言需求 | 创建隔离任务，确认后后台执行 |
| `Codex：修复登录` / `ChatGPT：分析当前项目` | 指定 Codex 本地引擎，不改变其他任务的引擎 |
| `分析当前项目的鉴权` | 选定仓库后使用 Cursor SDK plan 或 Codex 只读沙箱分析 |
| `分析 JavaScript 闭包`、普通概念问答 | 直接回答，不创建工作区；失败仍停留在问答路径 |
| `继续 <TaskID>：补充`、引用任务回复 | 在已有任务中续跑 |
| `按方案实现`、`提交 PR` | 结合任务绑定推进；发起人的明确操作可切换模式和模型 |
| `状态 <TaskID>`、`取消 <TaskID>`、`列表` | 本地控制路径，不调用分类模型 |
| `仓库`、仓库卡片 | 查询或选择工作区 |

任务关联优先级：显式 Task ID → 引用 → 唯一活跃任务 → 近期完成任务。多个候选、过期任务或低置信新需求会要求补充信息。群聊参与者可以显式补充，取消只允许发起人；卡片和文本共用访问校验。

新任务 ID 为 `task-wecom-<16位hex>-<8位hex>`，由消息身份稳定生成，兼容旧时间戳 ID。重复投递不会重复创建任务，同一条补充不会重复入队。相同文字但不同 msgid 仍视为不同消息。

## 配置与预算

分类和问答共用 `intent` 后端，输出预算独立。在 `wecom.local.json` 设置：

```json
{
  "intent": {
    "enabled": true,
    "endpoint": "https://your-gateway.example/v1/chat/completions",
    "model": "your-small-model",
    "tokenBudget": 4096,
    "maxOutputTokens": 256,
    "chatMaxOutputTokens": 768,
    "timeoutMs": 25000
  }
}
```

HTTP 网关需支持 `max_tokens`。未配置 endpoint/model 时按默认 provider 选择后端。输出硬上限仅用于 HTTP；Cursor/Codex 输入仍做预算检查。支持 durable Run 的 Cursor SDK 超时后会尝试取消底层 Run；旧版仅有 `Agent.prompt()` 的接口不能保证取消。

在项目 `.aafe.config.json` 设置 `agent.manager.tokenBudget`（默认 12000）与 `agent.manager.maxConcurrentTasks`（默认 4）。

任务预算约束 AAFE 实际提交的提示文本，不包含 SDK 自动加载的规则、提供方历史、内部工具调用或模型输出，不是计费总额上限。超限会明确失败，不静默截断用户要求。ContextAgent 先裁剪可恢复证据，核心要求仍超限时返回失败。

模型默认随任务保留；Cursor 任务发起人明确推进执行阶段时可重新路由，Codex 不使用 Cursor 阶段路由。参与者补充不提升模式。Cursor 分析使用 SDK `plan` 和只读提示，不等于操作系统级沙箱；Codex 分析使用 CLI `read-only` 沙箱。两者都不保证外部 MCP 写权限隔离。

## 恢复、进度和消耗

每轮保存结果快照；重建 Agent 时携带上一轮结论节选、Git 信息和记录位置。节选最多 6000 字符并标记截断，不额外调用模型生成摘要。正常续跑只发送增量，历史结论仍需核对当前代码。

运行中补充排队；显式继续已取消任务可以新开一轮，取消前未处理的补充不会自动重放。启动时尝试恢复 Cloud Run；失效本地 Run 需要明确续跑。企微已创建但尚未启动的任务也会恢复调度。

流消息过期后降级为推送；长时间无输出只提示状态，不据此取消仍可能运行的工具。

`.aafe/wecom/inbox.json` 保存最近 2048 个已处理消息的哈希回执，不保存正文。同会话常规消息顺序处理，状态和取消可绕过等待。回执是单进程、有限保留的防重机制，不是跨系统事务或无限期 exactly-once 保证。处理失败允许重试。

分类/问答日志使用 `llm.usage`；任务结果与 `cursor.runs[].usage` 保留提供方 usage，包括输入、输出、缓存输入、总量及费用，未知字段为 null。`estimatedContextTokens` 单独记录，不能当作实际消耗。Planner、Schema 修复和失败重试累计已观测消耗；缺失 usage 时不能据此推算费用。

Task 的 completed 表示执行结束；没有验证回调时，不代表已经获得测试通过证明。

## 验证

在仓库根运行 `npm run test:wecom-bot`、`npm run test:codex-runtime`、`npm run test:task-manager`、`npm run test:cost-controls`。测试使用临时目录和模拟后端，不连接真实企微、不消费模型额度。
