export function tapdSubmitRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE TAPD Submit Backfill (${ctx.moduleName ?? 'module'})\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE TAPD Submit Backfill on Commit/Push\nalwaysApply: true\n---';

  return `${header}

# AAFE 提交代码 / TAPD 回填

## 触发条件

当用户输入或意图等价于以下任一指令时，**在继续 git commit / push / PR 之前**执行本 Rule：

- 提交代码 / 提交 / commit / git commit / github push / push / submit / 提测 / 提 PR

## 前置：确认 TAPD 已启用

1. Read \`.aafe.config.json\` 中的 \`tapd\` 配置
2. 若 \`tapd.enabled !== true\` 或缺少 \`tapd\` 节：提示用户运行 \`aafe init\` / \`aafe update\` 配置 TAPD，或手动补充配置；**不要**调用 TAPD MCP

## Step 1 — 判断任务是否来自 TAPD

视为 **来自 TAPD** 若满足任一：

- 会话/任务上下文中已有 TAPD story/bug/task ID（19 位长 ID 或短 ID）
- 用户或系统明确引用 TAPD 单号、TAPD 链接、TAPD MCP 已用于本任务
- \`.aafe.config.json\` 或 session 元数据中记录了 \`tapd_entry_id\` / \`tapd_entry_type\`

否则视为 **非 TAPD 来源任务**。

## Step 2A — 来自 TAPD：回填 + 逐步改状态

1. Read \`${agentPrefix}/skills/tapd-submit-backfill.md\`
2. 若尚未完成影响分析/自测，先执行 \`${agentPrefix}/skills/architecture-impact-test-forecast.md\`（或引用本轮已有结果）
3. 通过 **TAPD MCP**（\`user-tapd_taihu\`）：
   - \`lookup_tool_param_schema\` → \`proxy_execute_tool\`
   - 使用 \`comments_create\` 将**自测结果 + 影响范围报告**回复到原单据（\`entry_type\` + \`entry_id\` + \`workspace_id\`）
4. **状态必须逐步变更**，禁止跳步：
   - Story/需求（已有单）：\`todo → doing → for_test\`（中间 \`doing\` 以 \`tapd.tapd_story.status_doing\` 逗号链为准）
   - **禁止** \`todo → for_test\` 一步到位
   - Bug/缺陷：按 \`tapd.tapd_bug.status_doing\` 链逐步至 \`status_done\`
5. 每一步：\`stories_get\` / \`bugs_get\` 读当前状态 → \`stories_update\` / \`bugs_update\` 仅更新到链上下一状态 → 校验 \`check_workflow\`
6. 向用户汇报：评论 ID、各步状态变更结果、最终状态

## Step 2B — 非 TAPD 来源：询问目标单

询问用户：

> 是否需要关联 TAPD 单据？可选：① 新建 TAPD 需求/缺陷 ② 指定已有 TAPD 单号

### 新建单据

1. 确认 \`tapd.workspace_id\`；若未配置，**必须**向用户索取
2. 确认 \`tapd.milestone_id\`（映射为创建时的 \`iteration_id\` 或发布计划）；若未配置，**必须**向用户索取
3. \`stories_create\` / \`bugs_create\` 创建单据
4. **新单据状态链必须逐步推进**：
   - Story：**\`backlog → todo → doing → for_test\`**
   - 以 \`tapd.tapd_story.status_backlog\`、\`status_todo\`、\`status_doing\`（逗号链）、\`status_done\` 为准
   - **禁止** \`backlog → for_test\` 或 \`todo → for_test\` 跳步
5. 创建后同样 \`comments_create\` 回填自测与影响范围，并逐步更新状态

### 指定已有单据

1. 向用户确认 \`entry_type\`（story/bug）与 \`entry_id\`
2. 短 ID 先 \`tapd_id_get\` 转长 ID
3. 按 **Step 2A** 执行回填与状态流转

## 回填评论内容模板

\`\`\`markdown
## 自测结果
（测试用例表格 + pass/fail/skipped + 命令）

## 影响范围
（直接/间接/潜在影响摘要）

## 变更摘要
（commit/PR 要点、关键文件）
\`\`\`

## 禁止事项

- 禁止跳过中间状态（todo→for_test、backlog→for_test）
- 禁止无自测/影响范围内容就改状态为 for_test
- 禁止在未配置 workspace_id 时创建单据
- 禁止伪造 TAPD MCP 调用结果
`;
}

