# @aafe/agent-runtime

`@aafe/agent-runtime` 是面向前端工程的项目级 AI 架构运行时。它将 AI Coding 从“直接修改代码”升级为：

```text
项目记忆 → 架构定位 → 需求分析 → DDD/模式设计 → 实施 → 批判审查 → 影响分析 → 测试预测 → 知识更新
```

核心能力：

- 项目级 Runtime 初始化、更新和诊断
- Skill、Pipeline、Hook、Gate 和 Memory 编排
- Vue/React/Next/Monorepo 等项目识别
- DDD 领域建模和设计模式建议
- `.docs` 架构文档与 Mermaid 图接入
- Knowledge Center 知识关系、影响分析和测试预测
- Knowledge Web 本地可视化
- 任务完成后自动更新 Knowledge、Runtime 和 Doctor

## 目录

- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [项目初始化](#项目初始化)
- [Workspace Root 与编辑器分层配置](#workspace-root-与编辑器分层配置)
- [项目更新与诊断](#项目更新与诊断)
- [Knowledge Center](#knowledge-center)
- [Knowledge Web](#knowledge-web)
- [任务完成自动同步](#任务完成自动同步)
- [架构文档接入](#架构文档接入)
- [AI Runtime 执行](#ai-runtime-执行)
- [DDD 与设计模式](#ddd-与设计模式)
- [项目目录结构](#项目目录结构)
- [Agent Skills 分发](#agent-skills-分发)
- [开发与验证](#开发与验证)

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
```

常用项目类型：

```text
--framework=vue|react|next|monorepo|generic
```

常用场景：

```text
--scenarios=complex,ddd,patterns,graph,admin,dashboard,workflow
```

## CLI 命令

| 命令 | 用途 |
| --- | --- |
| `aafe init` | 初始化项目 Runtime、Memory 和编辑器入口 |
| `aafe detect` | 识别项目框架、编辑器和场景 |
| `aafe doctor` | 检查 Runtime 文件和配置完整性 |
| `aafe sync` | 同步生成的 Runtime 文件 |
| `aafe update` | 更新已接入项目的 Runtime、Skills、Hooks 和 Knowledge |
| `aafe analyze` | 生成项目架构定位 Skill 和 Memory |
| `aafe knowledge init` | 初始化 Knowledge 关系视图 |
| `aafe knowledge update` | 更新 `.docs` 下的 Knowledge 视图 |
| `aafe knowledge sync` | `knowledge update` 的别名 |
| `aafe knowledge-web` | 生成 Knowledge Web HTML |
| `aafe task-completion` | 执行任务完成后的自动同步链路 |
| `aafe memory` | 管理项目 Memory |
| `aafe ddd` | DDD 发现和领域模型分析 |
| `aafe pattern` | 设计模式访谈和选择 |
| `aafe run` | 执行项目架构 Runtime 管线 |
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

只对 `--editors` 中启用的编辑器生成分层配置。例如 `--editors=cursor,codebuddy` 会同时处理 Cursor 与 CodeBuddy。

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

更新并迁移安装目录下遗留的编辑器配置：

```bash
cd bklog/web
npx aafe update --yes --module-name=web --migrate-editors
npx aafe doctor
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

### 更新已安装项目

升级 npm 包后执行：

```bash
npm install
npx --yes @aafe/agent-runtime@latest update
npx --yes @aafe/agent-runtime@latest doctor
```

`aafe update` 默认会：

- 刷新 `.ai-agent` Runtime、Skills、Pipelines 和 Gates；
- 刷新编辑器入口和 Hooks（含 Workspace Root 分层编辑器配置）；
- 保留 `.ai-agent/project.md`、`.ai-agent/project-skills/**`、`.ai-agent/rules/**` 和 `.ai-agent/memory/**`；
- 自动刷新 Knowledge 关系视图；
- 执行 `doctor` 校验。

子目录安装时，`aafe update` 同样会分析安装目录与 Workspace Root，并按 `--editors` 更新 Root 下的分层编辑器配置；`.ai-agent` / `.docs` 不会迁移到 Root。详见 [Workspace Root 与编辑器分层配置](#workspace-root-与编辑器分层配置)。

预览更新：

```bash
aafe update --dry-run
```

只升级全局 npm 包时：

```bash
aafe update --upgrade-package
```

关闭本次 Knowledge 自动更新：

```bash
aafe update --no-knowledge
```

子目录安装时迁移编辑器配置到 Workspace Root：

```bash
aafe update --yes --module-name=web --migrate-editors
```

## Knowledge Center

Knowledge Center 是基于项目代码、架构文档、Mermaid 图、Memory 和 Git 变更的 AI 项目知识管理能力。它不要求创建独立的深度文档站点，优先使用项目已有的 `.docs` 作为知识来源。

### 初始化

```bash
npx --yes @aafe/agent-runtime@latest knowledge init
```

### 更新

```bash
npx --yes @aafe/agent-runtime@latest knowledge update
```

### 同步别名

```bash
npx --yes @aafe/agent-runtime@latest knowledge sync
```

### 预览

```bash
aafe knowledge update --dry-run
```

### 自定义架构文档目录

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

这些文件是生成视图；原始 `.docs` 文档不会被覆盖。

Knowledge 采集和管理的内容包括：

- 页面、路由和模块
- Vue/React 组件及组件关系
- Store、API、Worker 和 Storage
- 测试路径和变更关系
- 架构文档及 Mermaid 图
- 影响范围和测试预测
- Memory、版本、来源和审核状态

## Knowledge Web

`knowledge-web` 将当前项目的 Knowledge 数据生成一个本地只读可视化页面。

### 生成 HTML

```bash
aafe knowledge-web
```

默认输出为模块化目录：

```text
.docs/aafe-generated/knowledge-web/
├── index.html
├── modules.html
├── routes.html
├── components.html
├── sources.html
├── impact.html
├── diagrams/*.html
└── site.json
```

不会再把所有内容塞入单个 HTML 页面。

### 启动本地服务

```bash
aafe knowledge-web --serve --port=4173
```

访问：

```text
http://127.0.0.1:4173/
```

### 自定义路径

```bash
aafe knowledge-web \
  --architecture-docs=.docs \
  --output=.docs/aafe-generated
```

Knowledge Web 当前按模块展示：

- `index.html`：项目总览
- `modules.html`：模块关系
- `routes.html`：路由与页面
- `components.html`：组件关系
- `sources.html`：架构来源
- `impact.html`：影响范围与测试预测
- `diagrams/*.html`：每张 Mermaid 图独立预览
- `site.json`：页面和图表索引

`.mmd` 架构图支持：

- Knowledge Web 内置源码预览；
- 每张图独立页面；
- 打开 Mermaid Live Editor 在线预览；
- 根据目标项目实际 `.docs` 内容动态生成。

它是 Knowledge 的模块化可视化索引，不替代源码、`.docs` 原文或测试结果。

## 任务完成自动同步

项目初始化后默认启用任务完成自动同步。任务成功结束时自动执行：

```text
aafe knowledge update
→ aafe knowledge-web
→ aafe update
→ aafe doctor
```

其中 `knowledge-web` 会刷新模块化页面，并将当前影响范围和 P0/P1/P2 测试推荐更新到：

```text
.docs/aafe-generated/knowledge-web/impact.html
```

也可以手动执行：

```bash
aafe task-completion
aafe task-completion --dry-run
```

执行结果记录到：

```text
.ai-agent/memory/knowledge-sync.jsonl
```

默认策略：

- 任务失败时不写入 Knowledge；
- 同步失败不阻断原任务；
- 同步失败记录到 `knowledge-sync.jsonl`；
- 需要严格阻断时，可将 `.aafe.config.json` 的 `taskCompletion.failClosed` 改为 `true`。

配置示例：

```json
{
  "taskCompletion": {
    "enabled": true,
    "command": "aafe task-completion",
    "steps": [
      "aafe knowledge update",
      "aafe update",
      "aafe doctor"
    ],
    "failClosed": false,
    "log": ".ai-agent/memory/knowledge-sync.jsonl"
  }
}
```

## 架构文档接入

如果项目存在 `.docs` 或其他架构文档目录，`aafe analyze` 会读取：

- Markdown / MDX 架构说明
- Mermaid `.mmd` 图表
- 路由、模块、Store、API 和数据流说明

默认扫描：

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

执行一项复杂前端任务：

```bash
aafe run "实现一个支持取消、分页和缓存的日志检索功能"
```

典型管线：

```text
Memory Recall
→ DDD Discovery
→ Architecture Analysis
→ Module Decomposition
→ Pattern Interview
→ Pattern Selection
→ Implementation Planning
→ Gate Validation
→ Refactor Critique
→ Memory Write
→ Impact and Test Forecast
```

任务结束前，必须基于 `.docs` 和相关模块关系输出：

- 直接影响范围
- 间接影响范围
- 潜在影响范围
- 架构证据
- P0/P1/P2 测试预测
- 已执行、预测中和未覆盖的测试
- 未验证风险和人工确认项

## DDD 与设计模式

### DDD 发现

```bash
aafe ddd ask "实现多租户权限模块"
aafe ddd analyze "使用 DDD 实现多租户权限模块，支持角色、组织、权限策略和审计事件"
```

DDD 输出包括：

```text
ubiquitousLanguage
boundedContexts
aggregates
entities
valueObjects
domainEvents
repositories
domainServices
questions
```

### 设计模式

```bash
aafe pattern ask "实现支持多种布局算法的画布能力"
aafe pattern select "实现支持多种布局算法的画布能力" --extensible
```

支持：

```text
Strategy | Factory | Registry | State Machine | Command
Pipeline | Observer | Adapter | Composition
```

复杂功能应按模块选择模式，不应为了使用模式而使用模式。

## 项目目录结构

### 标准安装（项目根目录即 Workspace Root）

初始化后主要结构：

```text
.ai-agent/
├── runtime/
│   ├── engine.md
│   ├── router.yaml
│   ├── gates.yaml
│   ├── protocol.md
│   └── memory.md
├── skills/
│   ├── architect.md
│   ├── module-decomposer.md
│   ├── architecture-impact-test-forecast.md
│   ├── knowledge-center-updater.md
│   ├── memory-recaller.md
│   └── memory-writer.md
├── pipelines/
├── scenarios/
└── memory/

.cursor/                  # --editors=cursor 时
├── rules/
├── skills/
└── hooks/

.codebuddy/               # --editors=codebuddy 时
├── aafe.md
└── skills/

.docs/
└── aafe-generated/
    ├── README.md
    ├── 组件关系.md
    ├── 业务关系与数据流.md
    ├── 影响范围与测试预测.md
    └── knowledge-web/
```

### 子目录安装（Monorepo / 多模块）

Runtime 知识仍在安装目录；编辑器适配器在 Workspace Root 按模块分层：

```text
# Workspace Root
.cursor/
├── rules/web/
├── skills/web/
├── hooks/web/
└── hooks.json
.codebuddy/web/
├── aafe.md
└── skills/
.codex/web/aafe.md
CLAUDE.md                  # 含 <!-- AAFE:module:web --> 模块块

# 安装目录 bklog/web/
.ai-agent/
.docs/
.aafe.config.json          # 含 workspace 元数据
package.json
```

`.ai-agent/` 是项目 AI Runtime 和 Memory 的单一知识入口；`.docs/` 保留项目原始架构说明及 Knowledge 生成视图；编辑器目录只是指向 `.ai-agent` 的薄适配层，不复制项目知识。

## Agent Skills 分发

AAFE 提供两条互不替代的链路：

| 场景 | 命令 | 写入位置 |
| --- | --- | --- |
| 下载 Agent Skill | `aafe skills install ... --github` | Agent Skills 目录 |
| 接入业务项目 Runtime | `aafe init/update/analyze/doctor` | 业务项目 `.ai-agent/` |

查看 Skill：

```bash
npx --yes @aafe/agent-runtime@latest skills list --github
```

安装 Knowledge Center Skill：

```bash
npx --yes @aafe/agent-runtime@latest skills install knowledge-center --github
```

安装 Vue Complex Skill：

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github
```

不要使用 `aafe skills install` 替代业务项目的 `aafe init/update/analyze/doctor`。

## 开发与验证

项目根目录执行：

```bash
npm test
npm run doctor
node ./scripts/test-workspace-cursor.js
node ./bin/aafe.js knowledge update --dry-run
node ./bin/aafe.js knowledge-web --dry-run
node --check src/cli/knowledge.js
node --check src/cli/knowledgeWeb.js
node --check src/cli/taskCompletion.js
```

格式检查：

```bash
git diff --check
```

## 发布后使用示例

目标项目安装最新版本：

```bash
npm install --save-dev @aafe/agent-runtime@latest
```

初始化：

```bash
npx aafe init --yes --framework=vue --scenarios=complex,ddd,patterns,graph --editors=cursor
npx aafe knowledge init
npx aafe knowledge-web
npx aafe doctor
```

Monorepo 子目录（例如 `bklog/web`）初始化：

```bash
cd bklog/web
npx aafe init --yes \
  --framework=vue \
  --scenarios=complex,ddd,patterns \
  --editors=cursor,codebuddy \
  --module-name=web \
  --migrate-editors
# 在 IDE 中以仓库 Root 打开 Workspace
npx aafe doctor
```

日常开发完成后，任务钩子会自动执行；如需手动刷新：

```bash
npx aafe knowledge update
npx aafe knowledge-web
npx aafe doctor
```

## 设计边界

- Runtime 核心提供通用编排能力，不承载具体业务 CMS 数据模型；
- Knowledge Center 使用项目代码、`.docs`、Mermaid 图和 Memory；
- Knowledge Web 是本地可视化索引，不是独立深度文档站点；
- 子目录安装时，仅编辑器适配器（`.cursor`、`.codebuddy`、`CLAUDE.md` 等）写入 Workspace Root；`.ai-agent` / `.docs` 保留在安装目录；
- 自动生成内容必须保留来源、版本、置信度和审核状态；
- 不上传源码、密钥、Token、Cookie 或未脱敏业务数据；
- 自动更新不应覆盖人工维护的原始架构文档。
