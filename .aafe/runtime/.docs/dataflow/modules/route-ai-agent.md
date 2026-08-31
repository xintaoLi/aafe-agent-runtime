# Dataflow · route-ai-agent

## Summary

- Routes: .ai-agent/memory
- Data hints: —

## Flow edges

- `route:.ai-agent/memory` -[route-to-file]-> `file:src/cli/bootstrap.js`

## Agent rules

- Load this file only for the matched module.
- Treat edges as facts for impact analysis; verify against current source when conflicting.
- Reserved LLM enrichment can refine narratives later via `.ai-agent/.docs/llm/`.
