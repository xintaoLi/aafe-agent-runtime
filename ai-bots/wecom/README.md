# AAFE 企微长连接机器人

企微是 AAFE 的会话入口。长连接接收文本、引用和媒体消息，经规则与意图分类后直接回答，或交给 TaskManager 异步执行。一个 Bot 应只运行一个常驻进程。

## 消息展示与反馈交互

企微使用流式 Markdown 展示内容、模板卡片提供操作，不能原样嵌入 Agent 客户端的工具面板或文件 Diff。两种引擎共用展示协议，不交叉调用执行后端。

此前差距主要来自适配层：把 `blocked` 映射为失败；终态统一加绿色“最终结论”；公开进展被忽略、结束后只剩“分析步数”；流式结论与任务通知再次拼接，重复输出错误、需求及 ID。现在按持久化任务状态和结构化结果统一渲染：

| 场景 | 内容 | 卡片操作 |
| --- | --- | --- |
| 执行中 | 当前状态、公开进展、最近工作记录 | 查看状态 / 查看完整过程 / 终止 |
| 等待反馈 | ⏸ 等待补充 / 确认、需要用户回答的问题、已完成部分、后续步骤 | 查看状态 / 查看完整过程 / 补充信息 |
| 成功 / 失败 / 终止 | 对应状态、一次结果说明、可用文件/PR 信息 | 查看状态 / 查看完整过程 |

例如，代码和单测通过、但缺少浏览器测试 URL 时，展示为：

> ⏸ 等待补充 / 确认
>
> **需要你反馈**
>
> 请提供已部署本次改动的完整目标测试页面 URL。
>
> 代码修改、5 项测试、ESLint 和格式检查均已通过；Commit、PR、TAPD 回填等待浏览器验证。

这仍然是阻塞任务，不会展示“执行失败”或宣称已交付。Bot 不根据工具调用次数宣称测试通过；验证依据在展开视图中标注为“Agent 报告的验证记录”，业务核验与交付门禁保持不变。

- 发起人点击「补充信息」后直接回复 URL 或其他反馈，即续接指定任务，不调用意图分类模型。点击按钮本身不执行、不批准 Commit/PR/回填。补充前再次校验任务状态和操作权限，其他群成员不能借此授权执行。
- 发送「取消」只退出待补充输入，不取消原任务；「做：新需求」仍是新请求。输入绑定按用户/会话隔离，30 分钟有效，重启后可重新点击按钮；没有可用卡片时发送 `继续 <TaskID>：<反馈>`。
- 流式消息结束后发送与最终状态对应的新卡片，已完成任务不再提供终止按钮。卡片发送失败不会把任务结果改成失败，仍可用文本命令查询/续接。
- 「查看完整过程」展示最近一轮保留的公开工作记录（最多 80 个事件块，不是全部历史或完整原始日志）；内存快照缺失时从任务持久化事件恢复。公开进展与内部 reasoning 分离，不展示原始推理或工具完整响应；常见凭证字段与认证头在展示前脱敏。
- 普通 Markdown 按不超过 3000 UTF-8 字节分段，避免中文长消息超限；实时视图有 18000 字节上限，超过后保留首尾并标记省略。代码块/链接恰好跨分段时不能保证跨消息排版连续。
- 默认关闭企鹅动画，内容无变化不重复发心跳帧；保留长任务的流式到期转推送与无输出提示。展示、去重、分段、卡片和记录恢复均为本地处理，不新增模型调用。减少的是消息噪声和重复分类调用，不能据此声称模型总 Tokens 按固定比例下降。

回归：项目根运行 `npm run test:wecom-bot`，覆盖流式/推送、阻塞结果、权限、反馈续接、记录恢复和中文分段。重启现有 Bot 后生效，不会自动重跑历史任务；真实企微客户端的排版和卡片送达仍需上线验收。

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

