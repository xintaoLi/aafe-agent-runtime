# AAFE Project Skills 索引按需加载优化说明

> 版本目标：`@aafe/agent-runtime@0.1.7`  
> 适用场景：多编辑器（Cursor / CodeBuddy / Claude / Codex / VS Code 等）共用同一套 `.ai-agent` 项目知识  
> 关联项目样例：`bklog/web`

---

## 1. 背景

### 1.1 问题从哪里来

`@aafe/agent-runtime` 的设计目标是：

- 以 `.ai-agent` 作为**唯一项目 AI Runtime / 知识根**
- 通过编辑器 adapter（`.cursor` / `.codebuddy` / ...）把 Agent 引导进 AAFE pipeline
- 项目特有知识（架构地图、组件/Hooks/API 约定）沉淀在 `.ai-agent/project-skills/`

在 `bklog/web` 落地后，实际出现了两类入口：

| 层级 | 路径 | 职责 |
|------|------|------|
| AAFE Runtime（包生成） | `.ai-agent/runtime/`、`.ai-agent/pipelines/`、`.ai-agent/skills/` | 架构流水线、门禁、通用技能 |
| Project Knowledge（项目维护） | `.ai-agent/project.md`、`.ai-agent/project-skills/` | 业务地图、域知识、自更新协议 |
| Editor Adapter（包生成） | `.cursor/`、`.codebuddy/` | 编辑器可发现入口，应只做薄指针 |

项目侧已经按“索引 + 按需读取”写了：

- `.cursor/skills/ENTRY.md`
- `.codebuddy/skills/ENTRY.md`
- `.ai-agent/project.md` 的 How to Use Project Skills

但在真实 Cursor 对话中，这些 **project-skills 不会自动命中**。

### 1.2 为什么“配了却不命中”

根因不是索引方案错误，而是**引导层没有接到编辑器的自动加载通道**。

#### Cursor 原生 Skill 发现规则

Cursor 只会把符合以下结构的 Skill 注入 `agent_skills`：

```text
.cursor/skills/<skill-name>/SKILL.md
~/.cursor/skills/<skill-name>/SKILL.md
```

当前项目实际是：

```text
.cursor/skills/ENTRY.md                    # 仅有索引，不是 SKILL.md 目录
.ai-agent/project-skills/*/SKILL.md      # 真正知识，但不在 Cursor 扫描路径
```

因此对话里自动出现的只有 Cursor 内置 skills，**没有任何 bklog project-skill**。

#### 现有 always-on 规则只覆盖 AAFE Runtime

包生成的 `.cursor/rules/aafe-architecture-runtime.mdc`（`alwaysApply: true`）只要求：

1. 读 `runtime/engine.md`
2. 走 `router.yaml` / `pipelines`
3. 执行 gates

它**不要求**先读 project skill index，也不要求按域加载 `project-skills`。

#### sessionStart hook 注入了错误粒度的上下文

`.cursor/hooks/aafe-session-start` 把 `engine.md + router.yaml + gates.yaml` **全文**塞进 `additional_context`：

- Token 成本高
- 仍然不触发 project-skills
- 强化了“只走 AAFE pipeline”的路径，弱化了项目知识入口

#### `ENTRY.md` 不是可发现 Skill

`ENTRY.md` 是人工索引协议，对多编辑器友好，但：

- Cursor 不会扫描它
- 没有 always-on rule 强制“先读它”
- 所以“动态按需加载”从未被启动

### 1.3 约束条件（必须同时满足）

1. **多编辑器兼容**：Cursor / CodeBuddy / Claude / Codex / VS Code 等共用知识源  
2. **单一知识源**：知识只在 `.ai-agent`，编辑器目录禁止复制业务知识  
3. **可被 `aafe update/sync` 刷新**：引导层由包生成；项目知识由项目维护且不被覆盖  
4. **最少读取**：先索引，再按域加载，禁止一次读完所有 skills  

在这些约束下，**不能**把 8 个 project-skills 复制/软链进各编辑器的原生 skills 目录作为主方案。

---

## 2. 目标

| 目标 | 说明 |
|------|------|
| 自动命中 | 每次对话都能进入 skill index 路由，而不是只看到 AAFE pipeline |
| 按需加载 | 仅读取任务命中的 domain skill |
| 多编辑器一致 | 所有 adapter 使用同一套 Skill Router 文案与协议 |
| 零知识复制 | `.cursor` / `.codebuddy` 只保留薄指针 |
| 可升级 | `aafe sync/update` 可安全刷新引导层，不破坏项目知识 |

---

## 3. 方案总览

### 3.1 核心思路

> **包负责“可发现的引导层”，项目负责“知识本体”；编辑器目录只做薄指针，按索引动态加载。**

```text
对话开始
  -> Editor always-on / instruction（包生成）
  -> 读 .ai-agent/skill-index.md（包生成协议）
  -> 读 .ai-agent/project.md（若存在，项目维护）
  -> 按任务域读 .ai-agent/project-skills/<domain>/SKILL.md（项目维护）
  -> 非平凡任务再进入 .ai-agent/runtime/* pipeline（包生成）
```

