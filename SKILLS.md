# Downloadable Agent SKILLS

This directory publishes AAFE Agent Skills that can be downloaded directly from GitHub and installed into any compatible Agent Skills directory.

This is only for the **Agent SKILLS download** use case. If a project wants to use `@aafe/agent-runtime` inside its own repository, install the npm package and use the CLI (`init`, `update`, `analyze`, `doctor`) instead.

## Usage boundary

| Goal | Use | Writes to |
| --- | --- | --- |
| Add AAFE collaboration capabilities to an Agent / AI tool | GitHub SKILLS download | Target Agent Skills directory |
| Initialize or update AAFE Runtime inside a business project | npm package + CLI | Project `.ai-agent/`, `.aafe.config.json`, editor config |

Do not use `aafe skills install` as a replacement for project `aafe init/update/analyze`.
Do not use project `aafe update` as a replacement for downloading Agent SKILLS.

## Manifest

```txt
https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/manifest.json
```

## Current published skills

- `aafe-vue-complex-runtime`
  - Source: `skills/aafe-vue-complex-runtime/SKILL.md`
  - Default target: `$SIBOOT_WORKSPACE_PATH/skills/aafe-vue-complex-runtime/SKILL.md`
- `knowledge-center`
  - Source: `skills/knowledge-center/SKILL.md`
  - Default target: `$SIBOOT_WORKSPACE_PATH/skills/knowledge-center/SKILL.md`
  - Provides project Knowledge CMS installation, code knowledge scanning, graph relations, AI search, impact analysis, Memory integration and automatic synchronization guidance.

Custom target: any compatible Agent Skills directory.

## Install into an Agent Skills directory

Using AAFE CLI:

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github
```

Preview only:

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github --dry-run
```

Specify target skills directory manually:

```bash
npx --yes @aafe/agent-runtime@latest skills install aafe-vue-complex-runtime --github --target="/path/to/agent/skills"
```

## Direct download fallback

```bash
mkdir -p "/path/to/agent/skills/aafe-vue-complex-runtime"
curl -L "https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/aafe-vue-complex-runtime/SKILL.md" \
  -o "/path/to/agent/skills/aafe-vue-complex-runtime/SKILL.md"
```

The install operation is idempotent: if the target `SKILL.md` already has the same content, it is left unchanged.
