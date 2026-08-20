# Skill: Knowledge Center Architecture Context

Generated: 2026-08-19T03:22:15.379Z
Project: @aafe/agent-runtime

## Purpose

Use the existing architecture documents and Mermaid diagrams as the first context for AI project management. Do not build a separate deep documentation site or invent domain entities not present in the project.

## Sources

- `.docs/aafe-generated/README.md` [architecture-doc] Knowledge Center Generated Index
- `.docs/aafe-generated/业务关系与数据流.md` [architecture-doc] 业务关系与数据流
- `.docs/aafe-generated/影响范围与测试预测.md` [architecture-doc] 影响范围与测试预测
- `.docs/aafe-generated/组件关系.md` [architecture-doc] 组件关系

## Analyze docs (AST)

- `.ai-agent/.docs/index.md` — entry + architecture/dataflow indexes (on-demand)

## Execution Rules

1. Read the relevant source document and diagram before planning a task.
2. Map requested changes to modules, routes, stores, APIs, workers, storage and tests.
3. Use architecture diagrams as relationship and flow evidence.
4. Prefer current code when documentation conflicts and record the conflict.
5. Before publishing knowledge, include source paths, commit/version, confidence and review status.
6. For changes to streaming, parsing, pagination, cancellation, cache or IndexedDB, calculate downstream impact and minimum verification paths.
