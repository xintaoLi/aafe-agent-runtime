---
name: aafe-vue-complex-runtime
description: 当用户要求为 Vue 复杂前端项目初始化、同步、更新、诊断或使用 AAFE Agent Runtime（来自 xintaoLi/aafe-agent-runtime）进行架构化开发时触发；适用于 Vue + Complex 场景下的功能设计、重构、性能优化、项目架构分析、DDD/设计模式管线执行。
argument-hint: 传入目标项目路径、任务类型（init/update/sync/doctor/analyze/run/pattern/ddd/memory）和具体前端需求；如未给路径，默认使用当前工作目录或用户明确指定的项目目录。
---

## 目标

使用 `https://github.com/xintaoLi/aafe-agent-runtime.git` 的 AAFE 能力，为 **Vue + Complex Frontend** 运行环境初始化、更新并使用项目级架构 Runtime，让前端开发从“直接写代码”变成“读取记忆 → 项目架构定位 → DDD 领域建模 → 架构分析 → 模块拆分 → 模式选择 → 门禁校验 → 实现计划 → 批判审查 → 经验/记忆沉淀”的闭环。

AAFE 核心定位：**Universal Frontend Architecture Runtime + Project Memory + Project Architecture Locator + DDD + Design Pattern Advisor**。

## 适用场景

在以下场景触发本 Skill：

1. 用户说“给这个 Vue 项目初始化 AAFE / agent runtime / 架构运行时”。
2. 用户说“使用 aafe-agent-runtime 做 Vue + Complex 初始化/更新/同步/doctor/analyze”。
3. 用户要求对复杂 Vue 前端功能先做架构管线、模块拆分、模式选择、DDD 分析或 ADR。
4. 用户要求在 Vue 复杂业务系统中做重构、性能优化、复杂状态流、跨模块协作、工作流、后台系统或图/画布类能力的架构化落地。
5. 用户要求快速分析项目主要路由、组件、模块或设计说明，生成项目定位 Skill / Memory。
6. 用户明确提供或引用仓库 `xintaoLi/aafe-agent-runtime` 并要求使用其中能力。

## 不触发场景

不要在以下场景触发：

- 只是普通 Vue 语法问答、单个组件小改、CSS 调整，且没有架构/Runtime/AAFE/复杂场景诉求。
- 用户要安装市场中的通用 Skill，而不是使用 AAFE 初始化或更新项目。
- 用户要求创建一个与 AAFE 无关的新 Skill；应使用 `skill-creator`。
- 用户要求前端监控排障、Aegis、Galileo、Replay 等，应优先使用相应监控 Skill。

## 发布使用边界：GitHub Agent SKILLS vs npm CLI Runtime

AAFE Runtime 作为可发布到 GitHub 和 npm 的包，提供两条互不替代的使用链路：

### A. GitHub Agent SKILLS 下载

适用于：用户只想让某个 Agent / AI 工具获得 AAFE 协作能力。

- 来源：`https://github.com/xintaoLi/aafe-agent-runtime` 的 `skills/manifest.json` 与 `skills/*/SKILL.md`。
- 目标：目标 Agent 的 Skills 目录，例如 `$SIBOOT_WORKSPACE_PATH/skills/{skill-name}/SKILL.md` 或用户显式提供的 `--target`。
- 命令：
  ```bash
  npx --yes @aafe/agent-runtime@latest skills list --github
  npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github --target="/path/to/agent/skills"
  ```
- 不写入业务项目 `.ai-agent/`。

### B. npm 安装后使用 CLI 初始化 / 更新项目 Runtime

适用于：业务项目要接入、更新、分析或诊断 AAFE Runtime。

- 来源：npm 包 `@aafe/agent-runtime`。
- 目标：当前业务项目的 `.ai-agent/`、`.aafe.config.json`、编辑器配置。
- 命令：
  ```bash
  npm install --save-dev @aafe/agent-runtime
  npx aafe init --yes --framework=vue --scenarios=complex --template=complex --editors=cursor
  npx aafe update
  npx aafe analyze
  npx aafe doctor
  ```
