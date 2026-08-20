# Skill: AAFE Test from PR

Trigger: 用户要按 PR/MR **生成测试用例**、**补测试**、**执行 e2e** 或 **输出报告**，包括直接贴出 PR/MR 链接。

Companion CLI: `aafe test --pr=<url>`（本包能力，不是 `uitest`）。

## Hard

- **只跑** `aafe test`。`aafe` 不在 PATH 时用 `node_modules/.bin/aafe`。
- **禁止**安装或调用 `uitest`、`@aafe/ai-test`、`npx uitest`、`npx uitest init`、`npx uitest from-pr`。
- **禁止**把 `ai-ui-test` / `uitest-from-pr` 写回 `.cursor/`。
- 不要为这条路径安装任何 uitest 依赖。Playwright 由 `aafe e2e enable|install` 按项目选择，不是本口令的前置安装步骤。

## Steps

1. 从用户消息取出 PR/MR URL（GitHub `/pull/` 或工蜂 `/merge_requests/`）。没有链接就问一句，不要编。
2. 生成用例：`aafe test --pr=<url>`。YAML 落 `tests/ui-ai/cases/`。
3. 用户还要求执行 e2e / 出报告：再跑 `aafe test --pr=<url> --run`。
   - 需要 `AAFE_E2E_BASE_URL` 或 `.aafe.config.json` `e2e.baseUrl`。
   - **禁止**填 `http://localhost:8080` 占位。
4. 只读统一报告 `.aafe/e2e/reports/<runId>/{report.json,index.html}`，不要散落到 `test/ui/`、`playwright-report/`、`test-results/`。
5. 命令提示 `e2e.enabled !== true` → 告诉用户 `aafe e2e enable`，仍然不要装 uitest。
6. Playwright 缺失时报告为 blocked；不要改口去装 uitest。

## Pointers

详细自测分层见 `.ai-agent/skills/minimal-convergent-self-test.md`。任务收尾 UI 走 `aafe test --diff`，不要默认 `--coverage`。
