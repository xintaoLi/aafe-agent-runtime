# Skill: TAPD Submit Backfill（Portable · Comment-Only + Commit/PR Gate）

Trigger: `tapd.enabled`（`tapd.config.json`）**且**任务有关联 TAPD 单。

Rules: `rules/tapd-submit-backfill.mdc` · Companions: `skills/architecture-impact-test-forecast.md`, `skills/minimal-convergent-self-test.md`

## MCP: user-tapd_taihu

`lookup_tool_param_schema` → `proxy_execute_tool`

Tools: `stories_*`, `bugs_*`, `comments_create`, `tapd_id_get`, `tapd_file_upload_url_generate`

## Config

Read `tapd.config.json` → `tapd` object: `enabled`, `workspace_id`, `milestone_id`, `tapd_story.*`, `tapd_bug.*`, optional `pr_field`.

Submit-backfill status: backlog → todo → doing（已是 doing 则跳过；不自动到 for_test）。

## Pipeline（有关联 TAPD）

```text
[A] 自测产物齐全
[B] 问 Commit → [C]/[D] 按 submit.cli（git|gtm）→ [E] 问回填
[E] 同意 → [F] 评论 + PR 字段 + 状态流转
```

无关联：跳过 [E][F]。

## Phase C / D — Submit CLI

先读 `submit.cli`：`git`（默认，Git+`gh`）或 `gtm`（`gtm commit`/`gtm pr`）。  
有关联 TAPD 时使用已关联 `entry_type` / `entry_id`；禁止无关联时编造 ID。

### TAPD Branch Association（git 和 gtm 均适用）

新任务：TAPD MCP 拉取需求详情 → 提取 short_id（URL 末 9 位）→ 检查分支 `feat|bug/<slug>/#<short_id>` 是否一致。未关联/错误则从远程主干创建分支：`git` → `git checkout -b feat|bug/<slug>/#<short_id> upstream/master`；`gtm` → `gtm create issue` 关联已有单据 → 目标 `master` → 按 TAPD 标题取英文短名建分支。

## Phase E — Ask backfill

仅有关联 TAPD 时问：「是否回填 TAPD 单子？」

## Phase F — Backfill

- F4: `comments_create` only（模板含处理结果、影响范围、自测表、Commit/PR）
- F5: 状态按当前续走：backlog→todo→doing；todo→doing；doing 跳过；禁止跳步/自动到 for_test
- UI 截图：upload 后 embed `html_code`

## Pure GitHub / 无 TAPD 关联

可选按 `submit.cli` 提交；不询问 TAPD 回填。
