# AAFE 企微长连接机器人

企微是 AAFE 的会话入口。长连接接收文本、引用和媒体消息，经规则与意图分类后直接回答，或交给 TaskManager 异步执行。一个 Bot 应只运行一个常驻进程。

本目录是独立可选服务，不随 `@aafe/agent-runtime` 默认 npm 包发布。普通 CLI 安装及 `aafe update` 不需要加载或安装 WeCom。以下 Bot 启动命令需在包含本目录的 AAFE 源码中使用，默认 npm 安装包不会自动下载 Bot。

## 消息展示与反馈交互

### 测试登录：MCP 优先，本地授权缓存兜底

本地 Codex/Cursor 任务执行 E2E 时优先使用 Get Token MCP；没有对应 MCP 时才复用经过验证的本地登录缓存，失效后请求登录授权。非交互 Bot 不会擅自完成 SSO：会让用户在本地执行授权命令，完成后续跑任务。MCP 已配置但调用/校验失败时保持阻塞，不自动重试或切换登录身份。

任务指引使用 Bot 自带新版 `bin/aafe.js test`，通过 `--config-root=<原项目目录>` 读取 E2E 配置及登录缓存，并通过 `--mcp-config-root=<Bot根目录>` 提供 MCP 后备配置源；仍在隔离 worktree 内执行、保存用例和报告，不复制配置凭据、不切换到原仓库执行。恢复任务时同样附带此指引。Cursor Cloud 不传本机配置路径，需远端独立配置。

人工授权命令使用同一 CLI 的 `e2e auth`，带相同配置目录和本次 `--base-url`。授权缓存保存在原项目 `.aafe/e2e/auth/<env>.json`，原子写入、权限 0600；复用前验证，过期重新授权。不要提交缓存。MCP Cookie 仍只驻留内存，不写入缓存。默认通过 base URL 的状态码、最终同源地址和登录跳转特征验证；`e2e.auth.readySelector` 或同域 `checkUrl` 是可选的增强业务态校验。

企微流式消息的协议体只有 `content` 一个正文字段（`@wecom/aibot-node-sdk` 未提供 `thinking_content`），所以整个执行视图都渲染进这一个 Markdown 文档并原地刷新：**状态行**（准备任务 / 思考中 / 执行中 / 已完成 / 等待补充 / 确认）、**思考过程**（用 `<think>` 标签包裹，由企微客户端渲染成可折叠区域，内容是 Codex 的 reasoning 摘要与脱敏工具活动按时间自然交错）、**当前输出**，以及结束时的**最终结果**。

思考过程的来源是 `codex exec --json` 的 `item.completed` + `item.type="reasoning"`（`item.text` 为推理摘要）；工具活动来自 `item.started` + `command_execution`，同样只保留脱敏摘要（如「正在执行命令（3 次）」），原始命令与工具参数不对外发送。折叠区内是**全文**——闭合状态下不占屏幕空间，这才是「展开」的价值所在；只有主动推送的 markdown 消息因为没有流式渲染能力，才退回只显示最近 3 步的引用块形态。

Bot 不再使用 `F/Q/R` 引用编号、企鹅动画或模型名称，也**不发送任务操作卡片**：企微的模板卡片只能作为独立消息，无法内嵌到流式消息底部，因此控制入口统一为正文命令（`终止 <对话ID>`、`查看完整过程 <对话ID>`、`状态 <对话ID>`）。任务开始即创建 stream，正文始终是可读的完整视图而不是占位符；任务结束时同一条消息原地替换为最终结果。引用消息按企微原生引用内容续接。

**企微能力边界**（决定 UI 能做到什么程度，勿再按超出此范围的设计实现）：

