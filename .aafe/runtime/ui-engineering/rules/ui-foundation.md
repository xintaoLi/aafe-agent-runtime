# UI Foundation Rules

UI-FOUND-001

Design decisions precede implementation decisions.

UI-FOUND-002

Compose existing components before creating new ones.

UI-FOUND-003

Use semantic tokens (`text-primary`, `var(--color-destructive)`). Never hardcode `#1677ff`.

UI-FOUND-004

Visual expression follows product type → user role → task priority → information density → hierarchy.

UI-FOUND-005

WCAG 2.2 AA is the accessibility floor, not extra credit.

UI-FOUND-006

Do not start from Button / Card / Input. Start from User → Goal → Task.

UI-FOUND-007

Color alone MUST NOT convey state.

UI-FOUND-008

Hover-only actions are forbidden.

UI-FOUND-009

prefers-reduced-motion MUST be honored whenever motion is used.

UI-FOUND-010

Framework adapters load only after Discovery identifies the stack.
