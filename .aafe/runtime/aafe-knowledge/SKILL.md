# AAFE Knowledge Runtime

Skill / Memory bodies stay in files. SQLite stores metadata, hits, ranking and lifecycle only.

1. LLM decides whether knowledge matched.
2. Runtime records the hit locally.
3. Ranking and aging run without the model.
4. Deletion is always human.

Use `aafe manage ranking`, `aafe manage dormant`, `aafe manage hit <id>`.
