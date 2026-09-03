<!--
  Tencent is pleased to support the open source community by making
  蓝鲸智云PaaS平台 (BlueKing PaaS) available.
  Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
  蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
  License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
  ---------------------------------------------------
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of
  the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
  CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  IN THE SOFTWARE.
-->

# Agent Setup：Cursor Agent 模式

本文说明如何启用、配置和运行 **Cursor Agent 模式**。启用后，`aafe run` 会先走 Planner + Orchestrator 产出 Context Package，再通过 Cursor SDK 真正改代码。

相关文档：

- [Agent 作用与配置指南](./AGENTS.CONFIG.md)：`.aafe.agents.json` 里的内置 capability Agent（分析、影响、测试、上下文打包）
- [Agent 协议规范](./AGENTS.SCHEMA.md)：请求 / 响应 / 状态机
- [隔离任务与 Cursor Cloud](./UPDATE-CURSOR-CLOUD.md)：`aafe task` 持久化 Cloud Task
- [Cloud Task Manager + 企微 Bot](./WECOM-CLOUD-TASK.md)：启动 Cloud Task Manager，用企微 AI Bot 创建隔离 Cursor Cloud Agent

不要把这三件事混在一起：

| 入口 | 配置 | 做什么 |
| --- | --- | --- |
| Agent Platform | `.aafe.agents.json` | 分析、影响、测试规划、上下文打包；默认不改代码 |
| **Agent 模式** | `.aafe.config.json` → `agent` | `aafe run` 结束后用 Cursor SDK 实施代码 |
| Cloud Task Manager | `agent.manager` + `aafe task` | 隔离的持久化 Cloud Agent，可并发、可恢复 |

默认 `agent.enabled=false`。不启用时，`aafe run` 只交回上下文包，由当前 IDE Agent 落地。

---

## 1. 前置条件

- Node.js `>= 18`
- 项目已 `aafe init`，存在 `.aafe.config.json`
- 本机已安装 `@cursor/sdk`（`@aafe/agent-runtime` 的依赖）
- 一份 Cursor API Key（用户 Key 或 Team Service Account Key）

Key 在 [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) 创建。Team Admin API Key 目前不能用于 SDK。

---

## 2. 三种启用方式

### 2.1 可视化配置（推荐）

```bash
aafe config
# 或
aafe ui
```

默认打开 `http://127.0.0.1:4318/`，在 **Agent** 区块：

1. 勾选「启用 agent-mode」
2. 选择运行时 `local` 或 `cloud`
3. 填写 API Key 环境变量名（默认 `CURSOR_API_KEY`）
4. 可选填写 `apiKey`（会写入仓库，不推荐）
5. 点模型下拉框：有 Key 时会请求 Cursor 拉**当前账号可用模型**
6. 保存到 `.aafe.config.json`

### 2.2 init / update 写入开关

```bash
# 初始化时打开
aafe init --agent-mode=on \
  --cursor-runtime=local \
  --cursor-model=composer-2.5 \
  --cursor-api-key-env=CURSOR_API_KEY

# 已有项目只改开关
aafe update --agent-mode=on --cursor-model=composer-2.5
aafe update --agent-mode=off
```

交互式 `aafe init` / `aafe update` 也会问是否启用。有 Key 时会打印可用模型列表，可输入序号或模型 id。

### 2.3 单次覆盖，不改配置

即使 `agent.enabled=false`，也可以只跑这一次：

```bash
aafe run "增加用户手机号搜索" --agent=cursor --model=composer-2.5
```

反过来，配置已打开时也可以临时关掉 SDK 实施：

```bash
aafe run "增加用户手机号搜索" --agent=off
```

`--agent=cursor` 只影响这一次 `aafe run`。`aafe context` / `aafe impact` / `aafe plan` / `aafe test` 不会调用 Cursor SDK。

---

## 3. 配置字段

写在 `.aafe.config.json` → `agent`：

