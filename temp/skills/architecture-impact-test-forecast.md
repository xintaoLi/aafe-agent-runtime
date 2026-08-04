# Skill: Architecture Impact and Test Forecast（Portable）

Trigger: 代码变更任务 + 用户确认要做影响分析。

Rule: `rules/task-completion-impact.mdc` · Next: `skills/minimal-convergent-self-test.md`

## Context（均可选，无固定 .ai-agent 路径）

1. 项目架构文档（`docs/`、README 架构节、Mermaid 等），按任务需要读取
2. **仅映射本次任务改动文件** → 模块、路由、组件、Store、API、Worker、存储、测试点

## Step 1 — Impact scope report

- **直接影响** / **间接影响** / **潜在影响**
- **架构依据**：文档路径、源码证据
- **影响分类**：`logic` | `store` | `api` | `ui` | `mixed`

Artifacts: `impact_scope`, `architecture_evidence`, `impact_class`

## Step 2 — Minimal test case design

| ID | Priority | Mode | Scenario | Mock | Assert | Boundary |
| --- | --- | --- | --- | --- | --- | --- |

- 默认 **unit**；可见渲染/交互才标 **ui**
- 无真实 API / 生产数据

## Step 2.5 — UI path draft（mode=ui）

预读变更模板，输出 `ui_test_paths` 草案；URL 仍须用户提供。格式见 `skills/minimal-convergent-self-test.md` Step 2.5。

## Step 3 — Hand off

Follow `skills/minimal-convergent-self-test.md` → 测试落盘 `test/`（工作区根目录）→ 有关联 TAPD 时 `skills/tapd-submit-backfill.md`

## Output template

```markdown
## 影响范围报告
...
## 测试用例（设计）
...
## UI 测试路径（草案，若有）
...
## 测试执行结果
...
## 未覆盖风险
...
```
