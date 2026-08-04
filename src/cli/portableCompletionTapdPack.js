/**
 * Portable completion + TAPD pack (no .ai-agent / monorepo path coupling).
 * Paths are relative to the bundle root: rules/ + skills/ + tapd.config.json
 */

const RULE_IMPACT = 'rules/task-completion-impact.mdc';
const RULE_TAPD = 'rules/tapd-submit-backfill.mdc';
const SKILL_IMPACT = 'skills/architecture-impact-test-forecast.md';
const SKILL_SELF_TEST = 'skills/minimal-convergent-self-test.md';
const SKILL_TAPD = 'skills/tapd-submit-backfill.md';
const CONFIG_TAPD = 'tapd.config.json';

export const PORTABLE_MANIFEST = {
  name: 'completion-tapd-portable-pack',
  version: '1.0.0',
  description: 'Impact analysis, minimal self-test, TAPD backfill — portable rules & skills',
  layout: {
    rules: [RULE_IMPACT, RULE_TAPD],
    skills: [SKILL_IMPACT, SKILL_SELF_TEST, SKILL_TAPD],
    configExample: 'tapd.config.example.json',
    cursorPointers: ['cursor-rules/task-completion-impact.mdc', 'cursor-rules/tapd-submit-backfill.mdc']
  },
  usage: {
    bundleRoot: 'Copy entire temp/ folder anywhere; keep rules/ and skills/ as siblings.',
    config: 'Copy tapd.config.example.json to project workspace as tapd.config.json (or merge tapd key into your own config).',
    cursor: 'Optional: copy cursor-rules/*.mdc into .cursor/rules/',
    skills: 'Register skills/ paths in your agent (Cursor Rules point to rules/; load skills/ on demand).'
  }
};

export function portableTaskCompletionImpactRule() {
  return `---
description: 代码变更任务完成后条件询问影响分析与自测；UI 须先预生成测试路径；自测后按 TAPD 关联进入 Commit/PR/回填。
alwaysApply: true
---

# Task Completion Impact & Self-Test（Portable）

> **Bundle paths**（相对本包根目录）：Rule \`${RULE_IMPACT}\` · Skills \`${SKILL_IMPACT}\` · \`${SKILL_SELF_TEST}\` · \`${SKILL_TAPD}\`

## 任务评估（前置 Gate，必须先做）

任务执行完毕、给出最终回复前，先评估本次任务性质：

### 涉及代码变更 → 有测试潜在需求

满足任一即视为**涉及代码变更**：

- git diff / 实际改动含**可执行代码或运行时配置**（如 \`.ts\` / \`.tsx\` / \`.vue\` / \`.js\` / \`.css\` / \`.scss\` / 影响构建或运行的配置）
- 用户明确说明改了逻辑、组件、接口、样式行为等

### 不涉及代码变更 → 跳过本 Rule 全流程

以下情况**不要**询问影响分析，也**不要**进入 UI 自测子询问：

- 纯文本：文档、README、说明 Markdown、注释-only（无行为变化）
- 需求分析、方案讨论、架构评审、问答解释、Review-only（未改代码）
- 用户明确「只改文档 / 只分析 / 不改代码」

跳过时：正常收尾；若用户随后提交，按 \`${RULE_TAPD}\` 评估是否有关联 TAPD 单。

## 条件询问（仅「涉及代码变更」时）

**仅当任务评估为涉及代码变更**，在最终回复前问：

> 是否需要分析当前任务的影响范围并提供测试参考？

- 否定：不再追问影响分析。
- 肯定（是 / Yes / Y / 需要）：进入 Skills 流程。

## 确认后加载顺序

1. \`${SKILL_IMPACT}\`
2. \`${SKILL_SELF_TEST}\`
3. 自测结束后：若任务**有关联 TAPD 单**且 \`tapd.enabled\`（见 \`${CONFIG_TAPD}\`）→ \`${SKILL_TAPD}\`；无 TAPD 关联则可选 Commit/PR，跳过 TAPD 回填
4. 可选：项目内架构文档（\`docs/\`、设计说明、Mermaid 图等），**不依赖**固定目录名

## 硬约束

- 自测按**本次 diff**最小收敛，禁止无关全量回归。
- 逻辑变更：Mock Props / 函数 I/O，测试落盘到**当前任务工作区根目录** \`test/\`（无则创建）。
- **UI 自测子询问**仅当：代码变更 + 已进入自测 + 影响含 **UI 渲染/交互**。
- UI：先问浏览器 MCP → 再问用户指定 URL → 执行前产出 \`ui_test_paths\`；禁止猜环境地址。
- 禁止未实际执行却声称 pass。

## 自测完成后的衔接

1. 询问 Commit（有 TAPD 关联时用 bug/feat 格式，见 \`${RULE_TAPD}\`）
2. Commit 后尝试 PR
3. **仅有关联 TAPD 单**且 \`tapd.enabled\` → 询问 TAPD 回填

## 配置

TAPD 开关与状态映射见包内 \`tapd.config.example.json\`，部署为工作区 \`${CONFIG_TAPD}\` 或合并到自有 JSON 的 \`tapd\` 节。
`;
}