- 流式消息体只有 `id` / `finish` / `content` / `msg_item` / `feedback` 五个字段，没有独立的「思考」字段。**思考过程的折叠展示靠 `content` 里的 `<think></think>` 标签触发客户端渲染**（被动回复消息文档原文：「若 content 中包含思考过程 `<think></think>` 标签，客户端会展示思考过程」）。标签名必须是 `think`——`<thinking>` 不被识别，内容会被客户端丢弃。`msg_item` 仅支持图片且只在结束帧可用。
- 模板卡片**始终是独立消息**，不能内嵌到流式消息内；`update_template_card` 必须由用户点击事件在 5 秒内触发，**无法用来自动刷新任务状态**。这是移除任务卡片的直接原因。
- 流式消息在 `finish: true` 之前被客户端视为「进行中」，**不支持选中、右键菜单和引用**；结束帧之后恢复。
- markdown 支持行内代码（等宽 + 灰底）、引用、分割线、列表、链接、加粗；**代码块与表格属于 markdown_v2**；颜色只有 `<font color="info|comment|warning">` 三档（绿 / 灰 / 橙红），不支持任意色值；`<details>` / `<summary>` 等 HTML 不被解析——**标准 Markdown 没有折叠语法**，折叠只能走 `<think>` 标签。

普通 Markdown 按不超过 3000 UTF-8 字节分段；流式消息超过企微时限后切换为主动 Markdown 推送。两者只改变传输方式，不改变或总结 Agent 内容。

回归：项目根运行 `npm run test:wecom-bot`。重启现有 Bot 后生效，不会自动重跑历史任务。

## 自然语言请求与澄清

### Codex 默认：Agent 主导

Codex 模式默认 `workflow.routing: "agent"`。普通消息、问答和任务补充直接交给 Codex，不经过本地分类模型、关键词意图判断或置信度门槛，也不调用 Cursor 分类后端。Codex 根据完整用户请求、补充、附件与 AAFE 技能决定回答、分析、实现或询问；传递消息不代表授予修改/提交权限。

本地仅负责身份权限、确定性控制命令、任务绑定、工作区隔离、并发/取消和产物核验。唯一活跃的本人任务直接接收补充；多个候选或较旧任务交给 Codex 协调，不再直接输出“多个未结束任务，请带显式 Task ID”。指定任务 ID/引用沿用已有绑定规则。明确新任务可发 `做：<新需求>`；单一会话内的新话题交给 Codex 理解，但不会因此自动切换仓库。未配置目标仓库时仍需选择工作区。

Codex 协调使用相同的 Codex 配置，在临时目录执行只读、无 MCP 的短轮次，读取当前用户在此会话中的任务摘要、需求链接及阻塞原因。它决定续接、新建或自然语言提问；同一需求有多个旧任务时可选择保留进展的相关任务，不要求用户手抄 Task ID，也不取消/合并旧任务。最多提供最近 40 项的限长摘要，超出时提示模型上下文不完整。返回 ID 必须属于已提供的本人任务，执行前再核验权限。失败只提示 Codex 暂不可用，不退回关键词分类。只有需要协调时增加这一次模型调用；唯一明确任务直接续接。

协调提问会保留原消息，下一条反馈连同原请求再次交给 Codex。`继续`、`好的` 等会话回复同样走这条链路，不在本地推断为某项提交授权。状态/停止等显式控制操作仍由本地处理。日志 `task.route.delegated/decided` 记录协调是否发生及选中任务，不记录凭据。

例如“使用 /path/local.settings.e2e.js 这里配置，结合 Playwright 执行测试”会续接待反馈任务并原样交给 Codex；不能再被本地置信度不足拦成 ask。续接复用原生 Codex 会话，已有只读/禁止提交限制保留在上下文中，由 Codex遵守。旧版未完成的意图澄清会合并原请求与反馈后交给 Codex，不继续本地重复询问。

启动日志为 `intentBackend: "codex-agent"`，普通消息记录 `intent.delegated`。问答不因缺交付技能在调用模型前被拦截；真正需要交付时仍须满足技能、授权和证据门禁。Agent 主导模式的只读请求将交付门禁记录为不适用，而不是自动提交。

