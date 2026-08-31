# Form

## Purpose

Collect and submit a set of fields as one task.

## When to use

- create/edit
- settings
- filters that submit together

## When not to use

- single instant toggle (save on change)
- unrelated fields on one blob

## Anatomy

- field
- label
- control
- description
- error
- actions

## Variants

page, dialog, inline

## Sizes

md

## States

default, submitting, error, success, partial

## Accessibility

- labels
- error summary
- focus first error
- autocomplete
- do not rely on color alone

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
