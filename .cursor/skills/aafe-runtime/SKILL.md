---
name: aafe-runtime
description: Use the AAFE project runtime for architecture-aware frontend work. Read the generated skill index first, then load only matching project skills on demand.
---

# AAFE Runtime (Cursor)

1. Read `.ai-agent/skill-index.md` first and follow **Task Spine**.
2. Read `.ai-agent/project.md` when present.
3. Load only the matching `.ai-agent/project-skills/<domain>/SKILL.md`.
4. Follow `.ai-agent/skill-index.md` **Task Spine** as a dynamic decision chain: [1] 需求/分支判定（TAPD ID 不匹配且用户未确认当前分支可用时必须继续切换/创建分支）→ [2] 执行判定 → [3] 影响/自测判定 → [4] 提交/PR/MR/回填判定。
5. For non-trivial work, follow `.ai-agent/runtime/engine.md`, `.ai-agent/runtime/router.yaml` and the selected pipeline.
6. Preserve successful decisions and reusable solutions in `.ai-agent/memory/`.

The project `.ai-agent/` directory is the single source of truth; this file is only the editor discovery entry.
