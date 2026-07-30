export function taskCompletionImpactRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE Task Completion Impact and Test Analysis (${ctx.moduleName ?? 'module'})\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE Task Completion Impact and Test Analysis\nalwaysApply: true\n---';

  return `${header}

# AAFE 任务完成影响分析与测试

## 强制询问（Always）

在**每次任务执行完毕**、准备给出最终回复之前，必须先询问用户：

> 是否需要分析当前任务的影响范围并提供测试参考？

- 不要跳过此询问。
- 若用户在本轮已明确说「不需要 / 否 / No / 跳过」，则仅简要说明可后续补做，不再重复追问。
- 若用户回答 **是 / Yes / 需要 / Y**（或等价确认），立即进入下方完整流程。

## 用户确认后：加载分析依据

1. Read \`${agentPrefix}/skills/architecture-impact-test-forecast.md\`
2. Read \`${agentPrefix}/skills/knowledge-center-architecture.md\` when present
3. Read \`${agentPrefix}/memory/knowledge-center-architecture.md\` when present
4. Read relevant \`.docs\` architecture documents and Mermaid diagrams
5. 基于**当前任务实际变更**（diff / 改动文件）分析，不做与本次无关的泛化堆砌

## 用户确认后：必须输出的三段内容

### 1. 影响范围报告

- **直接影响**：本次改动文件、模块、路由、组件、Store、API、Hooks
- **间接影响**：调用链、依赖方、共享层、数据流下游
- **潜在影响**：权限、缓存、Worker、IndexedDB、兼容路径、降级
- **架构依据**：引用 .docs、Mermaid 图、源码路径

### 2. 最小范围测试用例

根据**本次变更范围**设计最小必要测试集：

- 覆盖主路径、异常路径、边界条件、空值/极值、权限/降级（若相关）
- 涉及请求取消、并发、分页、流式解析时，必须包含对应边界用例
- **依赖数据自行 Mock**（fixture / vi.mock / jest.mock 等），禁止依赖真实 API 或生产数据
- 每个用例包含：ID、优先级（P0/P1/P2）、场景、Mock 要点、步骤、断言、覆盖的分析点

### 3. 测试执行结果

- **运行**可执行的单元/组件测试（Mock 环境下）
- 每个用例标注：**pass / fail / skipped / not_run**
- 禁止声称 pass unless 测试实际运行并通过
- skipped / not_run 必须说明原因（缺框架、无 runner、需 E2E 等）

## 推荐输出结构

\`\`\`markdown
## 影响范围报告
...

## 测试用例
| ID | 优先级 | 场景 | Mock 要点 | 断言 | 覆盖边界 |
...

## 测试执行结果
| ID | 状态 | 命令/方式 | 结果摘要 |
...

## 未覆盖风险与人工确认项
...
\`\`\`
`;
}

export function taskCompletionImpactRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE 任务完成影响分析与测试（Always）',
    '',
    '在每次任务执行完毕、给出最终回复前，必须先询问用户：是否需要分析当前任务的影响范围并提供测试参考？',
    '',
    '若用户确认（是/Yes/需要），则：',
    `1. Read \`${agentPrefix}/skills/architecture-impact-test-forecast.md\` 并按当前任务 diff 执行分析；`,
    '2. 输出影响范围报告（直接/间接/潜在影响 + 架构依据）；',
    '3. 设计最小范围测试用例（Mock 依赖数据，覆盖主路径与边界）；',
    '4. 执行可运行的测试并输出每个用例的 pass/fail/skipped 结果；',
    '5. 列出未覆盖风险。禁止虚假声称测试已通过。',
    ''
  ].join('\n');
}

export function architectureImpactTestForecastSkillContent(agentPrefix = '.ai-agent') {
  const prefix = agentPrefix.startsWith('.') ? agentPrefix : `.ai-agent`;
  return `# Skill: Architecture Impact and Test Forecast

This skill runs after the user confirms they want impact analysis and test references at task completion.

Trigger: user answers **是 / Yes / 需要 / Y** to the mandatory completion question defined in the global AAFE task-completion-impact rule.

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

Required artifacts: \`impact_scope\`, \`architecture_evidence\`

## Step 2 — Minimal test case design

Design the **smallest sufficient** test set for this change only:

| Field | Requirement |
| --- | --- |
| ID | TC-001, TC-002, ... |
| Priority | P0 required path / P1 important edge / P2 regression |
| Scenario | What behavior is verified |
| Mock setup | All external deps mocked; **no real API or prod data** |
| Steps | Arrange → Act → Assert |
| Assertions | Concrete expected outcomes |
| Boundary coverage | Which edge case this case covers |

Must cover when relevant:

- happy path
- validation / empty / null / max boundary
- error and rejection paths
- permission / unauthorized
- cancellation / timeout / concurrent requests
- cache stale / reload / degradation
- Store or API contract changes → dependent UI paths

Required artifact: \`test_cases\`

## Step 3 — Execute tests and report results

- Run unit/component tests where the project test runner exists
- Use Mock/fixtures for API, Store, router, browser APIs
- For each case report: **pass | fail | skipped | not_run**
- Include command or execution method when run
- **Never claim pass without actual execution**

Required artifact: \`test_results\`

## Step 4 — Residual risks

- unverified_risks
- items needing manual QA or E2E
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
### 架构依据
...

## 测试用例
| ID | 优先级 | 场景 | Mock 要点 | 断言 | 覆盖边界 |
...

## 测试执行结果
| ID | 状态 | 命令/方式 | 结果摘要 |
...

## 未覆盖风险
...
\`\`\`

## Rules

- Scope tests to **this task's diff** only; avoid unrelated full-suite regression unless P2 and justified.
- Mock all external I/O; document mock shape in each test case.
- Distinguish **tested / predicted / not covered** explicitly.
- If no automated test is feasible, provide executable manual verification steps and mark not_run with reason.
`;
}