export function portableTapdSubmitBackfillRule() {
  return `---
description: 有关联 TAPD 单时自测后 Commit → PR → 回填；内容仅评论；无 TAPD 关联则跳过。
alwaysApply: true
---

# TAPD Submit Backfill（Portable · Comment-Only + Commit/PR Gate）

> **Bundle paths**：Rule \`${RULE_TAPD}\` · Skill \`${SKILL_TAPD}\` · Config \`${CONFIG_TAPD}\`

## TAPD 关联评估（前置 Gate）

**仅当任务过程中已涉及 TAPD 单**，才进入回填分支。

视为有关联（满足任一）：

- 任务来自 TAPD（story/bug ID、链接、TAPD MCP 已用于本任务）
- 用户在本任务中引用/绑定 TAPD 单号
- 会话记录 \`tapd_entry_id\` / \`tapd_entry_type\`

**无关联** → 跳过回填询问、新建单、\`workspace_id\` / \`milestone_id\` 索取；可常规 Commit/PR。

## 触发

同时满足：

1. \`tapd.enabled === true\`（自 \`${CONFIG_TAPD}\` 或项目 JSON 的 \`tapd\` 节读取）
2. **TAPD 关联评估为有关联**
3. 自测完成，或用户意图 commit / push / 提测 / 提 PR

详细步骤：\`${SKILL_TAPD}\`

## 强制顺序（有关联 TAPD 时）

\`\`\`text
自测完成 → 询问 Commit？
  ├─ 是 → TAPD 格式 commit → 尝试 PR → 询问回填 TAPD？
  └─ 否 → 仍询问回填 TAPD？
同意回填 → comments_create + 可选 PR 字段 + 状态逐步流转
\`\`\`

### Commit message（有关联 TAPD）

| 类型 | 格式 |
| --- | --- |
| bug | \`bug: {标题} --bug={bug_id}\` |
| story | \`feat: {标题} --story={story_id}\` |

### 回填

仅 \`comments_create\` 追加评论；禁止改 \`description\` / \`test_focus\`。状态可逐步 update。

## 禁止

- 无 TAPD 关联时问回填或新建单
- todo → for_test 跳步
- 伪造 MCP / 测试结果
`;
}

