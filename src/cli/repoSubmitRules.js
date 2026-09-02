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

export function repoSubmitSkillContent(agentPrefix = '.ai-agent') {
  const prefix = String(agentPrefix ?? '.ai-agent').replace(/\/+$/, '') || '.ai-agent';
  return `# Skill: Repo Submit（Token-first GitHub / 工蜂）

Trigger: 代码 **提交 / 拉取 / push / PR / MR**，或 TAPD Submit Phase D。

Companion: \`${prefix}/skills/tapd-submit-backfill.md\`

Hard:

- 先读 \`.aafe.config.json\` → \`repo\`（代码仓库配置）。
- **已配置 \`repo.githubAccessToken\` 或 \`GITHUB_TOKEN\` / \`GH_TOKEN\`** → 用该 Token 执行 GitHub 相关操作，**不依赖项目内是否安装 \`gh\`**。
- **禁止**把 Token 写进命令行参数、\`git remote set-url\` 或对话明文。
- \`repo.reviewers\` / \`repo.labels\` 非空时，创建或补写 PR/MR **必须**带上。

---

## Phase R0 — 读配置

\`\`\`text
.aafe.config.json → repo
  githubAccessToken / gongfengAccessToken
  reviewers[] / labels[]
.aafe.config.json → submit.cli   # git | gtm
\`\`\`

展开 \`\${ENV}\`。环境变量已有值时优先于配置文件。

---

## Phase R1 — 解析 GitHub Token

1. \`GITHUB_TOKEN\` / \`GH_TOKEN\`
2. 否则 \`repo.githubAccessToken\`（可写 \`\${GITHUB_TOKEN}\`）

**有 Token（mode=token）→ 走 R2 + R3，禁止因为没有 \`gh\` 而失败。**  
**无 Token** → 仅当本机 \`command -v gh\` 成功才允许 \`gh\`；否则报告并停下（不阻断 TAPD Phase E）。

---

## Phase R2 — fetch / pull / push（GitHub + Token）

把 Token 注入环境变量（已有 shell 值不覆盖），再：

\`\`\`bash
git -c http.extraheader="AUTHORIZATION: bearer $GITHUB_TOKEN" fetch <remote>
git -c http.extraheader="AUTHORIZATION: bearer $GITHUB_TOKEN" pull --ff-only
git -c http.extraheader="AUTHORIZATION: bearer $GITHUB_TOKEN" push -u origin HEAD
\`\`\`

不要把 Token 写进 remote URL 并 \`git remote set-url\`（会落盘）。

---

## Phase R3 — 创建 / 补写 GitHub PR（Token API，不依赖 gh）

优先跑（\`aafe\` 不在 PATH 时用 \`node_modules/.bin/aafe\`）：

\`\`\`bash
aafe repo pr --title="<title>" --body="<body>" --base=<base> --head=<head>
\`\`\`

该命令读取 \`repo.githubAccessToken\`，用 GitHub REST API：

1. \`GET /repos/{owner}/{repo}/pulls?head={owner}:{head}&base={base}&state=open\`
2. 没有则 \`POST /repos/{owner}/{repo}/pulls\`（title / body / head / base）
3. \`repo.reviewers\` → \`POST .../pulls/{n}/requested_reviewers\`
4. \`repo.labels\` → \`POST .../issues/{n}/labels\`

也可用 curl（\`Authorization: Bearer $GITHUB_TOKEN\`），效果相同。  
\`--dry-run\` 只打印计划，不发请求。

无 Token 且 \`gh\` 可用时的降级（不要作为默认）：

\`\`\`bash
gh pr create --reviewer <a,b> --label <x,y> …
\`\`\`

---

## Phase R4 — 工蜂 MR

已配置 \`repo.gongfengAccessToken\` / \`GIT_PRIVATE_TOKEN\`：

1. \`submit.cli=gtm\` 可先 \`gtm pr\`
2. 再用 Token 调工蜂 API 写入 \`labels\` 与 \`reviewer_ids\`（username 先查用户 id；纯数字当 id）
3. **不要**因为没有 \`gh\` 改走 GitHub

---

## 禁止

- 未配置 Token 时假装 PR 已创建
- 把 Token 打印到日志 / commit / remote
- 仅因 \`gh\` 不存在且已有 \`githubAccessToken\` 而跳过 PR
`;
}

export function repoSubmitSkill() {
  return repoSubmitSkillContent('.ai-agent');
}
