# Skill: TAPD Submit Backfill（Portable · Comment-Only + Commit/PR Gate）

Trigger: `tapd.enabled`（`tapd.config.json`）**且**任务有关联 TAPD 单。

Rules: `rules/tapd-submit-backfill.mdc` · Companions: `skills/architecture-impact-test-forecast.md`, `skills/minimal-convergent-self-test.md`

## MCP: user-tapd_taihu

`lookup_tool_param_schema` → `proxy_execute_tool`

Tools: `stories_*`, `bugs_*`, `comments_create`, `tapd_id_get`, `tapd_file_upload_url_generate`

## Config

Read `tapd.config.json` → `tapd` object: `enabled`, `workspace_id`, `milestone_id`, `tapd_story.*`, `tapd_bug.*`, optional `pr_field`.

`status_doing`: comma-separated chain before `status_done`.

## Pipeline（有关联 TAPD）

```text
[A] 自测产物齐全
[B] 问 Commit → [C] bug:/feat: commit → [D] PR → [E] 问回填
[E] 同意 → [F] 评论 + PR 字段 + 状态流转
```

无关联：跳过 [E][F]。

## Phase C — Commit

使用已关联 `entry_type` / `entry_id` / 标题；禁止无关联时编造 ID。

## Phase E — Ask backfill

仅有关联 TAPD 时问：「是否回填 TAPD 单子？」

## Phase F — Backfill

- F4: `comments_create` only（模板含处理结果、影响范围、自测表、Commit/PR）
- F5: 状态逐步：story todo→doing→for_test；新单 backlog→todo→doing→for_test；禁止跳步
- UI 截图：upload 后 embed `html_code`

## Pure GitHub / 无 TAPD 关联

常规 Commit/PR；不询问 TAPD 回填。
