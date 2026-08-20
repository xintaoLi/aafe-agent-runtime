# Skill: Project Architecture Locator

Generated: 2026-08-19T03:48:17.413Z
Project: @aafe/agent-runtime

## Purpose

Locate routes/modules quickly, then deep-dive via on-demand skills against `.aafe`.

## Analysis output (configurable)

Outer Agent entry (read first):
- `.aafe/manifest.json`
- `.aafe/index.json`
- `.aafe/modules/index.json`

Then one module:
- `.aafe/modules/<id>/index.json`
- Agent: `.aafe/modules/<id>/json/`
- Human: `.aafe/modules/<id>/mmd/`

Global knowledge (on demand only): `.aafe/knowledge/`

## Entries

- `bin/aafe.js` (package.json#bin)
- `src/index.js` (package.json#exports.)

## Modules

- `src-cli` (27 files, 0 routes) → `modules/src-cli/index.json`
- `src-runtime` (7 files, 0 routes) → `modules/src-runtime/index.json`
- `src-analyze-analyzers` (6 files, 0 routes) → `modules/src-analyze-analyzers/index.json`
- `src-analyze` (4 files, 0 routes) → `modules/src-analyze/index.json`
- `src-analyze-types` (4 files, 0 routes) → `modules/src-analyze-types/index.json`
- `src-memory` (3 files, 0 routes) → `modules/src-memory/index.json`
- `src-analyze-ast` (2 files, 0 routes) → `modules/src-analyze-ast/index.json`
- `src-analyze-emit` (2 files, 0 routes) → `modules/src-analyze-emit/index.json`
- `src-analyze-modules` (2 files, 0 routes) → `modules/src-analyze-modules/index.json`
- `bin-aafe-js` (1 files, 0 routes) → `modules/bin-aafe-js/index.json`
- `route` (1 files, 1 routes) → `modules/route/index.json`
- `route-ai-agent` (1 files, 1 routes) → `modules/route-ai-agent/index.json`
- `route-package-json` (1 files, 1 routes) → `modules/route-package-json/index.json`
- `src` (1 files, 0 routes) → `modules/src/index.json`
- `src-analyze-routes` (1 files, 0 routes) → `modules/src-analyze-routes/index.json`
- `src-analyze-semantic` (1 files, 0 routes) → `modules/src-analyze-semantic/index.json`
- `src-analyze-storage` (1 files, 0 routes) → `modules/src-analyze-storage/index.json`
- `src-ddd` (1 files, 0 routes) → `modules/src-ddd/index.json`
- `src-patterns` (1 files, 0 routes) → `modules/src-patterns/index.json`
- `src-templates` (1 files, 0 routes) → `modules/src-templates/index.json`

## Context rules

1. Read outer entry files first (`manifest` / `index`).
2. Load only one matched `modules/<id>/index.json` then its `json/` slice.
3. Prefer JSON/JSONL for Agent; open `mmd/` only for humans.
4. Never eagerly read `knowledge/graph/jsonl/`.
5. Re-run `aafe analyze` after major structure changes.
