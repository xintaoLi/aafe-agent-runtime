import { workflowModeGatePreamble, workflowModeSkillNote } from './workflowModeRules.js';

export function taskCompletionImpactRuleMdc(ctx = {}) {
  // Editor adapters are thin pointers; detailed protocol lives in `.ai-agent/rules/` + skills.
  return taskCompletionImpactPointerRuleMdc(ctx);
}

export function taskCompletionImpactPointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleName = ctx.moduleName ?? 'module';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE Task Completion Impact and Test Analysis (${moduleName})\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE Task Completion Impact and Test Analysis\nalwaysApply: true\n---';

  return `${header}

# AAFE 任务完成影响分析与测试（Pointer）

Source of truth:

1. Rule: \`${agentPrefix}/rules/task-completion-impact.mdc\`
2. Skills:
   - \`${agentPrefix}/skills/architecture-impact-test-forecast.md\`
   - \`${agentPrefix}/skills/minimal-convergent-self-test.md\`
   - 自测后衔接：\`${agentPrefix}/skills/tapd-submit-backfill.md\`

Task Spine **[3]** 是动态决策：有代码变更才评估影响分析 + 自测；ask 模式按用户回复推进或跳过，autonomous 按上下文判定 \`proceed / skip / ask\`；完成或跳过后再动态判定 **[4]** 提交/PR/MR/回填。
UI/路由自测走 \`aafe test --diff\`；浏览器 MCP 仅当 E2E blocked。MCP 兜底须先预生成 \`ui_test_paths\`。无代码变更或无 UI 影响时不询问浏览器。Do not duplicate project knowledge here.
`;
}

export function taskCompletionImpactProjectRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: 代码变更任务完成后条件询问影响分析与自测；UI 须先预生成测试路径；自测后按 TAPD 关联进入 Commit/PR/回填。
alwaysApply: true
---

${taskCompletionImpactProjectRuleBody(agentPrefix)}
`;
}

function taskCompletionImpactProjectRuleBody(agentPrefix = '.ai-agent') {
  return `# Task Completion Impact & Self-Test

${workflowModeGatePreamble(agentPrefix)}

## 任务评估（前置 Gate，必须先做）

任务执行完毕、给出最终回复前，先评估本次任务性质：

### 涉及代码变更 → 有测试潜在需求

满足任一即视为**涉及代码变更**（可进入下方「影响分析询问」）：