```json
{
  "agent": {
    "enabled": false,
    "provider": "cursor",
    "mode": "local",
    "model": "composer-2.5",
    "apiKeyEnv": "CURSOR_API_KEY",
    "apiKey": null,
    "repository": null,
    "autoCreatePR": false,
    "skipReviewerRequest": true,
    "manager": {
      "enabled": false,
      "maxConcurrentTasks": 4,
      "output": ".aafe",
      "validateProjectRuntime": true,
      "recoverOnStart": true
    },
    "mcp": {
      "enabled": true,
      "config": null,
      "settingSources": [],
      "servers": {}
    }
  }
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关。`true` 后，`aafe run` 完成 Context Package 会继续调 Cursor SDK |
| `provider` | `cursor` | 目前只支持 `cursor` |
| `mode` | `local` | `local`：在本机 `cwd` 改代码；`cloud`：在 Cursor 托管 VM 里 clone 仓库执行 |
| `model` | `composer-2.5` | Cursor 模型 id，必须是当前 Key 能用的 |
| `apiKeyEnv` | `CURSOR_API_KEY` | **环境变量名**，不是 Key 本身 |
| `apiKey` | `null` | 可选。有值时优先用它；会进仓库，只适合本机调试 |
| `repository` | `null` | Cloud 模式的仓库，如 `owner/repo` 或完整 git URL |
| `autoCreatePR` | `false` | Cloud 跑完是否自动开 PR。不替代 Task Spine 的 Commit / PR 判断 |
| `skipReviewerRequest` | `true` | Cloud 自动 PR 时是否跳过 reviewer |
| `manager.enabled` | `false` | 是否启用持久化 `aafe task`；命令本身不以它为硬开关 |
| `mcp.enabled` | `true` | 是否把 MCP 带给 Cursor 实施步骤 |
| `mcp.config` | `null` | Cursor `mcp.json` 路径 |
| `mcp.settingSources` | `[]` | 空数组表示不加载 IDE 环境里的 MCP；可填 `project` / `user` / `plugins` / `all` |
| `mcp.servers` | `{}` | 内联 MCP server，优先级高于文件 |

`aafe doctor` 在 `manager.enabled=true` 时会检查：`mode` 必须是 `cloud`，且已配置 `repository`。

---

## 4. API Key 怎么配

解析顺序：`agent.apiKey` → 环境变量 `process.env[agent.apiKeyEnv]`。

**推荐：Key 只放环境变量。**

```bash
export CURSOR_API_KEY="crsr_..."   # 或 cursor_...
```

对应配置：

```json
{
  "agent": {
    "enabled": true,
    "apiKeyEnv": "CURSOR_API_KEY",
    "apiKey": null
  }
}
```

也可以换变量名：

```bash
export AAFE_CURSOR_KEY="crsr_..."
```

```json
{ "agent": { "apiKeyEnv": "AAFE_CURSOR_KEY" } }
```

CLI 一次性指定变量名：

```bash
aafe run "..." --agent=cursor --cursor-api-key-env=AAFE_CURSOR_KEY
```

### 常见错误

`apiKeyEnv` 必须是变量名。下面这样是错的——运行时会去读一个名叫整串 Key 的环境变量，结果永远是空：

```json
{
  "apiKeyEnv": "crsr_xxxxxxxx",
  "apiKey": "crsr_xxxxxxxx"
}
```

正确写法：

```json
{
  "apiKeyEnv": "CURSOR_API_KEY",
  "apiKey": null
}
```

本机调试若必须把 Key 写进配置，只填 `apiKey`，不要把 Key 写进 `apiKeyEnv`。提交前把 `apiKey` 清掉，避免进 git。

---

## 5. 列出可用模型

模型列表随账号变化，不要写死冷门 id。有 Key 时，AAFE 会调 `@cursor/sdk` 的 `Cursor.models.list`。

### 5.1 配置 UI

打开 `aafe config`，在 Agent 区块刷新模型下拉框。接口是本地 `GET/POST /api/models`，会带上当前 `apiKey` / `apiKeyEnv`。

### 5.2 init / update 交互

启用 Agent 模式时，终端会打印：

```text
Available Cursor models (number or id):
  1. auto — Auto
  2. composer-2.5 — Composer 2.5
  3. grok-4.6 — Cursor Grok 4.6
  ...
```

输入序号或 id 即可。Key 缺失或 SDK 失败时，只显示内置兜底：`auto`、`composer-2.5`。

### 5.3 用 SDK 自己拉

```js
import { Cursor } from '@cursor/sdk';

const models = await Cursor.models.list({
  apiKey: process.env.CURSOR_API_KEY
});
```

`composer-2.5` 是 SDK 默认模型。`auto` 交给 Cursor 选。`{ id: "auto" }` 与具体模型 id 都合法。

跑任务时覆盖模型：

```bash
aafe run "..." --agent=cursor --model=grok-4.6
aafe run "..." --agent=cursor --cursor-model=claude-opus-4-8
```

`--model` 与 `--cursor-model` 等价。

---

## 6. 跑一次 Agent 模式

先确认 Key 在环境里，再开开关：

```bash
export CURSOR_API_KEY="crsr_..."

# 写入配置（可选）
aafe update --agent-mode=on --cursor-runtime=local --cursor-model=composer-2.5

# Planner + Orchestrator，然后 Cursor SDK 实施
aafe run "增加用户手机号搜索"
```

不改配置的等价命令：

```bash
aafe run "增加用户手机号搜索" \
  --agent=cursor \
  --model=composer-2.5 \
  --cursor-api-key-env=CURSOR_API_KEY
