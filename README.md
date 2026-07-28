# @aafe/agent-runtime

`@aafe/agent-runtime` 是面向前端工程的项目级架构运行时，用来把 AI Coding 从“直接写代码”升级为“读取项目记忆、DDD 领域建模、架构分析、交互澄清、设计模式选择、门禁校验、实现代码、批判审查、学习沉淀”的闭环。

核心定位：**Universal Frontend Architecture Runtime + Project Memory + DDD + Design Pattern Advisor**。

## 已实现能力

- 交互式 `aafe init`
- 多编辑器 adapter
- 可发布模板系统
- 独立 framework/scenario npm packs 草案
- Critique fail / merge gate fail 后自动 rerun
- 从 `.ai-agent/*.yaml` 动态加载 Runtime 配置
- Memory 自动摘要、去重、压缩
- 基于代码扫描的组件/规范自动学习
- 新功能设计模式问答与选择
- DDD 领域驱动设计支持

## 新功能执行链路

```txt
User Request
  -> Memory Recall
  -> DDD Discovery
  -> Bounded Context Mapping
  -> Aggregate Design
  -> Domain Event Design
  -> DDD Gate
  -> Architecture Analysis
  -> Module Decomposition
  -> Pattern Interview
  -> Pattern Selection
  -> Pattern Gate
  -> Implementation Planning
  -> Implementation Gate
  -> ADR
  -> Refactor Critique
  -> Memory Write
```

## DDD 能力

新增 DDD 场景包：

```txt
.ai-agent/scenarios/ddd.md
.ai-agent/skills/ddd-discovery.md
.ai-agent/skills/bounded-context-mapper.md
.ai-agent/skills/aggregate-designer.md
.ai-agent/skills/domain-event-designer.md
.ai-agent/skills/ddd-implementation-planner.md
.ai-agent/pipelines/domain-feature.yaml
```

支持 DDD 构件：

- `Ubiquitous Language`
- `Subdomain`
- `Bounded Context`
- `Context Map`
- `Aggregate Root`
- `Entity`
- `Value Object`
- `Repository`
- `Domain Service`
- `Domain Event`
- `Anti-Corruption Layer`

### DDD CLI

生成 DDD 发现问题：

```bash
node ./bin/aafe.js ddd ask "实现多租户权限模块"
```

分析领域模型：

```bash
node ./bin/aafe.js ddd analyze "使用 DDD 实现多租户权限模块，支持角色、组织、权限策略和审计事件"
```

输出包含：

```txt
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

### DDD Runtime

```js
import { analyzeDDD, buildDDDInterview, createRuntimeFromProject } from '@aafe/agent-runtime';

const ddd = analyzeDDD({
  prompt: '使用 DDD 实现多租户权限模块，支持角色、组织、权限策略'
});

const runtime = await createRuntimeFromProject(process.cwd());
const result = await runtime.execute('使用 DDD 实现多租户权限模块，支持角色、组织、权限策略');
```

## 设计模式能力

新增设计模式场景包：

```txt
.ai-agent/scenarios/patterns.md
.ai-agent/skills/pattern-interviewer.md
.ai-agent/skills/pattern-selector.md
.ai-agent/skills/pattern-implementation-planner.md
.ai-agent/pipelines/pattern-feature.yaml
```

支持模式：

- `Strategy`
- `Factory`
- `Registry`
- `State Machine`
- `Command`
- `Pipeline`
- `Observer`
- `Adapter`
- `Composition`

设计模式问答：

```bash
node ./bin/aafe.js pattern ask "实现一个支持多种布局算法的画布自动布局能力"
```

设计模式选择：

```bash
node ./bin/aafe.js pattern select "实现一个支持多种布局算法的画布自动布局能力" --extensible
```

## CLI

```bash
aafe init
aafe detect
aafe doctor
aafe sync
aafe update
aafe memory
aafe pattern
aafe ddd
aafe skills   # 仅用于 GitHub Agent SKILLS 下载，不用于项目 .ai-agent 初始化
```

初始化示例：

```bash
node ./bin/aafe.js init --yes --framework=react --scenarios=ddd,patterns,graph --editors=cursor
```

## 生成结构

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
│   ├── ddd-discovery.md
│   ├── bounded-context-mapper.md
│   ├── aggregate-designer.md
│   ├── domain-event-designer.md
│   ├── ddd-implementation-planner.md
│   ├── architect.md
│   ├── module-decomposer.md
│   ├── pattern-interviewer.md
│   ├── pattern-selector.md
│   ├── pattern-implementation-planner.md
│   ├── refactor-critic.md
│   └── memory-writer.md
├── pipelines/
│   ├── feature.yaml
│   ├── domain-feature.yaml
│   ├── pattern-feature.yaml
│   ├── graph-feature.yaml
│   ├── refactor.yaml
│   ├── bugfix.yaml
│   └── performance.yaml
├── scenarios/
│   ├── ddd.md
│   ├── patterns.md
│   ├── graph.md
│   ├── admin.md
│   ├── dashboard.md
│   └── workflow.md
└── memory/
```

## Gate

新增 `ddd_gate`：

```yaml
gates:
  ddd_gate:
    requires:
      - ubiquitous_language
      - bounded_contexts
      - aggregates
```