当前仅支持已克隆的本地 Git 工作区；远程 repository 配置明确报 `codex-local-workspace-required`。不支持 Codex Cloud 调度；PR 信息来自下文交付记录及执行凭证核对。Codex worker 使用 `--ignore-user-config`，不继承个人 config.toml；同时关闭 plugins、apps、computer_use、browser_use、hooks。保留 CLI 认证和执行安全规则，只显式接入下面配置的业务 MCP，不读取 `.cursor/mcp.json`。项目级 MCP/规则仍需单独审核，不能把这些开关当作全局禁止任意 shell 操作的防火墙。Bot 不自动登录、不自动重试付费失败、不绕过沙箱。

### Codex 业务 MCP（与 Cursor 分开适配）

项目 `.aafe.config.json` 的 `agent.mcp.servers` 是共享的业务服务定义；Cursor 由 SDK 加载，Codex 转换为 CLI 原生 `mcp_servers`。`cursor.mcp` 只影响 Cursor；`codex.mcp` 覆盖共享设置，同名服务整体覆盖。Codex 不使用 Cursor 的 `settingSources`，也不继承个人 Codex MCP。

例如保留项目中现有的 `tapd_mcp_http`，只向 Codex 开放这一服务（在 `wecom.local.json` 的现有 `codex` 分组中合并，不删除 Key/executable）：

```json
{
  "codex": {
    "mcp": {
      "enabled": true,
      "allowedServers": ["tapd_mcp_http"]
    }
  }
}
```

未设置 `allowedServers` 时加载显式配置的全部启用服务；空数组不加载任何服务。支持 `config` 指定的 JSON 文件（`mcpServers`/`servers`）及内联 `servers`；不静默加载 Cursor 用户目录。HTTP 支持 `url` 和 `headers`，STDIO 支持 `command/args/env/cwd`。`${ENV_NAME}` 未展开会阻塞任务；HTTP 认证头通过临时子进程环境映射，不进入命令行或提示词。不要在 URL、command、args 中放凭证。中文服务 ID 自动映射为稳定 ASCII ID。

默认每个服务 `required=true`：由 Codex CLI 在模型执行前完成 MCP 初始化和工具发现，失败不应继续盲写；非必要服务可显式设置 `required:false`。可用 `enabled_tools/disabled_tools` 缩小工具范围。含 TAPD 链接的任务要求配置启用的 TAPD 服务（ID 含 `tapd`）；缺少服务时直接阻塞，不消耗模型调用。连接成功不等于已获得需求正文；正文读取失败仍必须阻塞。交付模式下显式配置的 MCP 工具调用走原生审批审查，业务确认仍遵守 AAFE workflow-mode。

### Codex Git 权限与阻塞结果