- git diff / 实际改动含**可执行代码或运行时配置**（如 \`.ts\` / \`.tsx\` / \`.vue\` / \`.js\` / \`.css\` / \`.scss\` / 影响构建或运行的配置）
- 用户明确说明改了逻辑、组件、接口、样式行为等

### 不涉及代码变更 → 跳过本 Rule 全流程

以下情况**不要**询问「是否需要分析影响范围并提供测试参考」，也**不要**进入 UI 自测子询问：

- 纯文本：文档、README、说明 Markdown、注释-only（无行为变化）
- 需求分析、方案讨论、架构评审、问答解释、Review-only（未改代码）
- 用户明确「只改文档 / 只分析 / 不改代码」

跳过时：正常给出最终回复即可；若用户随后发起提交意图，按 \`tapd-submit-backfill\` 评估是否有关联 TAPD 单（见该 Rule）。

## 条件询问（仅「涉及代码变更」时）

**仅当任务评估为涉及代码变更**：

- **ask**：在最终回复前问「是否需要分析当前任务的影响范围并提供测试参考？」是 → 进入 Skills；否 → 不再追问。
- **autonomous**：不询问，直接进入 Skills（产出判定记录）。纯文档任务仍跳过。

## 确认后加载顺序

0. 先跑 \`aafe impact --diff --format=md\`（\`aafe\` 不在 \`PATH\` 时用 \`node_modules/.bin/aafe\`），把机器算出的影响面作为起点，自己不要从零推断；命令不可用时才退回纯人工分析并说明。
1. \`${agentPrefix}/skills/architecture-impact-test-forecast.md\`
2. \`${agentPrefix}/skills/minimal-convergent-self-test.md\`（最后测试环节：UI/E2E 走 \`aafe test --diff\`，禁止任务收尾默认 \`--coverage\`）
3. 自测结束后：若任务过程中**有关联 TAPD 单**且 \`tapd.enabled\`，进入 \`${agentPrefix}/skills/tapd-submit-backfill.md\`（按 \`submit.cli\` 执行 Commit/PR → 回填）；无 TAPD 关联则仅可选提交，跳过 TAPD 回填询问
4. 按需读取 architecture 相关 docs / memory（含 \`${agentPrefix}/skills/knowledge-center-architecture.md\` / \`${agentPrefix}/memory/knowledge-center-architecture.md\` when present）

## 硬约束

- 自测必须按**本次 diff 影响范围最小收敛**，禁止无关全量回归。
- 逻辑/数据处理变更：优先 Mock Props / 函数 I/O 单元测试，落盘到安装目录下 \`test/\`（无则创建）。
- **E2E**：影响分类含 UI / 页面 / 路由时，在自测环节执行 \`aafe test --diff\`（生成 YAML）。要 \`--run\` 时：若用户消息里已有被测 URL 则带 \`--base-url=<url>\`（含 \`#\` 须加引号）；否则**停下来询问并等待用户输入本次测试地址**（每次可能不同，不要写进 \`e2e.baseUrl\`，禁止猜，禁止 \`http://localhost:8080\`）。地址含页面路径或查询参数时再确认 A/B/C，加 \`--url-role=target|origin|template\`。拿到后再 \`aafe test --diff --run --base-url=<url>\`。报告只读 \`.aafe/e2e/reports/<runId>/\`。
- \`primary: unit\` 时 E2E 标 \`NOT_APPLICABLE\`，不要为凑覆盖强开浏览器。
- **禁止猜 URL**；\`http://localhost:8080\` 占位视为未配置。
- **UI 自测子询问**（浏览器 MCP）**仅当** E2E blocked（无 Playwright）且用户仍要看 UI。缺测试地址时先问 URL，不要改走 MCP。
- MCP 兜底执行前必须产出完整 \`ui_test_paths\`；执行阶段只跟路径走。

## 自测完成后的衔接（按 TAPD 关联分流）

自测（或用户明确跳过）结束后：

1. **ask** 询问是否 Commit；**autonomous** 按 \`workflow-mode.md\` 判定。同意 / proceed 则按 \`.aafe.config.json\` → \`submit.cli\`（\`git\` 默认 / \`gtm\`）执行 Commit/PR（见 \`tapd-submit-backfill\`）
2. **仅当任务过程中有关联 TAPD 单**且 \`tapd.enabled\` → **ask** 询问是否回填 / **autonomous** 自行判定；**无 TAPD 关联则跳过回填**

## 与 TAPD 回填的关系

有 TAPD 关联时，本流程产出作为评论素材；规则见 \`tapd-submit-backfill\` / \`${agentPrefix}/skills/tapd-submit-backfill.md\`。无 TAPD 关联时不进入回填分支。`;
}

export function taskCompletionImpactRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE 任务完成影响分析与测试（条件触发）',
    '',
    '任务结束前先做**任务评估**：仅当本次涉及**可执行代码变更**（非纯文档/需求分析）时，才进入影响分析。`ask` 先询问；`autonomous` 直接进入（见 workflow-mode）。',
    '',
    '进入 Skills 后：',
    `1. Read \`${agentPrefix}/skills/architecture-impact-test-forecast.md\` 与 \`${agentPrefix}/skills/minimal-convergent-self-test.md\`；`,
    '2. 输出影响范围报告（直接/间接/潜在影响 + 影响分类 + 架构依据）；',
    '3. 按 diff 最小收敛设计测试：逻辑优先 Mock Props/I/O，落盘到 `test/`；',
    '4. UI/页面/路由变更：跑 `aafe test --diff`；要执行时询问本次测试 URL，等待输入后 `--run --base-url=<url>`（不要写死 e2e.baseUrl）；',
    '5. 浏览器 MCP 仅当 E2E blocked 且用户仍要看 UI；MCP 兜底须先预生成 `ui_test_paths`；禁止猜环境地址；禁止虚假声称通过；',
    `6. 自测结束后：仅当任务过程中**有关联 TAPD 单**且 tapd.enabled → 按 submit.cli 执行 Commit/PR → ask 询问 / autonomous 判定 TAPD 回填；无 TAPD 关联则跳过回填。`,
    ''
  ].join('\n');
}

