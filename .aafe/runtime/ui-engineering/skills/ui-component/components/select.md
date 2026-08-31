# Select

## Purpose

Pick one value from 5–20 known options without typeahead.

## When to use

- 5–20 options
- closed vocabulary
- form fields

## When not to use

- 2–5 options (Radio / Toggle)
- 20+ or searchable (Combobox)
- async remote lists

## Anatomy

- label
- trigger
- listbox
- option
- description

## Variants

default, ghost

## Sizes

sm, md, lg

## States

default, hover, focus, open, disabled, error

## Accessibility

- label
- keyboard Arrow/Enter/Esc
- active descendant
- typeahead optional

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
