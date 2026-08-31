# Table

## Purpose

Compare rows of structured records.

## When to use

- tabular data
- sortable/filterable records
- bulk actions on rows

## When not to use

- layout grids
- cards that are not comparable columns

## Anatomy

- caption
- header
- row
- cell
- pagination
- toolbar

## Variants

plain, striped, compact

## Sizes

sm, md

## States

loading, empty, error, partial, selected, sorting, filtering, pagination, virtualized

## Accessibility

- table semantics
- sort announced
- row selection name
- virtualization keeps keyboard access

## Anti-patterns

- Recreating this primitive when the project already has one
- Hardcoded colors instead of semantic tokens
- Hover-only interaction
