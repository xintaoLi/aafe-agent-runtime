# Skill: Requirement Intake & Analysis

Trigger: **具体需求已获取**（TAPD 单据内容已拉取，或用户给出可执行的需求描述），且尚未开始写代码。

Rule: `.ai-agent/rules/requirement-intake-analysis.mdc`

Post-implementation (unchanged): `.ai-agent/rules/task-completion-impact.mdc` → `.ai-agent/rules/tapd-submit-backfill.mdc`

## Workflow mode

Read `.aafe.config.json` → `mode.workflow` (default `ask`). See `.ai-agent/skills/workflow-mode.md`.

- `ask`: follow the ask / confirm steps in this skill.
- `autonomous`: decide this skill's gates per that skill; do **not** ask unless Hard Ask. Record the decision.

---

## Phase 0 — Confirm requirement source

| Source | Done when |
| --- | --- |
| TAPD | `stories_get` / `bugs_get` 或用户粘贴：标题、描述、验收、优先级、关联信息 |
| Non-TAPD | 用户消息含：要做什么、期望结果、范围边界（或经 Phase 1 补全） |

Record: `requirement_source`, `requirement_summary`, `tapd_entry_id`（若有）

### Phase 0.5 — TAPD branch association（git 和 gtm 均适用）

若本任务有 TAPD 单：

1. 通过 TAPD MCP 拉取需求详情（`tapd_id_get` → `stories_get` / `bugs_get`），提取 `tapd_short_id`（URL 最后一段数字的末 9 位）
2. `git branch --show-current`：是否匹配 `feat|bug/<slug>/#<short_id>` 且 `short_id` 与 TAPD 单一致
3. **已匹配且一致** → 记录 `tapd_entry_type` / `tapd_entry_id` / `tapd_short_id`，继续 Phase 1
4. **未匹配或不一致** → 按 `.ai-agent/skills/tapd-submit-backfill.md`「TAPD Branch Association」执行：
   - `submit.cli=git`：`git fetch upstream master` → `git checkout -b feat|bug/<slug>/#<short_id> upstream/master`
   - `submit.cli=gtm`：`gtm create issue` → 关联已有单据 → 短 ID → 目标分支 `master` → 按 TAPD 标题生成英文短名建开发分支

无 TAPD 单时跳过本小节。

---

## Phase 1 — Analyze & clarify (mandatory)

### 1.1 Parse

Extract:

- **Goal** — user-visible outcome
- **Scope** — in / out
- **Acceptance** — how to verify done
- **Constraints** — perf, compat, auth, deadline
- **Dependencies** — API, other modules, flags

### 1.2 Ambiguity register

For each unclear item, create `AMB-001`… with:

| Field | Content |
| --- | --- |
| Topic | What's unclear |
| Risk if guessed | Wrong fix cost |
| Resolution type | `choice` \| `question` \| `detail_needed` |

### 1.3 Resolution

**ask mode** — Interactive resolution (mandatory):

**choice** — present 2–4 options + recommendation:

```markdown
### AMB-001: （主题）
请选择：
- **A** …（推荐：…）
- **B** …
- **C** …
```

**question** — numbered precise questions.

**detail_needed** — ask for example, screenshot, API contract, edge case list.

**autonomous mode** — Close AMB if TAPD / code / history can infer it with high confidence; record `assumption`. If it would change the solution and cannot be inferred → Hard Ask (stop). Do not invent product requirements.

**Hard:** `ambiguity_register` 非空且未关闭 → **stop**；不得进入 Phase 2。

Close each AMB with `resolution` text in output.

---

## Phase 2 — Historical accumulation search

**Only after** all AMB closed.

1. Read `.ai-agent/skills/memory-recaller.md`
2. Search:
   - `.ai-agent/memory/experience.md`
   - `.ai-agent/memory/learnings.jsonl`
   - `.ai-agent/memory/decisions.md`, topic files if relevant
   - Optional: `.docs`, TAPD comments (MCP)

Output `history_hits`:

| Hit | Source | Summary | Reuse? |
| --- | --- | --- | --- |
| H-001 | experience.md | … | full / partial / none |

If **full reuse** possible: `ask` 先确认再跳过新设计；`autonomous` 证据充分则直接复用并记录判定。

---

## Phase 3 — Code scope & root cause

After history review:

### 3.1 Code scope

- List files / symbols likely touched (use `project-architecture-locator.md` when needed)
- Mark read-only vs must-change
- Artifact: `code_scope`

### 3.2 Root cause (bugs / defects)

```text
Symptom → Immediate cause → Root cause hypothesis → How to verify
```

Artifact: `root_cause_analysis`

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

Affirmative: `确认` / `同意` / `Yes` / `是` / `Y` / `切换plan` / `好`

**Action:** invoke **SwitchMode** with `target_mode_id: "plan"`. In Plan:

- Module boundaries, step order, file list, risks, test hooks
- Get user approval before returning to Agent for code

If user declines Plan: document risk; may proceed in Agent with explicit `plan_skipped: true`.

**autonomous mode** — Do not wait for chat yes/no. Invoke **SwitchMode** when large. If SwitchMode is unavailable, proceed in Agent with `plan_skipped: true` and document risk. Record the decision per `workflow-mode.md`.

---

## Phase 5 — Implement

- Small: implement immediately
- Large + approved plan: follow plan steps
- Non-trivial frontend: then `.ai-agent/runtime/engine.md`, router, pipelines, gates as usual

**Do not** run task-completion-impact / TAPD backfill here — those run **after** implementation complete.

---

## Output template (end of intake, before code)

```markdown
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

## 根因分析
...

## 规模评估
functions: n, files: m, new_lines: L → direct | plan (user: yes/no)

## 下一步
direct fix | plan mode | blocked (waiting user)
```

---

## Anti-patterns

- Coding with open AMB items
- Skipping history on recurring bug classes
- >5 files change without plan ask (ask mode) or without a recorded autonomous decision
- Confusing this skill with post-task impact analysis (`architecture-impact-test-forecast.md`)
