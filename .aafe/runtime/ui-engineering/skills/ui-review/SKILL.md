# UI Review

## Purpose

Exit gate for every UI change.

## Axes

UX (flow, task, IA) · Visual (hierarchy, density, spacing) · Code (composition, reuse) · A11y · Responsive · Performance

## Output

```json
{
  "score": 87,
  "status": "needs_fix",
  "issues": [{ "category": "accessibility", "severity": "high" }]
}
```

## Tooling

`aafe ui review "<request>"`

## Schema

`.aafe/runtime/ui-engineering/schemas/ui-review.schema.json`
