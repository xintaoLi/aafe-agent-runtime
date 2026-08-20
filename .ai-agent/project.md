# Project Knowledge · @aafe/agent-runtime

This file is **project-owned**. `aafe init` / `aafe update` create it only when missing and will not overwrite edits.

## Quick Map

- Framework: `generic`
- Runtime: `.ai-agent/`
- Analyze output: see `.aafe.config.json` → `analyze.output` (default `.aafe/`)
- Human architecture docs: `.docs/` (Knowledge Center source)

## How to Use Project Skills

1. Read `.ai-agent/skill-index.md` first.
2. Read this file for project-specific routing.
3. Load only the matching `.ai-agent/project-skills/<domain>/SKILL.md`:
   - architecture → routes / modules / boundaries
   - components → UI / Vue / React components
   - api-services → request / API / adapters
   - coding-patterns → conventions / lint / tests
   - self-update → how to grow project skills after changes
4. For deep static facts after `aafe analyze`, use on-demand architecture/dataflow skills against the configured analyze output.

## Domain Routing Hints

| Task keywords | Domain skill |
| --- | --- |
| route, page, module, boundary, map | architecture |
| component, UI, props, emit | components |
| api, request, service, axios, fetch | api-services |
| lint, convention, test pattern | coding-patterns |
| update skill docs, refresh knowledge | self-update |

## Ownership

- Generated / refreshed by package: `skill-index.md`, `runtime/**`, `pipelines/**`, editor adapters
- Project-owned (preserved): `project.md`, `project-skills/**`, `rules/**`, `memory/**`
