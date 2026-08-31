# Dialog

## Purpose

A blocking task that must complete or cancel before returning.

## When to use

- confirmations
- focused short forms
- blocking choices

## When not to use

- non-blocking extra info (Drawer / Popover)
- full page workflows

## Anatomy

- title
- description
- body
- actions

## Variants

default, alert, destructive

## Sizes

sm, md, lg

## States

closed, open, submitting, error

## Accessibility

- accessible title
- description
- focus trap
- Esc
- focus restore
- inert background

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