默认启用 Codex 原生交付通道：`workspace-write + on-request + auto_review`（CLI 必须支持 `codex exec --approve-for-me`，包括 resume）。仍保留沙箱和执行规则，不 chmod `.git`、不设置 full-access。Git 元数据写入和网络操作按需经过原生安全审查；审查拒绝、CLI 不支持或组织策略不允许时阻塞，不更换为绕过模式。[OpenAI Docs：自动审查](https://learn.chatgpt.com/zh-Hans/docs/sandboxing/auto-review)。自动审查可能增加模型用量，Bot 的主轮 usage 不保证包含全部审查开销。

每轮（包括续跑）读取目标项目原始安装目录的 `.aafe.config.json` 和 `.ai-agent` 流程技能/规则，不能通过修改任务 worktree 配置自行扩大权限。忽略配置文件也能从原始安装目录读取；绝不切换到主工作目录执行 Git。规则路径和内容指纹进入上下文，不重复塞入全部技能正文，指纹变化或上下文丢失时重新读取。缺少必要流程技能则明确阻塞。

交付不再由 Bot 硬编码 `feat/ticket` 分支或“一律禁止提交”。Codex 按实际 AAFE 技能处理分支命名/关联与主干、`submit.cli=git|gtm`、影响分析/自测、Commit、PR/MR 和回填。GitHub 优先 Token API（无需 gh），工蜂按 gtm/项目规则执行；reviewers/labels 必须随 PR/MR 应用。`aafe repo pr --config-root=<原始安装目录>` 只改变配置读取位置，Git/PR 执行目录仍是任务 worktree。仓库 Token 仅通过此编码子进程环境传递，不复用 Cursor Key、不写入参数或 remote URL；分析和普通问答不注入仓库 Token。

GitHub 凭据读取顺序：Bot `repo` 覆盖 → AAFE 运行目录 `.aafe.config.json` → 目标项目配置；进程已有 `GITHUB_TOKEN` / `GH_TOKEN` 保持优先。配置有 Token 不等于认证成功，也不代表有 Push/PR 权限。

- Git HTTPS（fetch/pull/push）使用 `Basic base64(x-access-token:TOKEN)`，由调用进程通过 `GIT_CONFIG_*` 注入仅作用于 `https://github.com/` 的认证头；直接运行普通 Git 命令，不叠加 `git -c http.extraheader=...`。
- GitHub REST API（PR/评论等）继续使用 Bearer；两种通道不可混用。Token 和 Base64 凭据均不得进入命令参数、remote URL、Git 配置文件或日志。
- 修复后重启 Bot 即可让新任务/续跑使用新认证逻辑，Token 无须重新配置。Codex 续跑提示显式纠正旧技能中的 Git Bearer 示例；已安装项目的技能文件仍建议通过新版 `aafe update` 同步。历史阻塞任务不会自动重跑。
- 回归命令：`npm run test:git-https-auth`，使用真实 Git 与本地 HTTP 服务、虚构 Token，验证 Basic 成功、Bearer 失败及跨主机不传认证头，不访问 GitHub。

Bot 默认覆盖目标项目的工作流模式（不修改项目 `.aafe.config.json`）。在 `wecom.local.json` 中配置独立分组，Cursor / Codex 共用交互策略，各自执行通道仍隔离：

```json
"workflow": { "mode": "auto", "intentConfidence": 0.7 }
```

`auto`（默认）使用 AAFE autonomous 自主判断；`ask` 强制询问；`project` 恢复继承目标项目 `mode.workflow`。非法模式按 ask。优先级为：任务发起人的明确会话限制 > Bot 覆盖 > 项目配置。覆盖在新任务和续跑时应用，重启 Bot 生效。Auto 不代表无条件 Commit/PR/回填，也不放宽沙箱权限。

ask 反馈续接：

- 意图澄清后可回复「仅分析，不修改」或「修改实现」；原需求只保留一份，保留最近 4 条反馈与附件，不层层拼接。回复「取消」放弃待澄清请求；明确的「做：新需求」按新请求处理。待澄清记录按用户/会话隔离，默认 30 分钟有效，保存在内存，Bot 重启后需重新提供请求。
- Commit / PR / 回填处于 blocked 且记录了待确认门禁时，发起人回复「好的 / 是 / 同意 / 跳过」可续跑唯一待确认任务，无须额外意图模型调用。多个候选或同时有其他进行中任务时，要求「继续 <TaskID>：同意/跳过」；引用消息沿用引用目标，不转到别的任务。
- 简短同意只对应当前门禁，不能用旧轮次的“是”授权新的回填，也不会将只读任务升级为开发。参与者回复不作为发起人授权。

自然语言请求先做意图分析，明确识别后路由到问答、只读分析、开发或续跑。置信度低于 `intentConfidence`（允许 0.5–1，缺省/非法为 0.7）、分类失败、未知类型或开发意图与只读标记冲突时，通过企微回复 ask 等待补充，不创建任务、不执行代码；同会话的补充消息带回待澄清文本。明确命令仍走命令路由，目标任务/仓库不唯一时继续询问。业务执行中的歧义按 AAFE Hard Ask 处理。

- 有效模式为 `ask`：Commit 与 TAPD 回填分别确认；“是”只对应当前待确认门禁，不授权后续所有步骤。通过企微原任务续跑承接确认。
- `mode.workflow=autonomous`：逐门禁输出 proceed/skip/ask 判定；仍遵守用户明确禁止、缺 URL/账号/需求歧义等 Hard Ask。
- Commit 跳过或 PR 失败仍继续评估回填；无 TAPD 关联或禁用 TAPD 时跳过回填，不强行要求三步都执行。
- TAPD 动态发现实际工具参数；处理结果只追加评论，PR 字段遵守配置/确认，状态按项目映射逐步到 doing，之后读取单据验证。禁止覆盖 description/test_focus、跳步或自动提测。

Codex 使用 `--output-schema` 返回结果及 `delivery` 门禁记录（commit/pr/tapd_backfill 的判定、状态、授权依据和实际产物）。Bot 自动核对 Commit HEAD/分支、PR URL 与仓库和成功 CLI 输出、TAPD 评论 ID/目标单据/MCP 成功回执与状态链；缺证据不会标完成，无需再提供外部 `verify` 才能交付。可额外提供 `verify` 执行业务验收。原生工具回执及时持久化至 `task.delivery`，续跑先核对已有产物，避免重复创建；写入超时且结果不明时必须读回确认，不能盲重试。MCP 响应无可识别的结构化 ID/状态时会阻塞，不能凭文字成功提示放行。此核对不等同于独立测试证明所有业务正确。

如需关闭自动交付，在 `wecom.local.json` 的 `codex` 分组中设置 `"delivery": { "enabled": false }`；此时保留 `never` 和旧的受控分支准备，不执行 Commit/Push/PR/回填。只读分析和普通问答始终不启用交付。修改后重启 Bot；历史误标任务不自动改写或重跑。

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

### 严格单引擎执行

一个 Bot 实例只执行当前 provider 的任务：Codex 不调用 Cursor SDK/模型接口，也不恢复 Cursor 历史任务；Cursor 不启动 Codex。两套配置可以保存，但不会同时传入执行器。跨引擎创建、续跑会返回 `task-provider-disabled`，历史记录保留不迁移。

`Codex：` / `ChatGPT：` 前缀只在当前 provider 为 Codex 时执行。切换引擎需修改配置并重启，没有跨引擎回退或热切换。

### 桌面授权弹窗与启动来源

从 Cursor 内置终端启动 Bot 时，macOS 可能把后代进程发起的 AppleScript 自动化请求归到 Cursor。此类“Cursor 想控制 Codex Computer Use”弹窗不等同于 Cursor 模型调用。本实现已关闭 Codex worker 的个人桌面插件继承；不会改动你的个人 Codex 配置，也不自动允许系统授权。

建议从独立 Terminal 或服务管理器启动 Bot，避免桌面应用作为父进程。仅设置 provider 不会改变已运行进程的父应用。修改隔离设置后要重启；旧 worker 不会被追溯修改。不需要桌面操作时拒绝自动化授权。

### 接入自检

1. 确认服务环境的 provider、凭证来源、模型和工作区，避免旧环境变量覆盖 JSON。
2. Cursor 用 `npm run check:models` 检查模型配置；Codex 在同一服务账号下用 `codex login status` 检查已有登录，使用环境 Key 时还需确认服务实际收到 Key（不要打印 Key）。
3. 启动后在企微发送 `仓库` 核对当前目标，先发送一个只读分析请求，再按需验证 `继续 <TaskID>：补充`、`状态 <TaskID>`、`取消 <TaskID>`。真实分析/问答会消耗对应账号额度。
4. `codex-cli-not-found` 检查 PATH/可执行文件路径；`codex-local-workspace-required` 改选本地仓库；登录/权限错误检查服务账号与 CODEX_HOME。不要通过关闭沙箱解决配置问题。

## 消息与任务

| 输入 | 行为 |
| --- | --- |
| `做：增加手机号搜索` 或明确自然语言需求 | 创建隔离任务，确认后后台执行 |
| `Codex：修复登录` / `ChatGPT：分析当前项目` | 当前 provider 为 Codex 时执行，否则拒绝跨引擎 |
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
