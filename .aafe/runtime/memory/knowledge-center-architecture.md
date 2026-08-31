# Knowledge Center Architecture Sources

Generated: 2026-08-19T03:22:15.379Z
Project: @aafe/agent-runtime

This generated memory is the primary architecture context for Knowledge Center and AI project management. Prefer these sources before broad code search. The source documents and Mermaid diagrams are authoritative project context; do not invent a CRM domain model when the project describes another domain.

## Architecture Sources

- `.docs/aafe-generated/README.md` [architecture-doc] Knowledge Center Generated Index — Project > Files > Update
- `.docs/aafe-generated/业务关系与数据流.md` [architecture-doc] 业务关系与数据流 — 路由与页面 > 架构文档与图表 > AI 使用规则
- `.docs/aafe-generated/影响范围与测试预测.md` [architecture-doc] 影响范围与测试预测 — 当前变更基线 > 默认影响范围 > 默认测试预测 > 依据 > 使用要求
- `.docs/aafe-generated/组件关系.md` [architecture-doc] 组件关系 — 组件与页面 > 模块关系 > 证据来源

## Analyze AST docs

- `.ai-agent/.docs/architecture/index.md`
- `.ai-agent/.docs/dataflow/index.md`

## Operating Rules

- Read the relevant architecture document and diagram before planning changes.
- Treat Mermaid diagrams as relationship and flow evidence, not as executable code.
- Prefer current source code when documentation conflicts, and record the conflict for review.
- Use `aafe analyze --architecture-docs=<path>` after architecture documents change.
- Use the architecture sources to guide AI task planning, impact analysis, test selection and knowledge updates.
