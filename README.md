# @aafe/agent-runtime

`@aafe/agent-runtime` 是一个面向前端工程的项目级架构运行时，用来把 AI Coding 从“直接写代码”提升为“先做架构分析、读取项目记忆、再执行实现、最后进行批判审查与学习沉淀”的工作流。

它的目标不是绑定某个具体业务场景，而是提供一套通用的 **Universal Frontend Architecture Runtime**。Graph / Canvas / DAG 等能力被作为场景扩展包，而不是核心主轴。

## 核心理念

传统 AI Coding 常见问题：

- 直接堆功能，缺少模块边界判断
- 不区分领域逻辑、表现层、基础设施和状态管理
- 不评估设计模式和长期演进风险
- 缺少实现后的架构批判和质量门禁
- 不会沉淀项目知识，换项目后不能形成不同项目的长期学习能力

AAFE 的执行链路：

```txt
User Request
  -> Memory Recall
  -> Task Classification
  -> Pipeline Routing
  -> Architecture Skills
  -> Gate Validation
  -> Implementation
  -> Refactor Critique
  -> Memory Write
```

也就是：任何非平凡前端任务，都应先经过项目记忆与架构运行时，再进入代码实现。

## Memory 能力

AAFE Memory 是项目内自增长学习层。每个项目都有自己的 `.ai-agent/memory/`，用于沉淀这个项目独有的：

- 项目设计：架构分层、模块边界、领域概念、状态归属
- 组件知识：组件契约、受控/非受控策略、组合方式、反模式
- 开发习惯：团队偏好、常用实现方式、评审习惯
- 项目规范：命名、目录、导入、测试、样式、提交规范
- 架构决策：ADR、方案取舍、长期影响
- 经验学习：缺陷复盘、性能问题、迁移经验、踩坑记录

Memory 目录：

```txt
.ai-agent/memory/
├── index.md
├── project-design.md
├── components.md
├── development-habits.md
├── conventions.md
├── decisions.md
└── learnings.jsonl
```

Memory 在 Pipeline 中通过两个 Skill 工作：

```txt
memory-recaller -> ...architecture pipeline... -> memory-writer
```

- `memory-recaller`：在架构分析前读取相关项目记忆
- `memory-writer`：在实现/审查后沉淀稳定知识

## 适用场景

适用于：

- React / Next.js / Vue 项目
- 中后台系统
- 组件库 / Design System
- Monorepo 前端工程
- 可视化画布 / Graph / DAG / Workflow 项目
- 需要在不同项目中形成不同学习沉淀的 AI Coding 工程
- 需要给 Cursor、Claude Code、CodeBuddy、CodeX、Trace 等 AI 编辑器注入项目级架构规则的工程

## 项目结构

```txt
.
├── bin/
│   └── aafe.js                    # CLI 入口
├── src/
│   ├── cli/
│   │   ├── bootstrap.js           # 初始化 .ai-agent 与编辑器规则
│   │   ├── detect.js              # 检测框架、编辑器、场景
│   │   ├── doctor.js              # 健康检查
│   │   ├── memory.js              # Memory CLI
│   │   └── index.js               # CLI 命令路由
│   ├── memory/
│   │   ├── MemoryRuntime.js       # 记忆召回、写入与执行记录
│   │   └── MemoryStore.js         # 项目记忆文件存储
│   ├── runtime/
│   │   ├── AgentRuntime.js        # 任务分类、记忆集成与流水线执行入口
│   │   ├── GateValidator.js       # 架构门禁校验
│   │   ├── PipelineExecutor.js    # Pipeline 执行器
│   │   ├── SkillRegistry.js       # Skill 注册与执行
│   │   └── defaults.js            # 默认路由、门禁、流水线、技能和记忆技能
│   └── index.js                   # 包导出
├── .ai-agent/                     # 当前项目已初始化的 Agent Runtime
├── .aafe.config.json              # 当前项目配置
└── .cursor/rules/                 # Cursor 适配规则
```

初始化后生成的 `.ai-agent/` 结构：

```txt
.ai-agent/
├── runtime/
│   ├── engine.md                  # Orchestrator 工作机制
│   ├── router.yaml                # 任务路由
│   ├── gates.yaml                 # 质量门禁
│   ├── protocol.md                # Skill 输出协议
│   └── memory.md                  # Memory 工作协议
├── memory/
│   ├── index.md
│   ├── project-design.md
│   ├── components.md
│   ├── development-habits.md
│   ├── conventions.md
│   ├── decisions.md
│   └── learnings.jsonl
├── skills/
│   ├── memory-recaller.md
│   ├── memory-writer.md
│   ├── architect.md
│   ├── module-decomposer.md
│   ├── pattern-selector.md
│   ├── evolution-predictor.md
│   ├── refactor-critic.md
│   ├── adr-generator.md
│   ├── graph-architect.md
│   ├── layout-strategy-selector.md
│   └── runtime-evolution-predictor.md
├── pipelines/
│   ├── feature.yaml
│   ├── refactor.yaml
│   ├── bugfix.yaml
│   ├── performance.yaml
│   └── graph-feature.yaml
├── frameworks/
│   ├── react.md
│   ├── next.md
│   ├── vue.md
│   └── monorepo.md
└── scenarios/
    ├── graph.md
    ├── admin.md
    ├── dashboard.md
    └── workflow.md
```

