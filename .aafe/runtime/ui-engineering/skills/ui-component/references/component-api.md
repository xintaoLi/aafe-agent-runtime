# Component API

Public props should name user intent, not internals: variant, size, disabled, loading, invalid.

Stable: `value` / `onChange` or framework-native v-model. Do not leak DOM implementation through the public API.

Document default, controlled and uncontrolled usage when both exist.
