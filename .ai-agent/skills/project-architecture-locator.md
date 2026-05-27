# Skill: Project Architecture Locator

Generated: 2026-05-27T09:03:10.878Z
Project: @aafe/agent-runtime
Root: /Users/lixintao/github/aafe-agent-runtime

## Purpose

Use this project-specific skill before reading large source files. It provides a compact map of the main routes, components, modules and design documents so AI agents can locate the right context quickly and avoid wasting context window.

## How to Use

1. Match the user's request to route/module/component keywords below.
2. Read only the listed files that are directly relevant.
3. Use design documents first when the request is architecture or requirement related.
4. Re-run `aafe analyze` after major route, component or architecture changes.

## Project Summary

- Package: @aafe/agent-runtime
- Version: 0.1.4
- Files scanned: 30
- Route entries: 0
- Component entries: 0
- Design docs: 1

## Main Routes

- No route entries detected.

## Main Components

- No component entries detected.

## Main Modules

- `src/cli` (10 files)
- `src/runtime` (7 files)
- `src/memory` (3 files)
- `packages` (1 files)
- `packages/ddd` (1 files)
- `packages/patterns` (1 files)
- `src/ddd` (1 files)
- `src` (1 files)
- `src/patterns` (1 files)
- `src/templates` (1 files)

## Design Documents

- `README.md`: @aafe/agent-runtime — 已实现能力 > 新功能执行链路 > DDD 能力 > DDD CLI > DDD Runtime > 设计模式能力 > CLI > 生成结构

## Context Budget Rules

- Prefer this locator before broad grep/search.
- Read route config first for page-level tasks.
- Read component files only after identifying the owning route/module.
- For design questions, read the listed design docs before implementation files.
