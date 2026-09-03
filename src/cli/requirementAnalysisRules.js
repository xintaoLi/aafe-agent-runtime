import { workflowModeGatePreamble, workflowModeSkillNote } from './workflowModeRules.js';

export function requirementIntakeRuleMdc(ctx = {}) {
  return requirementIntakePointerRuleMdc(ctx);
}

export function requirementIntakePointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleName = ctx.moduleName ?? 'module';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE Requirement Intake & Analysis (${moduleName})\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE Requirement Intake & Analysis\nalwaysApply: true\n---';

  return `${header}

# AAFE 需求分析阶段（Pointer）

Source of truth:

1. Rule: \`${agentPrefix}/rules/requirement-intake-analysis.mdc\`
2. Skill: \`${agentPrefix}/skills/requirement-intake-analysis.md\`

Task Spine **[1]** 是动态决策：若是 TAPD 单，先拉详情并按规则判定是否新建/切换关联分支；TAPD ID 不匹配时，除非此前已明确确认当前分支可用，否则必须继续执行分支切换/创建逻辑；若单据含 Figma 设计稿，必须提取设计链接并用 Figma MCP 获取结构化设计与截图作为 UI 还原依据；非 TAPD 新任务也需判定是否新建/切换分支；无法确定则 ask 询问，autonomous 仅高置信自主判定。闭合后再进入执行。

Do not duplicate project knowledge here.
`;
}

export function requirementIntakeProjectRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: 拿到具体需求后必须先做需求澄清、历史检索、代码范围与根因分析；大规模变更需确认切换 Plan 模式。
alwaysApply: true
---

${requirementIntakeProjectRuleBody(agentPrefix)}
`;
}

function requirementIntakeProjectRuleBody(agentPrefix = '.ai-agent') {
  return `# Requirement Intake & Analysis

${workflowModeGatePreamble(agentPrefix)}

## 触发（需求已到手）

在**开始改代码之前**，必须先完成本 Rule。需求来源：

| 来源 | 触发点 |
| --- | --- |
| TAPD 单 | 已通过 MCP / 用户拉取到**具体** story/bug 描述、验收标准、附件要点、Figma 设计稿链接（若有） |
| 非 TAPD | 用户给出**具体**需求描述（非空泛话题） |

若仅有「帮我看看」「优化一下」等模糊意图 → 先在本阶段澄清，**不得**直接写代码。

