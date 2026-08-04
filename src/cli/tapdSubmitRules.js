export function tapdSubmitRuleMdc(ctx = {}) {
  // Editor adapters are thin pointers; detailed protocol lives in `.ai-agent/rules/` + skills.
  return tapdSubmitPointerRuleMdc(ctx);
}

export function tapdSubmitPointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleName = ctx.moduleName ?? 'module';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE TAPD Submit Backfill (${moduleName}) — comment-only + Commit/PR gate\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE TAPD Submit Backfill — comment-only + Commit/PR gate\nalwaysApply: true\n---';

  return `${header}

# AAFE 提交代码 / TAPD 回填（Pointer）

Source of truth:

1. Rule: \`${agentPrefix}/rules/tapd-submit-backfill.mdc\`
2. Skill: \`${agentPrefix}/skills/tapd-submit-backfill.md\`

流程：自测完成 → Commit → PR → **仅任务有关联 TAPD 单时**询问回填。无 TAPD 关联则跳过回填及新建单等询问。

Do not duplicate project knowledge here.
`;
}

export function tapdSubmitProjectRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: 有关联 TAPD 单时自测后询问 Commit → PR → 回填；内容仅追加评论；无 TAPD 关联则跳过回填分支。
alwaysApply: true
---

${tapdSubmitProjectRuleBody(agentPrefix)}
`;
}

function tapdSubmitProjectRuleBody(agentPrefix = '.ai-agent') {
  return `# TAPD Submit Backfill（Comment-Only + Commit/PR Gate）

## TAPD 关联评估（前置 Gate）

**仅当任务过程中已涉及 TAPD 单**，才进入本 Rule 的回填分支（Phase E/F 及关联条件询问）。

视为**有关联 TAPD 单**（满足任一）：

- 任务来自 TAPD（story/bug/task ID、链接、TAPD MCP 已用于本任务）
- 用户在本任务中明确引用/绑定 TAPD 单号
- 会话或元数据记录 \`tapd_entry_id\` / \`tapd_entry_type\`

**无 TAPD 关联** → **跳过**：

- 「是否回填 TAPD 单子？」及 Phase F 全部步骤
- 新建单、\`workspace_id\` / \`milestone_id\` 索取、PR 字段探测等**回填专用**条件询问
- 仍可走常规 Commit/PR（无 \`--bug=\` / \`--story=\` 强制格式）

## 触发

以下任一情形，且 \`.aafe.config.json\` → \`tapd.enabled === true\`，且 **TAPD 关联评估为有关联**：

1. **自测完成之后**（影响分析 + 最小收敛自测已跑完，或用户明确跳过自测）
2. 用户意图为提交 / commit / push / 提测 / 提 PR（且本任务有 TAPD 关联）

详细步骤见 Skill：\`${agentPrefix}/skills/tapd-submit-backfill.md\`

## 强制顺序（有关联 TAPD 时，不可跳步）

\`\`\`text
自测完成（含 UI 路径预生成与执行）
  → 询问：是否执行 Commit？
      ├─ 是 → 按 TAPD 格式 commit → 尝试 PR → 询问：是否回填 TAPD？
      └─ 否 → 仍询问：是否回填 TAPD？（仅有关联 TAPD 时）
  → 用户同意回填 → comments_create（+ 可选 PR 字段 / 状态流转）
\`\`\`

无 TAPD 关联时：Commit/PR 可选，**不进入**上述回填询问。

### Commit message（有关联 TAPD 时）

| 单子类型 | 格式 |
| --- | --- |
| bug | \`bug: {TAPD 标题} --bug={bug_id}\` |
| 需求 / story | \`feat: {TAPD 标题} --story={story_id}\` |

- 标题取自 TAPD 单据 \`name\` / \`title\`；ID 为完整数字 ID
- **无 TAPD 关联**：常规 commit message，不强制 TAPD ID 格式

### PR

Commit 成功后**尝试**执行 git PR。PR 成功则保留 URL，供回填（有关联 TAPD 且用户同意回填时）。

### 回填询问（仅有关联 TAPD 时）

有关联 TAPD 且自测/提交链到达时，无论是否 Commit / 是否产出 PR，都要问：

> 是否回填 TAPD 单子？

同意词示例：\`是\` / \`Yes\` / \`Y\` / \`需要\` / \`同意\` / \`回填\` / \`好的\` / \`可以\` / \`ok\`。  
否定则跳过，不自动回填。

## 回填方式（强制）

「处理结果 / 预测影响范围 / 自测结果」**只能通过追加评论**：

1. Read \`${agentPrefix}/skills/tapd-submit-backfill.md\`
2. TAPD MCP \`comments_create\` 追加评论
3. UI 截图：\`tapd_file_upload_url_generate\` 上传后嵌入评论
4. 若存在 PR 链接字段，\`stories_update\` / \`bugs_update\` **仅更新该字段**

## 禁止事项

- **禁止**为回填内容调用 update 改写 \`description\`、\`test_focus\` 或其他业务正文
- **禁止**覆盖/重写原单据背景、截图、目标等已有内容
- 允许的 update：状态逐步流转；PR 链接字段；用户明确要求改的字段
- 禁止跳过中间状态（如 todo → for_test）
- 禁止无自测/影响范围评论就改到 \`for_test\`（用户明确跳过自测并仍要求回填时，评论中标注 \`self_test=skipped\`）
- 禁止伪造 MCP / 测试结果；禁止未拿到用户指定 URL 时自动探测环境
- **禁止**在无 TAPD 关联时主动询问回填、新建 TAPD 单或索取 \`workspace_id\` / \`milestone_id\`

## 与自测的衔接

- 自测规则见 \`task-completion-impact.mdc\`；影响分析/ UI 子询问仅对**代码变更**任务
- UI 自测须先产出 \`ui_test_paths\`（见 \`minimal-convergent-self-test.md\`）

## 状态流转

规则见 Skill；**内容回填 = 评论，状态流转 ≠ 改写描述**。`;
}

