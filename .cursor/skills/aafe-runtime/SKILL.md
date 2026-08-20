---
name: aafe-runtime
description: Use the AAFE project runtime for architecture-aware frontend work. Read the generated skill index first, then load only matching project skills on demand.
---

# AAFE Runtime (Cursor)

1. Read `.ai-agent/skill-index.md` first.
2. Read `.ai-agent/project.md` when present.
3. Load only the matching `.ai-agent/project-skills/<domain>/SKILL.md`.
4. For non-trivial work, follow `.ai-agent/runtime/engine.md`, `.ai-agent/runtime/router.yaml` and the selected pipeline.
5. Preserve successful decisions and reusable solutions in `.ai-agent/memory/`.

The project `.ai-agent/` directory is the single source of truth; this file is only the editor discovery entry.