如需回退旧路由，可设置 `"workflow": { "mode": "auto", "routing": "legacy" }`。Cursor 暂保留旧路由。下面的关键词、分类置信度与独立意图模型说明适用于 legacy 模式；`intentConfidence` 不再阻断 Codex Agent 主导模式的普通消息。

- “分析 PR，处理冲突，移除依赖”包含明确修改动作，按开发任务执行；“分析如何处理冲突”“仅分析，不修改”仍是只读分析。PR、bug 等名词本身不是修改授权。
- 澄清按原请求与最近反馈共同解析，最新明确的执行限制优先。补充仓库路径不会丢失原 PR、依赖清单或此前“仅分析”的限制，不要求重复套用固定句式。
- 支持在正文或补充中使用 `目标仓库：/path/to/repo，后续要求`；明确目标优先于默认仓库。多个明确目标会要求选择。未指定且没有当前仓库时，只询问仓库，不重新询问已经明确的执行意图。
- 已有唯一、近期的本人任务时，“目标仓库……更新 PR”“直接修改：……”按续接处理；有多个候选则询问目标，不重复创建 PR 任务。补充中的仓库与原任务不一致时停止续接，不能悄悄切换工作区；另起任务请使用“做：新需求”。
- 只清理开头独立的 @提及，保留 `@scope/package`、邮箱与 Git SSH 地址。PR 冲突处理请求中的依赖名称会原样交给 Agent。
- Codex 执行后端与意图分类后端是两回事：未配置独立 `intent.endpoint/model` 时，Codex 模式的分类后端是本地规则，不会偷偷调用 Cursor。明确动作走确定性规则；真正无法识别的请求仍 ask，不通过降低阈值让不明确任务自动执行。
- 启动日志 `bot.start.intentBackend` 和分类日志 `intent.resolved.intentBackend` 标明实际分类后端，便于区分规则未命中与模型调用失败。澄清记录目前保存在内存，服务重启后需重发原请求。

自然语言链路回归：`node scripts/test-wecom-intent-regression.js`（项目根执行）。包含原始 PR 多意图请求、旧版待澄清会话、自然语言仓库补充、只读限制和 @依赖保真；不会操作测试中引用的真实 PR。

## 公共接入与启动

运行环境统一使用 Node.js 24 LTS，当前基线为 `24.21.0`；Node 18/20 已结束官方支持，不再作为 Bot 运行环境。进入项目后可执行 `nvm use`（读取仓库根目录 `.nvmrc`），再安装依赖。

在 `ai-bots/wecom` 下安装依赖和 Chromium，复制 `wecom.local.json.example` 为 `wecom.local.json`，然后运行 `npm start`。

```bash
cd ai-bots/wecom
npm install
npm run playwright:install
```

WeCom Bot 自身固定依赖 `playwright` 与 `@playwright/test`，E2E 执行不要求每个业务项目重复安装 Playwright；业务项目仍需提供自身的 Vite/Webpack 启动配置。升级 Bot 依赖后应重新执行 `npm run playwright:install`，确保 Chromium 与当前 Playwright 版本匹配。

首次使用还需在项目根安装依赖（包含 Cursor SDK），再在本目录安装企微 SDK。准备好企微智能机器人的长连接 Bot ID 和 Secret，由服务环境注入 `WECOM_BOT_ID`、`WECOM_BOT_SECRET`，或填写本地 JSON 的 `botId`、`secret`。下面的 JSON 示例均假设这两个凭证已从服务环境注入。

`npm start` 从本目录运行时将项目根设为 `../..`，工作区的相对 cwd 也以该项目根解析；示例使用绝对路径避免歧义。不要同时启动两个连接同一 Bot 的进程。替换配置前保留旧文件，并先结束运行任务；切换配置后重启现有服务。

本地配置至少需要 `botId`、`secret`。默认 Cursor 后端还需要 `apiKey`；环境变量 `WECOM_BOT_ID`、`WECOM_BOT_SECRET`、`CURSOR_API_KEY` 优先。不要提交凭证文件。

统一显式启动入口为：