export function tapdSubmitRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE TAPD 提交回填（Commit/Push/Submit）',
    '',
    '当用户说「提交代码 / commit / push / submit / 提测」等：',
    '1. 读 `.aafe.config.json` 的 `tapd` 配置；未启用则提示配置。',
    '2. 判断任务是否来自 TAPD 单：是 → 用 TAPD MCP 回填自测+影响范围评论，并逐步改状态（todo→doing→for_test，禁止跳步）。',
    '3. 非 TAPD 来源：询问新建或指定 TAPD 单；新建需 workspace_id、milestone_id；新单状态链 backlog→todo→doing→for_test。',
    `4. 详细流程见 \`${agentPrefix}/skills/tapd-submit-backfill.md\`。`,
    ''
  ].join('\n');
}

export function tapdSubmitBackfillSkillContent(agentPrefix = '.ai-agent') {
  const prefix = agentPrefix.startsWith('.') ? agentPrefix : '.ai-agent';
  return `# Skill: TAPD Submit Backfill

Trigger: user intent to **commit / push / submit / 提交代码 / 提测 / 提 PR**, and \`.aafe.config.json\` → \`tapd.enabled === true\`.

## MCP workflow (user-tapd_taihu)

1. \`lookup_tool_param_schema\` — get tool args
2. \`proxy_execute_tool\` — execute TAPD API
3. Optional: \`lookup_tapd_tool\` when tool name uncertain

Common tools: \`stories_get\`, \`stories_create\`, \`stories_update\`, \`bugs_get\`, \`bugs_create\`, \`bugs_update\`, \`comments_create\`, \`tapd_id_get\`, \`user_participant_workspace_get\`, \`tapd_fields_summary_get\`

## Config (\`.aafe.config.json\` → \`tapd\`)

\`\`\`json
{
  "enabled": true,
  "username": "...",
  "api_password": "...",
  "workspace_id": "...",
  "milestone_id": "...",
  "default_entry_type": "story",
  "tapd_story": {
    "status_backlog": "backlog",
    "status_todo": "todo",
    "status_doing": "developing,status_7",
    "status_done": "for_test",
    "status_release": "status_3,status_9"
  },
  "tapd_bug": {
    "status_done": "resolved",
    "status_release": "verified",
    "status_doing": "assigned,in_progress"
  }
}
\`\`\`

- \`status_doing\`: comma-separated **sequential** intermediate statuses before \`status_done\`
- \`milestone_id\`: used as \`iteration_id\` (or release) when creating new stories

## Step 1 — Gather backfill content

Before TAPD actions, ensure you have (from current task or \`${prefix}/skills/architecture-impact-test-forecast.md\`):

- Self-test results (case table + pass/fail/skipped + command)
- Impact scope report (direct / indirect / potential)
- Change summary (files, PR/commit intent)

If missing, run impact/test analysis first or ask user to confirm proceeding with partial content.

## Step 2 — Resolve TAPD entry

| Source | Action |
| --- | --- |
| TAPD-origin task | Use known \`entry_type\`, \`entry_id\`, \`workspace_id\` |
| User provides ID | Short ID → \`tapd_id_get\`; confirm story vs bug |
| New story | Require \`workspace_id\` + \`milestone_id\`; \`stories_create\` |
| New bug | Require \`workspace_id\`; \`bugs_create\` |

## Step 3 — Post comment

\`comments_create\`:

- \`workspace_id\`, \`entry_type\` (story|bug), \`entry_id\`, \`description\` (Markdown: 自测结果 + 影响范围 + 变更摘要)

## Step 4 — Status transitions (strict, no skips)

### Existing story (TAPD-origin, not new)

Path: \`status_todo\` → each token in \`status_doing\` → \`status_done\`

Example config: todo → developing → status_7 → for_test

**Forbidden:** todo → for_test in one call.

### New story

Path: \`status_backlog\` → \`status_todo\` → each \`status_doing\` token → \`status_done\`

**Forbidden:** backlog → for_test, todo → for_test.

### Bug

Path: first \`status_doing\` token (if current is earlier) → ... → \`status_done\`

Algorithm:

1. \`stories_get\` / \`bugs_get\` — read \`status\` or \`v_status\`
2. Build ordered chain from config (see above)
3. Find current index in chain; if already at or past \`status_done\`, skip updates
4. For each remaining step until \`status_done\`:
   - \`stories_update\` / \`bugs_update\` with \`status\` or \`v_status\`, \`check_workflow: "permission,condition"\`
   - On failure, report and stop; do not skip steps
5. Log each transition for the user

## Step 5 — Report

Output:

- TAPD entry link/ID
- Comment posted (yes/no)
- Status transition log (from → to per step)
- Final status
- Any workflow errors

## Pure GitHub projects

If \`tapd\` is absent or \`enabled: false\`, skip this skill entirely; do not prompt TAPD unless user asks.
`;
}
