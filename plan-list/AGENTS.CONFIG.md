# Agent 作用与配置指南

本文说明 AAFE 里的 Agent **是什么、默认怎么跑、以及怎么改**。

与 [`AGENTS.SCHEMA.md`](./AGENTS.SCHEMA.md) 的分工：那份是协议规范（RFC），定义请求/响应结构、状态机与不变量，面向要实现 Agent 的人；本文面向要**用和配**这套东西的人。

---

## 目录

- [Agent 在链路里的位置](#agent-在链路里的位置)
- [内置 Agent 的职责](#内置-agent-的职责)
- [默认行为：什么都不配会怎样](#默认行为什么都不配会怎样)
- [全局开关：是否自动交给当前 IDE Agent](#全局开关是否自动交给当前-ide-agent)
- [`.aafe.agents.json` 字段说明](#aafeagentsjson-字段说明)
- [配置自定义 Agent](#配置自定义-agent)
- [Agent 契约与 Schema 校验](#agent-契约与-schema-校验)
- [执行策略 policies](#执行策略-policies)
- [验证与排查](#验证与排查)

---

## Agent 在链路里的位置

```text
CLI → Planner → Orchestrator → AgentProvider → Agent → Knowledge → Context Package → IDE Agent
```

- **Planner** 决定「该做什么」，输出一串 capability 调用；默认是确定性的 `RulePlanner`，不需要任何 API Key。
- **Orchestrator** 决定「怎么可靠地做完」：并发、重试、超时、预算、失败降级。
- **Agent** 各自解决一类问题，通过 **capability** 被寻址。
- **IDE Agent** 是链路终点。AAFE 自己不改代码，它产出最小上下文包，由编辑器里的 Coding Agent 落地。

关键一点：**Planner 只认 capability，不认 Agent 名字**。所以把某个内置 Agent 换成你自己的 HTTP 服务，不需要改 Planner、Pipeline 或任何 Skill。

---

## 内置 Agent 的职责

六个内置 Agent 全部默认启用，且全部是 `local`（进程内运行的确定性分析，不联网、不花钱）。

| Agent | 职责 | Capability |
| --- | --- | --- |
| `code-intelligence` | 把 AST 事实变成项目知识：模块、依赖、路由、组件、数据流、业务流程 | `project-analysis` / `architecture-analysis` / `dependency-analysis` / `data-flow-analysis` / `feature-analysis` / `business-flow-analysis` |
| `impact-analyzer` | 从需求描述或 git diff 推算影响面 | `requirement-impact` / `change-impact` / `risk-analysis` |
| `test-agent` | 测试规划、用例骨架生成、E2E 执行 | `test-planning` / `test-generation` / `e2e-execution` |
| `failure-analyzer` | 把失败的测试报告定位到根因并给修复方向 | `failure-analysis` / `root-cause-analysis` / `fix-analysis` |
| `knowledge-validator` | 确定性证据校验，拦住指不到实际文件的结论 | `knowledge-validation` / `evidence-check` |
| `context-agent` | 组装交给 IDE Agent 的最小可追溯上下文包 | `context-packaging` / `evidence-selection` |

其中 `e2e-execution` 需要 `policies.allowTestExecution` 为真（或走 `aafe test --run`）——真的去 spawn 项目测试套件是调用方要自己承担的副作用，不能默认发生。

`risk-analysis` 与 `evidence-check` 已注册但尚无本地实现分支。它们正是下面那个开关要处理的情况。

---

## 默认行为：什么都不配会怎样

`aafe init` 会生成一份完整的 `.aafe.agents.json`，但你**不需要动它**。默认状态下：

1. 六个内置 Agent 用 `local` provider 跑确定性分析，离线可用。
2. 落到**没有可用 Agent** 的 capability，会自动交给**当前 IDE 里正在跑的那个 Agent**。

第二条是重点。以前这种情况会停在 `no-agent-provides-capability`，而此时编辑器里明明坐着一个完全有能力做这件事的 Agent。现在它会被包装成一次 handoff：AAFE 把目标、capability 和已经收集到的上下文交出去，由 IDE Agent 接手分析。

三种情况会走到 IDE Agent：

| 情况 | 解析原因 |
| --- | --- |
| 没有任何 Agent 声明这个 capability | `ide-agent-fallback` |
| 声明了但被 `enabled: false` 关掉 | `ide-agent-fallback` |
| 在 `ideAgent.capabilities` 白名单里显式点名 | `ide-agent-requested` |

**已配置且启用的 Agent 永远优先**，回退不会顶掉真实接线——除非你用白名单显式点名。

---

## 全局开关：是否自动交给当前 IDE Agent

```json
{
  "ideAgent": {
    "enabled": true,
    "mode": "current",
    "capabilities": []
  }
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 全局总开关。关掉之后，无人认领的 capability 保持未服务状态并如实上报，不再自动交给 IDE Agent |
| `mode` | `"current"` | 交给哪个 IDE Agent。`current` 表示当前会话正在跑的这个 |
| `capabilities` | `[]` | 白名单。列在里面的 capability **总是**走 IDE Agent，即使已有 Agent 能服务它 |

### 三级关闭窗口

开关按「范围越窄越优先」解析，所以永远有办法临时关掉，而不用去改一个已提交的文件：

```bash
# 1. 单次命令 / CI 任务级
AAFE_IDE_AGENT=0 aafe run "..."      # 也接受 false / off / no
aafe run "..." --no-ide-agent        # CLI 参数，等价

# 2. 项目级：.aafe.agents.json
#    "ideAgent": { "enabled": false }

# 3. 不配 = 开启
```

环境变量方向是双向的：`AAFE_IDE_AGENT=1` 也能把项目里关掉的开关**重新打开**，方便本地临时调试一个 CI 里默认关闭的项目。空字符串不算表态，会被忽略。

### 什么时候该关

默认开是因为「有能力的 Agent 闲着，运行却停在这里」不是个好结果。但有两类场景应该关掉：

- **CI / 流水线**：没有交互式 IDE Agent 可以接手，handoff 只会变成一个永远不会被认领的 `skipped`。让它明确失败更有价值。
- **要求完全确定性可复现**：走 IDE Agent 意味着结果依赖当时那个模型，两次运行不保证一致。

### 向后兼容

旧配置里的 `developer` 块仍然有效。如果 `developer.provider` 已经指向 `ide` 以外的东西，说明这个项目本来就不想要 IDE handoff，升级后 `ideAgent.enabled` 会自动跟着变成 `false`，不会静默获得新行为。显式写出的 `ideAgent` 块优先级高于 `developer`。

---

## `.aafe.agents.json` 字段说明

Agent 接线单独成文件，避免把 `.aafe.config.json` 撑爆。`aafe init` / `aafe update` **只在缺失时生成，不覆盖已有配置**。

```json
{
  "version": 1,
  "planner": {
    "provider": "rule",
    "maxSteps": 12,
    "llm": {
      "endpoint": null,
      "model": null,
      "apiKeyEnv": "AAFE_LLM_API_KEY",
      "temperature": 0
    }
  },
  "agents": {
    "impact-analyzer": { "enabled": true, "provider": "local", "ref": "builtin:impact-analyzer" }
  },
  "ideAgent": { "enabled": true, "mode": "current", "capabilities": [] },
  "developer": { "provider": "ide", "mode": "current" },
  "policies": {
    "timeoutMs": 120000,
    "maxRetries": 1,
    "maxParallel": 4,
    "allowNetwork": false,
    "allowTestExecution": false,
    "tokenBudget": 12000,
    "maxTokens": null,
    "maxCost": null
  }
}
```

### `planner`

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `provider` | `"rule"` | `rule` 为确定性规划，离线可用；`llm` 走 OpenAI 兼容接口 |
| `maxSteps` | `12` | 单次规划的最大步数 |
| `llm.endpoint` / `llm.model` | `null` | `provider: "llm"` 时必填 |
| `llm.apiKeyEnv` | `"AAFE_LLM_API_KEY"` | 读取 Key 的环境变量名。Key 本身不进配置文件 |
| `llm.temperature` | `0` | 规划要的是稳定，不是创意 |

`LlmPlanner` 在网络异常、返回非 JSON、或请求了不存在的 capability 时会**自动回退到 RulePlanner**。开启 LLM 规划只会变慢，不会让流程中断。

### `agents.<id>`

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用。关掉后该 Agent 的 capability 交由回退处理 |
| `provider` | `local` / `http` / `cli` / `mcp` / `ide` |
| `ref` | 地址。格式随 provider 而定，见下节 |
| `endpoint` | `http` 的地址。只写一个时会和 `ref` 自动同步 |
| `capabilities` | 声明能力。自定义 Agent **必须**声明，否则 Planner 永远选不到它 |
| `model` | 远程实现使用的模型名 |
| `prompt` / `inputSchema` / `outputSchema` | 契约覆盖，见[契约](#agent-契约与-schema-校验) |
| `schemaMode` | `enforce` / `warn` / `off` |
| `maxRepairAttempts` | 输出不合契约时的最大回问轮数 |
| `tools` | 允许该 Agent 使用的工具名数组 |

`endpoint` / `ref` / `model` / `prompt` / `inputSchema` / `outputSchema` 支持 `${ENV_VAR}` 展开，密钥和内网地址不必进版本库。变量未设置时该字段置空并在 `aafe doctor` 报警，而不是把字面量 `${...}` 当地址发出去。

只有这几个字段会展开——全量展开会让一段包含 `${...}` 的 prompt 悄悄消失。

---

## 配置自定义 Agent

自定义 Agent 有两种用法：**替换**内置 Agent 的实现（沿用它的 capability），或**新增**一个 Agent 承担新 capability。两者写法一样，区别只在于 id 是否是内置的。

### 替换内置实现

沿用 `code-intelligence` 这个 id，把它从本地分析换成你的 HTTP 服务。capability 不用重写，继承内置声明：

```json
{
  "agents": {
    "code-intelligence": {
      "provider": "http",
      "endpoint": "${AAFE_AGENT_ENDPOINT}",
      "model": "${AAFE_AGENT_MODEL}",
      "outputSchema": "./contracts/code-intelligence.output.json",
      "schemaMode": "enforce",
      "maxRepairAttempts": 2
    }
  },
  "policies": { "allowNetwork": true }
}
```

`http` provider 需要显式打开 `policies.allowNetwork`，否则 `aafe doctor` 会报警且调用会被拒绝。

### 新增一个 Agent

新 id 必须自己声明 `capabilities`，否则它对 Planner 不可见：

```json
{
  "agents": {
    "security-auditor": {
      "enabled": true,
      "provider": "http",
      "endpoint": "${SECURITY_AGENT_ENDPOINT}",
      "capabilities": ["security-audit", "dependency-risk"],
      "outputSchema": "./contracts/security.output.json"
    }
  }
}
```

### 五种 provider

| provider | `ref` 格式 | 用途 |
| --- | --- | --- |
| `local` | `builtin:<id>` | 进程内的内置实现 |
| `http` | `https://...` | OpenAI 兼容或自建 HTTP 服务 |
| `cli` | `<command and args>` | 本地命令行工具 |
| `mcp` | `<command and args>#<toolName>` | MCP Server 的某个工具 |
| `ide` | `ide:<mode>` | 交给编辑器里的 Coding Agent |

```json
{
  "agents": {
    "local-scanner": {
      "provider": "cli",
      "ref": "npx my-scanner --json",
      "capabilities": ["dependency-risk"]
    },
    "impact-via-mcp": {
      "provider": "mcp",
      "ref": "npx -y @acme/impact-mcp#analyze_impact",
      "capabilities": ["requirement-impact"]
    },
    "design-reviewer": {
      "provider": "ide",
      "capabilities": ["design-review"]
    }
  }
}
```

`cli` 类型的命令和 `tools` 会先过危险操作 denylist——`rm -rf`、`git reset --hard`、`git push`、`sudo` 之类在 spawn 之前就被拒绝。

### 把某个能力固定交给 IDE Agent

不用为它建一个 Agent 条目，直接进白名单更省事：

```json
{
  "ideAgent": {
    "enabled": true,
    "capabilities": ["risk-analysis", "design-review"]
  }
}
```

适合那些**需要判断而不是查表**的分析——用编辑器里那个能读完整代码库的模型，往往比一个只能拿到片段的远程服务更准。

---

## Agent 契约与 Schema 校验

每个 Agent 绑定一组契约：`prompt` + `inputSchema` + `outputSchema`，默认从 `src/agents/<id>/` 装载，也可以在配置里指向项目自己的文件或内联 schema。

`AgentRuntime` 是所有 Agent 的唯一执行路径：

```text
装载契约 → 校验入参 → 注入 prompt/schema → 调用 provider
        → 确定性纠错 → 校验输出 → 修复回路 → 校验 evidence
```

输出不合契约时，先做本地确定性纠错（标量补成数组、字符串化 JSON 解开、数字/布尔强转），仍不合规才带着校验错误回问模型，最多 `maxRepairAttempts` 轮。

`schemaMode` 控制违约后果，默认按 provider 区分：

| 模式 | 行为 | 默认适用 |
| --- | --- | --- |
| `enforce` | 违约即 `failed` | `http` / `cli` / `mcp` / `ide` 等远程实现 |
| `warn` | 保留结果但降级为 `partial`，绝不报成 `success` | `local` 内置 Agent |
| `off` | 不校验 | 需显式配置 |

指向不存在文件的 evidence 会被丢弃并计数——一条指不到任何地方的证据，比没有证据更糟。

---

## 执行策略 policies

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `timeoutMs` | `120000` | 单个 Agent 调用超时 |
| `maxRetries` | `1` | 失败重试次数 |
| `maxParallel` | `4` | 并发上限 |
| `allowNetwork` | `false` | `http` provider 的总闸 |
| `allowTestExecution` | `false` | 是否允许真的执行项目测试套件 |
| `tokenBudget` | `12000` | **单个 Agent** 的上下文包大小上限 |
| `maxTokens` | `null` | **整个 run** 的 token 上限 |
| `maxCost` | `null` | **整个 run** 的花费上限 |

两种预算不是一回事：`tokenBudget` 管的是喂给一个 Agent 多少东西，`maxTokens` / `maxCost` 管的是这一趟总共花多少，在步与步之间检查——调用进行到一半中止并不会退还已经花掉的 token。

---

## 验证与排查

```bash
aafe doctor            # 校验配置、provider 与 capability 解析
aafe plan --requirement="..." --dry-run   # 只看 Planner 打算怎么做
aafe run --list                            # 历史 run
aafe run --replay=<runId>                  # 只读回放，含每步 input / output
```

`aafe doctor` 在检查 capability 解析时**不启用 IDE 回退**：回退什么都能接，开着会把「你本来打算自己接线、但配错了」的问题盖掉。所以它会明确区分两种措辞：

- `... has no configured agent (...); it will be handed to the IDE agent` —— 开关开着，运行时能兜住，属于提示。
- `... cannot be resolved (...) and ideAgent.enabled is false` —— 开关关着，这个 capability 运行时会真的失败。

常见问题：

| 现象 | 原因 |
| --- | --- |
| 自定义 Agent 从来没被调用 | 没声明 `capabilities`，Planner 看不见它 |
| `http` Agent 被拒绝 | `policies.allowNetwork` 仍是 `false` |
| 配置里的地址变成了空 | `${ENV_VAR}` 对应的环境变量没设置，看 `aafe doctor` 的报警 |
| CI 里一堆 `skipped` handoff | CI 没有 IDE Agent 能接手，应设 `AAFE_IDE_AGENT=0` |
| 结果两次不一致 | 走了 IDE Agent 回退，结果依赖当时的模型；要复现就关掉开关 |