export function tapdSubmitRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE TAPD 提交回填（Comment-Only + Commit/PR Gate）',
    '',
    '**前置**：任务过程中须**已关联 TAPD 单**；无关联则跳过回填及新建单/workspace_id 等条件询问。',
    '',
    '有关联且 tapd.enabled 时，自测完成后或用户说 commit/push/submit/提测：',
    '1. 询问 Commit（TAPD 格式）→ 若 Commit 则尝试 PR → **询问是否回填 TAPD**（无关联则整段跳过）。',
    '2. 回填内容 **只通过 `comments_create` 追加**；禁止改写 description/test_focus。',
    '3. 评论回填后逐步改状态（todo→doing→for_test，禁止跳步）。',
    `4. 详细流程见 \`${agentPrefix}/skills/tapd-submit-backfill.md\`。`,
    ''
  ].join('\n');
}

export function tapdSubmitBackfillSkillContent(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `# Skill: TAPD Submit Backfill（Comment-Only + Commit/PR Gate）

Trigger（\`.aafe.config.json\` → \`tapd.enabled === true\` **且任务过程中有关联 TAPD 单**）:

1. **自测流程结束后**（含用户跳过自测）
2. 用户意图 **commit / push / submit / 提交代码 / 提测 / 提 PR**（且本任务有 TAPD 关联）

**无 TAPD 关联**：跳过 Phase E/F 及 C1 新建/关联询问；可常规 Commit/PR。

Companions:

- Hard rule: \`${prefix}/rules/tapd-submit-backfill.mdc\`
- Self-test: \`${prefix}/skills/minimal-convergent-self-test.md\`
- Impact: \`${prefix}/skills/architecture-impact-test-forecast.md\`

## TAPD 关联判定

进入本 Skill 回填分支前，确认任务过程中**已涉及 TAPD 单**（ID/链接/MCP/用户绑定）。  
**否** → 不执行 Phase E/F；Commit 用常规 message；结束。

## End-to-end pipeline（有关联 TAPD 时）

\`\`\`text
[A] 确保自测产物齐全（缺则先跑 impact + self-test；代码变更任务才需）
[B] 询问是否 Commit
    ├─ 是 → [C] Commit（bug:/feat: 格式）→ [D] 尝试 PR → [E] 询问回填 TAPD
    └─ 否 → [E] 仍询问回填 TAPD
[E] 同意 → [F] 评论回填 + 可选 PR 字段 + 状态流转
    拒绝 → 结束
\`\`\`

**Hard：** 有关联 TAPD 时，即使不 Commit 也必须执行 [E]。**无关联**则整段 [E][F] 跳过。

---

## Core policy（回填）

| Allowed | Forbidden for backfill |
| --- | --- |
| \`comments_create\` | \`stories_update\` / \`bugs_update\` 改 \`description\` |
| 状态逐步流转（status only） | 改写 \`test_focus\` / 业务自定义字段正文塞自测 |
| 图片上传后嵌入评论 | 覆盖原单背景、截图、目标 |
| PR 链接字段写入（见 Step F3） | 跳步状态、伪造测试 pass |
| 用户明确要求的其它单字段 | 无评论证据就标 for_test |

---

## MCP workflow（user-tapd_taihu）

1. \`lookup_tool_param_schema\` → get args
2. \`proxy_execute_tool\` → execute
3. Optional: \`lookup_tapd_tool\` when unsure

Common tools: \`stories_get\`, \`stories_create\`, \`stories_update\`, \`bugs_*\`, \`comments_create\`, \`tapd_id_get\`, \`tapd_file_upload_url_generate\`

## Config（\`.aafe.config.json\` → \`tapd\`）

Use \`workspace_id\`, \`milestone_id\`, \`tapd_story.*\`, \`tapd_bug.*\` status chains.
\`status_doing\` is a comma-separated sequential list before \`status_done\`.

Optional PR field keys（任一存在且非空即用）:

- \`tapd.pr_field\`
- \`tapd.tapd_story.pr_field\`
- \`tapd.tapd_bug.pr_field\`

字段名示例（以项目实际为准）：\`source\`、\`custom_field_*\`、业务配置的「PR 链接」字段。未配置时见 Step F3 探测。

---

## Phase A — Ensure artifacts

Ensure before Commit/回填询问：

| Artifact | Source |
| --- | --- |
| 处理结果 / 变更摘要 | 本次 diff + 结论 |
| 影响范围 | \`architecture-impact-test-forecast.md\` |
| 自测结果 | \`minimal-convergent-self-test.md\` |
| \`ui_test_paths\`（若有 UI case） | 自测 Skill Step 2.5；执行 UI 前必须已生成 |

若缺失：先补跑 impact + self-test（含 UI 是否测、URL、路径预生成）。用户明确「跳过自测」：产物标注 \`self_test=skipped\`，仍可进入 B/E。

---

## Phase B — Ask Commit

问：

> 自测已完成。是否执行 Commit？

| 回答 | 动作 |
| --- | --- |
| 是 / Yes / Y / 需要 / 提交 / commit / 好的 / 可以 / ok | → Phase C |
| 否 / No / N / 不需要 / 跳过 | → Phase E（**仅有关联 TAPD 时**；否则结束） |

---

## Phase C — Commit

### C1 Resolve TAPD entry（**仅有关联 TAPD 时**）

| Source | Action |
| --- | --- |
| TAPD-origin task | Use known \`entry_type\`, \`entry_id\`, \`workspace_id\`, title |
| User provides ID | Short ID → \`tapd_id_get\`；确认 story vs bug；\`stories_get\` / \`bugs_get\` 取标题 |

**无 TAPD 关联**：不询问新建/关联单、不索取 \`workspace_id\` / \`milestone_id\`；Commit 用常规 message。

**禁止**在无 TAPD 关联时瞎编 \`--bug=\` / \`--story=\` ID。

### C2 Message format（强制）

\`\`\`text
# bug
bug: {TAPD标题} --bug={bug_id}

# story / 需求
feat: {TAPD标题} --story={story_id}
\`\`\`

规则：

- \`{TAPD标题}\`：单据名称，去掉换行；过长可截断到合理长度（保留语义）
- \`{bug_id}\` / \`{story_id}\`：TAPD 数字 ID
- 遵循用户 git commit 安全协议（仅在用户同意本 Phase 后执行；HEREDOC 传 message；不改 git config；不 force push）

### C3 Execute

按仓库 committing-changes 规则：\`git status\` / \`diff\` / \`log\` → stage 相关文件 → commit → \`git status\` 验证。  
Hook 失败：修问题后 **新建** commit，禁止擅自 amend（除非用户规则允许）。

---

## Phase D — Try PR

Commit 成功后尝试 PR：

1. 确认分支相对 base 的提交与远程同步（按 creating-pull-requests 规则）
2. 需要时 \`git push -u origin HEAD\`
3. \`gh pr create\`（HEREDOC body），Summary 含变更要点；Test plan 可引用自测表
4. 记录 \`pr_url\`；失败则报告原因，**不阻断** Phase E

---

## Phase E — Ask TAPD backfill（**仅有关联 TAPD 时**）

无 TAPD 关联 → **跳过本 Phase**，不向用户问回填。

有关联时，**无论** B 选否、C/D 成功或失败，都要问：

> 是否回填 TAPD 单子？（将追加评论：处理结果 / 影响范围 / 自测结果；若有 PR 且存在 PR 字段则写入链接）

同意词：\`是\` / \`Yes\` / \`Y\` / \`需要\` / \`同意\` / \`回填\` / \`好的\` / \`可以\` / \`ok\` 及明显同义肯定。  
否定：跳过并说明可稍后手动触发本 Skill。

---

## Phase F — Backfill（同意后）

### F1 Resolve entry

使用任务过程中已关联的 \`entry_type\` / \`entry_id\` / \`workspace_id\`。  
**禁止**在无 TAPD 关联时进入 F1–F6 或询问新建单 / \`workspace_id\` / \`milestone_id\`。

### F2 Upload UI screenshots（optional）

仅当自测产出 UI 截图：

1. \`tapd_file_upload_url_generate\` \`{ upload_kind: "image", workspace_id }\`
2. HTTP POST 图片到 \`upload_url\`（短链，尽快上传）
3. 保留 \`html_code\` / \`image_src\` 嵌入评论

禁止靠改写 description 挂截图。

### F3 PR 链接字段

若 Phase D 得到 \`pr_url\`（或用户提供 PR URL）：

1. 读配置 \`pr_field\`（story/bug 各自优先，否则 \`tapd.pr_field\`）
2. 未配置：\`stories_get\` / \`bugs_get\` 查看返回字段；或 \`lookup_tapd_tool\` 检索「获取需求/缺陷自定义字段」；名称含 \`pr\` / \`pull\` / \`git\` / \`合并\` / \`MR\` 等且语义为链接的字段可候选，**向用户确认字段名后**再写
3. 确认存在后：\`stories_update\` / \`bugs_update\` **仅** \`{ [pr_field]: pr_url }\`（可加 \`check_workflow\` 若接口要求）
4. 无该字段或不确认：评论中写明 PR URL，不猜字段强写

### F4 Post comment only

\`comments_create\`:

- \`workspace_id\`, \`entry_type\`（story|bug）, \`entry_id\`
- \`description\`：下方模板
- UI 截图 \`html_code\` 放在「UI 截图」

#### Comment template

\`\`\`markdown
## 处理结果
（做了什么、关键结论、改动文件）

## 影响范围
### 直接影响
...
### 间接影响
...
### 潜在影响
...

## 自测结果
| ID | Mode | 状态 | 命令/证据 | 摘要 |
| --- | --- | --- | --- | --- |
| TC-001 | unit | pass | \`node --test ...\` | ... |

### UI 测试路径（摘要）
（若有：入口 → 关键步骤序列；完整路径见自测产物）

### UI 截图
（若有：粘贴 tapd 返回的 html_code）

## 提交信息
- Commit: （hash / message；无则 \`skipped\`）
- PR: （url；无则 \`n/a\`）

## 未覆盖风险
...
\`\`\`

未 Commit 仍回填时：\`提交信息\` 标 \`Commit: skipped\`，照常写处理结果与自测。

### F5 Status transitions（strict, no skips）

内容回填 ≠ 状态更新。Status 仅用 update 的 **status 字段**。

#### Existing story

\`status_todo\` → each token in \`status_doing\` → \`status_done\`

**Forbidden:** todo → for_test in one call.

#### New story

\`status_backlog\` → \`status_todo\` → each \`status_doing\` → \`status_done\`

#### Bug

Follow \`tapd_bug.status_doing\` → \`status_done\`.

Algorithm:

1. \`stories_get\` / \`bugs_get\` — current status
2. Build ordered chain from config
3. Advance one step at a time with \`check_workflow: "permission,condition"\`
4. Stop and report on failure; never skip

### F6 Report to user

- TAPD link/ID
- Comment ID / success
- PR 字段是否写入及字段名
- Screenshots embedded?
- Status transition log / final status / errors

---

## Pure GitHub / 无 TAPD 关联

If \`tapd\` absent, \`enabled: false\`, or **任务无 TAPD 关联**：

- 仍可走 Commit / PR（常规 commit message）
- **不询问** TAPD 回填、新建单、\`workspace_id\` / \`milestone_id\`
- 用户**主动**要求关联 TAPD 时，可单独走本 Skill 并先确认 entry
`;
}

function normalizeAgentPrefix(agentPrefix = '.ai-agent') {
  return agentPrefix.startsWith('.') || agentPrefix.includes('/') ? agentPrefix : '.ai-agent';
}
