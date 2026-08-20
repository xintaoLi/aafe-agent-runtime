# Skill: Architecture On-Demand

Use after `aafe analyze` has written the configured output directory (default `.aafe`).

When to use:
- Need module boundaries, owned routes, or key files for a feature area
- Avoid loading the full architecture dump

Protocol:
1. Read `<analyze.output>/manifest.json` and `architecture/index.md`
2. Load only matching slices from `architecture/analysis.json`
3. Never eagerly read all graph JSONL

Command:

```bash
aafe analyze --output=.aafe
```