## 安装与初始化

### 本地开发方式

当前仓库可以直接运行：

```bash
node ./bin/aafe.js init --yes
node ./bin/aafe.js doctor
node ./bin/aafe.js detect
node ./bin/aafe.js memory list
```

也可以使用 npm scripts：

```bash
npm run init
npm run doctor
npm test
```

### 作为 npm 包使用

发布后可在任意前端项目中安装：

```bash
npm install -D @aafe/agent-runtime
```

然后初始化：

```bash
npx aafe init
```

初始化会生成：

```txt
.ai-agent/
.aafe.config.json
.cursor/rules/aafe-architecture-runtime.mdc
```

## CLI 命令

### `aafe init`

初始化当前项目的架构运行时与 Memory。

```bash
aafe init
```

执行内容：

- 检测当前项目框架
- 检测 AI 编辑器环境
- 生成 `.ai-agent/` 运行时文件
- 生成 `.ai-agent/memory/` 项目记忆目录
- 生成 `.aafe.config.json`
- 为 Cursor / Claude Code / CodeBuddy / CodeX / Trace 写入适配规则

非交互式初始化：

```bash
aafe init --yes
```

### `aafe detect`

检测当前项目环境：

```bash
aafe detect
```

输出示例：

```json
{
  "framework": "react",
  "editors": ["cursor"],
  "scenarios": ["graph"],
  "packageManager": "npm"
}
```

### `aafe doctor`

检查 Agent Runtime 与 Memory 是否完整：

```bash
aafe doctor
```

检查内容包括：

- `.ai-agent/runtime/engine.md`
- `.ai-agent/runtime/router.yaml`
- `.ai-agent/runtime/gates.yaml`
- `.ai-agent/runtime/memory.md`
- `.ai-agent/pipelines/feature.yaml`
- `.ai-agent/skills/architect.md`
- `.ai-agent/skills/memory-recaller.md`
- `.ai-agent/skills/memory-writer.md`
- `.ai-agent/memory/index.md`
- `.ai-agent/memory/learnings.jsonl`
- `.aafe.config.json`

通过时输出：

```json
{
  "status": "pass",
  "missing": [],
  "warnings": []
}
```

### `aafe sync`

同步或刷新运行时文件：

```bash
aafe sync --yes
```

默认不会覆盖已存在文件；如需强制覆盖：

```bash
aafe sync --force
```

### `aafe memory`

管理项目记忆。

初始化 Memory：

```bash
aafe memory init
```

新增记忆：

```bash
aafe memory add "组件统一使用受控 props，并通过 onChange 暴露状态变化" --type=component --tags=component,controlled
```

支持的类型：

```txt
design | component | habit | convention | decision | learning
```

列出记忆：

```bash
aafe memory list
aafe memory list --type=component
```

搜索记忆：

```bash
aafe memory search controlled
```

生成供 AI 使用的紧凑上下文：

```bash
aafe memory context Tree
```

## Runtime API

包入口：

```js
import {
  AgentRuntime,
  SkillRegistry,
  PipelineExecutor,
  GateValidator,
  MemoryRuntime,
  MemoryStore,
  createDefaultRuntime
} from '@aafe/agent-runtime';
```

### 使用默认 Runtime

```js
import { createDefaultRuntime } from '@aafe/agent-runtime';

const runtime = createDefaultRuntime({ root: process.cwd() });

await runtime.learn({
  type: 'convention',
  title: '组件命名规范',
  content: '组件文件使用 PascalCase，hooks 使用 use 前缀',
  tags: ['naming', 'component']
});

const result = await runtime.execute('实现用户权限模块');

console.log(result.memoryContext);
console.log(result.trace);
```

执行链路示例：

```txt
memory-recaller:pass
> architect:pass
> module-decomposer:pass
> pattern-selector:pass
> evolution-predictor:pass
> architecture_gate:pass
> adr-generator:pass
> implementation_gate:pass
> refactor-critic:pass
> memory-writer:pass
> merge_gate:pass
```

### 自定义 Skill

```js
import { createDefaultRuntime } from '@aafe/agent-runtime';

const runtime = createDefaultRuntime({
  root: process.cwd(),
  skills: {
    architect: {
      async run(context) {
        return {
          status: 'pass',
          summary: 'Architecture reviewed with project memory',
          artifacts: {
            boundaries: ['domain', 'application', 'presentation'],
            risk_review: ['state ownership'],
            memory_used: Boolean(context.input?.memoryContext)
          },
          risks: [],
          nextHints: []
        };
      }
    }
  }
});
```

Skill 输出协议：

```ts
interface SkillOutput {
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  artifacts: Record<string, unknown>;
  risks: string[];
  nextHints: string[];
}
```

Memory 记录协议：

