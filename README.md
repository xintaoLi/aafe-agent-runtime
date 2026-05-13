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
aafe memory
aafe pattern
aafe ddd
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

## 验证

```bash
node ./bin/aafe.js sync --force
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
