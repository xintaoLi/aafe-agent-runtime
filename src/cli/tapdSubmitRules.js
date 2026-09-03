import { repoPrApplySkillSection } from './repoConfig.js';
import { workflowModeGatePreamble, workflowModeSkillNote } from './workflowModeRules.js';

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

Task Spine 是动态决策链：**[1]** 若有 TAPD → 拉单并判定是否新建/切换分支；TAPD ID 不匹配时，除非此前已明确确认当前分支可用，否则必须继续执行分支切换/创建逻辑；非 TAPD 新任务也要判定分支；**[4]** 根据提交意图决定 Commit/PR/MR（\`repo-submit\`），仅任务有关联 TAPD 单时进入回填门禁。\`ask\` 根据用户回复推进；\`autonomous\` 按 workflow-mode 自主判定。无 TAPD 关联则跳过 TAPD 回填。

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

${workflowModeGatePreamble(agentPrefix)}

## TAPD 关联评估（前置 Gate）

**仅当任务过程中已涉及 TAPD 单**，才进入本 Rule 的回填分支（Phase E/F 及关联条件询问）。

视为**有关联 TAPD 单**（满足任一）：

- 任务来自 TAPD（story/bug/task ID、链接、TAPD MCP 已用于本任务）
- 用户在本任务中明确引用/绑定 TAPD 单号
- 会话或元数据记录 \`tapd_entry_id\` / \`tapd_entry_type\`
- 当前分支名为 \`feat|bug/<slug>/#<tapd_short_id>\` 且 short_id 与本任务 TAPD 单一致（已关联，git 和 gtm 均适用）

**无 TAPD 关联** → **跳过**：

- 「是否回填 TAPD 单子？」及 Phase F 全部步骤
- 新建单、\`workspace_id\` 索取、PR 字段探测等**回填专用**条件询问
- 仍可走常规 Commit/PR（无 \`--bug=\` / \`--story=\` 强制格式）

## 触发

以下任一情形，且 \`.aafe.config.json\` → \`tapd.enabled === true\`，且 **TAPD 关联评估为有关联**：

1. **自测完成之后**（影响分析 + 最小收敛自测已跑完，或用户明确跳过自测）
2. 用户意图为提交 / commit / push / 提测 / 提 PR（且本任务有 TAPD 关联）

详细步骤见 Skill：\`${agentPrefix}/skills/tapd-submit-backfill.md\`

## 动态门禁顺序（有关联 TAPD 时）

\`\`\`text
自测 / E2E 完成（或用户跳过）或用户触发提交意图
  → 动态判定是否 Commit/PR/MR（ask 根据回复 / autonomous 根据上下文）
      ├─ 是 / proceed → 按 \`.aafe.config.json\` → \`submit.cli\` 执行 Commit；Commit 成功后必须继续尝试 PR/MR → 回填门禁
      └─ 否 / skip → 仍进入回填门禁（仅有关联 TAPD 时）
  → 动态判定是否回填（ask 根据回复 / autonomous 根据上下文）
      ├─ 同意 / proceed → comments_create（+ 可选 PR 字段 + 状态逐步流转）
      └─ 拒绝 / skip → 结束
\`\`\`

无 TAPD 关联时：Commit/PR 可选，**不进入**上述回填。

### Commit / PR（\`submit.cli\`）

先读 \`.aafe.config.json\` → \`submit.cli\`（缺省 / 非法值按 \`git\`）：

| \`submit.cli\` | Commit | PR |
| --- | --- | --- |
| \`git\`（默认） | Git CLI（stage + commit） | Token API / \`aafe repo pr\`（不依赖 gh） |
| \`gtm\` | \`gtm commit\` | \`gtm pr\` |

先读 \`.aafe.config.json\` → \`repo\`（代码仓库配置）。提交、拉取、PR、MR 都依赖这里的 Token，不要写进命令行：

| 字段 | 用途 |
| --- | --- |
| \`repo.githubAccessToken\` | GitHub fetch / pull / push / PR（Token API，不依赖 gh）；也可用 \`GITHUB_TOKEN\` / \`\${GITHUB_TOKEN}\` |
| \`repo.gongfengAccessToken\` | 工蜂 fetch / pull / push / MR / \`gtm pr\`；也可用 \`GIT_PRIVATE_TOKEN\` / \`\${GIT_PRIVATE_TOKEN}\` |

执行 git / gh / gtm 前，把已配置 Token 注入对应环境变量（已有 shell 值优先）。

${repoPrApplySkillSection(agentPrefix)}

- \`aafe init\` / \`aafe update --submit-cli=git|gtm\` 可写入/更新该配置
- **分支关联（git 和 gtm 均适用）**：新任务开始时先检查当前分支是否含 \`#<tapd_short_id>\` 且与本任务 TAPD 单一致；未关联或 ID 不匹配则从远程主干创建/切换开发分支（详见 Skill「TAPD Branch Association」）。除非用户此前已明确确认当前分支可用，否则不得因当前分支已有相关提交或存在未提交改动而放行继续需求分析、设计还原或实现。
  - \`git\`：\`git checkout -b feat|bug/<slug>/#<short_id> upstream/master\`
  - \`gtm\`：\`gtm create issue\` → 关联已有单据（短 ID = URL 最后 9 位）→ 目标分支 \`master\` → 按 TAPD 标题取英文短名建开发分支
- 有关联 TAPD 时，commit message 必须含 \`--bug=\` / \`--story=\`

### 回填询问（仅有关联 TAPD 时）

有关联 TAPD 且自测/提交链到达时，无论是否 Commit / 是否产出 PR。若 Phase D 已产出 \`pr_url\`，必须把 \`pr_url\` 带入回填素材和 PR 字段处理：

- **ask**：必须问「是否回填 TAPD 单子？将追加评论、写入 PR 字段（如配置）并按状态映射逐步流转到 doing」同意词：\`是\` / \`Yes\` / \`Y\` / \`需要\` / \`同意\` / \`回填\` / \`好的\` / \`可以\` / \`ok\`。否定则跳过。
- **autonomous**：按 \`workflow-mode.md\` 判定；\`proceed\` 则回填，\`skip\` 则说明原因。有关联但解析不到 entry_id → Hard Ask。

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
- 禁止跳过中间状态（如 backlog → doing）
- 提交回填状态流转目标为 \`doing\`，禁止自动流转到 \`for_test\` / \`status_done\`
- 禁止伪造 MCP / 测试结果；禁止未拿到用户指定 URL 时自动探测环境
- **禁止**在无 TAPD 关联时主动询问回填、新建 TAPD 单或索取 \`workspace_id\`

## 与自测的衔接

- 自测规则见 \`task-completion-impact.mdc\`；影响分析/ UI 子询问仅对**代码变更**任务
- UI 自测须先产出 \`ui_test_paths\`（见 \`minimal-convergent-self-test.md\`）

## 状态流转（提交回填）

固定链路：\`backlog → todo → doing\`（按当前状态续走，已到 doing 则跳过）。  
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
    '1. 新任务时先检查当前分支 `feat|bug/<slug>/#<short_id>` 是否已关联且 ID 与本任务 TAPD 一致（git 和 gtm 均适用）；未关联或 ID 不匹配则从远程主干创建/切换开发分支（详见 Skill「TAPD Branch Association」）。除非用户此前已明确确认当前分支可用，否则不得因当前分支已有相关提交或未提交改动而放行继续需求分析、设计还原或实现。',
    '2. Commit 门禁：`ask` 询问 / `autonomous` 判定 → 同意或 proceed 则按 \`submit.cli\`（\`git\` 默认 / \`gtm\`）执行 Commit/PR。',
    '3. **Commit 成功后必须继续尝试 PR/MR**；PR 成功则记录 `pr_url`，失败只报告原因，不阻断回填判断。',
    '4. **Commit/PR 完成后进入回填门禁**（仅有关联 TAPD 时）：`ask` 必须问「是否回填 TAPD 单子？将追加评论、写入 PR 字段（如配置）并按状态映射逐步流转到 doing」；`autonomous` 按 workflow-mode 判定。',
    '5. 同意 / proceed → 加载 \`${agentPrefix}/skills/tapd-submit-backfill.md\` 执行 Phase F（comments_create + 可选 PR 字段 + 状态流转）。',
    '6. 拒绝 / skip → 在回复中说明已跳过回填。',
    '7. 回填内容 **只通过 `comments_create` 追加**；禁止改写 description/test_focus。',
    '8. 评论回填后按当前状态流转：backlog→todo→doing；已是 todo 则直接 →doing；已是 doing 则跳过。',
    `9. 详细流程见 \`${agentPrefix}/skills/tapd-submit-backfill.md\`。`,
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