### 3.2 两层机制对比

| 机制 | 谁负责 | 多编辑器 | 自动命中 | 是否采用 |
|------|--------|----------|----------|----------|
| 原生 Skill 发现（`.cursor/skills/*/SKILL.md`） | 各编辑器各自扫描 | 差（路径/语义不一致） | 强（单编辑器） | 不作为主方案 |
| 索引按需加载（always-on → index → Read） | AAFE adapter + `.ai-agent` | 好 | 依赖引导层 | **主方案** |

可选增强：仅在 Cursor 增加 **1 个** router skill（指向 index），不要挂 8 份知识副本。

### 3.3 目标目录结构

```text
.ai-agent/
  skill-index.md                 # [包生成] 通用索引协议
  project.md                     # [项目维护] 项目知识入口
  project-skills/*/SKILL.md      # [项目维护] 域知识
  rules/*.mdc                    # [项目维护] 项目规则
  runtime/ pipelines/ skills/    # [包生成] AAFE runtime
  memory/                        # [项目沉淀] 记忆（update 时保留）

.cursor/
  rules/aafe-skill-router.mdc            # [包生成] alwaysApply 索引路由
  rules/aafe-architecture-runtime.mdc    # [包生成] AAFE pipeline（保留）
  skills/ENTRY.md                        # [包生成] 薄索引镜像
  hooks/aafe-session-start               # [包生成] 只注入短路由，不灌全文

.codebuddy/
  aafe.md                                # [包生成] 含 Skill Router 段
  skills/ENTRY.md                        # [包生成/项目对齐] 薄索引镜像
```

---

## 4. 包侧改动清单（`@aafe/agent-runtime`）

建议版本：`0.1.6` → `0.1.7`  
主要改动文件：`src/cli/bootstrap.js`、`src/cli/doctor.js`、必要时 `README.md`

### 4.1 新增 `.ai-agent/skill-index.md`

由 `runtimeFiles()` / bootstrap 生成，约定：

```text
Default（每次任务开始）:
  1) .ai-agent/skill-index.md（本文件）
  2) .ai-agent/project.md（若存在）
  3) architecture / self-update 类 project-skills（若存在）

On-demand（按任务域）:
  仅读取命中的 .ai-agent/project-skills/<domain>/SKILL.md
  复杂任务再读 .ai-agent/runtime/* 与 pipelines

Forbidden:
  不把知识复制进 .cursor / .codebuddy / 其他编辑器目录
  不一次读完所有 project-skills
  不把 ENTRY.md 当作已加载的完整知识
```

说明：

- 包提供**协议与默认路由**
- 项目可在 `project.md` / `project-skills` 中扩展域映射
- `aafe update` **覆盖** `skill-index.md`，**不覆盖** `project.md` / `project-skills/**`

### 4.2 所有编辑器适配器注入统一 Skill Router

改 `writeEditorAdapters()`：

| 编辑器 | 生成物 | 行为 |
|--------|--------|------|
| Cursor | `.cursor/rules/aafe-skill-router.mdc`（`alwaysApply: true`） | 强制先走索引 |
| Cursor | `.cursor/skills/ENTRY.md` | 薄指针到 `.ai-agent/skill-index.md` |
| Cursor | 保留 `aafe-architecture-runtime.mdc` | 只管 pipeline/gates |
| CodeBuddy | `.codebuddy/aafe.md` 增加 Skill Router 段 | 与 Cursor 同文案 |
| Claude / Codex / Trace / Windsurf / VS Code | `genericEditorRules()` 增加同一段 | 多编辑器一致 |

**统一 Skill Router 指令（所有编辑器共用）：**

1. 先读 `.ai-agent/skill-index.md`  
2. 若存在 `.ai-agent/project.md`，再读它  
3. 仅当任务命中对应域时，再读 `.ai-agent/project-skills/<domain>/SKILL.md`  
4. 非平凡任务才进入 `.ai-agent/runtime/*` pipeline  
5. 编辑器目录只作指针，禁止复制或改写项目知识  

### 4.3 瘦身 `sessionStart` hook

**现状问题：** 注入 runtime 全文，贵且无效于 project-skills。

**改为只注入短路由：**

```text
<AAFE_SKILL_ROUTER>
1. Read .ai-agent/skill-index.md
2. Read .ai-agent/project.md if present
3. Load matching .ai-agent/project-skills/*/SKILL.md on demand
4. For non-trivial tasks, follow .ai-agent/runtime/*
</AAFE_SKILL_ROUTER>
```

完整 `engine/router/gates` 仍由 always-on rule **按需 Read**，不要在 hook 里灌全文。

### 4.4 `.aafe.config.json` 增加配置

```json
"projectKnowledge": {
  "enabled": true,
  "entry": ".ai-agent/project.md",
  "skillsPath": ".ai-agent/project-skills",
  "index": ".ai-agent/skill-index.md",
  "loadMode": "index-on-demand",
  "editorPointersOnly": true
}
```