详细步骤：\`${agentPrefix}/skills/requirement-intake-analysis.md\`

## 分支决策（TAPD / 非 TAPD 均适用）

写代码前先动态判定任务来源和当前分支是否适合本次任务。

### TAPD 单

1. 通过 TAPD MCP 拉取需求详情，提取 \`tapd_short_id\`（URL 最后一段数字的末 9 位）
2. 检查当前分支是否 \`feat|bug/<slug>/#<tapd_short_id>\` 且 short_id 与 TAPD 单一致
3. TAPD ID 不匹配、未关联或当前分支不适合本任务 → 按规则新建或切换开发分支；除非用户此前已明确确认当前分支可用，否则不得因当前分支已有相关提交或未提交改动而放行继续实现：
   - \`git\`：\`git checkout -b feat|bug/<slug>/#<short_id> upstream/master\`
   - \`gtm\`：\`gtm create issue\` → 关联已有单据 → 目标分支 \`master\` → 按 TAPD 标题生成英文短名
4. 详见 \`${agentPrefix}/skills/tapd-submit-backfill.md\`「TAPD Branch Association」

### 非 TAPD 任务

1. 判断是否是新任务：看用户需求、当前分支名、已有 diff 与历史上下文
2. 当前分支明显对应本任务 → 继续使用
3. 当前在 \`master\` / \`main\`，或分支主题与新任务无关 → 新建或切换任务分支
4. 无法确定 → \`ask\` 模式询问；\`autonomous\` 仅在高置信时自主判定，否则 Hard Ask

## TAPD Figma 设计稿 Gate

当 TAPD 标题、描述、验收标准、附件、评论或关联字段中出现 Figma 链接 / 节点信息时，必须执行本 Gate：

1. 提取并记录 \`figma_url\`、\`figma_node_id\`、\`figma_dpr\`（若 TAPD 未说明倍率，默认按 Figma MCP 的 \`dpr=1\`；发现 750/2x 等高倍率线索时显式设置 \`dpr=2\`）。
2. 调用 Figma MCP：优先 \`get_design_context\` 获取结构化数据，并搭配 \`get_screenshot\` 获取视觉截图；大设计稿、响应过大或需要先看层级时，改用 \`get_full_bundle(includeFiles=["design_context_tree","design_context","screenshot_compressed"])\`。
3. 输出 \`figma_design_context\`、\`figma_screenshot_evidence\`、\`figma_ui_constraints\`：布局尺寸、间距、颜色、字体、圆角、阴影、资源、状态与交互差异。
4. UI 还原必须以 Figma 结构化数据 + 截图为准；若本地组件库能力、响应式规则或现有样式与设计稿冲突，记录 \`design_deviation\` 并在实施前按工作流模式确认或说明取舍。
5. 无 Figma 链接时记录 \`figma: not_provided\`，不得编造设计稿。

## 阶段 A — 需求分析与澄清

1. 解析需求：目标、范围、验收标准、约束、依赖、风险
   - 若有 Figma：把设计稿节点、视觉约束、交互状态、切图资源纳入需求约束；UI 还原不得仅凭文字描述或截图猜测
2. 列出**不明确项**（歧义、缺失边界、多解路径、未定义异常/兼容策略）
3. 对每项不明确点按工作流模式闭合：
   - **ask**：必须交互获取明确答复（方案选择 / 追问 / 要详细答复）
   - **autonomous**：能从 TAPD / 代码 / 历史高置信推断则写下 assumption 并关闭；会改变方案且无法推断 → Hard Ask，禁止猜测

**Hard：** 存在未决且无法闭合的不明确项时，禁止进入阶段 B（历史检索）及之后写代码。

## 阶段 B — 历史积累检索（需求已明确后）

需求全部明确后，**先查历史再定方案**：

1. Read \`${agentPrefix}/skills/memory-recaller.md\`
2. 检索 \`${agentPrefix}/memory/experience.md\`、\`${agentPrefix}/memory/learnings.jsonl\`、相关 topic memory
3. 可选：项目 \`.docs\`、Knowledge Center、TAPD 评论历史（若 MCP 可查）

输出：

- 是否命中历史方案 / 类似问题
- **能否直接复用或部分复用**（满足当前修复则标注 reuse；否则说明差异）

## 阶段 C — 代码范围与根因

在历史检索之后、实施之前：

1. **代码范围**：受影响文件/模块/函数清单（基于 locator + diff 意图，非全库）
2. **Figma 约束映射（若有设计稿）**：将 \`figma_ui_constraints\` 映射到本地页面/组件/样式/资源，标记 must-change、read-only、design-deviation
3. **根因分析**：现象 → 直接原因 → 根因假设 → 验证点
4. **实施策略草案**：改哪些点、不改哪些点；UI 还原类任务必须说明如何按 Figma 落地

## 阶段 D — 实施规模 Gate（Plan 模式）

评估本次**预计**变更规模（基于阶段 C，非臆测）：

### 直接实施（无需 Plan）

满足**全部**或等价为**小改**：

- 仅**单个函数**逻辑修复，或
- 仅**样式**调整（CSS/class/布局，无多文件逻辑交叉）

→ 进入阶段 E 直接修复/实现。

### 建议切换 Plan 模式

满足**任一**即视为**大规模**：

- 多个函数 + 多文件**相互交叉**依赖变更
- 预计改动 **> 5 个函数**（含新增）
- 预计涉及 **> 5 个文件**
- 预计**新增代码 > 300 行**（含新功能）

→ 按工作流模式处理 Plan 门禁：

- **ask**：必须先询问用户是否切换 Plan 模式；确认后 **SwitchMode**（\`target_mode_id: plan\`）；拒绝则实施并记录 \`plan_skipped: true\`
- **autonomous**：大改直接调用 **SwitchMode**（无需再问 chat yes/no）；SwitchMode 不可用则实施并记录风险与 \`plan_skipped: true\`

### Plan 模式内

- 输出：目标、模块边界、步骤、文件清单、风险、验证点
- 用户认可计划后再 Agent 模式实施（或用户在 Plan 中确认继续）

## 阶段 E — 实施

- **小改**：直接修改
- **大改且已 plan**：按批准计划执行
- 非 trivial 前端任务仍遵循 \`${agentPrefix}/runtime/engine.md\`、router、pipelines、gates（在需求分析**之后**）

## 任务完成后（不变）

需求分析**不替代**收尾流程。实施完成后仍按：

- \`${agentPrefix}/rules/task-completion-impact.mdc\`（代码变更时条件影响分析 + 自测）
- \`${agentPrefix}/rules/tapd-submit-backfill.mdc\`（有关联 TAPD 时 Commit / PR / 回填）

## 禁止

- 未澄清需求就写代码
- 跳过历史检索直接大改
- 询问模式下大规模变更不询问就 silent 全量实施；自主模式须产出判定记录
- 将「需求分析阶段」与「任务完成影响分析」混淆（后者在**实施完成后**）`;
}

