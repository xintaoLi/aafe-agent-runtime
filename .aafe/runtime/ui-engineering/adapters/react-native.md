# react-native / react-native

**Role:** implementation binding. This file does not make UX decisions.

Native controls, touch targets ≥ 44pt, no hover-only affordances.

## Rules

1. Load only after UI Discovery identified this stack.
2. Search installed / registered components before generating new ones.
3. Prefer built-in variants.
4. Map visuals to semantic tokens used by this library.
5. Keep keyboard and ARIA behaviour from the primitive; do not wrap it away.