```bash
aafe bot start --wecom --root=/path/to/project --config=/path/to/wecom.local.json
```

若 `aafe` 指向默认 npm 安装包，请改用源码入口（并先安装本目录依赖）：

```bash
node /path/to/aafe-agent-runtime/bin/aafe.js bot start --wecom --root=/path/to/project --config=/path/to/wecom.local.json
```

`npm start` 和 `npm run dev` 已使用这个统一入口。命令在前台常驻，Ctrl+C 停止；`--no-recover` 禁止启动时恢复任务。`aafe bot --help` 查看用法；必须明确选择 Bot，不默认启动任何 Bot。旧 `aafe wecom` 命令保留兼容。默认 `aafe update` 仅更新 CLI / Runtime，不安装、更新或启动 Bot；Bot 源码及依赖独立维护。后续新增 Bot 在 CLI 的适配器注册表中接入，不增加普通 CLI 的启动依赖。

选定本地目录使用 local runtime，远程 repository 使用 Cursor Cloud。无选定仓库时，仓库分析和代码修改都会询问目标，不默认分析 Bot 自己的代码。

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

### 项目级 E2E 测试地址（本地 Codex / Cursor）

普通 `aafe` 在安装项目内运行，只读取该项目 `.aafe.config.json` 的单个 `e2e.baseUrl`；不需要配置多项目映射。

WeCom Bot 是多项目入口：在 `wecom.local.json` 的每个工作区配置独立地址，空字符串表示未设置，不会跨项目复用：

```json
{
  "workspaces": [
    {
      "id": "app",
      "cwd": "/absolute/path/to/local-git-repo",
      "e2e": {
        "baseUrl": "https://test.example.com/#/logs?bizId=2",
        "urlRole": "template"
      }
    },
    {
      "id": "another-app",
      "cwd": "/absolute/path/to/another-project",
      "e2e": {
        "baseUrl": "https://another-test.example.com",
        "urlRole": "origin"
      }
    }
  ]
}
```

`urlRole` 默认 `template`：复用环境、路由模式与业务参数拼接变更涉及的页面；`target` 表示完整目标页，`origin` 表示环境根地址。URL 必须是 HTTP(S)，不要包含账号密码或 Token。也可在目标项目 `.aafe.config.json` 配置同样的 `e2e.baseUrl` / `e2e.urlRole`，作为未配置工作区地址时的来源。

触发适用的 E2E 时，Bot 将工作区地址同时加入测试和登录命令。Agent 按以下顺序选址：本轮用户明确指定的测试地址 → TAPD 正文／需求描述中明确标注的应用测试地址 → 工作区配置 → 项目配置或指定的配置文件。任务地址只覆盖本次执行，不改写项目默认值；TAPD 链接本身不是测试地址。需求解析由 Agent 完成，不以关键词规则阻断。CLI 手动调用仍支持 `--base-url` 和环境变量覆盖。

建议在 TAPD 正文或企微需求消息中补充：

```text
测试地址：https://test.example.com/#/logs?bizId=2
地址用途：本次目标页面
部署情况：已部署本需求分支代码
验收步骤：模拟 Space 解析失败，检查下拉切换及无权限提示。
```

Bot 每次执行按任务绑定的工作区 ID 和路径读取配置，而不是读取聊天当前切换到的项目。重启 Bot 加载配置后，历史任务续跑也使用该项目更新后的地址；清空工作区地址则回退到该项目自己的 `.aafe.config.json`，不沿用旧任务地址快照。独立 worktree 的 `--config-root` 始终指向原项目；Bot 根目录只可作为 MCP 配置后备，不是其他项目的 E2E 默认配置来源。Bot 生成的测试／登录命令携带 `--project-e2e`，忽略服务级 URL 环境变量，防止串用地址；普通 CLI 不受影响。

只有地址不代表本次代码已部署：Agent 需核实验证范围并如实记录。登录仍走已配置的 Get Token MCP；没有该 MCP 才使用已验证的本地登录缓存／授权登录。配置地址不会自动开启无关任务的测试，也不会跳过登录、权限或明确的验收要求。