```

产物仍在 `<analyze.output>/runs/<runId>/`（默认 `.aafe/runs/`）。Cursor 实施是 Context Package 之后的 overlay，失败不会抹掉已经生成的上下文。

只看规划、不实施：

```bash
aafe plan --requirement="增加用户手机号搜索" --dry-run
aafe run "增加用户手机号搜索" --agent=off
```

---

## 7. local 与 cloud

| | `mode: "local"` | `mode: "cloud"` |
| --- | --- | --- |
| 执行位置 | 本机，针对当前项目目录 | Cursor 托管 VM，clone 仓库 |
| 需要的配置 | API Key + model | API Key + model + `repository` |
| 适用 | 本机开发、已有 checkout 的 CI | 长任务、隔离执行、自动开 PR |
| 模型 | **必填** | 建议始终显式传，避免默认值漂移 |

CLI：

```bash
# local
aafe run "..." --agent=cursor --agent-runtime=local

# cloud
aafe run "..." --agent=cursor --agent-runtime=cloud \
  --cursor-repository=owner/repo
```

`--agent-runtime` / `--cursor-runtime` 对应 `agent.mode`。

Cloud 自动 PR 只影响 Cursor Cloud 自己的收尾，**不替代** Task Spine 的 Commit / PR / TAPD 回填。默认 `autoCreatePR=false`。

---

## 8. MCP

MCP 只挂在 Cursor 实施这一步，不会进 Planner。

默认 `mcp.enabled=true`，但 **不会自动带上 Cursor IDE 里已装的 MCP**。要复用 IDE 配置，显式写：

```json
{
  "agent": {
    "mcp": {
      "enabled": true,
      "config": ".cursor/mcp.json",
      "settingSources": ["project", "user"],
      "servers": {}
    }
  }
}
```

或命令行：

```bash
aafe run "..." --agent=cursor --mcp-config=.cursor/mcp.json --mcp-setting-sources=project,user
aafe run "..." --agent=cursor --no-mcp
```

优先级：CLI `--mcp-config` / `--mcp-setting-sources` / 内联 `servers` > 配置文件。`--no-mcp` 关掉这一次。

---

## 9. 和 `aafe task` 的关系

`aafe run --agent=cursor` 是**一次性** developer overlay：当前进程里创建 Cursor Agent，跑完即结束。

`aafe task` 是**持久化** Cloud Task：每个任务有独立 `task.json` / `context.json` / `events.jsonl`，可 `continue` / `cancel` / `recover`。

```bash
aafe task create --requirement="..." --repository=https://github.com/acme/app
aafe task list
aafe task status <taskId>
aafe task continue <taskId> "按评审意见改一下边界处理"
aafe task cancel <taskId>
aafe task recover
```

`agent.manager.enabled` 只影响 init 配置和 `aafe doctor` 提示。直接执行 `aafe task` 仍会进 TaskManager。Cloud Task 要求 `agent.mode=cloud` 且配置了 `repository`。企微 Bot 作为生产入口、长驻 recover 与分阶段实施见 [WECOM-CLOUD-TASK.md](./WECOM-CLOUD-TASK.md)。

---

## 10. 排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `aafe run` 只出上下文、不改代码 | `agent.enabled=false` 且没加 `--agent=cursor` | 打开开关，或加 `--agent=cursor` |
| `cursor-sdk-api-key-missing:CURSOR_API_KEY` | 环境变量为空，且 `apiKey` 为空 | `export CURSOR_API_KEY=...`，或填写 `agent.apiKey` |
| `cursor-sdk-api-key-missing:crsr_...` | 把 Key 写进了 `apiKeyEnv` | `apiKeyEnv` 改回 `CURSOR_API_KEY` |
| 模型下拉只有 `auto` / `composer-2.5` | Key 无效，或 `Cursor.models.list` 失败 | 检查 Key、网络；看 UI / 交互提示里的 `warnings` |
| 401 | Key 带空格、环境不匹配、账号无权限 | 重新生成 Key，Cloud 还要确认仓库访问权 |
| `cursor-sdk-unavailable` | 没装到 `@cursor/sdk` | 在项目根执行 `npm install` |
| Cloud 被 doctor 警告 | `manager.enabled=true` 但 `mode` 不是 `cloud`，或缺少 `repository` | 补齐这两项 |
| 想用 IDE 里的 MCP，但 Agent 看不到 | `settingSources` 为空 | 设置 `project,user` 或 `--mcp-setting-sources=` |

验证 Key 是否可用：打开 `aafe config` 看模型列表来源是否为 `cursor`（不是 `fallback`）。

---

## 11. 最小检查清单

1. `export CURSOR_API_KEY=...`
2. `aafe config` 或 `aafe update --agent-mode=on` 打开开关
3. `apiKeyEnv` 是变量名；Key 不要提交进 git
4. `mode=local` 先在本机跑通；Cloud 再补 `repository`
5. 用 `aafe config` 或交互提示确认模型 id 属于当前账号
6. `aafe run "<任务>" --agent=cursor --model=<id>`
7. 需要隔离长任务时再用 `aafe task`，不要指望普通 `aafe run` 自动创建 durable Task
