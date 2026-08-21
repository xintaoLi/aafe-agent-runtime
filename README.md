# @aafe/agent-runtime

`@aafe/agent-runtime` 是面向前端工程的项目级 AI 架构运行时。它把 AI Coding 从「直接改代码」升级为一条可审计的链路：

```text
项目记忆 → 架构定位 → 需求分析 → 设计（按需） → 实施 → 批判审查 → 影响分析 → 测试预测 → 知识更新
```

AAFE 自己不改代码。它负责让 IDE Agent 在动手之前，先拿到这个项目的真实结构、约束和影响面。

核心能力：

- 项目级 Runtime 初始化、更新和诊断
- Skill、Pipeline、Hook、Gate 和 Memory 编排
- Vue / React / Next / Monorepo 等项目识别
- **DDD 领域建模**与**前端设计模式组合**，两者均为显式开启
- Planner + Orchestrator 的 Agent Platform，产出给 IDE Agent 的最小上下文包
- Knowledge Center 知识关系、影响分析和测试预测
- Knowledge Web 本地可视化
- 任务完成后自动更新 Knowledge、Runtime 和 Doctor

## 目录

- [快速开始](#快速开始)
- [从 0.1.x 升级到 0.2.0](#从-01x-升级到-020)
- [CLI 命令](#cli-命令)
- [项目初始化](#项目初始化)
- [Workspace Root 与编辑器分层配置](#workspace-root-与编辑器分层配置)
- [项目更新与诊断](#项目更新与诊断)
- [DDD（显式开启）](#ddd显式开启)
- [前端设计模式（显式开启）](#前端设计模式显式开启)
- [Agent Platform](#agent-platform)
- [Agent 作用与配置指南](./AGENTS.CONFIG.md)
- [Agent 内自主命中](#agent-内自主命中)
- [Knowledge Center](#knowledge-center)
- [Knowledge Web](#knowledge-web)
- [任务完成自动同步](#任务完成自动同步)
- [架构文档接入](#架构文档接入)
- [AI Runtime 执行](#ai-runtime-执行)
- [项目目录结构](#项目目录结构)
- [Agent Skills 分发](#agent-skills-分发)
- [开发与验证](#开发与验证)
- [设计边界](#设计边界)

## 快速开始

在目标前端项目根目录执行：

```bash
npm install --save-dev @aafe/agent-runtime
npx aafe init --yes \
  --framework=vue \
  --scenarios=complex,admin,dashboard,workflow,graph \
  --template=complex \
  --editors=cursor
npx aafe doctor
npx aafe knowledge update
npx aafe knowledge-web --serve --port=4173   # 浏览器打开 http://127.0.0.1:4173/
```

常用项目类型与场景：

```text
--framework=vue|react|next|monorepo|generic
--scenarios=complex,ddd,patterns,graph,admin,dashboard,workflow
```

DDD 与设计模式的知识包始终会安装，但**默认不激活**——是否启用由每次请求的门禁判定，见 [DDD（显式开启）](#ddd显式开启) 与 [前端设计模式（显式开启）](#前端设计模式显式开启)。

## 从 0.1.x 升级到 0.2.0

线上已发布的最新版本是 `0.1.22`，`0.2.0` 是一次包含破坏性变更的升级。**升级 npm 包之后必须执行 `aafe update`**：`.ai-agent/` 下的 Pipeline 和 Gate 是随包生成、留在项目里的文件，光升级包不会刷新它们。

### 一条命令完成迁移

```bash
npm install --save-dev @aafe/agent-runtime@latest
npx aafe update --yes
npx aafe doctor
```

子目录（Monorepo）安装：

```bash
cd bklog/web
npm install --save-dev @aafe/agent-runtime@latest
npx aafe update --yes --module-name=web --migrate-editors
npx aafe doctor
```

先看会改什么：

```bash
npx aafe update --dry-run
```

`aafe update` 会刷新生成物，并保留项目自有知识：`.ai-agent/project.md`、`.ai-agent/project-skills/**`、`.ai-agent/rules/**`、`.ai-agent/memory/**`。

### 破坏性变更清单

| 变更 | 影响 | 迁移动作 |
| --- | --- | --- |
| `aafe run` 语义变更为 Planner + Orchestrator 全循环 | 依赖旧行为的脚本 | 改用 `aafe pipeline`，过渡期可用 `aafe run --legacy` |
| 包内目录调整 | 深链导入的代码 | 见「包内目录调整」 |
| DDD 改为显式开启 | 通用需求不再自动做领域建模 | `aafe update`，无需改代码 |
| 设计模式改为显式开启 | `feature` 管线不再无条件跑模式步骤 | `aafe update`，无需改代码 |
| `architecture_gate` 不再要求 `pattern_selection` | 自定义 `gates.yaml` | 见「自定义 Pipeline / Gate」 |
| `analyzeDDD` 变为 async | 直接调用 API 的代码 | 加 `await` |
| `analyzePatternFit` 不再返回 `recommendation` | 直接调用 API 的代码 | 改读 `composition.patterns` |
| `.aafe.config.json` 的 `analyze.llm.agents` 废弃 | Agent 接线配置 | 迁到 `.aafe.agents.json` |

### 包内目录调整

```text
src/analyze/   →  src/static-analysis/
src/runtime/   →  src/agent-platform/skill-runtime/
```

直接深链到这些路径的代码需要改导入。从包名根导入不受影响：

```js
import { AgentRuntime, analyzePatternComposition } from '@aafe/agent-runtime';
```

### DDD 与设计模式改为显式开启

0.1.x 的 `feature` 管线里，DDD 与模式步骤是**无条件执行**的，`AgentRuntime.classify` 也会因为请求里出现「领域」「策略」这类词就切到对应管线。结果是一个「加个订单列表页」的普通需求，也会被要求先产出限界上下文和模式选型。

0.2.0 起两者都由门禁把关，只有请求中**明确表达**了相应意图才会激活：

```bash
$ aafe ddd gate "加个订单列表页"
{ "enabled": false, "decision": "disabled",
  "reason": "no explicit DDD intent in the request", "scope": "none" }

$ aafe ddd gate "用 DDD 重构订单模块"
{ "enabled": true, "decision": "enabled",
  "reason": "explicit DDD intent: ddd", "scope": "partial",
  "requestedCapabilities": ["refactoring"] }
```

判定为 `ambiguous` 时会先反问，不会静默启用。代码库里本来就存在的 DDD 术语或 `adapter`、`strategy` 之类的类名，都不构成启用理由。

`aafe update` 会同时做三件事：

1. 重写 `feature.yaml`，移除无条件的 DDD 与模式步骤；
2. 写入新的 `domain-feature.yaml`（Gate → Scope → Discovery → Strategic → Tactical → Architecture → Validation）和 `pattern-feature.yaml`（Gate → Discovery → Selection → Composition → Audit → Validation）；
3. 生成 `.ai-agent/ddd/`（39 个文件）与 `.ai-agent/frontend-engineering/`（61 个文件）两棵知识树，并写入 `aafe-ddd-gate.mdc`、`aafe-pattern-gate.mdc` 两条编辑器指针规则。

### 自动迁移历史文件与配置

`.ai-agent/`、`.aafe.config.json` 和 `.aafe.agents.json` 都在你的仓库里，升级 npm 包搬不动它们；只重新生成也不够，因为新版本只会写自己知道的路径，不会去动一个它已经不认识的旧文件。所以 `aafe init` / `aafe update` / `aafe sync` 都会在写完新布局之后自动跑一遍迁移。

也可以单独执行：

```bash
npx aafe migrate --dry-run    # 只看会改什么
npx aafe migrate
```

当前包含四项：

| 迁移 | 从 | 到 |
| --- | --- | --- |
| `superseded-flat-ddd-skills` | `.ai-agent/skills/` 下 5 个扁平 DDD 技能文件 | 已由 `.ai-agent/ddd/skills/` 取代，删除 |
| `file-license-memory-jsonl` | `.ai-agent/memory/file-license-ok.json` | `.ai-agent/memory/file-license-ok.jsonl` |
| `analyze-output-key` | `.aafe.config.json → analyze.docsOut` + 旧产物目录 | `analyze.output` + 现产物目录 |
| `analyze-llm-agents` | `.aafe.config.json → analyze.llm.agents` | `.aafe.agents.json` |

几点值得说明：

- **扁平 DDD 技能文件必须清掉。** 留着不只是多余——Skill Index 路由仍会读到它们，一个残留的 `ddd-discovery.md` 足以让 Agent 对一个从没要求过领域建模的需求做起限界上下文分析，正好绕开新门禁。这些文件每次 `update` 本来就会被整体覆盖，删除不会丢掉任何你该保留的东西。
- **license 记忆是真实数据，做的是格式转换而非删除。** 旧的单体 `.json` 会被逐条转成追加式 `.jsonl`，只搬运 `ok: true` 的记录，并保留旧文件自己的 fingerprint——如果 License 模板后来变过，这些记录就应该继续判定为不匹配。重新校验一个文件很便宜，错误地信任一个过期的头部不便宜。
- **`analyze` 产物目录会合并，而不是二选一。** `analyze.docsOut` 和 `analyze.output` 同时存在时，配置值只能取其一：读取优先级本来就是 `output ?? docsOut`，而配置模板一直无条件写入 `output`，所以任何生成过的项目里 `docsOut` 其实从未生效——改用它会把分析悄悄指向一个项目可能从没用过的目录。磁盘上的产物则不同：当旧目录有产物、而 `output` 指向的目录还不存在时，产物会一并迁过去，让配置和磁盘重新对上；两个目录都有产物时不合并，因为那会把一次更旧的分析混进当前产物里且无从分辨新旧——分析产物随时可以用 `aafe analyze` 重建，此时只报告旧目录位置，由你确认后删除。指向项目外的旧路径只报告、不搬运。

- **迁移按「磁盘现状」判断，不看版本号。** 跳过了好几个版本的项目、已经手工迁移过的项目、和完全最新的项目，跑完结果一致；重复执行是 no-op，中途失败也不需要回滚。
- **前置条件不满足时会推迟而不是硬来。** 例如 `.ai-agent/ddd/` 尚未安装时不会删旧技能文件，`.aafe.agents.json` 尚未生成时不会去写它——否则会写出一个残缺的 agents 配置，让项目永久失去 planner 和内置 Agent。这类情况下旧内容原地保留，下次再迁移。

### 自定义 Pipeline / Gate

如果改过 `.ai-agent/pipelines/*.yaml` 或 `.ai-agent/runtime/gates.yaml`，`aafe update` 会用新版本覆盖它们。请先备份，再把自定义步骤挪到新结构上。三处语义变化需要注意：

- `architecture_gate` 的 `requires` 去掉了 `pattern_selection`。架构合理与否，和有没有用设计模式是两件事。
- `pattern_gate` 的 `requires` 改为 `pattern_problems` / `pattern_composition` / `pattern_anti_patterns`。
- 新增 `ddd_enablement_gate` 与 `pattern_enablement_gate`。

**未执行 `aafe update` 时不会崩**：模式技能在被门禁跳过时，仍会发布 `pattern_interview`、`pattern_selection`、`module_pattern_selection` 等旧 artifact 键（值为空），所以留在磁盘上的旧 `pattern_gate` 不会把管线卡死。但这只是兼容垫片，行为已经是新的——请尽快执行 `update`。

### 升级后验证

```bash
npx aafe doctor          # 期望 status: pass，missing 与 warnings 均为空
npx aafe migrate         # 期望 migrated: 0，即已无遗留内容
npx aafe ddd gate "加个列表页"        # 期望 disabled
npx aafe pattern gate "加个列表页"    # 期望 disabled
```

`doctor` 会校验两棵新知识树是否完整、`feature.yaml` 是否已去掉无条件的 DDD/模式步骤、各 Gate 配置是否为新版本。

### 回滚

`.ai-agent/` 全部纳入版本库时，回滚即：

```bash
npm install --save-dev @aafe/agent-runtime@0.1.22
git checkout -- .ai-agent .aafe.config.json
```

## CLI 命令

| 命令 | 用途 |
| --- | --- |
| `aafe init` | 初始化项目 Runtime、Memory 和编辑器入口 |
| `aafe detect` | 识别项目框架、编辑器和场景 |
| `aafe doctor` | 检查 Runtime 文件和配置完整性 |
| `aafe sync` | 同步生成的 Runtime 文件 |
| `aafe update` | 更新已接入项目的 Runtime、Skills、Hooks 和 Knowledge |
| `aafe migrate` | 把旧版本遗留的文件和配置迁移到当前位置；`--dry-run` 预览 |
| `aafe analyze` | 生成项目架构定位 Skill、AST 分析产物和检索索引 |
| `aafe knowledge init` | 初始化 Knowledge 关系视图 |
| `aafe knowledge update` | 更新 `.docs` 下的 Knowledge 视图 |
| `aafe knowledge sync` | `knowledge update` 的别名 |
| `aafe knowledge search` | 在 analyze 产物里做排序检索（模块/文件/路由/组件/特性/符号） |
| `aafe knowledge index` | 重建并落盘检索索引 |
| `aafe knowledge-web` | 生成 Knowledge Web 可视化页面；加 `--serve` 启动本地服务 |
| `aafe task-completion` | 执行任务完成后的自动同步链路 |
| `aafe memory` | 管理项目 Memory |
| `aafe ddd` | DDD 门禁、范围、发现与领域模型分析 |
| `aafe pattern` | 设计模式门禁、问题识别、选型与组合 |
| `aafe context` | 为 IDE Agent 生成最小可追溯上下文包 |
| `aafe impact` | 预测需求或 git diff 的影响范围 |
| `aafe plan` | 查看 Planner 的决策轨迹 |
| `aafe run` | 运行 Planner + Orchestrator 全循环 |
| `aafe pipeline` | 运行旧的 Skill Pipeline（0.1.x 的 `aafe run` 行为） |
| `aafe test` | 规划并生成 YAML Case；`--coverage` 全量、`--diff` 任务变更、`--pr=<url>` PR 差异；`--run` 才用 Playwright 执行 |
| `aafe diagnose` | 把失败报告定位成根因与修复方向 |
| `aafe license` | 校验并补齐文件 License 头 |
| `aafe skills` | 下载 GitHub Agent Skills，不用于项目初始化 |

查看帮助：

```bash
aafe --help
```

## 项目初始化

### 初始化 Runtime

```bash
aafe init --yes \
  --framework=vue \
  --scenarios=complex,ddd,patterns,graph \
  --template=complex \
  --editors=cursor,codebuddy,codex
```

常用编辑器：

```text
--editors=cursor|codebuddy|claude|codex|trace|windsurf|vscode
```

子目录安装额外参数：

```text
--module-name=web
--migrate-editors
--no-migrate-editors
```

Monorepo 子目录安装见 [Workspace Root 与编辑器分层配置](#workspace-root-与编辑器分层配置)。

### 检查初始化结果

```bash
aafe detect
aafe doctor
```

`doctor` 期望结果：

```json
{
  "status": "pass",
  "missing": [],
  "warnings": []
}
```

## Workspace Root 与编辑器分层配置

当 AAFE 安装在 **Git 仓库的子目录**（例如 monorepo 中的 `bklog/web`）时，编辑器适配器必须写入 **Workspace Root** 才能生效；`.ai-agent`、`.docs`、`.aafe.config.json` 仍保留在安装目录，避免污染仓库根目录。

### 适用场景

```text
仓库 Root（Workspace Root，Cursor / CodeBuddy / Claude 等在此读取编辑器配置）
└── bklog/web/          ← 安装目录（在此执行 aafe init / update）
    ├── .ai-agent/      ← Runtime 知识源，保留在此
    ├── .docs/          ← 模块文档，保留在此
    ├── .aafe.config.json
    └── package.json
```

`aafe init` / `aafe update` 会同时扫描 **安装目录** 与 **Workspace Root**，输出分析结果，并按当前 `--editors` 智能适配。

### 迁移策略

| 资源 | 位置 | 说明 |
| --- | --- | --- |
| `.cursor` / `.codebuddy` / `.codex` 等 | Workspace Root | 仅编辑器适配器迁移/合并到 Root |
| `.ai-agent` | 安装目录 | Runtime、Skills、Pipelines、Memory |
| `.docs` | 安装目录 | 架构文档与 Knowledge 视图 |
| `.aafe.config.json` | 安装目录 | 项目配置，含 `workspace` 元数据 |

迁移时，编辑器文件内的路径引用会自动重写为安装目录实际路径，例如：

```text
.ai-agent/skill-index.md  →  bklog/web/.ai-agent/skill-index.md
.docs/guide.md            →  bklog/web/.docs/guide.md
.cursor/hooks/...         →  .cursor/hooks/web/...
```

若安装目录已存在编辑器配置，CLI 会提示是否迁移到 Workspace Root（交互模式默认确认；`--yes` 时自动迁移）。

### 支持的编辑器与分层结构

| 编辑器 | 安装目录标记 | Workspace Root 分层结构 |
| --- | --- | --- |
| Cursor | `.cursor/` | `.cursor/{rules,skills,hooks,context}/{module}/` |
| CodeBuddy | `.codebuddy/` | `.codebuddy/{module}/` + `skills/` |
| Claude | `CLAUDE.md` | 合并到 Root 的 `CLAUDE.md`（按模块块） |
| Codex | `.codex/` | `.codex/{module}/aafe.md` |
| Trace | `.trace/` | `.trace/{module}/aafe.md` |
| Windsurf | `.windsurfrules` | 合并到 Root 文件（按模块块） |
| VS Code | `.vscode/` | `.vscode/{module}/aafe.instructions.md` |

只对 `--editors` 中启用的编辑器生成分层配置。

### 子目录安装示例

在模块目录下初始化（需以 **仓库 Root** 作为 IDE Workspace 打开）：

```bash
cd bklog/web
npm install --save-dev @aafe/agent-runtime

# 交互式：分析双目录、提示模块名、确认迁移
npx aafe init --editors=cursor,codebuddy

# 非交互式
npx aafe init --yes \
  --framework=vue \
  --scenarios=complex,ddd,patterns \
  --editors=cursor,codebuddy,codex \
  --module-name=web \
  --migrate-editors
```

### 相关 CLI 参数

| 参数 | 说明 |
| --- | --- |
| `--module-name=<name>` | 分层配置的模块名，默认取安装目录名（如 `web`） |
| `--migrate-editors` | 将安装目录下的编辑器适配器迁移/合并到 Workspace Root |
| `--migrate-cursor` | `--migrate-editors` 的别名 |
| `--no-migrate-editors` | 跳过编辑器适配器迁移 |
| `--no-migrate-cursor` | `--no-migrate-editors` 的别名 |

### `.aafe.config.json` 中的 workspace 配置

子目录安装且启用分层后，安装目录下的 `.aafe.config.json` 会写入类似配置：

```json
{
  "workspace": {
    "layeredEditors": true,
    "installRoot": ".",
    "workspaceRoot": "../..",
    "moduleName": "web",
    "moduleRelativePath": "bklog/web",
    "retainInInstallDir": [".ai-agent", ".docs", ".aafe.config.json"],
    "editorOnlyAtWorkspaceRoot": true,
    "agentPrefix": "bklog/web/.ai-agent",
    "docsPrefix": "bklog/web/.docs",
    "editorLayers": {
      "cursor": ".cursor/{rules,skills,hooks,context}/web",
      "codebuddy": ".codebuddy/web",
      "codex": ".codex/web"
    }
  }
}
```

`aafe doctor` 会校验 Workspace Root 下的分层编辑器文件，并警告安装目录仍残留 `.cursor` / `.codebuddy` 或 Root 下误放的 `.ai-agent` / `.docs`。

## 项目更新与诊断

升级 npm 包后执行：

```bash
npm install
npx --yes @aafe/agent-runtime@latest update
npx --yes @aafe/agent-runtime@latest doctor
```

`aafe update` 默认会：

- 刷新 `.ai-agent` Runtime、Skills、Pipelines 和 Gates；
- 刷新编辑器入口和 Hooks（含 Workspace Root 分层编辑器配置）；
- 迁移旧版本遗留的文件和配置（见 [自动迁移历史文件与配置](#自动迁移历史文件与配置)），结果在输出的 `migration` 字段；
- 保留 `.ai-agent/project.md`、`.ai-agent/project-skills/**`、`.ai-agent/rules/**` 和 `.ai-agent/memory/**`；
- 自动刷新 Knowledge 关系视图；
- 执行 `doctor` 校验。

常用参数：

```bash
aafe update --dry-run              # 预览
aafe update --upgrade-package      # 只升级全局 npm 包
aafe update --no-knowledge         # 关闭本次 Knowledge 自动更新
aafe update --yes --module-name=web --migrate-editors   # 子目录安装迁移编辑器配置
```

## DDD（显式开启）

DDD 是 **opt-in** 的。在用户明确表达 DDD 意图之前，Agent 不会读取 `.ai-agent/ddd/` 下的任何文件，也不做限界上下文、聚合和领域事件分析。代码库里恰好存在的 DDD 术语不构成启用理由。

### 门禁与范围

```bash
aafe ddd gate "用 DDD 重构订单模块"     # enabled | disabled | ambiguous
aafe ddd scope "用 DDD 重构订单模块"     # 命中的最小技能集与规则加载顺序
```

判定为 `ambiguous` 时先问用户，不静默启用。

### 发现与建模

```bash
aafe ddd ask "使用 DDD 实现多租户权限模块"
aafe ddd analyze "使用 DDD 实现多租户权限模块，支持角色、组织、权限策略和审计事件"
```

`analyze` 是证据驱动的：它读取 `aafe analyze` 的产物，把每个概念标注为 `observed`（项目里确有此物，附来源）或 `inferred`（从需求文本推断），各自带置信度和依据。没有证据的推断不会被伪装成事实。

```bash
aafe ddd analyze "..." --no-evidence   # 只从请求推断，不读项目知识
aafe ddd analyze "..." --force         # 门禁判定未启用时仍强制执行
```

输出包含：

```text
ubiquitousLanguage  boundedContexts  aggregates  entities  valueObjects
domainEvents        repositories     domainServices        questions
```

### 管线

`domain-feature` 管线按 DDD 链路执行：

```text
Gate → Scope → Discovery → Strategic → Tactical → Architecture → Validation
```

其中还包含 `ddd-pattern-bridge`：把聚合、领域事件等构造块映射到前端模式角色（Aggregate → State Machine / Command / Repository），但不因此激活整条模式链路。

## 前端设计模式（显式开启）

设计模式同样是 **opt-in**。最高优先级的两条原则：

- **PATTERN-SYSTEM-001**：一个项目不是「选一个设计模式」，而是针对具体问题选出**最小充分的模式组合**；
- **PATTERN-SYSTEM-002**：**不用设计模式不是缺陷**。

内置 16 个模式域、304 个模式、155 条规则，其中 82 个模式带完整评分元数据。

### 门禁

```bash
aafe pattern gate "用策略模式重构布局算法"
```

裸出现 `strategy`、`factory`、`adapter` 这类词不会触发；必须是明确的模式诉求。

### 问题识别与组合

先识别问题，再谈模式：

```bash
aafe pattern discover "..."    # 只输出问题与变化点，不给任何模式
aafe pattern select "..."      # 识别问题 → 评分候选 → 组合
aafe pattern modules "..."     # 按模块分别给出组合
aafe pattern audit "..."       # 反模式审计（不受门禁限制）
aafe pattern ask "..."         # 选型前需要澄清的问题
aafe pattern catalog --scorable
```

`select` 的实际输出（`--summary`）：

```json
{
  "status": "pass",
  "problems": ["同一能力存在多种可替换实现，需要运行时选择或后续扩展", "用户操作需要撤销与重做"],
  "complexity": "high",
  "patterns": [
    { "pattern": "Strategy", "responsibility": "承担「algorithm-variation」…", "score": 8 },
    { "pattern": "Command",  "responsibility": "承担「user-operation」…",      "score": 5 }
  ],
  "flows": ["Strategy", "Undo/Redo → Command"],
  "conflicts": [],
  "redundant": ["chain-of-responsibility"],
  "rationale": ["识别到 2 个问题、1 个变化点，问题复杂度评级 2/3。", "剔除 1 个冗余模式（Rule 011：优先最小充分组合）。"]
}
```

每个入选模式都必须对应一个明确职责；冲突与冗余会被显式剔除并说明理由。

### 评分与过度设计

评分同时计算收益（ProblemFit、ChangeIsolation、ComplexityReduction、ReusePotential、PerformanceBenefit）与成本（Implementation、Cognitive、Coupling、Overengineering）。收益是**上下文相关**的：一个模式在它的 `justifiedAt` 复杂度阈值之下被使用，会被记为过度设计风险并直接扣分，从而落选。

### 管线

```text
Gate → Discovery → Selection → Composition → Anti-Pattern Audit → Validation
```

`aafe pattern audit` 会区分 `observed`（项目现状里已存在的反模式）与 `predicted`（当前组合方案会引入的反模式），共 25 类。

## Agent Platform

从 `0.2.0` 起，静态分析之上多了一层 Agent Platform：Planner 决定「该做什么」，Orchestrator 负责「怎么可靠地做完」，专业 Agent 各自解决一类问题，最终由 Context Agent 产出交给 IDE Agent 的最小上下文包。

```text
CLI → Planner → Orchestrator → AgentProvider → Agent → Knowledge → Context Package → IDE Agent
```

### 命令

```bash
# 给 IDE Agent 的上下文包（默认纯文本，便于直接粘进对话）
aafe context --requirement="增加用户手机号搜索"
aafe context --diff --format=md --out=.aafe/context.md

# 影响面分析：需求驱动或 diff 驱动
aafe impact --requirement="增加用户手机号搜索"
aafe impact --diff=main...HEAD

# 只看 Planner 打算怎么做，不真正调用 Agent
aafe plan --requirement="..." --dry-run

# Planner + Orchestrator 全循环，产物写入 <output>/runs/<runId>/
aafe run "增加用户手机号搜索"

# 规划测试 / 生成 YAML Case；加 --run 才真正用 Playwright 执行
aafe test --diff
aafe test --coverage
# 「分析此PR … 生成测试用例」走 aafe test --pr，不要安装 uitest / @aafe/ai-test
# 测试地址每次可能不同：缺地址时 Agent 询问用户，再 --run --base-url=<本次 URL>
aafe test --pr=https://github.com/acme/app/pull/12
aafe test --pr=https://github.com/acme/app/pull/12 --run --base-url=https://preview.example/app

# E2E 默认开启；关闭用 --no-e2e 或：
aafe e2e disable
aafe e2e enable
aafe e2e status
aafe e2e install --yes

# PR 访问令牌写在 .aafe.config.json（可用 ${ENV}），不要用 --token <值>
#   e2e.githubAccessToken / e2e.gongfengAccessToken
aafe test --requirement="增加用户手机号搜索"

# 把一次失败的测试报告定位成根因
aafe diagnose --failure=<report.json|log.txt>

# 历史 run：列表与只读回放（含每步的 input / output 载荷）
aafe run --list
aafe run --replay=<runId>
```

加 `--no-write` 可以不落盘运行。`aafe impact --format=md` 输出可直接贴进 PR 或 TAPD 的影响分析报告。

### 知识检索

`aafe analyze` 会同时构建倒排索引（`.aafe/knowledge/index/json/search.json`），覆盖模块、文件、路由、组件、特性、业务流程和符号：

```bash
aafe knowledge search "用户手机号搜索"
aafe knowledge search "UserList" --kind=component,route --limit=10
aafe knowledge index --rebuild
```

路径与驼峰符号会归一到同一组词元，所以 `userPhoneSearch`、`user-phone-search.js` 和「用户手机号搜索」命中同一批结果。

### 内置 Agent 与 Capability

Planner 只认 capability，不认 Agent 名字，因此换实现不需要改 Planner。

| Agent | Capability | 状态 |
| --- | --- | --- |
| `code-intelligence` | `project-analysis` / `architecture-analysis` / `dependency-analysis` / `data-flow-analysis` / `feature-analysis` / `business-flow-analysis` | 已实现 |
| `impact-analyzer` | `requirement-impact` / `change-impact` / `risk-analysis` | 已实现 |
| `knowledge-validator` | `knowledge-validation` / `evidence-check` | 已实现 |
| `context-agent` | `context-packaging` / `evidence-selection` | 已实现 |
| `test-agent` | `test-planning` / `test-generation` / `e2e-execution` | 已实现；YAML 落 `tests/ui-ai/cases/`，报告只在 `.aafe/e2e/reports/`；`e2e-execution` 需 `allowTestExecution`（或 `aafe test --run`） |
| `failure-analyzer` | `failure-analysis` / `root-cause-analysis` / `fix-analysis` | 已实现 |

`risk-analysis` 与 `evidence-check` 两个 capability 已注册但尚无本地实现分支。

### 交给当前 IDE Agent（默认开启）

没有可用 Agent 的 capability 不会停在 `no-agent-provides-capability`——此时编辑器里正跑着一个完全有能力做这件事的 Agent。默认会包装成一次 handoff 交给它，已配置且启用的 Agent 永远优先，回退不顶掉真实接线。

```json
{ "ideAgent": { "enabled": true, "mode": "current", "capabilities": [] } }
```

三级关闭窗口，范围越窄越优先：

```bash
AAFE_IDE_AGENT=0 aafe run "..."   # 单次命令 / CI，也接受 false / off / no
aafe run "..." --no-ide-agent      # 等价的 CLI 参数
# 项目级：.aafe.agents.json → "ideAgent": { "enabled": false }
```

CI 里建议关掉：没有交互式 IDE Agent 能接手，handoff 只会变成永远没人认领的 `skipped`，明确失败更有价值。要求结果完全可复现时同理。

`ideAgent.capabilities` 是白名单，列进去的 capability **总是**走 IDE Agent，适合那些需要判断而非查表的分析。完整说明见 [Agent 作用与配置指南](./AGENTS.CONFIG.md#全局开关是否自动交给当前-ide-agent)。

### Agent 契约与 Schema 校验

每个 Agent 都绑定一组契约：`prompt` + `inputSchema` + `outputSchema`，默认从 `src/agents/<id>/` 装载，也可以在 `.aafe.agents.json` 里指向项目自己的文件或内联 schema。

`AgentRuntime` 是所有 Agent 的唯一执行路径：

```text
装载契约 → 校验入参 → 注入 prompt/schema → 调用 provider
        → 确定性纠错 → 校验输出 → 修复回路 → 校验 evidence
```

输出不合契约时先做本地确定性纠错（标量补成数组、字符串化 JSON 解开、数字/布尔强转），仍不合规才带着校验错误回问模型，最多 `maxRepairAttempts` 轮。

`schemaMode` 控制违约后果，默认按 provider 区分：

| 模式 | 行为 | 默认适用 |
| --- | --- | --- |
| `enforce` | 违约即 `failed` | `http` / `cli` / `mcp` / `ide` 等远程实现 |
| `warn` | 保留结果但降级为 `partial`，绝不报成 `success` | `local` 内置 Agent |
| `off` | 不校验 | 需要显式配置 |

指向不存在文件的 evidence 会被丢弃并计数——一条指不到任何地方的证据，比没有证据更糟。

### `.aafe.agents.json`

Agent 接线独立成文件，避免把 `.aafe.config.json` 撑爆。`aafe init` / `aafe update` 只在缺失时生成，不覆盖已有配置；`aafe doctor` 会校验每个 capability 都能解析到启用的 Agent。

```json
{
  "version": 1,
  "planner": { "provider": "rule", "maxSteps": 12,
    "llm": { "endpoint": null, "model": null, "apiKeyEnv": "AAFE_LLM_API_KEY", "temperature": 0 } },
  "agents": {
    "impact-analyzer": { "enabled": true, "provider": "local", "ref": "builtin:impact-analyzer" },
    "test-agent": { "enabled": true, "provider": "local", "ref": "builtin:test-agent" },
    "code-intelligence": {
      "provider": "http",
      "endpoint": "${AAFE_AGENT_ENDPOINT}",
      "model": "${AAFE_AGENT_MODEL}",
      "outputSchema": "./contracts/code-intelligence.output.json",
      "schemaMode": "enforce",
      "maxRepairAttempts": 2
    }
  },
  "ideAgent": { "enabled": true, "mode": "current", "capabilities": [] },
  "developer": { "provider": "ide", "mode": "current" },
  "policies": {
    "timeoutMs": 120000, "maxRetries": 1, "maxParallel": 4, "allowNetwork": false,
    "allowTestExecution": false, "tokenBudget": 12000, "maxTokens": null, "maxCost": null
  }
}
```

字段逐条说明、五种 provider 的配置示例和自定义 Agent 的写法见 **[Agent 作用与配置指南](./AGENTS.CONFIG.md)**；协议层面的请求/响应结构见 [`AGENTS.SCHEMA.md`](./AGENTS.SCHEMA.md)。

Planner 默认是确定性的 `RulePlanner`，无需 API Key 即可离线运行。把 `planner.provider` 改成 `"llm"` 并填好 `endpoint` / `model` 即可启用 OpenAI 兼容的 `LlmPlanner`；它在网络异常、返回非 JSON 或请求了不存在的 capability 时会**自动回退到 RulePlanner**，所以开启 LLM 只会变慢，不会让流程中断。

`provider` 支持 `local` / `http` / `cli` / `mcp` / `ide` 五种传输方式。`http` 类型的 Agent 需要显式打开 `policies.allowNetwork`。`endpoint` / `model` / `prompt` / `inputSchema` / `outputSchema` 支持 `${ENV_VAR}` 展开，密钥和内网地址不必进版本库；变量未设置时该字段置空并在 `aafe doctor` 报警，而不是把字面量 `${...}` 当成地址去请求。

`policies` 里两种预算是不同的东西：`tokenBudget` 限制单个 Agent 的上下文包大小，`maxTokens` / `maxCost` 是整个 run 的花费上限，在步与步之间检查（调用中途中止并不会退还已花的 token）。`cli` 类型 Agent 的命令和 `tools` 会先过危险操作 denylist——`rm -rf`、`git reset --hard`、`git push`、`sudo` 之类在 spawn 前就被拒绝。

## Knowledge Center

Knowledge Center 是基于项目代码、架构文档、Mermaid 图、Memory 和 Git 变更的 AI 项目知识管理能力。它不要求创建独立的深度文档站点，优先使用项目已有的 `.docs` 作为知识来源。

```bash
npx aafe knowledge init
npx aafe knowledge update
npx aafe knowledge sync            # update 的别名
aafe knowledge update --dry-run    # 预览
```

自定义架构文档目录：

```bash
aafe knowledge update \
  --architecture-docs=.docs \
  --knowledge-docs=.docs/aafe-generated
```

默认生成：

```text
.docs/aafe-generated/
├── README.md
├── 组件关系.md
├── 业务关系与数据流.md
└── 影响范围与测试预测.md
```

这些是生成视图；原始 `.docs` 文档不会被覆盖。采集内容包括页面路由与模块、Vue/React 组件关系、Store/API/Worker/Storage、测试路径与变更关系、架构文档及 Mermaid 图、影响范围与测试预测，以及 Memory、版本、来源和审核状态。

## Knowledge Web

`knowledge-web` 将当前项目的 Knowledge 数据生成一套本地只读可视化页面。

在 **AAFE 安装目录**（存在 `.ai-agent` 的目录，Monorepo 子模块则在对应子目录）执行：

```bash
npx aafe knowledge update                      # 建议先更新数据
npx aafe knowledge-web --serve --port=4173     # 生成并启动本地服务
```

浏览器访问 `http://127.0.0.1:4173/`。`--serve` 会占用当前终端，按 `Ctrl+C` 停止。

不加 `--serve` 时只生成静态 HTML，可直接打开 `.docs/aafe-generated/knowledge-web/index.html`。

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `--serve` | 生成后启动内置 HTTP 服务 |
| `--port=<number>` | 服务端口，默认 `4173` |
| `--host=<host>` | 服务主机，默认 `127.0.0.1` |
| `--dry-run` | 预览将生成的文件，不写入磁盘 |
| `--architecture-docs=<path>` | 架构文档目录，默认 `.docs` |
| `--output=<path>` | 输出目录，默认 `.docs/aafe-generated/knowledge-web` |

### 默认输出目录

```text
.docs/aafe-generated/knowledge-web/
├── index.html          # 项目总览与扫描统计
├── modules.html        # 模块关系
├── routes.html         # 路由与页面
├── components.html     # 组件关系
├── sources.html        # 架构文档与 Mermaid 来源
├── impact.html         # 影响范围与 P0/P1/P2 测试预测
├── diagrams/*.html     # 每张 Mermaid 图独立预览，可跳转 Mermaid Live Editor
└── site.json           # 页面和图表索引
```

它是 Knowledge 的模块化可视化索引，不替代源码、`.docs` 原文或测试结果。

## Agent 内自主命中

上面这些命令不需要你手动敲。项目初始化后，IDE Agent 有三条自主入口：

**1. 会话钩子自动跑同步链。** `sessionStart` 触发 `aafe task-completion`，即 `knowledge update → knowledge-web → update → doctor`，历史文件迁移也在其中。钩子会依次尝试 `node_modules/.bin/aafe`（含 monorepo 向上查找）和全局 `aafe`；都找不到才静默退出，绝不会从网络拉包。

**2. always-apply 规则替 Agent 做判定。** `aafe-ddd-gate.mdc` 和 `aafe-pattern-gate.mdc` 要求 Agent 在动手前自己跑 `aafe ddd gate` / `aafe pattern gate`；`aafe-new-file-license.mdc` 要求跑 `aafe license ensure`；影响分析规则要求先跑 `aafe impact --diff` 拿机器结果，而不是从零推断。

**3. `skill-index.md` 里的命令表。** Agent 每个任务都先读这个文件，其中「Commands you may run yourself」列出了什么情况该跑什么：

| 情况 | 命令 |
| --- | --- |
| 定位模块 / 路由 / 组件 / 特性 / 符号 | `aafe knowledge search "<terms>"` |
| 检索无结果且 `.aafe/` 缺失或过期 | `aafe analyze` |
| 改动前收集需求证据 | `aafe context --requirement="..."` |
| 改动后报告影响面 | `aafe impact --diff` |
| 规划测试 / 定位失败根因 | `aafe test`、`aafe diagnose` |
| Runtime 文件看起来不一致 | `aafe doctor`、`aafe migrate --dry-run` |

这些命令除 `analyze` 和 `migrate` 外都只读，Agent 拿来验证假设的成本很低。定位代码时应优先用 `aafe knowledge search` 而不是盲目 grep——它跨模块、路由、组件、特性和符号排序，并把 `userPhoneSearch`、`user-phone-search.js` 和「用户手机号搜索」归一到同一组词元。

## 任务完成自动同步

项目初始化后默认启用。任务成功结束时自动执行：

```text
aafe knowledge update → aafe knowledge-web → aafe update → aafe doctor
```

也可以手动执行：

```bash
aafe task-completion
aafe task-completion --dry-run
```

执行结果记录到 `.ai-agent/memory/knowledge-sync.jsonl`。默认策略：任务失败时不写入 Knowledge；同步失败不阻断原任务，只记录日志。需要严格阻断时把 `.aafe.config.json` 的 `taskCompletion.failClosed` 改为 `true`。

```json
{
  "taskCompletion": {
    "enabled": true,
    "command": "aafe task-completion",
    "steps": ["aafe knowledge update", "aafe update", "aafe doctor"],
    "failClosed": false,
    "log": ".ai-agent/memory/knowledge-sync.jsonl"
  }
}
```

## 架构文档接入

如果项目存在 `.docs` 或其他架构文档目录，`aafe analyze` 会读取 Markdown / MDX 架构说明、Mermaid `.mmd` 图表，以及路由、模块、Store、API 和数据流说明。

```bash
aafe analyze --architecture-docs=.docs
```

生成：

```text
.ai-agent/skills/project-architecture-locator.md
.ai-agent/memory/project-architecture.md
.ai-agent/skills/knowledge-center-architecture.md
.ai-agent/memory/knowledge-center-architecture.md
```

使用原则：

1. 先读取架构文档和相关图表，再定位源码；
2. 文档与当前代码冲突时，以代码为事实并记录冲突；
3. Mermaid 图作为关系和流程证据，不作为可执行代码；
4. 需求、修复、重构完成后重新计算影响范围和测试范围；
5. 不把项目强行转换成不存在的业务领域模型。

## AI Runtime 执行

```bash
aafe run "实现一个支持取消、分页和缓存的日志检索功能"
```

通用 `feature` 管线（不含 DDD 与模式步骤）：

```text
memory-recaller → architect → module-decomposer → evolution-predictor
→ [architecture_gate] → adr-generator → [implementation_gate]
→ refactor-critic → memory-writer → [merge_gate]
```

只有请求明确表达了相应意图，才会改走 `domain-feature` 或 `pattern-feature` 管线。

任务结束前，必须基于 `.docs` 和相关模块关系输出：直接/间接/潜在影响范围、架构证据、P0/P1/P2 测试预测、已执行与未覆盖的测试，以及未验证风险和人工确认项。

## 项目目录结构

### 标准安装（项目根目录即 Workspace Root）

```text
.ai-agent/
├── runtime/                    # engine.md router.yaml gates.yaml protocol.md memory.md
├── skills/                     # 通用技能
├── pipelines/                  # feature / domain-feature / pattern-feature / refactor / performance …
├── scenarios/
├── ddd/                        # DDD 知识包（opt-in，39 个文件）
│   ├── SKILL.md
│   ├── rules/                  # 8 条，含 ddd-gate.md / ddd-scope.md
│   ├── skills/                 # 15 个
│   └── schemas/                # 15 个
├── frontend-engineering/       # 设计模式知识包（opt-in，61 个文件）
│   ├── SKILL.md
│   ├── rules/                  # 22 条，含 pattern-gate.md / pattern-composition.md
│   ├── skills/                 # 23 个
│   ├── schemas/                # 11 个
│   └── references/             # 4 个
├── project.md                  # 项目自有，update 不覆盖
├── project-skills/             # 项目自有，update 不覆盖
├── rules/                      # 项目自有，update 不覆盖
└── memory/                     # 项目自有，update 不覆盖

.cursor/                        # --editors=cursor 时，仅指针，不复制项目知识
├── rules/                      # aafe-skill-router / aafe-architecture-runtime
│                               # aafe-ddd-gate / aafe-pattern-gate …
├── skills/
└── hooks/

.docs/
└── aafe-generated/
```

`.ai-agent/` 是项目 AI Runtime 和 Memory 的单一知识入口；`.docs/` 保留项目原始架构说明及 Knowledge 生成视图；编辑器目录只是指向 `.ai-agent` 的薄适配层。

### 子目录安装（Monorepo / 多模块）

Runtime 知识仍在安装目录；编辑器适配器在 Workspace Root 按模块分层：

```text
# Workspace Root
.cursor/{rules,skills,hooks}/web/
.cursor/hooks.json
.codebuddy/web/
.codex/web/aafe.md
CLAUDE.md                  # 含 <!-- AAFE:module:web --> 模块块

# 安装目录 bklog/web/
.ai-agent/
.docs/
.aafe.config.json          # 含 workspace 元数据
package.json
```

## Agent Skills 分发

AAFE 提供两条互不替代的链路：

| 场景 | 命令 | 写入位置 |
| --- | --- | --- |
| 下载 Agent Skill | `aafe skills install ... --github` | Agent Skills 目录 |
| 接入业务项目 Runtime | `aafe init/update/analyze/doctor` | 业务项目 `.ai-agent/` |

```bash
npx --yes @aafe/agent-runtime@latest skills list --github
npx --yes @aafe/agent-runtime@latest skills install knowledge-center --github
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github
```

不要使用 `aafe skills install` 替代业务项目的 `aafe init/update/analyze/doctor`。

## 开发与验证

项目根目录执行：

```bash
npm test                 # 全量：agent-platform / submit / license / tapd / workspace + doctor
npm run test:agent-platform
npm run doctor
node ./bin/aafe.js knowledge update --dry-run
node ./bin/aafe.js knowledge-web --dry-run
```

格式检查：

```bash
git diff --check
```

## 设计边界

- Runtime 核心提供通用编排能力，不承载具体业务 CMS 数据模型；
- DDD 与设计模式均为显式开启，不因代码库里的术语或需求里的裸关键词自动激活；
- 模式选型的产物是**最小充分的模式组合**，「不用设计模式」是合法结论；
- 领域模型区分 `observed` 与 `inferred`，没有证据的推断不伪装成事实；
- Knowledge Center 使用项目代码、`.docs`、Mermaid 图和 Memory；
- Knowledge Web 是本地可视化索引，不是独立深度文档站点；
- 子目录安装时，仅编辑器适配器写入 Workspace Root；`.ai-agent` / `.docs` 保留在安装目录；
- 自动生成内容必须保留来源、版本、置信度和审核状态；
- 不上传源码、密钥、Token、Cookie 或未脱敏业务数据；
- 自动更新不应覆盖人工维护的原始架构文档。