### 本地 Vite / Webpack 开发服务 + Playwright

#### Bot 项目初始化：Vite / Webpack

**新增项目的 E2E 初始化**：Bot 收到消息或切换工作区时会刷新 JSON 配置中的 `workspaces`，但选中或使用未初始化项目时不再前置询问，也不会把 E2E 初始化显示成当前任务的审批项。只有 Agent 判定本次确实需要 UI 验证时，才检查并安全初始化缺失模板；项目已有配置时直接采用。运维人员仍可显式发送 `初始化 E2E <项目ID>`，也可使用下方 CLI 脚本预先初始化。

成功初始化后在项目 `.aafe/e2e/project-init.json` 保存一次性标记；后续执行直接复用。已有有效开发配置也会直接采用，不强制迁移。显式并发初始化会合并为一次执行；失败不写成功标记。初始化成功不代表代理、登录或 E2E 验证已通过。

在 AAFE 源码根目录，按 `workspaces[].id` 初始化**指定本地项目**，不启动 Bot、不要求企微凭据：

```sh
node bin/aafe.js bot project init --wecom --workspace=app --dry-run
node bin/aafe.js bot project init --wecom --workspace=app
```

或在 `ai-bots/wecom` 目录使用脚本：

```sh
npm run project:init -- --workspace=app --dry-run
npm run project:init -- --workspace=app
```

支持 `--config=<Bot配置JSON>`、`--root=<Bot根目录>`；项目相对路径相对于 Bot 根目录，初始化始终落到该项目 `cwd`，不会使用聊天当前项目。配置示例：

```json
{
  "workspaces": [
    {
      "id": "app",
      "cwd": "/projects/vite-app",
      "e2eInit": {
        "tool": "vite",
        "configFile": "vite.config.ts",
        "proxyTarget": "https://app-test.example.com",
        "proxyPaths": ["/api", "/rest"]
      }
    },
    {
      "id": "admin",
      "cwd": "/projects/webpack-admin",
      "e2eInit": {
        "tool": "webpack",
        "configFile": "webpack.config.cjs",
        "proxyTarget": "https://admin-test.example.com",
        "proxyPaths": ["/api"]
      }
    }
  ]
}
```

`tool` / `configFile` 可省略：静态检查 `package.json`、开发脚本中的 `--config` 和 Vite/Webpack 配置文件名，不执行配置文件来探测。多种构建同时存在时用 `--tool=vite|webpack|custom` 选择；非默认入口可用 `--build-config=config/vite.dev.ts`。开发脚本中的额外 mode/env/root 参数需核对并在项目配置中适配，不会盲目执行或复制任意脚本内容。

