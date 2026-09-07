

# AAFE 企微长连接机器人

本目录是 AAFE 的企微入口：本机（或内网）进程主动连接企业微信智能机器人长连接，把会话里的文本命令转成隔离的 AAFE Task。

没有配置 `repository` 时，这是一个完整 Agent：在进程当前项目目录跑 **local Agent**。配了 `repository` 才走 Cursor Cloud clone。

它**不是** HTTP Webhook，也**不会**在一条消息里干等 Agent 跑完。流程是：

```text
企微发「做：<需求>」
  → 机器人立刻回 Task ID
  → 后台 TaskManager.create + start
  → local / Cloud Agent 改代码
  → 完成后主动推一条结果（状态 / 文件 / PR / 错误）
```

Gateway 只调用 `TaskManager`，不直接 `Agent.create`。同一 Bot 同时只能有一条有效长连接，因此本进程必须长驻、单实例。

## 前置条件

1. 企业微信管理后台：智能机器人开启「API 模式」并选择「长连接」，拿到 BotID、Secret。
2. Cursor API Key（环境变量或本地配置 `apiKey`）。
3. Node.js `>= 18`。
4. 可选：配置 `repository` 后才走 Cloud clone；不配则在启动目录跑 local Agent。

本仓库默认 `.aafe.config.json` 仍是 `agent.enabled=false` / `mode=local`，不要把 Key 提交进 git。

## 安装

在仓库根目录：

```bash
cd ai-bots/wecom
npm install
```

## 配置

凭证优先读环境变量；没有 `export` 时回退读本地文件（已 gitignore）。

### 优先级

1. 环境变量：`WECOM_BOT_ID` / `WECOM_BOT_SECRET` / `CURSOR_API_KEY`
2. `--config=` 或 `AAFE_WECOM_CONFIG`
3. `ai-bots/wecom/wecom.local.json`
4. `ai-bots/wecom/.env`
5. 项目根 `wecom.local.json`
6. `.aafe/wecom.local.json`

`repository` **可选**。不配也能用：Agent 在 `--root` / 启动目录本地执行。需要 Cloud 时再配 `AAFE_WECOM_REPOSITORY`、本地 JSON 的 `repository`，或目标项目 `.aafe.config.json` → `agent.repository`。

### 推荐：本地 JSON

```bash
cp wecom.local.json.example wecom.local.json
```

`wecom.local.json`：

```json
{
  "botId": "your-wecom-bot-id",
  "secret": "your-wecom-bot-secret",
  "apiKey": "crsr_your-cursor-api-key"
}
```

走 Cloud 时再加 `"repository": "owner/repo"`。

可选 `"provider": "cursor" | "codex"`。`codex` 只接通入口：任务会标成 Codex，执行实现仍是 TODO。也可用环境变量 `AAFE_WECOM_PROVIDER`。

也支持 `.env`（可带 `export`）：

```
WECOM_BOT_ID=...
WECOM_BOT_SECRET=...
CURSOR_API_KEY=...
```

可选字段：`repository` / `AAFE_WECOM_REPOSITORY`（Cloud 仓库），`wsUrl` / `WECOM_WS_URL`（私有化地址，默认 `wss://openws.work.weixin.qq.com`），`baseBranch` / `AAFE_WECOM_BASE_BRANCH`。

不要把真实 `wecom.local.json` 或 `.env` 提交进仓库。

## 启动

在**目标项目根目录**启动（进程要能读到该项目的 `.aafe.config.json`）：

```bash
# 仓库根已装过 aafe 时
aafe wecom

# 或指定项目根 / 本地配置
aafe wecom --root=/path/to/project --config=/path/to/wecom.local.json

# 直接跑本目录入口
node /path/to/aafe-agent-runtime/ai-bots/wecom/bin/wecom.js
```

开发本机器人本身时，在 `ai-bots/wecom` 下用 npm script（`--root` 已指向仓库根）：

```bash
npm run dev          # node --watch + WECOM_LOG=1 / level=debug，改代码自动重启
npm start            # 同样以仓库根为项目根启动，不带 watch 与 debug 日志
npm run check:models # 只校验 models 规则表，不建长连接
```

`npm run dev` 会重连长连接，同一 Bot 只能有一条连接：跑 dev 前先停掉其它实例。

启动成功后日志会出现 `wecom-bot connecting` / `authenticated`。进程不要退出。

- `SIGINT` / `SIGTERM`：先断开企微长连接，再关闭本机 runtime。
- 被另一个实例踢线：本进程退出，避免两条连接互踢。
- 重启后会对未结束任务做 `TaskManager.initialize()` / `recover()`，已有 `agentId + activeRunId` 的 running 任务会重连，而不是再 `Agent.create`。

`aafe task` 命令跑完会 `manager.close()`，不能替代本长驻进程。

## 启动之后如何执行 AAFE

启动只建立企微长连接，**不会自动创建 Task**。要执行 AAFE，在企微里给这个智能机器人发文本（群聊先 @机器人）。

| 你在企微说 | AAFE 做什么 |
| --- | --- |
| `做：增加用户手机号搜索` | `TaskManager.create` + 异步 `start`（默认 Cursor），立刻回 Task ID |
| `Codex：增加用户手机号搜索` | 同样创建任务，但 `provider=codex`。执行引擎入口已预留，实现待接入 |
| `继续 task-xxxx：补单测` | 同一 Agent 上新 Run |
| `继续 task-xxxx：补单测` | 同一 Cursor Agent 上新 Run |
| `状态 task-xxxx` | 读任务状态 |
| `取消 task-xxxx` | 取消队列或运行中的任务 |
| `列表` | 当前用户未结束任务 |
| 其它文本 | 回帮助，不建任务 |

也可以写成 `@AAFE 做：...`。第一版必须带显式 Task ID 才能「继续」，不会猜「刚才那个」。第一版只处理文本，不处理图片/文件。

一次完整执行：

1. 进程已启动并认证成功。
2. 单聊打开机器人，或在群里 @ 它，发送：`做：<需求>`。
3. 几秒内收到流式回复，正文含 `task-...`。这只表示 Task 已创建并已后台 `start`，不是 Agent 跑完。
4. Cursor Agent（无仓库时 local，有仓库时 Cloud）按 AAFE Task / Context 执行（Rules、Skills、分析、改代码）。
5. 任务结束（完成 / 失败 / 取消）后，机器人再主动推一条 markdown：Task ID、状态、改动文件、PR、错误。
6. 要补充需求：`继续 <刚才的 Task ID>：<补充>`，不要再发一条新的「做：」除非你要新任务。

注意：

- 企微原文不会整段当 Cursor prompt 转发，会先落成 Task + Context。
- `autoCreatePR` 默认关，PR 仍走 AAFE 自己的提交门禁。
- 主动推送要求该会话里用户先给机器人发过消息（企微限制）。
- 每会话大约 30 条/分钟、1000 条/小时。

## 命令速查

```text
做：<需求>
Codex：<需求>
继续 <TaskID>：<补充>
状态 <TaskID>
取消 <TaskID>
列表
```

Task ID 形如 `task-20260903120000-abcd1234`（创建任务时机器人会回）。
