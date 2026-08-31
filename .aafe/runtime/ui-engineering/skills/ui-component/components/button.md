# Button

## Purpose

Trigger an action. Not for navigation (use a link) and not for toggling exclusive choice (use Toggle / Radio).

## When to use

- primary / secondary / destructive actions
- form submit
- toolbar commands

## When not to use

- navigation between pages
- multi-select filters
- text that is not actionable

## Anatomy

- label
- optional icon
- optional shortcut

## Variants

default, secondary, outline, ghost, destructive, link

## Sizes

sm, md, lg, icon

## States

default, hover, focus, active, disabled, loading, destructive

## Accessibility

- native button or role="button"
- focus visible
- loading announced
- icon-only has accessible name
- disabled is not focus-trapped as clickable

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
