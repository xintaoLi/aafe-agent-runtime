# Skill: Project Architecture Locator

Generated: 2026-08-20T04:10:48.456Z
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

- `src-cli` (28 files, 0 routes) → `modules/src-cli/index.json`
- `src-agent-platform-runtime` (9 files, 0 routes) → `modules/src-agent-platform-runtime/index.json`
- `src-agent-platform-skill-runtime` (7 files, 0 routes) → `modules/src-agent-platform-skill-runtime/index.json`
- `src-static-analysis-analyzers` (6 files, 0 routes) → `modules/src-static-analysis-analyzers/index.json`
- `src-agent-platform-planner` (4 files, 0 routes) → `modules/src-agent-platform-planner/index.json`
- `src-static-analysis` (4 files, 0 routes) → `modules/src-static-analysis/index.json`
- `src-static-analysis-types` (4 files, 0 routes) → `modules/src-static-analysis-types/index.json`
- `src-agent-platform-schema` (3 files, 0 routes) → `modules/src-agent-platform-schema/index.json`
- `src-agents-test-agent` (3 files, 0 routes) → `modules/src-agents-test-agent/index.json`
- `src-memory` (3 files, 0 routes) → `modules/src-memory/index.json`
- `src-agent-platform-orchestrator` (2 files, 0 routes) → `modules/src-agent-platform-orchestrator/index.json`
- `src-agent-platform-protocol` (2 files, 0 routes) → `modules/src-agent-platform-protocol/index.json`
- `src-agent-platform-registry` (2 files, 0 routes) → `modules/src-agent-platform-registry/index.json`
- `src-agent-platform-state` (2 files, 0 routes) → `modules/src-agent-platform-state/index.json`
- `src-agents-code-intelligence` (2 files, 0 routes) → `modules/src-agents-code-intelligence/index.json`
- `src-agents-failure-analyzer` (2 files, 0 routes) → `modules/src-agents-failure-analyzer/index.json`
- `src-agents-impact-analyzer` (2 files, 0 routes) → `modules/src-agents-impact-analyzer/index.json`
- `src-ide-bridge-context` (2 files, 0 routes) → `modules/src-ide-bridge-context/index.json`
- `src-static-analysis-ast` (2 files, 0 routes) → `modules/src-static-analysis-ast/index.json`
- `src-static-analysis-emit` (2 files, 0 routes) → `modules/src-static-analysis-emit/index.json`
- `src-static-analysis-modules` (2 files, 0 routes) → `modules/src-static-analysis-modules/index.json`
- `src-testing` (2 files, 0 routes) → `modules/src-testing/index.json`
- `bin-aafe-js` (1 files, 0 routes) → `modules/bin-aafe-js/index.json`
- `route` (1 files, 1 routes) → `modules/route/index.json`
- `route-ai-agent` (1 files, 1 routes) → `modules/route-ai-agent/index.json`
- `route-ctx-path` (1 files, 2 routes) → `modules/route-ctx-path/index.json`
- `route-package-json` (1 files, 1 routes) → `modules/route-package-json/index.json`
- `route-tests` (1 files, 2 routes) → `modules/route-tests/index.json`
- `src` (1 files, 0 routes) → `modules/src/index.json`
- `src-agent-platform` (1 files, 0 routes) → `modules/src-agent-platform/index.json`
- `src-agent-platform-config` (1 files, 0 routes) → `modules/src-agent-platform-config/index.json`
- `src-agent-platform-policy` (1 files, 0 routes) → `modules/src-agent-platform-policy/index.json`
- `src-agents` (1 files, 0 routes) → `modules/src-agents/index.json`
- `src-agents-context-agent` (1 files, 0 routes) → `modules/src-agents-context-agent/index.json`
- `src-agents-knowledge-validator` (1 files, 0 routes) → `modules/src-agents-knowledge-validator/index.json`
- `src-ddd` (1 files, 0 routes) → `modules/src-ddd/index.json`
- `src-knowledge-graph` (1 files, 0 routes) → `modules/src-knowledge-graph/index.json`
- `src-knowledge-model` (1 files, 0 routes) → `modules/src-knowledge-model/index.json`
- `src-knowledge-report` (1 files, 0 routes) → `modules/src-knowledge-report/index.json`
- `src-knowledge-store` (1 files, 0 routes) → `modules/src-knowledge-store/index.json`

## Context rules

1. Read outer entry files first (`manifest` / `index`).
2. Load only one matched `modules/<id>/index.json` then its `json/` slice.
3. Prefer JSON/JSONL for Agent; open `mmd/` only for humans.
4. Never eagerly read `knowledge/graph/jsonl/`.
5. Re-run `aafe analyze` after major structure changes.