`aafe sync/update` 策略：

| 路径 | 策略 |
|------|------|
| 编辑器适配层、`skill-index.md`、runtime/pipelines | 覆盖刷新 |
| `project.md`、`project-skills/**`、项目 `.ai-agent/rules/**` | 保留 |
| `memory/**` | 保留（已有 `preserveMemory`） |

### 4.5 `doctor` 增加检查项

| 检查 | 级别 | 含义 |
|------|------|------|
| 存在 `project-skills/` 但缺少 `skill-index.md` | warn | 有知识无路由 |
| Cursor 缺少 `aafe-skill-router.mdc` | fail/warn | 无法自动进入索引 |
| `.cursor/skills` 出现非 ENTRY 的知识副本 | warn | 破坏单一知识源 |
| sessionStart hook 仍注入超大 runtime 全文 | warn | Token / 路由退化 |
| `projectKnowledge.loadMode !== index-on-demand` 且多编辑器开启 | warn | 配置与目标不一致 |

### 4.6 明确不做

1. **不要**把全部 project-skills symlink/复制进 `.cursor/skills/` 作为主方案  
2. **不要**把业务项目知识写进 npm 包  
3. **不要**假设 `ENTRY.md` 会被 Cursor 原生 Skill 发现自动加载  
4. **不要**在 hook 中继续注入 runtime 全文  

---

## 5. 项目侧更新步骤（以 `bklog/web` 为例）

包发版后：

```bash
cd bklog/web
npm i -D @aafe/agent-runtime@0.1.7
npm run aafe:sync    # 或 npx aafe update
npm run aafe:doctor
```

项目特有补强（包不会生成，需项目维护）：

1. 对齐 `.ai-agent/project.md` 的 Quick Map / How to Use 与 `skill-index.md`  
2. 为各 `project-skills/*/SKILL.md` 的 `description` 补充 **WHEN** 触发词（便于选域）  
3. 保留现有 `.ai-agent/rules/*`（workspace-boundary、retrieve-v2-ui、knowledge-self-update）  
4. 确认 `.cursor` / `.codebuddy` 仅有指针，无知识副本  

### 5.1 description 补强示例

```yaml
# 弱（只有 WHAT）
description: Components 地图（目录/全局注册/改动半径）。

# 强（WHAT + WHEN）
description: BKLog Web 组件地图（src/components、src/global、注册点）。
  Use when editing Vue/TSX components, global components, or component registration.
```

---

## 6. 验收标准

新开编辑器对话后，应观察到：

1. Agent 先读 `.ai-agent/skill-index.md` 和/或 `project.md`  
2. 组件任务会继续读 `bklog-components`（或对应域 skill），而不是只读 AAFE pipeline  
3. Hooks / API 任务同理按域加载  
4. 非平凡架构任务才会进入 `runtime/pipelines`  
5. `.cursor` / `.codebuddy` 中仍无 project-skills 知识副本  
6. `aafe doctor` 对 skill router / index 检查通过  

抽测建议：

| 用例 | 期望加载 |
|------|----------|
| 改 `src/global/json-formatter.vue` | components（+ 必要时 coding-patterns） |
| 改 `src/views/retrieve-v2/hooks/use-text-action.ts` | hooks（+ architecture） |
| 改 `src/services/*` | api-services |
| 新增大模块/路由 | architecture + self-update |

---

## 7. 落地顺序

1. 在 `aafe-agent-runtime` 实现：`skill-index` + `aafe-skill-router` + 瘦 hook + doctor + config  
2. 本地对 `bklog/web` 执行 dry-run / sync 验证  
3. 发布 `@aafe/agent-runtime@0.1.7`  
4. 业务仓库 bump 依赖并 `aafe:sync`  
5. 新开 Cursor / CodeBuddy 对话做三类域任务抽测  

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| always-on 规则过多导致上下文膨胀 | Skill Router 保持短指令；hook 只注入短路由 |
| `aafe update` 误覆盖项目知识 | 明确 preserve 列表；doctor 校验 |
| 部分编辑器不支持 alwaysApply | 退化为 editor instruction / `aafe.md` 文本引导，协议仍统一 |
| 团队误把知识写进 `.cursor` | doctor 警告 + self-update 规则禁止复制 |

回滚：

- 卸载 `aafe-skill-router.mdc` / 恢复旧 hook 即可退回 0.1.6 行为  
- 项目 `project-skills` 不受影响（本方案不迁移知识本体）

---

## 9. 结论

当前“每次对话不自动命中 project-skills”的根因是：

> **知识放对了（`.ai-agent`），索引也写了（`ENTRY.md`），但编辑器引导层没有强制启动索引路由。**

最佳优化不是把知识复制进各编辑器，而是：

> **在 `@aafe/agent-runtime` 中标准化“Skill Index On-Demand”协议，并用各编辑器 always-on / instruction 启动它。**

这能同时满足：多编辑器兼容、单一知识源、按需加载、可 `aafe update` 升级。
