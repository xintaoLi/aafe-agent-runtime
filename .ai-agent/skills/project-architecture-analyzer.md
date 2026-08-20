# Skill: Project Architecture Analyzer

Generate and use a compact project architecture locator before broad source reading.

When to use:
- The user asks where a route, page, component, module or design document is implemented.
- The agent needs to understand a project quickly before editing.
- The project structure has changed and the architecture index may be stale.
- Entry / build-tool / AST-based module maps need refresh.

Command:

```bash
aafe analyze
aafe analyze --docs-out=.ai-agent/.docs
aafe analyze --force
aafe analyze --skip-existing
aafe analyze --llm
```

Generated artifacts:
- .ai-agent/skills/project-architecture-locator.md
- .ai-agent/skills/architecture-on-demand.md
- .ai-agent/skills/dataflow-on-demand.md
- .ai-agent/memory/project-architecture.md
- .ai-agent/.docs/ (entry, architecture, dataflow, facts; on-demand only)

Usage rules:
1. Read project-architecture-locator.md first for route/component/module locating.
2. For deep architecture, use architecture-on-demand.md (index then one module).
3. For dataflow, use dataflow-on-demand.md (index then one module).
4. Read only the files listed as relevant before doing wider search.
5. For human architecture docs / Knowledge Center, still use project `.docs` via `--architecture-docs`.
6. Re-run aafe analyze after large routing, component or module changes.

Required artifacts:
- project_architecture_index