- Vite：生成 `aafe.e2e.vite.mjs`，通过 Vite 配置加载器读取原配置（含 TS），保留插件、别名等构建设置；仅替换 E2E server/proxy，开启 `strictPort`，避免端口自动漂移。[Vite server 配置说明](https://vite.dev/config/server-options)
- Webpack：生成 `aafe.e2e.webpack.cjs`，支持标准对象/函数配置，保留构建插件。
- 自定义构建（如 bkmonitor-cli）：识别为 `custom`，优先记录已有 `npm run dev:e2e`，仅生成通用 Cookie/代理设置文件；仍需将设置接到自定义工厂，初始化不会冒充完成适配。

`e2eInit` 是初始化种子，不是测试运行时的第二份全局配置。落盘位置仍是目标项目 `.aafe.config.json → e2e.devServer`。已有自定义配置及生成文件不覆盖；上一版完全未修改的默认 Webpack 配置可迁移为识别出的构建类型。重跑会补缺并输出保留文件列表。远程仓库必须先有本地 checkout，不自动克隆。完成代理和登录验证条件检查后，在项目配置中启用 `devServer.enabled`。

#### 开发服务运行配置

`aafe init` 和 `aafe update` 在**执行命令的安装项目**内初始化：

- `.aafe.config.json → e2e.devServer`：启动 argv、代理目标、本地 URL 等项目配置，默认关闭。
- `local.settings.e2e.aafe.cjs`：独立代理配置，只转发当前浏览器请求 Cookie；不读取 `.cookie`。
- `aafe.e2e.webpack.cjs` 或 `aafe.e2e.vite.mjs`：根据构建类型生成的包装入口。

仅补缺，不覆盖已有文件/配置，`update --force` 也不覆盖这些项目自有文件；`update --dry-run` 不创建文件。不安装 Webpack、不启动服务、不获取 Token，也不改写已有 `local.settings.e2e.js`。每个 Bot 项目分别运行 init/update，不能在 Bot 根目录初始化一次后共用代理目标。

在目标项目 `.aafe.config.json` 合并（代理路径按项目实际接口填写）：

```json
{
  "e2e": {
    "enabled": true,
    "devServer": {
      "enabled": true,
      "command": ["npx", "--no-install", "webpack", "serve", "--config", "aafe.e2e.webpack.cjs"],
      "webpackConfig": "webpack.config.js",
      "url": "http://127.0.0.1:8011",
      "proxyTarget": "https://your-test-backend.example.com",
      "proxyPaths": ["/api", "/rest", "/apm"],
      "secure": true,
      "timeoutMs": 120000,
      "env": {}
    },
    "auth": {
      "mode": "reuse-or-headed",
      "readySelector": "[data-testid=logged-in-app]"
    }
  }
}
```

选择器必须替换为真实的登录后元素，或配置真实的同源 `auth.checkUrl`；不能以开发首页返回 200 代替登录验证。代理默认验证 TLS，不复制参考项目的 `secure: false`。模板使用 Webpack Dev Server 4/5 的 `onProxyReq` 代理接口。

执行 `aafe test --run` 时，启用的 `devServer.url` 作为本地测试地址（高于普通 `e2e.baseUrl`）；显式 `--base-url` 仍优先。Bot 做本地验证时会移除工作区默认地址参数，保留用户明确指定环境的优先权。实际执行链路：在任务 checkout 启动 argv → 等待本地服务就绪 → 现有 Get Token MCP/缓存/授权登录 → 向本地应用域注入 Cookie → 经代理转发至目标后端 → 验证登录 → Playwright → finally 关闭本次创建的服务。Token 不写入代理配置；人工登录缓存仍按现有规则保存在原项目。MCP 缺失才走缓存/授权，MCP 失败不会静默绕过。

Bot 命令传入 `--dev-port=<任务端口>`，执行器向子进程传入 `AAFE_E2E_CONFIG_ROOT`、`AAFE_E2E_DEV_URL`、`AAFE_E2E_PORT`；配置从原项目读取，代码在 worktree 中运行。端口被占用则报错，不复用可能属于其他分支的服务。服务仅允许本地 HTTP 地址；当前进程组清理适用于 macOS/Linux。dry-run 不启动服务；配置的远程测试地址不会启动本地服务。

任务 worktree 是独立 git checkout，源项目里由 `aafe init/update` 创建的未跟踪 E2E 适配文件不一定存在。运行 `aafe test --run` 时会自动在任务 worktree 内补齐 `local.settings.e2e.aafe.cjs`，以及命令 argv 引用到的 `aafe.e2e.webpack.cjs` / `aafe.e2e.vite.mjs`；已有文件不覆盖，测试结束后清理由本次创建的临时适配文件。该步骤只发生在任务 worktree，不修改源项目 `.aafe.config.json`、`local.settings*` 或 `.cookie`，因此不需要在企微里再次询问“是否允许适配 E2E 启动配置”。

**bklog 的现有配置适配**：它的 `webpack.config.js` 是 `bkmonitor-cli` 自定义工厂，不适用通用包装入口。保留已有 `local.settings.e2e.js`，将 `devServer.command` 改为 `["npm", "run", "dev:e2e"]`。项目的 `BKLOG_E2E_DEV` 配置分支需改为加载生成的 `local.settings.e2e.aafe.cjs`，或让原文件等价读取上述环境变量及项目代理配置。这样既保留现有构建插件，又支持任务端口隔离。初始化不会自动重写业务 Webpack 工厂；未接入的旧脚本仍可能固定使用 8011，应完成适配后再启用。

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

Auto / autonomous 使用“仅真实阻断才询问”的交互覆盖策略：优先读取用户指定的测试配置和现有上下文，不要求用户把配置中的 URL 再抄一遍；URL 角色明确时自行判定。检查后仍缺少**可选 UI 验证**的应用地址，记录 UI 未执行、原因及风险，继续独立验证和其他已授权的 Commit / PR / TAPD 步骤，不要求口令式回复“跳过 UI 验证，继续交付”。TAPD 回填和最终结果必须如实写出 UI 未验证，不能宣称 E2E 通过。

此 Bot 策略明确覆盖旧项目技能里“缺 UI URL 一律 Hard Ask”的要求；策略纳入 Codex 工作流指纹，旧任务续接时重新判定旧等待项。底层 `aafe test --run` 缺 URL 仍返回未执行/阻塞，Bot 根据步骤适用性决定是否跳过，不能篡改测试报告。项目技能文件不被自动改写。

用户明确要求 UI 通过才能交付、真实测试失败、必需认证失效、权限拒绝、目标不明且可能造成实质影响、缺少授权的破坏性操作和产品/安全取舍仍属阻断。保留用户“不要提交”等限制及原生安全审批；`workflow.mode: "ask"` 仍按确认模式执行。非阻断决策简短说明后继续，真正缺失的信息合并成一个具体问题。

```json
"workflow": { "mode": "auto", "intentConfidence": 0.7 }
```

`auto`（默认）使用 AAFE autonomous 自主判断；`ask` 强制询问；`project` 恢复继承目标项目 `mode.workflow`。非法模式按 ask。优先级为：任务发起人的明确会话限制 > Bot 覆盖 > 项目配置。覆盖在新任务和续跑时应用，重启 Bot 生效。Auto 不代表无条件 Commit/PR/回填，也不放宽沙箱权限。

### 自主推进与等待策略

Bot 默认使用 `balanced` 自主级别。“发现信息不完整”不会直接停止整个任务：可从 Snapshot、会话、仓库、项目配置、Git、Knowledge 或工具结果获得的信息由 Agent 自行探查；低风险项采用安全默认值；只影响后续的项延后处理；仍有独立步骤时进入 `partially_blocked` 并自动续跑。只有全部安全路径都耗尽时才进入 `waiting_user`，敏感或外部写入则进入 `waiting_approval`。

```json
{
  "autonomy": {
    "level": "balanced",
    "readWorkspace": "auto",
    "modifyTaskFiles": "auto",
    "runTests": "auto",
    "startDevServer": "auto",
    "installLockedDependencies": "auto",
    "addDependency": "policy",
    "commit": "policy",
    "push": "confirm",
    "createPullRequest": "confirm",
    "deploy": "confirm",
    "externalWrite": "confirm",
    "destructiveOperation": "confirm"
  }
}
```

同一个 `taskId + stepId + blockerType + normalizedRequirement` 生成稳定 Blocker ID。相同等待状态不会重复投递；统一事件和旧 Provider 事件即使并发到达，也只发送一次 Agent 终态文本。

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

Cursor Cloud 切到 Codex 时，还需将 `currentWorkspace` 改成本地工作区；若同一会话此前选择过远程仓库，应在企微重新选择本地仓库。引擎切换不会自动克隆仓库。

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
| `仓库`、`切换 <id>` | 查询或选择工作区 |

任务关联优先级：显式 Task ID → 引用 → 唯一活跃任务 → 近期完成任务。多个候选、过期任务或低置信新需求会要求补充信息。群聊参与者可以显式补充，取消只允许发起人。

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
