/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

function normalizeAgentPrefix(agentPrefix = '.ai-agent') {
  return agentPrefix.startsWith('.') || agentPrefix.includes('/') ? agentPrefix : '.ai-agent';
}

export function workflowModePointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleName = ctx.moduleName ?? 'module';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE Workflow Mode (${moduleName}) — ask vs autonomous gates\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE Workflow Mode — ask vs autonomous gates\nalwaysApply: true\n---';

  return `${header}

# AAFE 全局工作流模式（Pointer）

Source of truth:

1. Config: \`.aafe.config.json\` → \`mode.workflow\`（缺省 \`ask\`）
2. Rule: \`${agentPrefix}/rules/workflow-mode.mdc\`
3. Skill: \`${agentPrefix}/skills/workflow-mode.md\`

**先读配置再走门禁。** \`ask\` 保持向用户确认；\`autonomous\` 由 LLM 按 Skill 判定表决定是否进入下一步（Commit / PR / 回填 / Plan / 影响分析），仅 Hard Ask 才停下来问。

\`aafe init\` / \`aafe update --workflow-mode=ask|autonomous\` 可写入。Do not duplicate project knowledge here.
`;
}

export function workflowModeProjectRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: 全局工作流模式：询问模式保持门禁确认；自主判断模式由 LLM 判定是否进入下一步。
alwaysApply: true
---

${workflowModeProjectRuleBody(agentPrefix)}
`;
}

function workflowModeProjectRuleBody(agentPrefix = '.ai-agent') {
  return `# Workflow Mode（Ask vs Autonomous）

## 读取配置（每个任务开始、第一次门禁前）

读 \`.aafe.config.json\` → \`mode.workflow\`：

| 值 | 名称 | 行为 |
| --- | --- | --- |
| \`ask\`（缺省） | 询问模式 | 各环节 / 门禁向用户确认后再继续 |
| \`autonomous\` | 自主判断模式 | LLM 按 \`${agentPrefix}/skills/workflow-mode.md\` 判定是否进入下一步 |

非法值按 \`ask\`。写入：\`aafe init\` / \`aafe update --workflow-mode=ask|autonomous\`。

详细判定表与 Hard Ask：\`${agentPrefix}/skills/workflow-mode.md\`。

## 询问模式

保持现有协议：需求澄清、Plan 切换、影响分析、Commit、PR、TAPD 回填等均通过询问反馈执行。

## 自主判断模式

- **不是**跳过所有确认、也**不是**无条件全做。
- LLM 根据证据判定 \`proceed\` / \`skip\` / \`ask\`。
- 每次门禁必须输出简短**判定记录**（门禁 / 判定 / 依据）。
- Hard Ask 仍必须停下来问：缺失只有用户能提供的事实（测试 URL、不可推断的 TAPD ID、产品歧义）。
- 禁止事项不变：force push、跳过 hook、伪造测试、无 TAPD 关联时回填、猜 URL。

## 与其它 Rule 的关系

本 Rule 约束**交互方式**。需求澄清、自测、Commit/PR/回填的业务条件仍分别见：

- \`${agentPrefix}/rules/requirement-intake-analysis.mdc\`
- \`${agentPrefix}/rules/task-completion-impact.mdc\`
- \`${agentPrefix}/rules/tapd-submit-backfill.mdc\`
`;
}

export function workflowModeGatePreamble(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `## 全局工作流模式

先读 \`.aafe.config.json\` → \`mode.workflow\`（缺省 \`ask\`）。详见 \`${prefix}/skills/workflow-mode.md\`。

| 值 | 行为 |
| --- | --- |
| \`ask\` | 询问模式：各门禁向用户确认后再继续 |
| \`autonomous\` | 自主判断模式：LLM 按判定表决定是否进入下一步；仅 Hard Ask 才停下来问 |

\`aafe init\` / \`aafe update --workflow-mode=ask|autonomous\` 可写入。`;
}

export function workflowModeSkillNote(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `## Workflow mode

Read \`.aafe.config.json\` → \`mode.workflow\` (default \`ask\`). See \`${prefix}/skills/workflow-mode.md\`.

- \`ask\`: follow the ask / confirm steps in this skill.
- \`autonomous\`: decide this skill's gates per that skill; do **not** ask unless Hard Ask. Record the decision.`;
}

