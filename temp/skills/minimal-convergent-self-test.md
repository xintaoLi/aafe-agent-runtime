# Skill: Minimal Convergent Self-Test（Portable）

Trigger: 影响分析之后（代码变更任务），或 TAPD 回填需要自测结果。

Chain: `skills/architecture-impact-test-forecast.md` → this → `skills/tapd-submit-backfill.md`（仅 TAPD 关联时）

## Step 0 — Mode from impact

| Class | Mode | Location |
| --- | --- | --- |
| 纯逻辑 / 数据处理 | unit | `test/` @ workspace root |
| 组件 props/emit | unit/component | `test/` |
| Store 契约 | unit | `test/` |
| 可见 UI | ui-optional | 条件询问浏览器 MCP |

## Step 1 — Test directory

**当前任务工作区根目录** `test/`（与 git 根或用户指定工作目录一致；无则创建）。

```text
test/unit/  test/fixtures/  test/ui/
```

## Step 2 — Minimal cases

覆盖变更分支 + 相邻边界；Mock only。

Runner: vitest / jest / `npm test` / `node:test`。

## Step 2.5 — UI paths（执行浏览器前）

含 `mode=ui` 时：拿到 URL 后、点击前，一次性产出完整 `ui_test_paths`；执行只消费路径。

Actions: navigate | click | switch | fill | hover | assert | screenshot

## Step 3 — UI tests（条件询问）

前置：代码变更 + 影响含 UI。**禁止**对纯文档任务询问。

1. 问是否启用 browser MCP
2. 问用户指定完整 URL
3. 生成/补全 `ui_test_paths` → 按路径执行

## Step 4 — Results

| ID | Mode | Status | Command / evidence | Summary |

禁止虚假 pass。

## Step 5 — Hand off

- 有关联 TAPD + `tapd.enabled` → `skills/tapd-submit-backfill.md` Phase B
- 无 TAPD 关联 → 可选 Commit/PR，跳过 TAPD

## Anti-patterns

- 未授权开浏览器、猜 URL、执行中全库分析、改 TAPD description 塞自测表
