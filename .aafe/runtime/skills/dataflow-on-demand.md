# Skill: Dataflow On-Demand

Use after `aafe analyze` has written the configured output directory (default `.aafe`).

When to use:
- Tracing route → page → store/API/hooks flow for one module
- Impact analysis that needs data edges without full-repo scan

Protocol:
1. Read `<analyze.output>/dataflow/index.md`
2. Load only needed flows from `dataflow/analysis.json`
3. Use evidence to jump back to source files

Command:

```bash
aafe analyze --output=.aafe
```