现有 `pattern_gate`：

```yaml
gates:
  pattern_gate:
    requires:
      - pattern_interview
      - pattern_selection
```

业务复杂的新功能应先通过 `ddd_gate`，再进入架构拆分和设计模式选择。

## 更新已安装项目能力

当项目已经安装过 `@aafe/agent-runtime`，并且已经通过 `npm install` 拉取了新版本后，在项目根目录执行：

```bash
aafe update
```

`aafe update` 默认刷新当前项目的 `.ai-agent` Runtime、Skills、Pipelines、Framework/Scenario packs、Skill Index On-Demand 路由、编辑器适配层和 `.aafe.config.json` 生成配置，并保留已有 `.ai-agent/project.md`、`.ai-agent/project-skills/**`、`.ai-agent/rules/**` 与 `.ai-agent/memory/**` 项目知识/记忆。更新过程是幂等的：已存在且内容一致的生成文件不会重复写入，也不会追加重复声明，避免浪费后续 AI 上下文。存量项目可直接执行 `npx aafe update`（或已安装 CLI 时执行 `aafe update`）获得新的索引按需加载配置。

如需检查将执行的动作：

```bash
aafe update --dry-run
```

只有需要同时升级全局 CLI 包时，才使用：

```bash
aafe update --upgrade-package
```

## 验证

```bash
node ./bin/aafe.js update
node ./bin/aafe.js doctor
node ./bin/aafe.js ddd analyze "使用 DDD 实现多租户权限模块，支持角色、组织、权限策略和审计事件"
```

期望 `doctor`：

```json
{
  "status": "pass",
  "missing": [],
  "warnings": []
}
```

## 项目架构快速分析

在已接入 AAFE 的项目根目录执行：

```bash
aafe analyze
```

该命令会扫描当前项目并生成紧凑的项目架构定位文件：

```txt
.ai-agent/skills/project-architecture-locator.md
.ai-agent/memory/project-architecture.md
```

用途：

- 快速定位主要路由、页面、组件、模块和设计文档；
- 让 AI Agent 在处理需求前先读取架构索引，避免盲目读取大量源码浪费上下文；
- 在项目路由、组件、模块或设计文档发生较大变化后重新运行；
- 生成过程只维护单份 locator skill 和 architecture memory，架构内容未变化时不会仅因时间戳变化重复写入。

预览但不写入：

```bash
aafe analyze --dry-run
```

只输出分析结果、不生成文件：

```bash
aafe analyze --no-write
```

## 可下载 Agent SKILLS（GitHub 分发）

AAFE Runtime 作为发布到 GitHub / npm 的包，同时提供 **Agent SKILLS 配置分发** 和 **项目内 CLI Runtime 初始化** 两条互不替代的使用链路。

### 使用边界

| 场景 | 使用方式 | 写入目标 |
| --- | --- | --- |
| 只想让某个 Agent / AI 工具获得 AAFE 协作能力 | 从 GitHub 下载 Agent SKILLS | 目标 Agent 的 Skills 目录，如 `$SIBOOT_WORKSPACE_PATH/skills/{skill-name}/SKILL.md` |
| 业务项目要接入 AAFE Runtime | `npm install` / `npx @aafe/agent-runtime` 后执行 CLI | 当前业务项目的 `.ai-agent/`、`.aafe.config.json`、编辑器配置 |

> ⚠️ **不要混用**：`aafe skills ...` 只用于下载/安装 Agent SKILLS；项目内接入、更新、分析和诊断必须使用 `init / update / analyze / doctor`。

### GitHub 发布入口

```txt
SKILLS.md
skills/manifest.json
skills/aafe-vue-complex-runtime/SKILL.md
```

GitHub Raw Manifest：

```txt
https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/manifest.json
```

### 查看可下载 Skill

```bash
npx --yes @aafe/agent-runtime@latest skills list --github
```

### 安装到目标 Agent Skills 目录

当运行环境存在 `$SIBOOT_WORKSPACE_PATH` 时，默认目标为：

```txt
$SIBOOT_WORKSPACE_PATH/skills
```

安装命令：

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github
```

预览安装目标但不写入：

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github --dry-run
```

指定目标目录：

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github --target="/path/to/agent/skills"
```

安装逻辑是幂等的：如果目标 `SKILL.md` 内容一致，则不会重复写入，避免 Agent SKILLS 上下文重复膨胀。

### 直接下载 fallback

```bash
mkdir -p "/path/to/agent/skills/aafe-vue-complex-runtime"
curl -L "https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/aafe-vue-complex-runtime/SKILL.md" \
  -o "/path/to/agent/skills/aafe-vue-complex-runtime/SKILL.md"
```

## npm / CLI 项目内使用

如果目标是让业务项目接入 AAFE Runtime，不需要下载 GitHub SKILLS。请在业务项目根目录使用 npm 包提供的 CLI：

```bash
npm install --save-dev @aafe/agent-runtime
npx aafe init --yes --framework=vue --scenarios=complex --template=complex --editors=cursor
npx aafe doctor
```

已接入项目更新到新版本能力：

```bash
npm install
npx aafe update
npx aafe analyze
npx aafe doctor
```

该模式只写入当前项目 Runtime，不安装 Agent SKILLS。
