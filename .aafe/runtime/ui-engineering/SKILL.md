---
name: ui-engineering
description: UI/UX Engineering。任务门禁：做 UI 必须先 Discovery，禁止 Requirement→Code。组件库只负责实现绑定。
---

# UI/UX Engineering Skills

> UX 决策 → UI 系统 → Layout → Component → Interaction → State → Accessibility → Performance → Implementation → Review

这不是「让 AI 写一个好看的页面」。

## Entry

```text
User Requirement
       ↓
 UI Trigger Rule  ── disabled → 不加载本包
       ↓ enabled
 UI Discovery     禁止在此之前写 UI
       ↓
 UX / IA / Flow / Layout
       ↓
 Component Selection + Composition
       ↓
 State · Interaction · Responsive · A11y · Performance · Motion
       ↓
 Implementation（走 Framework Adapter，不是再造组件）
       ↓
 UI Review  ── needs_fix → 返回修复
```

## Compression

| 需求 | 路径 |
| --- | --- |
| 简单 Button / 文案 / 间距 / variant | Discovery → Component → Implementation → Review |
| 标准表单 / Dialog / 设置区块 | 标准链（含 UX、State、A11y） |
| Dashboard / Admin / Editor / 复杂表单 / 数据表格 / 移动应用 | 全链 |

## Rules

1. `rules/ui-trigger.md`
2. `rules/ui-foundation.md`
3. `rules/ui-component.md`
4. `rules/ui-layout.md`
5. `rules/ui-interaction.md`
6. `rules/ui-state.md`
7. `rules/ui-accessibility.md`
8. `rules/ui-responsive.md`
9. `rules/ui-performance.md`
10. `rules/ui-review.md`

## Skills

- `skills/ui-discovery/SKILL.md` — UI Discovery
- `skills/ui-ux-design/SKILL.md` — UX Design
- `skills/ui-design-system/SKILL.md` — UI Design System
- `skills/ui-layout/SKILL.md` — UI Layout
- `skills/ui-component/SKILL.md` — UI Component Engineering
- `skills/ui-interaction/SKILL.md` — UI Interaction
- `skills/ui-state/SKILL.md` — UI State
- `skills/ui-responsive/SKILL.md` — UI Responsive
- `skills/ui-accessibility/SKILL.md` — UI Accessibility
- `skills/ui-performance/SKILL.md` — UI Performance
- `skills/ui-motion/SKILL.md` — UI Motion
- `skills/ui-anti-slop/SKILL.md` — UI Anti-AI-Slop
- `skills/ui-review/SKILL.md` — UI Review

## Adapters

UX/UI Skill 决定设计；Adapter 决定实现。Discovery 识别技术栈后再读：

- `react` / `shadcn` → `adapters/react/shadcn.md`
- `react` / `radix` → `adapters/react/radix.md`
- `react` / `aria` → `adapters/react/aria.md`
- `vue` / `element-plus` → `adapters/vue/element-plus.md`
- `vue` / `naive-ui` → `adapters/vue/naive-ui.md`
- `vue` / `headless` → `adapters/vue/headless.md`
- `react-native` / `react-native` → `adapters/react-native.md`

## Tooling

```bash
aafe ui gate "<request>"
aafe ui scope "<request>"
aafe ui discover "<request>"
aafe ui select "<request>"
aafe ui review "<request>"
```

## Core Constraints

- **UI-SYSTEM-001** UI work MUST NOT go Requirement → Code.
- **UI-SYSTEM-002** Discovery runs before any UI is written.
- **UI-SYSTEM-003** UX/UI Skill is not a component-library skill.
- **UI-SYSTEM-004** Compose existing components; do not duplicate primitives.
- **UI-SYSTEM-005** Semantic tokens only; no hardcoded palette.
- **UI-SYSTEM-006** Simple UI work uses the compressed chain; complex surfaces use the full chain.
- **UI-SYSTEM-007** Every interactive control is keyboard operable.
- **UI-SYSTEM-008** WCAG 2.2 AA is P0.
- **UI-SYSTEM-009** State design is required before implementation.
- **UI-SYSTEM-010** Hover-only interaction is a defect.
- **UI-SYSTEM-011** Motion requires a purpose and prefers-reduced-motion.
- **UI-SYSTEM-012** Anti-slop defaults are not a visual identity.
- **UI-SYSTEM-013** Every UI change exits through ui-review.
