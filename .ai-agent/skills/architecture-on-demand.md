# Skill: Architecture On-Demand

Generated: 2026-08-19T03:48:17.413Z
Project: @aafe/agent-runtime

## Purpose

Load architecture facts **per module** without scanning the whole tree.

## Agent loading protocol

1. `.aafe/manifest.json`
2. `.aafe/index.json`
3. `.aafe/modules/index.json` → pick one module id
4. `.aafe/modules/<id>/index.json` (module entry)
5. Only then open `.aafe/modules/<id>/json/architecture.json` / `routes.json` / `components.json`
6. Human diagrams (optional): `.aafe/modules/<id>/mmd/`
7. **Forbidden:** eagerly open every module or `knowledge/graph/jsonl/`

## Module ids (summary)

- `src-cli` (27 files)
- `src-runtime` (7 files)
- `src-analyze-analyzers` (6 files)
- `src-analyze` (4 files)
- `src-analyze-types` (4 files)
- `src-memory` (3 files)
- `src-analyze-ast` (2 files)
- `src-analyze-emit` (2 files)
- `src-analyze-modules` (2 files)
- `bin-aafe-js` (1 files)
- `route` (1 files)
- `route-ai-agent` (1 files)
- `route-package-json` (1 files)
- `src` (1 files)
- `src-analyze-routes` (1 files)
- `src-analyze-semantic` (1 files)
- `src-analyze-storage` (1 files)
- `src-ddd` (1 files)
- `src-patterns` (1 files)
- `src-templates` (1 files)

## Related

- Locator: `.ai-agent/skills/project-architecture-locator.md`
- Dataflow: `.ai-agent/skills/dataflow-on-demand.md`