export function requirementIntakeRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE 需求分析阶段（Requirement Intake）',
    '',
    '拿到具体需求后（TAPD 拉取或用户描述）、写代码前：',
    '0. TAPD MCP 拉取需求详情并核对分支关联（git 和 gtm 均适用）：检查当前分支 `feat|bug/<slug>/#<short_id>` 是否与 TAPD 单一致；未关联或 ID 错误则从远程主干创建/切换开发分支（见 `tapd-submit-backfill`「TAPD Branch Association」）。除非用户此前已明确确认当前分支可用，否则不得因当前分支已有相关提交或未提交改动而放行。',
    '1. TAPD 单若含 Figma 链接，必须通过 Figma MCP 获取结构化设计和截图；UI 还原以 Figma 尺寸、间距、颜色、字体、资源和交互状态为准。',
    `2. 澄清不明确项（方案选择 / 追问 / 要详细答复）；未明确禁止写代码。自主模式可按 workflow-mode 用证据闭合 AMB。`,
    `3. 需求明确后查历史：\`${agentPrefix}/skills/memory-recaller.md\` + experience/learnings。`,
    '4. 分析代码范围与根因；若有 Figma，将设计约束映射到本地组件/样式/资源，再定实施策略。',
    '5. 单函数或纯样式小改 → 直接修；>5 函数 / >5 文件 / >300 行新增或多文件交叉 → ask 询问 SwitchMode；autonomous 自行判定。',
    '6. 实施后：task-completion-impact + tapd-submit-backfill 流程不变。',
    `7. 详见 \`${agentPrefix}/skills/requirement-intake-analysis.md\`。`,
    ''
  ].join('\n');
}

