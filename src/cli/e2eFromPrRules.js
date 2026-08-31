/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * PR → YAML → E2E 的编辑器发现层。
 *
 * Cursor 按 Skill/Rule 的 description 做「口令广告」。旧包 `@aafe/ai-test` 把
 * 「分析此PR … 生成测试用例」写进 `.cursor/skills` 下的 `ai-ui-test` 与
 * `uitest-from-pr.mdc`，Agent 就会去跑 `npx uitest from-pr` 并要求安装 uitest。
 *
 * 本模块写出 AAFE 自己的同款触发句，但只指向 `aafe test --pr`，禁止安装或调用
 * uitest。不要把 `ai-ui-test` / `uitest-from-pr` 写回 `.cursor/`。
 */

export const AAFE_TEST_FROM_PR_SKILL_DIR = 'aafe-test-from-pr';
export const AAFE_TEST_FROM_PR_RULE_FILE = 'aafe-test-from-pr.mdc';

/** Matches the historical uitest trigger phrases so Cursor selects this skill instead. */
export const AAFE_TEST_FROM_PR_DESCRIPTION = '用户说「分析此PR <PR URL>影响并生成测试用例」「按 PR 补测试」「执行 PR 分析生成测试用例」「生成测试用例并执行e2e测试」或直接贴出 GitHub/工蜂 PR/MR 链接时，跑 aafe test --pr=<url>（要执行再加 --run）。禁止安装或调用 uitest / @aafe/ai-test。';

export function aafeTestFromPrSkillContent(agentPrefix = '.ai-agent') {
  return `# Skill: AAFE Test from PR

Trigger: 用户要按 PR/MR **生成测试用例**、**补测试**、**执行 e2e** 或 **输出报告**，包括直接贴出 PR/MR 链接。

Companion CLI: \`aafe test --pr=<url>\`（本包能力，不是 \`uitest\`）。

## Hard

- **只跑** \`aafe test\`。\`aafe\` 不在 PATH 时用 \`node_modules/.bin/aafe\`。
- **禁止**安装或调用 \`uitest\`、\`@aafe/ai-test\`、\`npx uitest\`、\`npx uitest init\`、\`npx uitest from-pr\`。
- **禁止**把 \`ai-ui-test\` / \`uitest-from-pr\` 写回 \`.cursor/\`。
- 不要为这条路径安装任何 uitest 依赖。Playwright 由 \`aafe e2e enable|install\` 按项目选择，不是本口令的前置安装步骤。

## Steps

1. 从用户消息取出 PR/MR URL（GitHub \`/pull/\` 或工蜂 \`/merge_requests/\`）。没有链接就问一句，不要编。
2. 生成用例：\`aafe test --pr=<url>\`。YAML 落 \`tests/ui-ai/cases/\`。
3. 用户还要求执行 e2e / 出报告：尽量带 \`--run\`。
   - 用户消息里已有被测页面 URL（不是 PR 链接）→ 先确认该地址角色，再 \`aafe test --pr=<url> --run --base-url=<该地址> --url-role=...\`。含 \`#\` 的地址必须用引号，禁止把 hash 丢掉后只拿 origin。
   - 否则**必须停下来询问并等待用户输入本次测试地址**。地址每次可能不同，不要写进 \`e2e.baseUrl\` / 环境变量，不要猜，不要用 \`http://localhost:8080\`。
   - 用户给出地址后，若包含页面路径（\`#/...\`）或查询参数，**必须再确认并等待**：
     - **A** 是目标页面：匹配该路径的用例打开这个完整地址；其它用例复用同一主机、hash/history 模式和查询参数。
     - **B** 不是，只是环境根地址：丢弃 \`#\` 后的路径和业务参数。
     - **C** 需要根据此地址分析变更（推荐）：提取协议/主机、是否 hash 路由、以及 bizId 等参数，拼到本次变更的各条路由上。
     然后 \`--run --base-url=<用户输入> --url-role=target|origin|template\`（A/B/C）。
   - 没有路径/参数的纯 origin 可直接 \`--run --base-url=<用户输入>\`。
   - CLI 返回 \`needInput: "baseUrl"\` 或 \`needInput: "urlRole"\` 时同样：问用户，等待，再带齐参数重跑。
   - 业务需登录 / SSO：每次 \`--run\` **先匿名探测用户地址**（HTTP 200 且未跳转登录则跳过 SSO，适合 Dev 本地代理）；否则再校验登录态，未登录或过期则重新登录并更新 \`.aafe/e2e/auth\`。无认证且非交互环境会返回 \`needInput: "auth"\`，引导 \`aafe e2e auth --base-url=<url>\`。不要把密码写入配置。
4. 只读统一报告 \`.aafe/e2e/reports/<runId>/{report.json,index.html}\`，不要散落到 \`test/ui/\`、\`playwright-report/\`、\`test-results/\`。
5. 命令提示 \`e2e.enabled !== true\` → 告诉用户 \`aafe e2e enable\`，仍然不要装 uitest。
6. Playwright 缺失时报告为 blocked；不要改口去装 uitest。

## Pointers

详细自测分层见 \`${agentPrefix}/skills/minimal-convergent-self-test.md\`。任务收尾 UI 走 \`aafe test --diff\`，不要默认 \`--coverage\`。
`;
}

