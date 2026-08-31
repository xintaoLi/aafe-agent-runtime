# Input

## Purpose

Enter a short free-text value.

## When to use

- names
- emails
- numbers
- single-line search that does not pick from a list

## When not to use

- picking from a known list (Select / Combobox)
- long text (Textarea)
- binary choice

## Anatomy

- label
- input
- description
- error

## Variants

text, email, password, number, search

## Sizes

sm, md, lg

## States

default, hover, focus, disabled, readonly, error, success

## Accessibility

- label associated
- error linked via aria-describedby
- required announced
- autocomplete when relevant

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