- 不安装 Agent SKILLS。

> ⚠️ **CRITICAL**：不要用 `aafe skills install` 替代项目内 `init/update/analyze/doctor`；也不要用项目内 `aafe update` 替代 GitHub Agent SKILLS 下载。

## AAFE Vue + Complex 基准配置

默认运行环境：

```txt
framework: vue
scenarios: complex
runtime directory: .ai-agent
memory: enabled
recommended template: complex
recommended editors: cursor（如项目已有其他编辑器配置，可按需附加）
```

Vue Framework Pack 关注点：

- composable design
- reactive ownership
- store boundaries
- component responsibility split

Complex Frontend Scenario Pack 工作流：

1. 在选择模式之前，先按真实业务模块拆分功能。
2. 分别为 domain、application、infrastructure、presentation 模块选择模式。
3. 每个模式必须保持在对应模块边界内。
4. 每个模式都要落地 contract、implementation、verification。
5. 当模块职责不同，拒绝使用一个全局统一模式解决所有问题。

## 快速命令

> ⚠️ **CRITICAL**：只有在用户明确要求对目标项目写入/修改文件，或任务本身就是初始化/更新/同步 Runtime 时，才运行会写文件的命令。执行前确认目标目录是否正确；不要在错误目录生成 `.ai-agent`、`.aafe.config.json` 或编辑器配置。

### 1) 初始化 Vue + Complex Runtime

```bash
npx --yes @aafe/agent-runtime@latest init --yes --framework=vue --scenarios=complex --template=complex --editors=cursor
npx --yes @aafe/agent-runtime@latest doctor
```

### 2) 更新已安装项目的最新能力

当项目已经安装过 AAFE，并且已通过 `npm install` 拉取新版本后，在项目根目录执行：

```bash
aafe update
aafe doctor
```

预览更新：

```bash
aafe update --dry-run
```

更新规则：

- `aafe update` 默认刷新当前项目 `.ai-agent` Runtime、Skills、Pipelines、Framework/Scenario packs。
- 保留已有 `.ai-agent/memory/*` 项目记忆。
- 幂等写入：已存在且内容一致的生成文件不重复写入，不追加重复声明。
- 只有显式 `aafe update --upgrade-package` 才升级全局 CLI 包。

### 3) 项目架构快速分析

```bash
aafe analyze
```

生成：

```txt
.ai-agent/skills/project-architecture-locator.md
.ai-agent/memory/project-architecture.md
```

使用规则：

1. 涉及路由、页面、组件、模块或设计说明定位时，先读 `.ai-agent/skills/project-architecture-locator.md`。
2. 只读取索引中相关文件，再做必要搜索，避免盲目扫描源码浪费上下文。
3. 项目路由、组件、模块或设计文档大幅变化后重新执行 `aafe analyze`。
4. `aafe analyze` 只维护单份 locator skill 和 architecture memory；内容未变化时不重复写入。

### 4) DDD 分析

```bash
aafe ddd ask "<业务功能>"
aafe ddd analyze "<业务功能>"
```

### 5) 设计模式选择

```bash
aafe pattern ask "<复杂前端能力>"
aafe pattern select "<复杂前端能力>" --extensible
```

### 6) 执行架构 Runtime 管线

```bash
aafe run "<Vue 复杂前端任务描述>"
```

## 初始化后应生成的结构

```txt
.ai-agent/
├── runtime/
│   ├── engine.md
│   ├── router.yaml
│   ├── gates.yaml
│   ├── protocol.md
│   └── memory.md
├── skills/
│   ├── memory-recaller.md
│   ├── project-architecture-analyzer.md
│   ├── project-architecture-locator.md      # aafe analyze 生成
│   ├── ddd-discovery.md
│   ├── bounded-context-mapper.md
│   ├── aggregate-designer.md
│   ├── domain-event-designer.md
│   ├── ddd-implementation-planner.md
│   ├── architect.md
│   ├── module-decomposer.md
│   ├── pattern-interviewer.md
│   ├── pattern-selector.md
│   ├── module-pattern-selector.md
│   ├── pattern-implementation-planner.md
│   ├── evolution-predictor.md
│   ├── refactor-critic.md
│   ├── experience-recorder.md
│   ├── adr-generator.md
│   └── memory-writer.md
├── frameworks/
│   └── vue.md
├── scenarios/
│   └── complex.md
├── pipelines/
│   ├── feature.yaml
│   ├── domain-feature.yaml
│   ├── pattern-feature.yaml
│   ├── refactor.yaml
│   ├── bugfix.yaml
│   └── performance.yaml
└── memory/
    ├── project-architecture.md              # aafe analyze 生成
    └── experience.md
```

