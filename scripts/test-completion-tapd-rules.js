import assert from 'node:assert/strict';
import {
  architectureImpactTestForecastSkillContent,
  minimalConvergentSelfTestSkillContent,
  taskCompletionImpactProjectRuleMdc,
  taskCompletionImpactRuleMdc,
  taskCompletionImpactRuleSection
} from '../src/cli/completionImpactRules.js';
import {
  tapdSubmitBackfillSkillContent,
  tapdSubmitProjectRuleMdc,
  tapdSubmitRuleMdc,
  tapdSubmitRuleSection
} from '../src/cli/tapdSubmitRules.js';
import { taskSpineHookContext, taskSpineMarkdown } from '../src/cli/taskSpine.js';

const layeredImpact = taskCompletionImpactRuleMdc({
  agentPrefix: 'bklog/web/.ai-agent',
  moduleGlob: 'bklog/web/**',
  moduleName: 'bklog-web'
});
assert.match(layeredImpact, /Pointer/);
assert.match(layeredImpact, /ui_test_paths/);
assert.match(layeredImpact, /bklog\/web\/\.ai-agent\/rules\/task-completion-impact\.mdc/);
assert.match(layeredImpact, /globs: bklog\/web\/\*\*/);
assert.doesNotMatch(layeredImpact, /## 强制询问/);

const flatImpact = taskCompletionImpactRuleMdc();
assert.match(flatImpact, /Pointer/);
assert.match(flatImpact, /\.ai-agent\/rules\/task-completion-impact\.mdc/);

const projectImpact = taskCompletionImpactProjectRuleMdc({ agentPrefix: '.ai-agent' });
assert.match(projectImpact, /aafe test --diff/);
assert.match(projectImpact, /ui_test_paths/);
assert.match(projectImpact, /询问是否 Commit|Commit 门禁|workflow-mode/);
assert.match(projectImpact, /mode\.workflow|自主判断/);
assert.match(projectImpact, /submit\.cli/);
assert.match(projectImpact, /仅当任务过程中有关联 TAPD 单/);
assert.match(projectImpact, /任务评估/);
assert.match(projectImpact, /改进空间评估/);
assert.match(projectImpact, /Commit 成功后继续尝试 PR/);
assert.match(projectImpact, /状态映射逐步流转到 doing/);
assert.match(projectImpact, /Figma 约束与本地 diff/);
assert.match(projectImpact, /禁止只按本地 diff 生成 UI 用例/);

const impactSection = taskCompletionImpactRuleSection({ agentPrefix: '.ai-agent' });
assert.match(impactSection, /aafe test --diff/);
assert.match(impactSection, /ui_test_paths/);
assert.match(impactSection, /submit\.cli/);
assert.match(impactSection, /改进空间/);
assert.match(impactSection, /PR 成功后记录 pr_url/);

const forecast = architectureImpactTestForecastSkillContent('.ai-agent');
assert.match(forecast, /impact_class/);
assert.match(forecast, /ui_test_paths/);
assert.match(forecast, /Step 2\.5/);
assert.match(forecast, /tapd-submit-backfill\.md/);
assert.match(forecast, /本 Skill 不自动开浏览器/);
assert.match(forecast, /figma_design_context/);
assert.match(forecast, /Local diff pass/);
assert.match(forecast, /Figma regression pass/);
assert.match(forecast, /figma_assertions/);

const selfTest = minimalConvergentSelfTestSkillContent('.ai-agent');
assert.match(selfTest, /aafe test --diff/);
assert.match(selfTest, /test\//);
assert.match(selfTest, /ui_test_paths/);
assert.match(selfTest, /Step 2\.5/);
assert.match(selfTest, /Hand off to submit/);
assert.match(selfTest, /user_declined_browser_mcp/);
assert.match(selfTest, /请提供要测试的完整页面 URL/);
assert.match(selfTest, /等待用户输入/);
assert.match(selfTest, /needInput: "baseUrl"/);
assert.match(selfTest, /Figma 结构化设计/);
assert.match(selfTest, /关键 node-id/);
assert.doesNotMatch(selfTest, /无 Playwright \/ 无 baseUrl/);

const layeredTapd = tapdSubmitRuleMdc({
  agentPrefix: 'bklog/web/.ai-agent',
  moduleGlob: 'bklog/web/**',
  moduleName: 'bklog-web'
});
assert.match(layeredTapd, /Pointer/);
assert.match(layeredTapd, /有关联 TAPD 单/);
assert.match(layeredTapd, /bklog\/web\/\.ai-agent\/rules\/tapd-submit-backfill\.mdc/);

const projectTapd = tapdSubmitProjectRuleMdc({ agentPrefix: '.ai-agent' });
assert.match(projectTapd, /Commit\/PR Gate/);
assert.match(projectTapd, /submit\.cli/);
assert.match(projectTapd, /gtm commit/);
assert.match(projectTapd, /--bug=/);
assert.match(projectTapd, /comments_create/);
assert.match(projectTapd, /ui_test_paths/);
assert.match(projectTapd, /PR 链接字段/);
assert.match(projectTapd, /Commit 成功后必须继续尝试 PR/);
assert.match(projectTapd, /状态映射逐步流转到 doing/);
assert.match(projectTapd, /临时注入/);
assert.match(projectTapd, /ID 不匹配/);
assert.match(projectTapd, /不得因当前分支已有相关提交或存在未提交改动而放行继续实现/);

const tapdSection = tapdSubmitRuleSection();
assert.match(tapdSection, /comments_create/);
assert.match(tapdSection, /submit\.cli/);
assert.match(tapdSection, /Commit\/PR Gate|询问 Commit/);
assert.match(tapdSection, /Commit 成功后必须继续尝试 PR/);
assert.match(tapdSection, /未关联或 ID 不匹配/);

const tapdSkill = tapdSubmitBackfillSkillContent('.ai-agent');
assert.match(tapdSkill, /Commit\/PR Gate/);
assert.match(tapdSkill, /Phase B — Commit gate/);
assert.match(tapdSkill, /autonomous mode/);
assert.match(tapdSkill, /submit\.cli/);
assert.match(tapdSkill, /gtm commit/);
assert.match(tapdSkill, /gtm pr/);
assert.match(tapdSkill, /aafe repo pr/);
assert.match(tapdSkill, /repo-submit\.md/);
assert.match(tapdSkill, /不依赖/);
assert.match(tapdSkill, /提示降级原因/);
assert.match(tapdSkill, /aafe update --submit-cli/);
assert.match(tapdSkill, /repo\.githubAccessToken/);
assert.match(tapdSkill, /repo\.gongfengAccessToken/);
assert.match(tapdSkill, /repo\.reviewers/);
assert.match(tapdSkill, /repo\.labels/);
assert.match(tapdSkill, /reviewer_ids/);
assert.match(tapdSkill, /TAPD Branch Association/);
assert.match(tapdSkill, /git 和 gtm 均适用/);
assert.match(tapdSkill, /gtm create issue/);
assert.match(tapdSkill, /upstream\/master/);
assert.match(tapdSkill, /末 9 位/);
assert.match(tapdSkill, /Phase D — Try PR/);
assert.match(tapdSkill, /Phase E — TAPD backfill gate/);
assert.match(tapdSkill, /有关联 TAPD 时/);
assert.match(tapdSkill, /Commit 成功后必须尝试 PR/);
assert.match(tapdSkill, /临时注入 `GITHUB_TOKEN`/);
assert.match(tapdSkill, /按配置状态映射逐步流转到 doing/);
assert.match(tapdSkill, /TAPD ID 不匹配不是可忽略警告/);
assert.match(tapdSkill, /不能替代“用户已明确确认当前分支可用”/);

import {
  requirementIntakeAnalysisSkillContent,
  requirementIntakeProjectRuleMdc,
  requirementIntakeRuleMdc,
  requirementIntakeRuleSection
} from '../src/cli/requirementAnalysisRules.js';

const projectReq = requirementIntakeProjectRuleMdc({ agentPrefix: '.ai-agent' });
assert.match(projectReq, /阶段 A — 需求分析与澄清/);
assert.match(projectReq, /历史积累检索/);
assert.match(projectReq, /SwitchMode/);
assert.match(projectReq, /> 5 个函数/);
assert.match(projectReq, /TAPD Figma 设计稿 Gate/);
assert.match(projectReq, /get_design_context/);
assert.match(projectReq, /get_full_bundle/);
assert.match(projectReq, /TAPD ID 不匹配/);
assert.match(projectReq, /不得因当前分支已有相关提交或未提交改动而放行继续实现/);

const reqSkill = requirementIntakeAnalysisSkillContent('.ai-agent');
assert.match(reqSkill, /Workflow mode/);
assert.match(reqSkill, /Phase 1 — Analyze & clarify/);
assert.match(reqSkill, /Phase 2 — Historical/);
assert.match(reqSkill, /target_mode_id: \"plan\"/);
assert.match(reqSkill, /memory-recaller/);
assert.match(reqSkill, /Phase 0\.6 — TAPD Figma design intake/);
assert.match(reqSkill, /figma_ui_constraints/);
assert.match(reqSkill, /design_deviation/);
assert.match(reqSkill, /TAPD ID 不匹配时，分支关联门禁未关闭/);

const reqSection = requirementIntakeRuleSection({ agentPrefix: '.ai-agent' });
assert.match(reqSection, /Requirement Intake/);
assert.match(reqSection, /Figma MCP/);

const flatReq = requirementIntakeRuleMdc();
assert.match(flatReq, /requirement-intake-analysis/);
assert.match(flatReq, /Task Spine/);
assert.match(flatReq, /Figma 设计稿/);

const tapdPointer = tapdSubmitRuleMdc();
assert.match(tapdPointer, /Task Spine/);
assert.match(tapdPointer, /repo-submit/);

const spine = taskSpineMarkdown('.ai-agent');
assert.match(spine, /Task Spine/);
assert.match(spine, /\[1\].*需求与分支决策/);
assert.match(spine, /非 TAPD/);
assert.match(spine, /动态路由/);
assert.match(spine, /\[3\].*自测/);
assert.match(spine, /\[4\].*PR/);
assert.match(spine, /repo-submit\.md/);
assert.match(spine, /Figma 回归验证收敛/);
assert.match(taskSpineHookContext('.ai-agent'), /Task Spine/);
assert.match(taskSpineHookContext('.ai-agent'), /TAPD includes Figma/);

console.log('completion/tapd rules generator tests passed');
