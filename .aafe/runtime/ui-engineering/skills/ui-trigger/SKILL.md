# UI Trigger

## Purpose

Decide whether the request is UI work and which complexity path applies. This skill runs before every other UI skill.

## Decision

enabled | disabled | ambiguous, plus complexity simple | standard | full.

## Rule

Read `rules/ui-trigger.md`. Do not load the rest of this pack when disabled.

## Schema

`.aafe/runtime/ui-engineering/schemas/ui-trigger.schema.json`