export function portableArchitectureImpactSkill() {
  return `# Skill: Architecture Impact and Test Forecast（Portable）

Trigger: 代码变更任务 + 用户确认要做影响分析。

Rule: \`${RULE_IMPACT}\` · Next: \`${SKILL_SELF_TEST}\`

## Context（均可选，无固定 .ai-agent 路径）

1. 项目架构文档（\`docs/\`、README 架构节、Mermaid 等），按任务需要读取
2. **仅映射本次任务改动文件** → 模块、路由、组件、Store、API、Worker、存储、测试点

## Step 1 — Impact scope report

- **直接影响** / **间接影响** / **潜在影响**
- **架构依据**：文档路径、源码证据
- **影响分类**：\`logic\` | \`store\` | \`api\` | \`ui\` | \`mixed\`

Artifacts: \`impact_scope\`, \`architecture_evidence\`, \`impact_class\`

## Step 2 — Minimal test case design

| ID | Priority | Mode | Scenario | Mock | Assert | Boundary |
| --- | --- | --- | --- | --- | --- | --- |

- 默认 **unit**；可见渲染/交互才标 **ui**
- 无真实 API / 生产数据

## Step 2.5 — UI path draft（mode=ui）

预读变更模板，输出 \`ui_test_paths\` 草案；URL 仍须用户提供。格式见 \`${SKILL_SELF_TEST}\` Step 2.5。

## Step 3 — Hand off

Follow \`${SKILL_SELF_TEST}\` → 测试落盘 \`test/\`（工作区根目录）→ 有关联 TAPD 时 \`${SKILL_TAPD}\`

## Output template

\`\`\`markdown
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
\`\`\`
`;
}

export function portableMinimalSelfTestSkill() {
  return `# Skill: Minimal Convergent Self-Test（Portable）

Trigger: 影响分析之后（代码变更任务），或 TAPD 回填需要自测结果。

Chain: \`${SKILL_IMPACT}\` → this → \`${SKILL_TAPD}\`（仅 TAPD 关联时）

## Step 0 — Mode from impact

| Class | Mode | Location |
| --- | --- | --- |
| 纯逻辑 / 数据处理 | unit | \`test/\` @ workspace root |
| 组件 props/emit | unit/component | \`test/\` |
| Store 契约 | unit | \`test/\` |
| 可见 UI | ui-optional | 条件询问浏览器 MCP |

## Step 1 — Test directory

**当前任务工作区根目录** \`test/\`（与 git 根或用户指定工作目录一致；无则创建）。

\`\`\`text
test/unit/  test/fixtures/  test/ui/
\`\`\`

## Step 2 — Minimal cases

覆盖变更分支 + 相邻边界；Mock only。

Runner: vitest / jest / \`npm test\` / \`node:test\`。

## Step 2.5 — UI paths（执行浏览器前）

含 \`mode=ui\` 时：拿到 URL 后、点击前，一次性产出完整 \`ui_test_paths\`；执行只消费路径。

Actions: navigate | click | switch | fill | hover | assert | screenshot

## Step 3 — UI tests（条件询问）

前置：代码变更 + 影响含 UI。**禁止**对纯文档任务询问。

1. 问是否启用 browser MCP
2. 问用户指定完整 URL
3. 生成/补全 \`ui_test_paths\` → 按路径执行

## Step 4 — Results

| ID | Mode | Status | Command / evidence | Summary |

禁止虚假 pass。

## Step 5 — Hand off

- 有关联 TAPD + \`tapd.enabled\` → \`${SKILL_TAPD}\` Phase B
- 无 TAPD 关联 → 可选 Commit/PR，跳过 TAPD

## Anti-patterns

- 未授权开浏览器、猜 URL、执行中全库分析、改 TAPD description 塞自测表
`;
}

