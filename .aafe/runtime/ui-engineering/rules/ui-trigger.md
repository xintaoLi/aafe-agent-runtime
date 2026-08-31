# UI Trigger Rule

## Purpose

Decide whether this request is UI work. If it is, UI/UX Engineering is
**mandatory**. If it is not, do not load this pack.

This is not an opt-in slogan like DDD. The user does not need to say
"UI Engineering". A page, component, layout, form, table, dialog, style,
Figma or accessibility request **is** UI work.

## Forbidden

UI MUST NOT go `Requirement → Code`.

```text
Requirement → UX → UI Architecture → Component → State → Accessibility → Implementation
```

## Complexity compression

Simple (button color, copy, spacing, variant):

```text
Discovery (reuse check) → Component → Implementation → Review
```

Full (Dashboard, Log Platform, Admin, Editor, Complex Form, Data Table, Mobile App):
run the complete chain.

## UX/UI Skill ≠ component library Skill

UI skills decide **what** and **why**. Adapters decide **which library primitive**.
Do not skip Discovery because shadcn / Element Plus is installed.

## Tooling

`aafe ui gate "<request>"` → enabled | disabled | ambiguous
`aafe ui scope "<request>"` → simple | standard | full + minimum skill set

- disabled → not UI; do not load `ui-engineering/`
- ambiguous → ask whether the change includes a UI surface
- enabled → Discovery before any UI code