export function aafeTestFromPrCursorSkill(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '---',
    `name: ${AAFE_TEST_FROM_PR_SKILL_DIR}`,
    `description: ${AAFE_TEST_FROM_PR_DESCRIPTION}`,
    '---',
    '',
    '# AAFE Test from PR (Cursor)',
    '',
    `Source of truth: \`${agentPrefix}/skills/aafe-test-from-pr.md\`.`,
    '',
    '1. Extract the PR/MR URL.',
    '2. Run `aafe test --pr=<url>` (`node_modules/.bin/aafe` when not on PATH).',
    '3. If the user asked to execute e2e: ask and **wait** for this run\'s page URL. If the URL has `#` or query, ask A/B/C (target page / origin only / template+params) and wait, then `aafe test --pr=<url> --run --base-url=<quoted url> --url-role=target|origin|template`. Quote hash URLs. Each `--run` first probes the URL anonymously (HTTP 200 and no login redirect skips SSO, e.g. Dev local proxy); otherwise it verifies login and re-auths if missing/expired (`aafe e2e auth` when headed SSO is needed). Do not persist to e2e.baseUrl. Never guess or use `http://localhost:8080`.',
    '4. Read only `.aafe/e2e/reports/<runId>/`.',
    '5. Do **not** install or run `uitest` / `@aafe/ai-test` / `npx uitest`.',
    ''
  ].join('\n');
}

export function aafeTestFromPrPointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: ${AAFE_TEST_FROM_PR_DESCRIPTION}
alwaysApply: false
---

# AAFE Test from PR（Pointer）

Source of truth: \`${agentPrefix}/skills/aafe-test-from-pr.md\`

用户要「分析此PR」「按 PR 补测试」「生成测试用例并执行e2e」或直接贴 PR/MR 链接时：

1. \`aafe test --pr=<url>\` 生成 YAML
2. 需要执行时：询问并**等待**用户输入本次测试 URL。若地址含 \`#\` 或查询参数，再确认 A（目标页）/ B（仅环境根）/ C（按此地址提取参数拼到变更路由），然后 \`aafe test --pr=<url> --run --base-url=<url> --url-role=target|origin|template\`（不要写死配置；hash 地址用引号）
3. 报告只读 \`.aafe/e2e/reports/\`

**禁止**安装或调用 \`uitest\` / \`@aafe/ai-test\`。不要把 \`ai-ui-test\` / \`uitest-from-pr\` 写回 \`.cursor/\`。
`;
}
