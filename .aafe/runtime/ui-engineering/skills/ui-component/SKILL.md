# UI Component Engineering

## Purpose

Select, compose and specify components. This is not a per-widget copy-paste skill.

## Selection

- 2-5 options → **Radio / Toggle** (`radio-or-toggle`)
- 5-20 options → **Select** (`select`)
- 20+ options → **Combobox** (`combobox`)
- multi-select → **MultiSelect** (`multi-select`)
- hierarchy → **Cascader** (`cascader`)
- large / async data → **Async Combobox** (`async-combobox`)

## Composition

Compose > Create. Settings is Sidebar + Header + Tabs + Form fields, not a new Settings organism.

## References

- `references/component-selection.md`
- `references/component-composition.md`
- `components/<name>.md` for Button, Input, Select, Combobox, Dialog, …

## Schema

`.aafe/runtime/ui-engineering/schemas/ui-component.schema.json`
