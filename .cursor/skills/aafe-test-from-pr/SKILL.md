---
name: aafe-test-from-pr
description: 用户说「分析此PR <PR URL>影响并生成测试用例」「按 PR 补测试」「执行 PR 分析生成测试用例」「生成测试用例并执行e2e测试」或直接贴出 GitHub/工蜂 PR/MR 链接时，跑 aafe test --pr=<url>（要执行再加 --run）。禁止安装或调用 uitest / @aafe/ai-test。
---

# AAFE Test from PR (Cursor)

Source of truth: `.ai-agent/skills/aafe-test-from-pr.md`.

1. Extract the PR/MR URL.
2. Run `aafe test --pr=<url>` (`node_modules/.bin/aafe` when not on PATH).
3. If the user asked to execute e2e or emit a report, add `--run` after a real `e2e.baseUrl` / `AAFE_E2E_BASE_URL` (never `http://localhost:8080`).
4. Read only `.aafe/e2e/reports/<runId>/`.
5. Do **not** install or run `uitest` / `@aafe/ai-test` / `npx uitest`.