export function architectureImpactTestForecastSkillContent(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `# Skill: Architecture Impact and Test Forecast

Trigger: **同时满足**：
1. 任务评估为**涉及代码变更**（非纯文档/需求分析-only）
2. **ask**：用户回答 **是 / Yes / 需要 / Y** 至影响分析条件询问；**autonomous**：LLM 判定 \`proceed\`（见 \`workflow-mode.md\`）

（Rule: \`${prefix}/rules/task-completion-impact.mdc\` when present）

${workflowModeSkillNote(prefix)}

Next skill for execution: \`minimal-convergent-self-test.md\`.

## Required context

1. Read the target project's \`${prefix}/skills/knowledge-center-architecture.md\` when present.
2. Read \`${prefix}/memory/knowledge-center-architecture.md\` when present.
3. Read relevant \`.docs\` architecture documents and Mermaid diagrams.
4. Map **current task changed files only** to modules, routes, components, stores, APIs, workers, storage, flows and tests.

## Step 1 — Impact scope report

Produce:

- **直接影响**：changed files, modules, routes, components, stores, APIs, hooks
- **间接影响**：callers, dependents, shared layers, downstream data flow
- **潜在影响**：auth guards, cache, Worker, IndexedDB, compatibility, degradation paths
- **架构关系依据**：.docs paths, diagram refs, source evidence
- **影响分类标签**（供自测收敛）：\`logic\` | \`store\` | \`api\` | \`ui\` | \`mixed\`

Required artifacts: \`impact_scope\`, \`architecture_evidence\`, \`impact_class\`

## Step 2 — Minimal test case design（设计 only）

Design the **smallest sufficient** case list for this diff. Do **not** run browser MCP here.

| Field | Requirement |
| --- | --- |
| ID | TC-001, TC-002, ... |
| Priority | P0 / P1 / P2 |
| Mode | unit（默认）/ ui（仅当影响含可见渲染） |
| Scenario | What behavior is verified |
| Mock setup | fixtures / mocked props; **no real API or prod data** |
| Steps | Arrange → Act → Assert |
| Assertions | Concrete expected outcomes |
| Boundary | edge covered |

Classification hints:

- 组件内数据处理 / 百分比 / 缓存 / 排序 → **unit**，Mock Props 或纯函数 I/O
- Store/API 契约 → **unit**，Mock state/response
- 布局、样式、图表真实渲染、交互可见性 → 标记 **ui**；交给自测 Skill 走 \`aafe test --diff\`。浏览器 MCP 仅作 E2E blocked 兜底，本 Skill 不自动开浏览器

Required artifact: \`test_cases\`

## Step 2.5 — UI 交互路径草案（仅 mode=ui）

若 \`test_cases\` 含 UI，基于变更文件的模板/render **预读一次**，输出 \`ui_test_paths\` 草案（可无最终 URL）：

- 标注将用到的 \`click\` / \`switch\` / \`fill\` / \`hover\` / \`assert\` 目标（文案、role、稳定 class / data-*）
- 写清从页面壳层到复现点的步骤序列
- 完整格式与硬约束见 \`minimal-convergent-self-test.md\` Step 2.5

目的：把代码分析前移到设计阶段，自测执行只消费路径。URL 仍须用户提供后才能 \`navigate\`。

Required artifact when UI: \`ui_test_paths\`（草案可在自测 Skill 用 URL 补全）

## Step 3 — Hand off to self-test skill

Read and follow \`${prefix}/skills/minimal-convergent-self-test.md\` to:

1. Create/update files under install-root \`test/\` for unit cases
2. Run unit tests with Mock
3. UI/路由变更：执行 \`aafe test --diff\`；要 \`--run\` 则询问并等待本次测试 URL（含 \`#\` 须加引号；有路径/参数时确认 A/B/C 并加 \`--url-role\`），再用 \`--base-url=<url>\`（不要写死配置），报告只读 \`.aafe/e2e/reports/\`
4. 浏览器 MCP 仅当 E2E blocked 且用户仍要看 UI；禁止猜环境地址
5. 自测结束后：若任务过程中**有关联 TAPD 单** → \`tapd-submit-backfill.md\`（按 submit.cli 执行 Commit/PR → 条件回填）；无 TAPD 关联则跳过 TAPD 回填

Collect \`test_results\`（及 UI 时的 \`ui_test_paths\`）from that skill.

## Step 4 — Residual risks

- unverified_risks
- items needing manual QA or authorized UI run
- architecture conflicts between .docs and code

## Output template

\`\`\`markdown
## 影响范围报告
### 直接影响
...
### 间接影响
...
### 潜在影响
...
### 影响分类
logic | store | api | ui | mixed
### 架构依据
...

## 测试用例（设计）
| ID | 优先级 | Mode | 场景 | Mock 要点 | 断言 | 覆盖边界 |
...

## UI 测试路径（草案，若有）
### Path P-001 — ...
1. click|switch|fill|hover|assert | target | expected
...

## 测试执行结果
| ID | Mode | 状态 | 命令/证据 | 结果摘要 |
...

## 未覆盖风险
...
\`\`\`

## Rules

- Scope to **this task's diff** only.
- Distinguish **tested / predicted / not covered**.
- UI browser work is opt-in via \`minimal-convergent-self-test.md\`；本 Skill 不自动开浏览器。
- UI 路径分析在设计/自测准备阶段完成；禁止把大量源码分析留到点击执行中。
`;
}