${workflowModeSkillNote(prefix)}

Companions:

- Hard rule: \`${prefix}/rules/tapd-submit-backfill.mdc\`
- Repo submit: \`${prefix}/skills/repo-submit.md\`
- Self-test: \`${prefix}/skills/minimal-convergent-self-test.md\`
- Impact: \`${prefix}/skills/architecture-impact-test-forecast.md\`

## TAPD 关联判定

进入本 Skill 回填分支前，确认任务过程中**已涉及 TAPD 单**（ID/链接/MCP/用户绑定）。  
**否** → 不执行 Phase E/F；Commit 用常规 message；结束。

## Submit / Backfill decision chain（有关联 TAPD 时）

\`\`\`text
[A] 动态确认自测产物是否需要补齐（代码变更任务才需；UI 影响含 E2E）
[B] Commit 门禁（ask 根据用户回复；autonomous 根据上下文判定）
    ├─ 是 / proceed → [C] Commit → [D] Try PR/MR → [E] 回填门禁
    └─ 否 / skip → [E] 仍进入回填门禁
[E] 回填门禁（ask 根据用户回复；autonomous 根据上下文判定）
    同意 / proceed → [F] 评论回填 + 可选 PR 字段 + 状态逐步流转
    拒绝 → 结束
\`\`\`

**Hard：** 有关联 TAPD 时，即使不 Commit 也要动态进入 [E] 回填门禁；ask 模式尊重用户回复，autonomous 模式按判定表执行。**无关联**则整段 [E][F] 跳过。

### Submit CLI 选择（强制先读配置）

Read \`.aafe.config.json\` → \`submit.cli\`:

| 值 | 含义 |
| --- | --- |
| \`git\`（默认） | Phase C/D 走 Git CLI + Token API（\`aafe repo pr\`，不依赖 gh） |
| \`gtm\` | Phase C/D 走 \`gtm commit\` / \`gtm pr\` |

可用 \`aafe update --submit-cli=git|gtm\` 更新配置。

先读 \`.aafe.config.json\` → \`repo\`（代码仓库配置）。提交、拉取、PR、MR 都依赖这里的 Token，不要写进命令行：

| 字段 | 用途 |
| --- | --- |
| \`repo.githubAccessToken\` | GitHub fetch / pull / push / PR（Token API，不依赖 gh）；也可用 \`GITHUB_TOKEN\` / \`\${GITHUB_TOKEN}\` |
| \`repo.gongfengAccessToken\` | 工蜂 fetch / pull / push / MR / \`gtm pr\`；也可用 \`GIT_PRIVATE_TOKEN\` / \`\${GIT_PRIVATE_TOKEN}\` |

执行 git / gh / gtm 前，把已配置 Token 注入对应环境变量（已有 shell 值优先）。

${repoPrApplySkillSection(prefix)}

---

## TAPD Branch Association — 分支关联与 TAPD 详情核对（git 和 gtm 均适用）

**触发**：新任务开始（已拿到具体 TAPD 单 / 需求，准备进入需求分析、设计还原或写代码前），无论 \`submit.cli\` 是 \`git\` 还是 \`gtm\`。

### T0 拉取 TAPD 需求详情

通过 TAPD MCP 拉取单据详情，确认任务内容：

\`\`\`text
1. 从用户提供的 TAPD URL 提取 ID（URL 最后一段数字的末 9 位 = short_id）
2. tapd_id_get → 确认 story / bug 类型和完整信息
3. stories_get / bugs_get → 拉取标题、描述、验收标准、当前状态
4. 记录 tapd_entry_type / tapd_entry_id / tapd_short_id / tapd_title
\`\`\`

TAPD URL 与 ID 示例：

\`\`\`text
https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137629063
→ URL 最后一段 = 1010158081137629063
→ short_id = 末 9 位 = 137629063
→ entry_type = story
\`\`\`

### T1 检查当前分支是否已关联该 TAPD 单

\`\`\`bash
git branch --show-current
\`\`\`

分支命名约定（git 和 gtm 统一）：

\`\`\`text
{type}/{feature-slug}/#{tapd_short_id}
\`\`\`

示例：\`feat/search-tag/#137629063\`

| 段 | 含义 |
| --- | --- |
| \`feat\` / \`feature\` | 需求（story） |
| \`bug\` / \`fix\` | 缺陷（bug） |
| \`search-tag\` | 当前分支功能短名（可读英文，kebab-case） |
| \`#137629063\` | TAPD URL 最后一段数字的**末 9 位** |

**判定**：

- 当前分支匹配 \`{type}/{slug}/#{short_id}\` 且 \`short_id\` **与 T0 拉取的 TAPD 单一致** → **已正确关联**，进入需求分析/设计还原/开发
- 当前分支匹配 \`{type}/{slug}/#{digits}\` 但 \`digits\` **与 TAPD 单不一致** → **关联了错误的单**；除非用户此前已明确确认当前分支可用于本 TAPD 单，否则必须继续执行 T2 创建/切换新分支
- 不匹配（如 \`master\` / \`main\` / 无 \`#id\` 后缀）→ **未关联**，执行 T2

**Hard：** TAPD ID 不匹配不是可忽略警告；当前分支包含相关提交、已有半成品实现或工作区存在未提交改动，都不能替代“用户已明确确认当前分支可用”。若未提交改动导致无法 checkout，应先停下报告并确认保护/迁移方式，禁止继续需求分析、设计还原或实现。

### T2 未关联或关联错误时：从远程主干创建开发分支

#### T2a \`submit.cli=git\`（默认）

从远程 \`upstream/master\` 创建新分支：

\`\`\`bash
# 1. 确保远程主干为最新
git fetch upstream master

# 2. 基于 upstream/master 创建开发分支
git checkout -b {type}/{slug}/#{short_id} upstream/master
\`\`\`

- \`{type}\`：story → \`feat\`；bug → \`bug\`
- \`{slug}\`：根据 TAPD 标题生成可读英文短名（kebab-case，如 \`search-tag\`）
- \`{short_id}\`：T0 提取的 TAPD short_id（末 9 位）

示例：

\`\`\`bash
git fetch upstream master
git checkout -b feat/search-tag/#137629063 upstream/master
\`\`\`

#### T2b \`submit.cli=gtm\`

\`\`\`bash
gtm create issue
\`\`\`

按交互提示依次操作：

1. 选择 **关联已有单据**
2. **输入单据 ID**：TAPD short_id（URL 最后一段数字的末 9 位）  
   - 例：\`.../detail/1010158081137629063\` → 输入 \`137629063\`
3. **请输入目标分支**：\`master\`（或项目约定的主干名）
4. **请输入新的开发分支名称**：根据 TAPD 单据标题生成**可读英文短名**（kebab-case，如 \`search-tag\`）  
   - 只需输入功能短名；**系统会自动补充前缀（feat/bug）与后缀（\`#short_id\`）**

### T3 确认关联成功

完成后再次 \`git branch --show-current\`，确认已变为 \`feat|bug/<slug>/#<short_id>\`，再继续需求分析、设计还原或写代码。

**失败/异常**：简要报告；由项目侧处理，本 Skill 不强制降级；未关联成功时提醒用户手动完成后继续。

---

## Core policy（回填）

| Allowed | Forbidden for backfill |
| --- | --- |
| \`comments_create\` | \`stories_update\` / \`bugs_update\` 改 \`description\` |
| 状态逐步流转（status only） | 改写 \`test_focus\` / 业务自定义字段正文塞自测 |
| 图片上传后嵌入评论 | 覆盖原单背景、截图、目标 |
| PR 链接字段写入（见 Step F3） | 跳步状态（如 backlog→doing）、伪造测试 pass |
| 用户明确要求的其它单字段 | 自动流转到 for_test / status_done |

---

## MCP workflow（user-tapd_taihu）

1. \`lookup_tool_param_schema\` → get args
2. \`proxy_execute_tool\` → execute
3. Optional: \`lookup_tapd_tool\` when unsure

Common tools: \`stories_get\`, \`stories_create\`, \`stories_update\`, \`bugs_*\`, \`comments_create\`, \`tapd_id_get\`, \`tapd_file_upload_url_generate\`

## Config（\`.aafe.config.json\`）

### \`submit.cli\`（Commit/PR provider）

\`\`\`json
{ "submit": { "cli": "git" } }
\`\`\`

- \`git\`（默认）：Git CLI + \`gh\`
- \`gtm\`：\`gtm commit\` / \`gtm pr\`
- Update: \`aafe update --submit-cli=gtm\`

### \`tapd\`

Use \`tapd_story.*\`, \`tapd_bug.*\` status values.
Submit-backfill story target is \`status_doing\` (first token if comma-separated); do **not** auto-advance to \`status_done\`.

\`workspace_id\` **不在配置中硬编码**；回填时从 TAPD 链接或 MCP 查询动态提取（见 F1）。

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

## Phase B — Commit gate

**ask mode** — 问：

> 自测已完成。是否执行 Commit？

| 回答 | 动作 |
| --- | --- |
| 是 / Yes / Y / 需要 / 提交 / commit / 好的 / 可以 / ok | → Phase C |
| 否 / No / N / 不需要 / 跳过 | → Phase E（**仅有关联 TAPD 时**；否则结束） |

**autonomous mode** — 按 \`workflow-mode.md\` 判定：有相关 diff、无 secret、自测完成或 skipped → \`proceed\` 进 Phase C；否则 \`skip\` 进 Phase E（有关联 TAPD 时）。输出判定记录，不要再问 chat yes/no。用户本轮已禁止提交 → 视为 skip。

---

## Phase C — Commit

先确认 \`submit.cli\`（见上表），再执行对应分支。仅在 Phase B 同意或 autonomous \`proceed\` 后执行。

### C1 Resolve TAPD entry（**仅有关联 TAPD 时**）

| Source | Action |
| --- | --- |
| TAPD-origin task | Use known \`entry_type\`, \`entry_id\`, title; \`workspace_id\` 从 TAPD 链接提取 |
| User provides ID | Short ID → \`tapd_id_get\`；确认 story vs bug；\`stories_get\` / \`bugs_get\` 取标题 |

**无 TAPD 关联**：不询问新建/关联单、不索取 \`workspace_id\`（回填时从 TAPD 链接动态提取）。

**禁止**在无 TAPD 关联时瞎编 \`--bug=\` / \`--story=\` ID。

### C2 Message hint（有关联 TAPD 时）

\`\`\`text
# bug
bug: {功能或缺陷描述} --bug={tapd_short_id}

# story / 需求
feat: {功能描述} --story={tapd_short_id}
\`\`\`

其中 \`{tapd_short_id}\` 为 TAPD URL 最后一段数字的末 9 位（如 \`137629063\`）。

若 \`submit.cli=gtm\` 且项目 GTM 已自动注入 TAPD ID，可直接执行。

### C3a Execute when \`submit.cli=git\`（默认）

按仓库 committing-changes 规则：\`git status\` / \`diff\` / \`log\` → stage 相关文件 → commit（HEREDOC message）→ \`git status\` 验证。  
Hook 失败：修问题后 **新建** commit，禁止擅自 amend（除非用户规则允许）。

### C3b Execute when \`submit.cli=gtm\`

\`\`\`bash
gtm commit
\`\`\`

- 成功：记录 commit 结果（若输出可见）
- **失败/异常**：简要报告；由项目内 GTM/钩子处理，**不强制**重试、amend 或降级裸 git；**不阻断** Phase D/E

---

## Phase D — Try PR

### D1 when \`submit.cli=git\`（默认）

Commit 成功后必须尝试 PR；该步骤是 Phase C 的连续动作，不因 \`agent.autoCreatePR=false\` 跳过（该配置仅约束 Agent 平台自动建 PR）：

1. Read \`${prefix}/skills/repo-submit.md\`
2. 确认分支相对 base 的提交与远程同步；先判定 \`.aafe.config.json\` → \`repo.githubAccessToken\` 以及 \`GITHUB_TOKEN\` / \`GH_TOKEN\`
3. 已配置 \`repo.githubAccessToken\` / \`GITHUB_TOKEN\` / \`GH_TOKEN\`：临时注入 \`GITHUB_TOKEN\` 环境变量，用 Token \`git -c http.extraheader="AUTHORIZATION: bearer $GITHUB_TOKEN" push -u origin HEAD\`（不要把 Token 写进 remote）
4. 创建 PR：优先 \`aafe repo pr --title= --body= --base= --head=\`（Token API，附带 \`repo.reviewers\` / \`repo.labels\`）。无 Token 或 Token API 失败时，先提示降级原因，再允许 \`gh pr create\`
5. 记录 \`pr_url\`；失败则报告原因，**不阻断** Phase E

### D2 when \`submit.cli=gtm\`

\`\`\`bash
gtm pr
\`\`\`

- 成功：记录 \`pr_url\`（若输出可见）；若 \`repo.reviewers\` / \`repo.labels\` 非空，立刻按工蜂规则写入 Reviewers / Labels（见上方 \`repo.reviewers\` / \`repo.labels\`）
- **失败/异常**：简要报告；项目内处理，**不强制**补救或降级 \`gh\`；**不阻断** Phase E

---

## Phase E — TAPD backfill gate（**仅有关联 TAPD 时**）

无 TAPD 关联 → **跳过本 Phase**，不向用户问回填。

有关联时，**无论** B 选否、C/D 成功或失败。若 D 成功，\`pr_url\` 是 Phase F 的输入：

**ask mode** — 必须问：

> 是否回填 TAPD 单子？（将追加评论：处理结果 / 影响范围 / 自测结果；若有 PR 且存在 PR 字段则写入链接；并按配置状态映射逐步流转到 doing）

同意词：\`是\` / \`Yes\` / \`Y\` / \`需要\` / \`同意\` / \`回填\` / \`好的\` / \`可以\` / \`ok\` 及明显同义肯定。  
否定：跳过并说明可稍后手动触发本 Skill。

**autonomous mode** — 有关联 + \`tapd.enabled\` + 有产物（或 skipped 标注）→ \`proceed\` 进 Phase F；entry_id 无法解析 → Hard Ask。输出判定记录。

---

## Phase F — Backfill（同意或 autonomous proceed 后）

### F1 Resolve entry

使用任务过程中已关联的 \`entry_type\` / \`entry_id\`。  
\`workspace_id\` 从 TAPD 链接或 MCP 查询动态获取（不在配置中硬编码）：\`https://tapd.woa.com/tapd_fe/{workspace_id}/story|bug/detail/{full_id}\` → 提取 \`workspace_id\`；或 \`tapd_id_get\` / \`stories_get\` / \`bugs_get\` 返回值获取。  
**禁止**在无 TAPD 关联时进入 F1–F6 或询问新建单 / \`workspace_id\`。

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

### F5 Status transitions（submit backfill: backlog → todo → doing）

内容回填 ≠ 状态更新。Status 仅用 update 的 **status 字段**。  
提交回填**只推进到 doing**，不自动走到 \`for_test\` / \`status_done\`。

固定链路（映射 \`tapd_story\`）：

\`status_backlog\` → \`status_todo\` → \`status_doing\`（取配置首个 token）

按**当前状态**决定剩余步骤：

| 当前状态 | 操作 |
| --- | --- |
| \`backlog\`（\`status_backlog\`） | 先 → \`todo\`，再 → \`doing\` |
| \`todo\`（\`status_todo\`） | 直接 → \`doing\` |
| \`doing\`（\`status_doing\` / doing 链内任一） | **不做处理** |
| 已是 \`for_test\` / \`status_done\` 等更后状态 | **不做处理** |

**Forbidden:** backlog → doing 一步跳过；提交回填自动改到 for_test。

#### Bug

对齐同一目标：向 \`tapd_bug.status_doing\` 推进；已在 doing 则跳过；不自动改 \`status_done\`。

Algorithm:

1. \`stories_get\` / \`bugs_get\` — current status
2. 按上表计算剩余步骤（可用 \`storySubmitRemainingPath\` 语义）
3. Advance **one step at a time** with \`check_workflow: "permission,condition"\`
4. Stop and report on failure; never skip; already-doing → report skipped

### F6 Report to user

- TAPD link/ID
- Comment ID / success
- PR 字段是否写入及字段名
- Screenshots embedded?
- Status transition log / final status / errors

---

## Pure GitHub / 无 TAPD 关联

If \`tapd\` absent, \`enabled: false\`, or **任务无 TAPD 关联**：

- 仍可按 \`submit.cli\` 走 Commit/PR（\`git\` 默认 / \`gtm\`）
- **不询问** TAPD 回填、新建单、\`workspace_id\`
- 用户**主动**要求关联 TAPD 时，可单独走本 Skill 并先确认 entry
`;
}

function normalizeAgentPrefix(agentPrefix = '.ai-agent') {
  return agentPrefix.startsWith('.') || agentPrefix.includes('/') ? agentPrefix : '.ai-agent';
}
