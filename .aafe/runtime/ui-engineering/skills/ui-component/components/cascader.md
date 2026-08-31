# Cascader

## Purpose

Pick one path through a known hierarchy.

## When to use

- region / category / org path
- closed hierarchical vocabulary

## When not to use

- open-ended trees (Tree)
- flat options (Select)

## Anatomy

- label
- trigger
- columns
- option

## Variants

single, multiple

## Sizes

md

## States

default, open, loading, error, disabled

## Accessibility

- combobox or listbox per column
- keyboard across columns
- complete path announced

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