export function portableTapdSubmitBackfillSkill() {
  return `# Skill: TAPD Submit Backfill（Portable · Comment-Only + Commit/PR Gate）

Trigger: \`tapd.enabled\`（\`${CONFIG_TAPD}\`）**且**任务有关联 TAPD 单。

Rules: \`${RULE_TAPD}\` · Companions: \`${SKILL_IMPACT}\`, \`${SKILL_SELF_TEST}\`

## MCP: user-tapd_taihu

\`lookup_tool_param_schema\` → \`proxy_execute_tool\`

Tools: \`stories_*\`, \`bugs_*\`, \`comments_create\`, \`tapd_id_get\`, \`tapd_file_upload_url_generate\`

## Config

Read \`${CONFIG_TAPD}\` → \`tapd\` object: \`enabled\`, \`workspace_id\`, \`milestone_id\`, \`tapd_story.*\`, \`tapd_bug.*\`, optional \`pr_field\`.

\`status_doing\`: comma-separated chain before \`status_done\`.

## Pipeline（有关联 TAPD）

\`\`\`text
[A] 自测产物齐全
[B] 问 Commit → [C] bug:/feat: commit → [D] PR → [E] 问回填
[E] 同意 → [F] 评论 + PR 字段 + 状态流转
\`\`\`

无关联：跳过 [E][F]。

## Phase C — Commit

使用已关联 \`entry_type\` / \`entry_id\` / 标题；禁止无关联时编造 ID。

## Phase E — Ask backfill

仅有关联 TAPD 时问：「是否回填 TAPD 单子？」

## Phase F — Backfill

- F4: \`comments_create\` only（模板含处理结果、影响范围、自测表、Commit/PR）
- F5: 状态逐步：story todo→doing→for_test；新单 backlog→todo→doing→for_test；禁止跳步
- UI 截图：upload 后 embed \`html_code\`

## Pure GitHub / 无 TAPD 关联

常规 Commit/PR；不询问 TAPD 回填。
`;
}

export function portableCursorPointerImpact() {
  return `---
description: Task completion impact & self-test (portable pack pointer)
alwaysApply: true
---

# Task Completion Impact（Portable Pointer）

Load from **this pack's bundle root** (same folder that contains \`rules/\` and \`skills/\`):

1. Rule: \`${RULE_IMPACT}\`
2. Skills: \`${SKILL_IMPACT}\`, \`${SKILL_SELF_TEST}\`, \`${SKILL_TAPD}\`

No \`.ai-agent\` or monorepo path required. TAPD config: \`${CONFIG_TAPD}\` in project workspace.
`;
}

export function portableCursorPointerTapd() {
  return `---
description: TAPD submit backfill (portable pack pointer)
alwaysApply: true
---

# TAPD Submit Backfill（Portable Pointer）

1. Rule: \`${RULE_TAPD}\`
2. Skill: \`${SKILL_TAPD}\`
3. Config: \`${CONFIG_TAPD}\`

Only when task has TAPD association. Comment-only backfill via MCP.
`;
}

export function portableTapdConfigExample() {
  return {
    tapd: {
      enabled: true,
      username: '',
      api_password: '',
      workspace_id: '',
      milestone_id: '',
      default_entry_type: 'story',
      pr_field: '',
      tapd_story: {
        status_backlog: 'backlog',
        status_todo: 'todo',
        status_doing: 'developing,status_7',
        status_done: 'for_test',
        status_release: 'status_3,status_9',
        pr_field: ''
      },
      tapd_bug: {
        status_done: 'resolved',
        status_release: 'verified',
        status_doing: 'assigned,in_progress',
        pr_field: ''
      }
    }
  };
}

export function getPortablePackFiles() {
  return {
    'manifest.json': `${JSON.stringify(PORTABLE_MANIFEST, null, 2)}\n`,
    [RULE_IMPACT]: portableTaskCompletionImpactRule(),
    [RULE_TAPD]: portableTapdSubmitBackfillRule(),
    [SKILL_IMPACT]: portableArchitectureImpactSkill(),
    [SKILL_SELF_TEST]: portableMinimalSelfTestSkill(),
    [SKILL_TAPD]: portableTapdSubmitBackfillSkill(),
    'tapd.config.example.json': `${JSON.stringify(portableTapdConfigExample(), null, 2)}\n`,
    'cursor-rules/task-completion-impact.mdc': portableCursorPointerImpact(),
    'cursor-rules/tapd-submit-backfill.mdc': portableCursorPointerTapd()
  };
}
