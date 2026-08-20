# Skill: Dataflow On-Demand

Generated: 2026-08-19T03:48:17.413Z
Project: @aafe/agent-runtime

## Purpose

Load dataflow facts **per module**.

## Agent loading protocol

1. `.aafe/index.json` → `.aafe/modules/index.json`
2. `.aafe/modules/<id>/index.json`
3. `.aafe/modules/<id>/json/dataflow.json`
4. Cross-module: `.aafe/knowledge/relations/json/dataflow.json`
5. Human: `.aafe/modules/<id>/mmd/dataflow.mmd`
6. **Forbidden:** dump all flows into context

## Module ids (summary)

- `src-cli`
- `src-runtime`
- `src-analyze-analyzers`
- `src-analyze`
- `src-analyze-types`
- `src-memory`
- `src-analyze-ast`
- `src-analyze-emit`
- `src-analyze-modules`
- `bin-aafe-js`
- `route`
- `route-ai-agent`
- `route-package-json`
- `src`
- `src-analyze-routes`
- `src-analyze-semantic`
- `src-analyze-storage`
- `src-ddd`
- `src-patterns`
- `src-templates`

## Related

- Architecture: `.ai-agent/skills/architecture-on-demand.md`
