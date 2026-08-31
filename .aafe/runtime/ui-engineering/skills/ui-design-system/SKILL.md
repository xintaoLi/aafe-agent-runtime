# UI Design System

## Purpose

Bind the project visual language to semantic tokens.

## Tokens

Color: background, foreground, primary, secondary, muted, accent, destructive, success, warning, info

Typography: display, heading, body, label, caption

Also: spacing, radius, border, shadow, elevation, icon, motion, breakpoint

## Forbidden

`color: #1677ff`. Use `var(--color-primary)` or `text-primary` / `bg-muted` / `text-destructive`.

## Rule

Do not invent a second palette beside an existing Design System.

## Schema

`.aafe/runtime/ui-engineering/schemas/ui-ux.schema.json`
