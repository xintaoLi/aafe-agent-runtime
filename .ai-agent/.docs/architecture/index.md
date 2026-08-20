# Architecture Index

Generated: 2026-08-19T03:22:15.379Z
Project: @aafe/agent-runtime

## How to use (on-demand)

1. Read this index to match the task to a module id.
2. Load **only** `.ai-agent/.docs/architecture/modules/<module-id>.md` for hit modules.
3. Do **not** read every module file in one pass.
4. For data flow, use `.ai-agent/skills/dataflow-on-demand.md`.

## Entry & Build

- Build tool: `node-package`
- Framework hint: `node`
- Entries:
  - `bin/aafe.js` (package.json#bin)
  - `src/index.js` (package.json#exports.)

## Modules (17) · Routes 2

- [`src-cli`](modules/src-cli.md) — 27 files, 0 routes, depends: src-analyze, src-analyze-architecture, src-analyze-dataflow, src-analyze-llm, src-analyze-modules, src-analyze-routes, src-ddd, src-memory, src-patterns, src-runtime, src-templates
- [`src-runtime`](modules/src-runtime.md) — 7 files, 0 routes, depends: src-ddd, src-memory, src-patterns
- [`src-analyze`](modules/src-analyze.md) — 3 files, 0 routes, depends: —
- [`src-memory`](modules/src-memory.md) — 3 files, 0 routes, depends: —
- [`src-analyze-ast`](modules/src-analyze-ast.md) — 2 files, 0 routes, depends: —
- [`bin-aafe-js`](modules/bin-aafe-js.md) — 1 files, 0 routes, depends: src-cli
- [`route`](modules/route.md) — 1 files, 1 routes, depends: —
- [`route-ai-agent`](modules/route-ai-agent.md) — 1 files, 1 routes, depends: —
- [`src`](modules/src.md) — 1 files, 0 routes, depends: —
- [`src-analyze-architecture`](modules/src-analyze-architecture.md) — 1 files, 0 routes, depends: —
- [`src-analyze-dataflow`](modules/src-analyze-dataflow.md) — 1 files, 0 routes, depends: —
- [`src-analyze-llm`](modules/src-analyze-llm.md) — 1 files, 0 routes, depends: —
- [`src-analyze-modules`](modules/src-analyze-modules.md) — 1 files, 0 routes, depends: —
- [`src-analyze-routes`](modules/src-analyze-routes.md) — 1 files, 0 routes, depends: src-analyze-ast
- [`src-ddd`](modules/src-ddd.md) — 1 files, 0 routes, depends: —
- [`src-patterns`](modules/src-patterns.md) — 1 files, 0 routes, depends: —
- [`src-templates`](modules/src-templates.md) — 1 files, 0 routes, depends: —