export function workflowModeRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE 全局工作流模式',
    '',
    '每个任务第一次门禁前，读 `.aafe.config.json` → `mode.workflow`（缺省 `ask`）：',
    '- `ask`：询问模式，各环节向用户确认后再继续。',
    '- `autonomous`：自主判断模式，LLM 按判定表决定是否 Commit / PR / 回填 / Plan / 影响分析；仅 Hard Ask（缺失用户独有事实）才停下来问。',
    `详见 \`${agentPrefix}/skills/workflow-mode.md\`。可用 \`aafe update --workflow-mode=ask|autonomous\` 切换。`,
    ''
  ].join('\n');
}

export function workflowModeSkillContent(agentPrefix = '.ai-agent') {
  const prefix = normalizeAgentPrefix(agentPrefix);
  return `# Skill: Workflow Mode（Ask vs Autonomous）

Trigger: **每个任务第一次交互门禁之前**（需求澄清、Plan 切换、影响分析、自测 URL、Commit、PR、TAPD 回填）。

Companions:

- Rule: \`${prefix}/rules/workflow-mode.mdc\`
- Config: \`.aafe.config.json\` → \`mode.workflow\`
- Downstream: \`${prefix}/skills/requirement-intake-analysis.md\`、\`${prefix}/skills/architecture-impact-test-forecast.md\`、\`${prefix}/skills/minimal-convergent-self-test.md\`、\`${prefix}/skills/tapd-submit-backfill.md\`

Update: \`aafe update --workflow-mode=ask|autonomous\`

---

## 1. Read config

\`\`\`text
.aafe.config.json → mode.workflow
\`\`\`

| 值 | 名称 | 默认 |
| --- | --- | --- |
| \`ask\` | 询问模式 | 是（缺省 / 非法值） |
| \`autonomous\` | 自主判断模式 | 否 |

Aliases accepted by CLI: \`inquire\` / \`interactive\` / \`询问模式\` → \`ask\`；\`auto\` / \`judge\` / \`自主判断模式\` → \`autonomous\`.

If the file is missing or \`mode\` is absent → treat as \`ask\`.

---

## 2. Ask mode（询问模式）

Keep current AAFE protocol. Do **not** auto-advance gates.

| Gate | Action |
| --- | --- |
| Requirement AMB | 必须交互，未关闭禁止写代码 |
| History full-reuse | 先确认再跳过新设计 |
| Plan sizing | 大规模必须询问是否 SwitchMode |
| Impact / self-test | 代码变更后询问是否分析影响 |
| E2E URL | 缺地址则询问并等待 |
| Commit | 询问是否 Commit |
| PR | 随 Commit 同意后尝试；失败不阻断 |
| TAPD backfill | 仅有关联 TAPD 时询问 |

User yes/no words stay as defined in the downstream skills.

---

## 3. Autonomous mode（自主判断模式）

LLM **judges** each gate: \`proceed\` / \`skip\` / \`ask\`.

This is **not** "always do everything" and **not** "never talk to the user".

### 3.1 Output a decision record（mandatory）

Before acting on a gate, emit:

\`\`\`markdown
## 自主判定
| 门禁 | 判定 | 依据 |
| impact | proceed | 代码变更且非纯文档 |
| commit | proceed | 有相关 diff、无 secret、自测已完成或已标注 skipped |
| pr | skip | 当前在 main / 无独立功能分支 |
| tapd_backfill | skip | 无 TAPD 关联 |
\`\`\`

Keep it short. Do not hide the decision.

### 3.2 Decision table

| Gate | \`proceed\` when | \`skip\` when | \`ask\` (Hard Ask) when |
| --- | --- | --- | --- |
| Requirement AMB | 能从 TAPD / 代码 / 历史 **高置信** 推断，并写下 assumption | 该项不影响方案 | 会改变方案且无法推断（产品选择、未定义边界） |
| History reuse | full reuse 且命中证据充分 | 无命中或差异大，走新设计 | 复用会改外部契约且证据不足 |
| Plan sizing | 小改 → 直接实施；大改 → 调用 SwitchMode（无需再问 chat yes/no） | — | 规模临界且缺少阶段 C 证据 |
| Impact analysis | 任务涉及可执行代码变更 | 纯文档 / 问答 / Review-only | — |
| Self-test | 已做 impact，或用户已跳过但仍要提交 | 无代码变更 | — |
| E2E / 测试 URL | 用户消息或本次会话已给出完整 URL | \`primary: unit\` → E2E \`NOT_APPLICABLE\` | 要 \`--run\` 但没有本次 URL |
| Browser MCP | E2E blocked 且仍需看 UI，且已有 \`ui_test_paths\` + URL | E2E 已跑或无 UI 影响 | 缺 URL |
| Commit | 有相关代码/配置 diff；无 secret；自测完成或 \`self_test=skipped\`；用户未禁止提交 | 无变更 / 仅生成噪声 / 用户说不要 commit | — |
| PR | Commit 成功；分支不是 \`main\`/\`master\`；有 remote；变更值得评审 | 已有 PR / 在主干 / 无 remote / 纯本地试验 | — |
| TAPD backfill | 有关联 TAPD **且** \`tapd.enabled\` **且** 有处理结果/影响/自测产物（或 skipped 标注） | 无 TAPD 关联 / \`tapd.enabled !== true\` | 有关联但 entry_id 无法从会话/分支/URL 解析 |

### 3.3 Hard Ask（自主模式仍必须停）

以下情况 **禁止猜测**，必须问用户并等待：

1. 要执行 E2E / 浏览器但没有本次完整页面 URL（禁止 \`http://localhost:8080\` 占位）
2. 回填需要 TAPD ID，且会话、分支 \`#id\`、用户消息都解析不到
3. 需求 AMB 会实质改变方案，且 TAPD/代码/历史无法闭合
4. 用户本轮已明确说「先别提交 / 先别 PR / 等我确认 / 不要回填」
5. 需要密钥、账号、不可逆破坏性操作（这类本来就禁止自动做）

Hard Ask 时输出 \`blocked (waiting user)\`，不要假装已判定 \`proceed\`。

### 3.4 Still forbidden（两种模式相同）

- force push、跳过 hook、擅自 amend（除非用户规则允许）
- 伪造测试 / MCP / 自测通过
- 无 TAPD 关联时询问或执行回填、新建单、索取 \`workspace_id\`
- 回填改写 \`description\` / \`test_focus\`
- 自动把 TAPD 状态推到 \`for_test\` / \`status_done\`
- 编造 \`--bug=\` / \`--story=\` ID

### 3.5 How to execute after \`proceed\`

Do **not** invent a parallel protocol. After deciding \`proceed\`, run the **same** downstream skill steps as if the user said yes:

| Gate | Then follow |
| --- | --- |
| Impact | \`${prefix}/skills/architecture-impact-test-forecast.md\` |
| Self-test | \`${prefix}/skills/minimal-convergent-self-test.md\` |
| Commit / PR / backfill | \`${prefix}/skills/tapd-submit-backfill.md\` Phase C/D/F |
| Plan | \`SwitchMode\` \`target_mode_id: plan\`，再输出分步计划 |

After \`skip\`, say so once and continue the remaining gates (e.g. skip Commit still evaluate TAPD backfill if associated).

---

## 4. Session override

If the user says in this turn「用询问模式 / 先问我 / 不要自动提交」→ treat remaining gates as \`ask\` for this task only; do not rewrite \`.aafe.config.json\`.

If the user says「按自主判断继续 / 你自己决定」→ treat remaining gates as \`autonomous\` for this task only.

To persist: \`aafe update --workflow-mode=ask|autonomous\`.

---

## 5. Anti-patterns

- 配了 \`autonomous\` 仍机械逐项询问（除非 Hard Ask）
- 配了 \`ask\` 却静默 Commit / PR / 回填
- 自主模式不写判定记录
- 把「自主」理解成跳过自测或跳过 TAPD 关联检查
- 用自主模式发明 URL、TAPD ID 或产品需求
`;
}

export function workflowModeSkill(agentPrefix = '.ai-agent') {
  return workflowModeSkillContent(agentPrefix);
}
