# AAFE Analysis Knowledge

Output: `.aafe`
Formats: json, jsonl, md, mmd

## Agent entry (read first)

1. `.aafe/manifest.json`
2. `.aafe/index.json`
3. `.aafe/modules/index.json` → one `modules/<id>/index.json`

Do **not** scan the whole tree.

## Layout

```text
.aafe/
  manifest.json      # root entry
  index.json         # compact agent index
  README.md          # human entry
  knowledge/         # global domains (json / jsonl / mmd / md)
  modules/           # per-module slices
    <id>/
      index.json     # module agent entry
      json/          # agent
      mmd/           # human
```

## Stats

- Files: 168
- Modules: 53
- Symbols: 38
- Dependencies: 85
- Data flows: 1008
- Features: 8
- Business candidates: 8
- LLM: disabled

## Modules

- [`src-cli`](modules/src-cli/README.md) — routes 0, components 1
- [`src-agent-platform-runtime`](modules/src-agent-platform-runtime/README.md) — routes 0, components 2
- [`src-testing-e2e`](modules/src-testing-e2e/README.md) — routes 0, components 3
- [`src-agent-platform-skill-runtime`](modules/src-agent-platform-skill-runtime/README.md) — routes 0, components 2
- [`src-patterns`](modules/src-patterns/README.md) — routes 0, components 4
- [`src-static-analysis-analyzers`](modules/src-static-analysis-analyzers/README.md) — routes 0, components 0
- [`src-agent-platform-planner`](modules/src-agent-platform-planner/README.md) — routes 0, components 2
- [`src-static-analysis`](modules/src-static-analysis/README.md) — routes 0, components 0
- [`src-static-analysis-types`](modules/src-static-analysis-types/README.md) — routes 0, components 0
- [`src-agent-platform-schema`](modules/src-agent-platform-schema/README.md) — routes 0, components 2
- [`src-agents-test-agent`](modules/src-agents-test-agent/README.md) — routes 0, components 0
- [`src-ddd`](modules/src-ddd/README.md) — routes 0, components 4
- [`src-memory`](modules/src-memory/README.md) — routes 0, components 0
- [`src-agent-platform-orchestrator`](modules/src-agent-platform-orchestrator/README.md) — routes 0, components 1
- [`src-agent-platform-protocol`](modules/src-agent-platform-protocol/README.md) — routes 0, components 1
- [`src-agent-platform-registry`](modules/src-agent-platform-registry/README.md) — routes 0, components 3
- [`src-agent-platform-state`](modules/src-agent-platform-state/README.md) — routes 0, components 0
- [`src-agents-code-intelligence`](modules/src-agents-code-intelligence/README.md) — routes 0, components 1
- [`src-agents-failure-analyzer`](modules/src-agents-failure-analyzer/README.md) — routes 0, components 1
- [`src-agents-impact-analyzer`](modules/src-agents-impact-analyzer/README.md) — routes 0, components 0
- [`src-ide-bridge-context`](modules/src-ide-bridge-context/README.md) — routes 0, components 1
- [`src-static-analysis-ast`](modules/src-static-analysis-ast/README.md) — routes 0, components 0
- [`src-static-analysis-emit`](modules/src-static-analysis-emit/README.md) — routes 0, components 0
- [`src-static-analysis-modules`](modules/src-static-analysis-modules/README.md) — routes 0, components 0
- [`src-testing`](modules/src-testing/README.md) — routes 0, components 0
- [`bin-aafe-js`](modules/bin-aafe-js/README.md) — routes 0, components 0
- [`route`](modules/route/README.md) — routes 1, components 0
- [`route-aafe`](modules/route-aafe/README.md) — routes 1, components 0
- [`route-ai-agent`](modules/route-ai-agent/README.md) — routes 1, components 0
- [`route-casesdir`](modules/route-casesdir/README.md) — routes 1, components 0
- [`route-ctx-path`](modules/route-ctx-path/README.md) — routes 2, components 0
- [`route-package-json`](modules/route-package-json/README.md) — routes 1, components 0
- [`route-tests`](modules/route-tests/README.md) — routes 1, components 0
- [`src`](modules/src/README.md) — routes 0, components 0
- [`src-agent-platform`](modules/src-agent-platform/README.md) — routes 0, components 0
- [`src-agent-platform-config`](modules/src-agent-platform-config/README.md) — routes 0, components 2
- [`src-agent-platform-policy`](modules/src-agent-platform-policy/README.md) — routes 0, components 1
- [`src-agents`](modules/src-agents/README.md) — routes 0, components 0
- [`src-agents-context-agent`](modules/src-agents-context-agent/README.md) — routes 0, components 0
- [`src-agents-knowledge-validator`](modules/src-agents-knowledge-validator/README.md) — routes 0, components 0