```ts
type MemoryType = 'design' | 'component' | 'habit' | 'convention' | 'decision' | 'learning';

interface MemoryEntry {
  type: MemoryType;
  title?: string;
  content: string;
  tags?: string[];
  source?: 'manual' | 'cli' | 'runtime';
}
```

## 内置 Pipeline

### Feature Pipeline

用于新增功能：

```txt
memory-recaller
-> architect
-> module-decomposer
-> pattern-selector
-> evolution-predictor
-> architecture_gate
-> adr-generator
-> implementation_gate
-> refactor-critic
-> memory-writer
-> merge_gate
```

### Refactor Pipeline

用于架构重构：

```txt
memory-recaller
-> architect
-> module-decomposer
-> pattern-selector
-> refactor-critic
-> architecture_gate
-> adr-generator
-> memory-writer
-> merge_gate
```

### Bugfix Pipeline

用于问题修复：

```txt
memory-recaller
-> architect
-> module-decomposer
-> refactor-critic
-> memory-writer
-> merge_gate
```

### Performance Pipeline

用于性能优化：

```txt
memory-recaller
-> architect
-> pattern-selector
-> evolution-predictor
-> architecture_gate
-> refactor-critic
-> memory-writer
-> merge_gate
```

### Graph Feature Pipeline

用于 Graph / Canvas / DAG / Layout / Node Editor 场景：

```txt
memory-recaller
-> architect
-> graph-architect
-> layout-strategy-selector
-> runtime-evolution-predictor
-> module-decomposer
-> pattern-selector
-> architecture_gate
-> adr-generator
-> refactor-critic
-> memory-writer
-> merge_gate
```

## Gate 机制

AAFE 通过 gate 防止 AI 跳过架构分析直接实现。

默认门禁：

```yaml
gates:
  architecture_gate:
    requires:
      - boundaries
      - decomposition
      - pattern_selection

  implementation_gate:
    requires:
      - risk_review
      - extension_points

  merge_gate:
    requires:
      - critic_pass
```

如果前置 skill 没有产出必需 artifact，pipeline 会被阻断。

## 编辑器适配

当前实现会自动生成 Cursor 规则：

```txt
.cursor/rules/aafe-architecture-runtime.mdc
```

规则会要求 AI 编辑器在处理非平凡前端任务时：

1. 读取 `.ai-agent/runtime/engine.md`
2. 读取 `.ai-agent/runtime/memory.md`
3. 从 `.ai-agent/memory/` 召回相关项目记忆
4. 根据 `.ai-agent/runtime/router.yaml` 分类任务
5. 执行 `.ai-agent/pipelines/*.yaml`
6. 根据 `.ai-agent/runtime/gates.yaml` 做门禁校验
7. 引用对应 framework / scenario pack
8. 输出 Architecture、Module Boundaries、Pattern Selection、Tradeoffs、Implementation、Critique、Memory Updates

## Framework Packs

核心包包含通用 framework pack：

- `react.md`：hooks boundary、context overuse、state slicing、render optimization
- `next.md`：server/client boundary、route segmentation、cache strategy
- `vue.md`：composable design、reactive ownership、store boundaries
- `monorepo.md`：package boundary、dependency graph、public contract governance

## Scenario Packs

场景包是可选扩展：

- `graph.md`：graph boundary、node lifecycle、edge ownership、layout strategy
- `admin.md`：RBAC / ABAC、route permissions、auditability
- `dashboard.md`：metric definition、visualization composition、cache refresh
- `workflow.md`：state machine、approval lifecycle、event history

Graph 只是场景包之一，项目核心仍然是通用前端架构运行时。

## 推荐工作流

在目标项目中：

```bash
npm install -D @aafe/agent-runtime
npx aafe init
npx aafe doctor
```

先沉淀项目偏好：

```bash
npx aafe memory add "组件统一使用受控 props，并通过 onChange 暴露状态变化" --type=component --tags=component,controlled
npx aafe memory add "业务模块按 domain/application/infrastructure/presentation 分层" --type=design --tags=architecture,boundary
npx aafe memory add "组件文件使用 PascalCase，hooks 使用 use 前缀" --type=convention --tags=naming
```

然后在 AI 编辑器里提出需求，例如：

```txt
实现一个多租户权限模块
```

AI 应先输出：

```txt
Memory Context
Architecture
Module Boundaries
Pattern Selection
Tradeoffs
Implementation
Critique
Memory Updates
```

而不是直接开始写代码。

## 当前版本状态

当前版本为 `0.1.0`，已实现最小可用闭环：

- CLI 初始化
- 项目检测
- 运行时文件生成
- Cursor 适配
- 默认 Runtime API
- Pipeline 执行
- Gate 校验
- Doctor 检查
- Project Memory 初始化
- Memory CLI 增删查基础能力
- Runtime 记忆召回与失败记录

后续可扩展方向：

- 更完整的交互式 `init`
- 更多编辑器 adapter
- 可发布的模板系统
- 独立 framework/scenario npm packs
- Critique fail 后自动 rerun
- 从 `.ai-agent/*.yaml` 动态加载 Runtime 配置
- Memory 自动摘要与去重
- 基于代码扫描的组件/规范自动学习
