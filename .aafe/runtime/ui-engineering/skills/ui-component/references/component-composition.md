# Component Composition

Pages are compositions, not new organisms.

Example — Settings:

```text
Page
 ├── Sidebar
 └── Main
      ├── Header
      ├── Tabs
      └── Form
           ├── Field (Label + Input + Description)
           └── Actions
```

Reuse existing layout, field and action primitives. Do not restyle a one-off Settings from scratch.