export function minimalConvergentSelfTestSkillContent(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `# Skill: Minimal Convergent Self-Test

Trigger: after impact analysis (code-change tasks only), or when TAPD backfill needs self-test results.

Companion: \`${prefix}/skills/architecture-impact-test-forecast.md\` (impact) → this skill (tests) → **完成后** 若任务有关联 TAPD 单 → \`${prefix}/skills/tapd-submit-backfill.md\`.

${workflowModeSkillNote(prefix)}

E2E / 浏览器缺本次 URL 时，即使 \`mode.workflow=autonomous\` 也必须 Hard Ask，禁止猜地址。

## Goal

按**本次变更影响范围**做最小收敛自测：能 Mock 则 Mock；UI/路由变更在最后测试环节走 \`aafe test --diff\`（Playwright YAML）。浏览器 MCP 仅作 E2E blocked 时的兜底。

## Step 0 — Decide test mode from impact

| Impact class | Default mode | Location |
| --- | --- | --- |
| Pure function / data transform / computed / cache / percent calc | **unit**（Mock 输入 → 断言输出） | \`test/\` under install root |
| Component logic with props/emit, no visual claim | **unit/component**（Mock Props） | \`test/\` |
| Store getter/action contract | **unit**（Mock state） | \`test/\` |
| Visible layout / CSS / popover / chart render / interaction | **e2e** | \`aafe test --diff\` → \`tests/ui-ai/cases/\` + \`.aafe/e2e/reports/\` |

Rules:

- Prefer the narrowest mode that can fail if the bug regresses.
- Example: 组件内数据处理逻辑变更 → 只测函数/方法 I/O，**不要**默认开浏览器。
- Do not invent E2E for logic-only diffs.
- 任务收尾**禁止**默认跑 \`aafe test --coverage\`（全量铺底是显式命令）。

## Step 0.5 — E2E via \`aafe test --diff\`

当 Step 0 判定为 e2e / ui 时：

1. 执行 \`aafe test --diff\`（\`aafe\` 不在 PATH 时用 \`node_modules/.bin/aafe\`）。
2. 要 \`--run\` 但没有本次 URL：在对话里询问完整被测地址并**等待用户输入**。测试地址每次可能不同，不要写入 \`.aafe.config.json\` \`e2e.baseUrl\`，不要用环境变量凑合，**禁止**填 \`http://localhost:8080\`。
3. 用户给出地址后：若含 \`#\` 或查询参数，先确认 A（目标页）/ B（仅 origin）/ C（提取参数拼到变更路由），再 \`aafe test --diff --run --base-url=<用户输入的 URL> --url-role=target|origin|template\`。
4. CLI 若返回 \`needInput: "baseUrl"\` 或 \`needInput: "urlRole"\`：必须停下来问用户，禁止自行编造 URL 或改去装 uitest。
5. 只引用统一报告 \`.aafe/e2e/reports/<runId>/{report.json,index.html}\`。
6. \`layers.primary: unit\` 时 E2E 标 \`NOT_APPLICABLE\`。

浏览器 MCP 仅当 E2E blocked（无 Playwright）且用户仍要看 UI。缺测试地址时先问 URL，不要改走 MCP。

## Step 1 — Ensure test directory

Path: install-root \`test/\`（与 \`.aafe.config.json\` / \`.ai-agent\` 同级；无则创建）。

Suggested layout:

\`\`\`text
test/
  unit/           # pure logic / props I/O
  fixtures/       # mock data
  ui/             # UI paths + screenshots + notes（授权后）
\`\`\`

Naming: \`test/unit/<module>-<topic>.test.ts\`（或项目既有后缀）。  
UI 路径产物建议：\`test/ui/<module>-<topic>.path.md\`（或同会话内结构化输出，不强制落盘文档除非便于复跑）。

## Step 2 — Author minimal cases

For each case:

| Field | Requirement |
| --- | --- |
| ID | TC-001… |
| Priority | P0 / P1 / P2 |
| Mode | unit \\| ui |
| Target | file/symbol under test |
| Mock | props / store / API fixtures only |
| Assert | concrete I/O or UI observation |

Converge:

- Cover the changed branch + one adjacent edge (empty / zero / stale cache).
- Skip unrelated modules.
- No real API / prod data.

### Runner

1. Prefer existing project test runner if present (\`vitest\` / \`jest\` / \`npm test\`).
2. If none: use Node built-in \`node:test\` + \`node:assert\` for pure logic.
3. Record the exact command in results.

## Step 2.5 — Pre-generate UI test paths（UI cases only, before browser）

当 \`test_cases\` 含 \`mode=ui\` 时，在询问浏览器 / 拿到 URL **之后、开始点击之前**，必须基于**本次 diff 影响范围**做一次集中代码分析，产出完整 \`ui_test_paths\`。之后执行阶段**只消费该产物**，禁止再大范围翻组件实现。

### 分析范围（收敛）

仅读：

- 变更文件及其直接模板 / render（\`.vue\` / \`.tsx\` / \`.jsx\`）
- 为定位交互控件所必需的子组件入口（点到能写出稳定 selector / 文案 / role 为止）
- 影响报告中的路由 / Tab / 面板入口

禁止：无关目录全库检索、自测中途「再分析一下整个模块」。

### 交互类型（必须覆盖到变更相关的）

| Action | 含义 | 路径中要写清 |
| --- | --- | --- |
| \`navigate\` | 打开页面 / 路由 | 完整 URL（用户提供）+ 必要 query |
| \`click\` | 点击 | 目标文案 / \`data-*\` / role / CSS 选择器候选 |
| \`switch\` | Tab / 模式 / 开关切换 | 切换前状态 → 目标态控件 |
| \`fill\` | 输入 / 选择填充 | 目标控件 + 填充值 + 触发方式（input/enter/blur） |
| \`hover\` | 悬停 | 目标行/节点 + 期望出现的浮层/操作条 |
| \`assert\` | 观察断言 | 可见文本 / loading 结束 / 网络请求名 / 截图区域 |
| \`screenshot\` | 存证 | 建议文件名（\`test/ui/...\`） |

### \`ui_test_paths\` 模板

\`\`\`markdown
## UI 测试路径
### Meta
- Case IDs: TC-00x
- Entry URL: （用户提供，禁止猜测）
- Impact files: ...
- Generated from: （分析过的源文件列表）

### Path P-001 — （场景名）
1. navigate | {url} | 页面可交互 / 关键壳层可见
2. click | （控件：文案或 selector） | （期望）
3. switch | （如 Tab / 模式切换） | （期望）
4. fill | （输入目标）| value=... | （期望）
5. hover | （行/节点） | （期望浮层/按钮）
6. assert | （可观察结果）
7. screenshot | .aafe/e2e/reports/<runId>/artifacts/xxx.png
\`\`\`

要求：

- **完整可执行**：他人仅凭路径即可操作，无需再读源码
- 每步含：\`action | target | expected\`（fill 含 value）
- 目标优先稳定信号：可见文案、\`role\`、\`data-test*\`、业务 class；避免脆弱的 nth-child 链（除非无更好信号）
- 与 TC ID 关联；P0 路径优先生成

若影响分析阶段已产出同等质量路径，本步校验补全即可，勿重复劳动。

## Step 3 — Browser MCP fallback (only when E2E blocked)

**前置**：已走 Step 0.5 的 \`aafe test --diff\`，且结果为 blocked（无 Playwright），用户仍要看 UI。缺测试地址时先问 URL 再 \`--run --base-url\`，不要改走 MCP。纯文档/需求分析任务**不得**进入本 Step。

When all preconditions met:

1. Ask:

   > 本次变更涉及 UI，是否启用浏览器 MCP（Chrome DevTools / cursor-ide-browser）做渲染自测？

2. If **否**：mark UI cases \`not_run\`，reason=\`user_declined_browser_mcp\`；仍可用 unit 覆盖可测逻辑。
3. If **是**：再问：

   > 请提供要测试的完整页面 URL（含环境与必要 query）。未提供则不自动探测。

4. URL 到手后：执行 **Step 2.5** 生成/补全 \`ui_test_paths\`，再严格按路径操作：
   - navigate → snapshot 定位 → click/switch/fill/hover → assert → screenshot
   - 截图与 trace 只写入 \`.aafe/e2e/reports/<runId>/artifacts/\`，不要散落到 \`test/ui/\`
   - do **not** guess hosts, retry random envs, or burn tokens re-analyzing code mid-run
5. 路径某步失效：允许**一次**局部重读该步相关模板修正路径，记录 \`path_amended\`；禁止借机全模块再分析。

## Step 4 — Results artifact

Produce \`test_results\`（+ 若有 UI：附 \`ui_test_paths\` 摘要）:

| ID | Mode | Status | Command / evidence | Summary |
| --- | --- | --- | --- | --- |
| TC-001 | unit | pass/fail/skipped/not_run | \`node --test ...\` | … |
| TC-002 | ui | pass/fail/not_run | screenshot + path id | … |

Hard rules:

- Never claim **pass** without execution.
- Unit results → text table for TAPD comment.
- UI results → screenshot(s) + path 摘要 → TAPD comment（见 tapd-submit-backfill skill）.

## Step 5 — Hand off to submit / backfill gate

自测结束后（含用户拒绝 UI、或仅 unit）：

1. 若任务过程中**有关联 TAPD 单**且 \`tapd.enabled\`：Read \`${prefix}/skills/tapd-submit-backfill.md\` Phase B 起（按 submit.cli 执行 Commit/PR → 询问 TAPD 回填）
2. 若无 TAPD 关联：可询问常规 Commit/PR；**跳过 TAPD 回填及关联单号/新建单等条件询问**
3. 若 \`tapd.enabled !== true\`：跳过 TAPD 回填询问

## Anti-patterns

- Auto-launching browser MCP without consent
- Guessing/testing multiple URLs
- UI 执行中途大范围代码分析（应用 Step 2.5 预生成路径）
- Full-suite regression for a one-file logic fix
- Editing TAPD story description to dump test matrices（评论回填即可）
- 自测结束后直接 commit/回填而不询问
`;
}

function normalizeAgentPrefix(agentPrefix = '.ai-agent') {
  return agentPrefix.startsWith('.') || agentPrefix.includes('/') ? agentPrefix : '.ai-agent';
}
