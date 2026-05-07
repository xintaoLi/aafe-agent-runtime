# @aafe/agent-runtime

`@aafe/agent-runtime` 是面向前端工程的项目级架构运行时，用来把 AI Coding 从“直接写代码”升级为“读取项目记忆、做架构分析、执行门禁、实现代码、批判审查、学习沉淀”的闭环。

核心定位：**Universal Frontend Architecture Runtime + Project Memory**。

## 已实现能力

- 交互式 `aafe init`，支持 `--framework`、`--scenarios`、`--editors`、`--no-memory`、`--force`
- 多编辑器 adapter：Cursor、Claude Code、CodeBuddy、CodeX、Trace、Windsurf、VS Code
- 可发布模板系统：根据 framework / scenario / editor 生成初始化计划和推荐包
- 独立 package 草案：`@aafe/core`、`@aafe/react`、`@aafe/next`、`@aafe/vue`、`@aafe/graph` 等
- Critique fail / merge gate fail 后自动 rerun
- 从 `.ai-agent/runtime/*.yaml` 和 `.ai-agent/pipelines/*.yaml` 动态加载 Runtime 配置
- Memory 自动摘要、去重、压缩
- 基于代码扫描的组件/规范自动学习

## 执行链路

```txt
User Request
  -> Memory Recall
  -> Task Classification
  -> Pipeline Routing
  -> Architecture Skills
  -> Gate Validation
  -> Implementation
  -> Refactor Critique
  -> Auto Rerun if failed
  -> Memory Write
```

## 安装与初始化

本地开发：

```bash
node ./bin/aafe.js init --yes
node ./bin/aafe.js doctor
node ./bin/aafe.js detect
```

交互式初始化：

```bash
node ./bin/aafe.js init
```

非交互式指定模板：

```bash
node ./bin/aafe.js init --yes --framework=react --scenarios=graph,admin --editors=cursor,windsurf,vscode
```

发布后使用：

```bash
npm install -D @aafe/agent-runtime
npx aafe init
```

## CLI

```bash
aafe init      # 初始化 .ai-agent、memory、editor adapters
aafe detect    # 检测 framework/editor/scenario
aafe doctor    # 检查运行时完整性
aafe sync      # 刷新生成文件
aafe memory    # 管理项目记忆
```

`init` 参数：

```bash
--yes
--framework=react|next|vue|monorepo|generic
--scenarios=graph,admin,dashboard,workflow
--editors=cursor,claude,codebuddy,codex,trace,windsurf,vscode
--no-memory
--force
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
├── memory/
│   ├── index.md
│   ├── summary.md
│   ├── project-design.md
│   ├── components.md
│   ├── development-habits.md
│   ├── conventions.md
│   ├── decisions.md
│   └── learnings.jsonl
├── skills/
├── pipelines/
├── frameworks/
├── scenarios/
└── packs.md
```

编辑器适配会按选择生成：

```txt
.cursor/rules/aafe-architecture-runtime.mdc
CLAUDE.md
.codebuddy/aafe.md
.codex/aafe.md
.trace/aafe.md
.windsurfrules
.vscode/aafe.instructions.md
```

## Memory 使用

新增记忆：

```bash
aafe memory add "组件统一使用受控 props，并通过 onChange 暴露状态变化" --type=component --tags=component,controlled
```

搜索与上下文：

```bash
aafe memory search controlled
aafe memory context Tree
```

摘要与去重：

```bash
aafe memory summary
aafe memory compact
```

扫描代码自动学习组件和规范：

```bash
aafe memory scan --target=src
```

支持类型：

```txt
design | component | habit | convention | decision | learning
```

## Runtime API

```js
import {
  createDefaultRuntime,
  createRuntimeFromProject,
  loadRuntimeConfig,
  MemoryStore,
  scanProjectMemory
} from '@aafe/agent-runtime';
```

使用默认 Runtime：

```js
const runtime = createDefaultRuntime({ root: process.cwd(), maxReruns: 1 });

await runtime.learn({
  type: 'convention',
  title: '组件命名规范',
  content: '组件文件使用 PascalCase，hooks 使用 use 前缀',
  tags: ['naming']
});

const result = await runtime.execute('实现用户权限模块');
console.log(result.memoryContext);
console.log(result.trace);
```

从项目 `.ai-agent/*.yaml` 动态加载：

```js
const runtime = await createRuntimeFromProject(process.cwd(), {
  maxReruns: 1
});

const result = await runtime.execute('实现一个受控 Tree 组件');
```

扫描代码并写入 Memory：

```js
const store = new MemoryStore(process.cwd());
const memories = await scanProjectMemory(process.cwd(), { target: 'src' });
for (const memory of memories) await store.add(memory);
```

## Pipeline

Feature Pipeline：

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

Graph Feature Pipeline：

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

## Gate

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

## 可发布包规划

`packages/` 下已提供独立包草案：

```txt
packages/
├── core
├── react
├── next
├── vue
├── graph
├── admin
├── dashboard
├── workflow
├── adapter-cursor
└── adapter-claude
```

推荐拆分：

- `@aafe/core`：runtime、pipeline、gate、memory、config loader
- `@aafe/react` / `@aafe/next` / `@aafe/vue`：framework packs
- `@aafe/graph` / `@aafe/admin` / `@aafe/dashboard` / `@aafe/workflow`：scenario packs
- `@aafe/adapter-*`：编辑器适配

## 当前状态

版本：`0.1.0`

已验证：

```bash
node ./bin/aafe.js doctor
```

输出：

```json
{
  "status": "pass",
  "missing": [],
  "warnings": []
}
```
