# react / shadcn

**Role:** implementation binding. This file does not make UX decisions.

Compose existing shadcn components and variants. Search installed components before generating.

## Rules

1. Load only after UI Discovery identified this stack.
2. Search installed / registered components before generating new ones.
3. Prefer built-in variants.
4. Map visuals to semantic tokens used by this library.
5. Keep keyboard and ARIA behaviour from the primitive; do not wrap it away.