## Memory 与经验沉淀

Memory 类型：

```txt
design | component | habit | convention | decision | experience | project-architecture | learning
```

经验沉淀规则：

- 同一个问题重复处理三次仍然存在问题时，只有在最终方案验证成功后才记录经验。
- 只记录可复用解决思路、决策路径、适用边界和避免项。
- 不记录完整试错过程、临时调试日志、情绪或归因。

## 核心执行流程

### 1) 定位项目与写入权限

- 如果用户给出项目路径，使用该路径作为 cwd。
- 如果用户没有给路径，但上下文中有明确当前项目目录，使用当前项目目录。
- 如果无法确定目标项目目录，先询问目标路径，不要猜测写入。
- 初始化/更新/同步前检查：
  - `package.json`
  - 是否已有 Vue/Nuxt 依赖
  - 是否已有 `.ai-agent` / `.aafe.config.json`
  - 是否已有 `.cursor` / `CLAUDE.md` 等编辑器配置

### 2) 检测项目类型

```bash
aafe detect
```

如果检测结果不是 Vue，但用户明确要求 Vue + Complex：按用户指定覆盖，并在汇报中说明。

### 3) 初始化、更新或同步 Runtime

- 新项目或无 `.ai-agent`：运行 `init`。
- 已有 `.ai-agent` 且用户说更新最新能力：运行 `aafe update`。
- 已有 `.ai-agent` 且只需要修复缺失：运行 `aafe doctor`，必要时 `aafe sync --yes --force`。
- 用户要求预览：使用 `--dry-run`。

### 4) 验证 Gate 与管线

初始化或更新后必须运行：

```bash
aafe doctor
```

如 doctor 失败：

1. 读取缺失文件/警告。
2. 运行 `aafe update` 或 `aafe sync --yes --force` 修复生成文件。
3. 再次运行 `aafe doctor`。
4. 如仍失败，输出阻塞原因和需人工处理项。

### 5) 对复杂 Vue 功能执行架构管线

当用户给出功能需求时，先分类：

| 类型 | Pipeline |
| --- | --- |
| 新复杂功能 | feature |
| 领域建模明显的业务功能 | domain-feature |
| 设计模式/扩展性诉求明显 | pattern-feature |
| 重构 | refactor |
| Bug 修复 | bugfix |
| 性能优化 | performance |
| 图/画布/节点边布局 | graph-feature |

然后执行：

```bash
aafe run "<需求>"
```

## Runtime Gate 规则

AAFE 默认门禁：

```yaml
gates:
  ddd_gate:
    requires:
      - ubiquitous_language
      - bounded_contexts
      - aggregates
  architecture_gate:
    requires:
      - boundaries
      - decomposition
      - pattern_selection
  pattern_gate:
    requires:
      - pattern_interview
      - pattern_selection
      - module_pattern_selection
  implementation_gate:
    requires:
      - risk_review
      - extension_points
  merge_gate:
    requires:
      - critic_pass
```

> ⚠️ **CRITICAL**：复杂功能、重构和性能任务不能跳过 architecture analysis；在 `architecture_gate` 通过前，不要直接进入代码实现。

## 输出要求

完成后简洁汇报：

1. 已执行的命令。
2. 生成/修改的关键文件。
3. `doctor` 状态。
4. Vue + Complex 配置是否生效。
5. 是否已生成或读取项目架构 locator。
6. 后续可用命令或下一步实现建议。