export function requirementIntakeAnalysisSkillContent(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `# Skill: Requirement Intake & Analysis

Trigger: **具体需求已获取**（TAPD 单据内容已拉取，或用户给出可执行的需求描述），且尚未开始写代码。

Rule: \`${prefix}/rules/requirement-intake-analysis.mdc\`

Post-implementation (unchanged): \`${prefix}/rules/task-completion-impact.mdc\` → \`${prefix}/rules/tapd-submit-backfill.mdc\`

${workflowModeSkillNote(prefix)}

---

## Phase 0 — Confirm requirement source

| Source | Done when |
| --- | --- |
| TAPD | \`stories_get\` / \`bugs_get\` 或用户粘贴：标题、描述、验收、优先级、关联信息、Figma 设计稿链接（若有） |
| Non-TAPD | 用户消息含：要做什么、期望结果、范围边界（或经 Phase 1 补全） |

Record: \`requirement_source\`, \`requirement_summary\`, \`tapd_entry_id\`（若有）, \`figma_url\`（若有）

### Phase 0.5 — TAPD branch association（git 和 gtm 均适用）

若本任务有 TAPD 单：

1. 通过 TAPD MCP 拉取需求详情（\`tapd_id_get\` → \`stories_get\` / \`bugs_get\`），提取 \`tapd_short_id\`（URL 最后一段数字的末 9 位）
2. \`git branch --show-current\`：是否匹配 \`feat|bug/<slug>/#<short_id>\` 且 \`short_id\` 与 TAPD 单一致
3. **已匹配且一致** → 记录 \`tapd_entry_type\` / \`tapd_entry_id\` / \`tapd_short_id\`，继续 Phase 1
4. **未匹配或不一致** → 按 \`${prefix}/skills/tapd-submit-backfill.md\`「TAPD Branch Association」执行；除非用户此前已明确确认当前分支可用，否则不得因当前分支已有相关提交或未提交改动而继续实现：
   - \`submit.cli=git\`：\`git fetch upstream master\` → \`git checkout -b feat|bug/<slug>/#<short_id> upstream/master\`
   - \`submit.cli=gtm\`：\`gtm create issue\` → 关联已有单据 → 短 ID → 目标分支 \`master\` → 按 TAPD 标题生成英文短名建开发分支

**Hard：** TAPD ID 不匹配时，分支关联门禁未关闭；相关提交、半成品实现、package 变更或其它会话前未提交改动都不能视为“当前分支可用”。若这些改动阻塞 checkout，应先报告并确认保护/迁移方式，禁止继续 Phase 1 或写代码。

无 TAPD 单时跳过本小节。

---

### Phase 0.6 — TAPD Figma design intake

若 TAPD 单据标题、描述、验收标准、附件、评论或关联字段中包含 Figma URL / node-id：

1. 提取 \`figma_url\`、\`node-id\`、设计倍率线索（如 375/750、1x/2x）；无法确认倍率时默认 \`dpr=1\`，不要猜测业务设计稿比例。
2. 使用 Figma MCP 获取设计依据：
   - 常规节点：\`get_design_context({ url, dpr, includeComponents: true, includeResources: true })\` + \`get_screenshot({ url })\`
   - 大节点 / 超出上下文 / 需要层级俯瞰：\`get_full_bundle({ url, dpr, includeFiles: ["design_context_tree", "design_context", "screenshot_compressed"], includeResources: true })\`
3. 记录 \`figma_design_context\`、\`figma_screenshot_evidence\`、\`figma_resource_map\`、\`figma_ui_constraints\`。
4. UI 还原类需求必须基于 Figma 结构数据和截图执行；不得只按 TAPD 文字、口头描述或本地现状自由发挥。
5. 若 Figma 与现有组件规范冲突，生成 \`design_deviation\`：差异、原因、影响、建议取舍；ask 模式先确认会影响视觉/交互的取舍。

无 Figma 链接：记录 \`figma: not_provided\`，继续 Phase 1。

---

## Phase 1 — Analyze & clarify (mandatory)

### 1.1 Parse

Extract:

- **Goal** — user-visible outcome
- **Scope** — in / out
- **Acceptance** — how to verify done
- **Constraints** — perf, compat, auth, deadline
- **Dependencies** — API, other modules, flags
- **Design** — Figma 节点、视觉规范、资源、交互状态（若 TAPD 已提供）

### 1.2 Ambiguity register

For each unclear item, create \`AMB-001\`… with:

| Field | Content |
| --- | --- |
| Topic | What's unclear |
| Risk if guessed | Wrong fix cost |
| Resolution type | \`choice\` \\| \`question\` \\| \`detail_needed\` |

### 1.3 Resolution

**ask mode** — Interactive resolution (mandatory):

**choice** — present 2–4 options + recommendation:

\`\`\`markdown
### AMB-001: （主题）
请选择：
- **A** …（推荐：…）
- **B** …
- **C** …
\`\`\`

**question** — numbered precise questions.

**detail_needed** — ask for example, screenshot, API contract, edge case list.

**autonomous mode** — Close AMB if TAPD / code / history can infer it with high confidence; record \`assumption\`. If it would change the solution and cannot be inferred → Hard Ask (stop). Do not invent product requirements.

**Hard:** \`ambiguity_register\` 非空且未关闭 → **stop**；不得进入 Phase 2。

Close each AMB with \`resolution\` text in output.

---

## Phase 2 — Historical accumulation search

**Only after** all AMB closed.

1. Read \`${prefix}/skills/memory-recaller.md\`
2. Search:
   - \`${prefix}/memory/experience.md\`
   - \`${prefix}/memory/learnings.jsonl\`
   - \`${prefix}/memory/decisions.md\`, topic files if relevant
   - Optional: \`.docs\`, TAPD comments (MCP)

Output \`history_hits\`:

| Hit | Source | Summary | Reuse? |
| --- | --- | --- | --- |
| H-001 | experience.md | … | full / partial / none |

If **full reuse** possible: \`ask\` 先确认再跳过新设计；\`autonomous\` 证据充分则直接复用并记录判定。

---

## Phase 3 — Code scope & root cause

After history review:

### 3.1 Code scope

- List files / symbols likely touched (use \`project-architecture-locator.md\` when needed)
- Mark read-only vs must-change
- If Figma exists: map each \`figma_ui_constraints\` item to local page/component/style/resource files; label \`must_match_figma\`, \`acceptable_delta\`, or \`design_deviation\`
- Artifact: \`code_scope\`

### 3.2 Root cause (bugs / defects)

\`\`\`text
Symptom → Immediate cause → Root cause hypothesis → How to verify
\`\`\`

Artifact: \`root_cause_analysis\`

### 3.3 Implementation sketch

Bullet plan: what to change, what NOT to change.

---

## Phase 4 — Sizing gate & Plan mode

Estimate **before** coding:

| Signal | Count |
| --- | --- |
| Functions touched (incl. new) | n |
| Files touched | m |
| Estimated new lines | L |

### Direct path (small)

**All true:**

- Single-function logic fix **OR** style-only (CSS/class/layout), AND
- Not cross-cutting multi-module refactor

→ **Phase 5 direct implement**

### Plan path (large)

**Any true:**

- Cross-cutting multi-function **and** multi-file interdependency
- n > 5
- m > 5
- L > 300 (new feature / substantial addition)

**ask mode** — Ask:

> 本次变更规模较大（约 n 个函数 / m 个文件 / L 行新增）。是否切换 **Plan 模式** 先制定详细实施计划？

Affirmative: \`确认\` / \`同意\` / \`Yes\` / \`是\` / \`Y\` / \`切换plan\` / \`好\`

**Action:** invoke **SwitchMode** with \`target_mode_id: "plan"\`. In Plan:

- Module boundaries, step order, file list, risks, test hooks
- Get user approval before returning to Agent for code

If user declines Plan: document risk; may proceed in Agent with explicit \`plan_skipped: true\`.

**autonomous mode** — Do not wait for chat yes/no. Invoke **SwitchMode** when large. If SwitchMode is unavailable, proceed in Agent with \`plan_skipped: true\` and document risk. Record the decision per \`workflow-mode.md\`.

---

## Phase 5 — Implement

- Small: implement immediately
- Large + approved plan: follow plan steps
- Non-trivial frontend: then \`${prefix}/runtime/engine.md\`, router, pipelines, gates as usual

**Do not** run task-completion-impact / TAPD backfill here — those run **after** implementation complete.

---

## Output template (end of intake, before code)

\`\`\`markdown
## 需求摘要
...

## 不明确项处理
| ID | 问题 | _resolution |
...

## 历史方案检索
| Hit | 来源 | 是否复用 |
...

## 代码范围
...

## Figma 设计依据（若有）
- URL / node-id / dpr
- 关键视觉约束
- 本地代码映射与 design_deviation

## 根因分析
...

## 规模评估
functions: n, files: m, new_lines: L → direct | plan (user: yes/no)

## 下一步
direct fix | plan mode | blocked (waiting user)
\`\`\`

---

## Anti-patterns

- Coding with open AMB items
- UI restoration from TAPD with Figma link but without fetching Figma structured data and screenshot
- Generating UI scope/tests only from local diff when TAPD already provides Figma design
- Skipping history on recurring bug classes
- >5 files change without plan ask (ask mode) or without a recorded autonomous decision
- Confusing this skill with post-task impact analysis (\`architecture-impact-test-forecast.md\`)
`;
}

function normalizeAgentPrefix(agentPrefix = '.ai-agent') {
  return agentPrefix.startsWith('.') || agentPrefix.includes('/') ? agentPrefix : '.ai-agent';
}
