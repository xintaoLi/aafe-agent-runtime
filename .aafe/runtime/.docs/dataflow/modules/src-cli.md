# Dataflow · src-cli

## Summary

- Routes: —
- Data hints: —

## Flow edges

- `file:src/cli/memory.js` -[file-to-import]-> `import:../memory/MemoryStore.js`

## Agent rules

- Load this file only for the matched module.
- Treat edges as facts for impact analysis; verify against current source when conflicting.
- Reserved LLM enrichment can refine narratives later via `.ai-agent/.docs/llm/`.
