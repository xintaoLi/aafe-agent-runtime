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

function normalizePrefix(agentPrefix = '.ai-agent') {
  return String(agentPrefix ?? '.ai-agent').replace(/\/+$/, '') || '.ai-agent';
}

/** First-read task spine. Each node is a decision point, not a fixed stage. */
export function taskSpineMarkdown(agentPrefix = '.ai-agent') {
  const p = normalizePrefix(agentPrefix);
  return `## Task Spine（动态决策链）

\`\`\`text
[1] 需求与分支决策（需求/设计分析或写代码前）
    TAPD 单 → 拉详情 → 校验/新建/切换关联分支；ID 不匹配且用户未明确确认当前分支可用 → 继续切换/创建分支 → 若含 Figma 则获取结构化设计/截图 → 需求分析
    非 TAPD → 判断是否新任务 → 按需新建/切换分支 → 需求分析
    无法判断 → ask 模式询问；autonomous 模式仅高置信自主判定，否则 Hard Ask
[2] 任务执行决策
    小改直接执行；复杂/多方案 → Plan Gate；前端非平凡任务进入 runtime/pipelines
[3] 影响与自测决策
    有代码变更 → impact + 最小收敛自测；纯问答/纯文档 → skip
    TAPD + Figma → 本地 diff 生成影响单位/测试路径 → Figma 回归验证收敛影响范围与断言
    UI/E2E 缺 URL → Hard Ask；E2E blocked 且用户仍需要 → 浏览器 MCP 兜底
[4] 提交 / PR / MR / 回填决策
    需要提交或用户要求提交 → \`${p}/skills/repo-submit.md\`
    有 TAPD 关联 → 回填门禁；无 TAPD 关联 → 跳过 TAPD 回填
\`\`\`

Hard：Task Spine 是动态路由，不是固定阶段。每个节点都要先判定适用性；\`ask\` 模式按用户回复推进或跳过；\`autonomous\` 模式按上下文自主判定 \`proceed / skip / ask\`，缺少用户独有事实时必须 Hard Ask。`;
}

export function taskSpineHookLines(agentPrefix = '.ai-agent') {
  const p = normalizePrefix(agentPrefix);
  return [
    `1. Read ${p}/skill-index.md and follow dynamic Task Spine.`,
    '2. Decide TAPD vs non-TAPD and whether to create/switch branch before requirement/design analysis or code; TAPD ID mismatch must continue branch switch/create unless the user already confirmed current branch; if TAPD includes Figma, fetch structured design and screenshot before UI implementation.',
    '3. Execute analysis or implementation only after requirement/branch decision is closed.',
    '4. After code changes, decide impact/self-test; TAPD+Figma uses local diff plus Figma evidence to narrow impact/tests; then decide submit/PR/MR and TAPD backfill if associated.',
    '5. Load project.md / project-skills on demand only. Do not copy knowledge into editor directories.'
  ];
}

export function taskSpineHookContext(agentPrefix = '.ai-agent', moduleName = '') {
  const extra = moduleName ? ` module=\\"${moduleName}\\"` : '';
  return `<AAFE_SKILL_ROUTER${extra}>\\n${taskSpineHookLines(agentPrefix).join('\\n')}\\n</AAFE_SKILL_ROUTER>`;
}

export function taskSpinePointerLine(agentPrefix = '.ai-agent') {
  const p = normalizePrefix(agentPrefix);
  return `Follow \`${p}/skill-index.md\` **Task Spine** as a dynamic decision chain: [1] 需求/分支判定（TAPD ID 不匹配且用户未确认当前分支可用时必须继续切换/创建分支；TAPD 含 Figma 时先取结构化设计/截图）→ [2] 执行判定 → [3] 影响/自测判定（TAPD+Figma 用 diff+设计稿收敛）→ [4] 提交/PR/MR/回填判定。`;
}
