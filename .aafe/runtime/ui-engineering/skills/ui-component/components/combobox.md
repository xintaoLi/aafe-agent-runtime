# Combobox

## Purpose

Pick from 20+ options or a list that needs filtering.

## When to use

- 20+ options
- user may type to filter
- known local list

## When not to use

- tiny closed lists
- free-text that is not a pick

## Anatomy

- label
- input
- listbox
- option
- empty

## Variants

default, async

## Sizes

sm, md, lg

## States

default, focus, open, loading, empty, error, disabled

## Accessibility

- combobox+listbox pattern
- aria-expanded
- aria-controls
- aria-activedescendant

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
