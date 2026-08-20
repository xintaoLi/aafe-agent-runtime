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
assert.match(projectImpact, /询问是否 Commit/);
assert.match(projectImpact, /submit\.cli/);
assert.match(projectImpact, /仅当任务过程中有关联 TAPD 单/);
assert.match(projectImpact, /任务评估/);

const impactSection = taskCompletionImpactRuleSection({ agentPrefix: '.ai-agent' });
assert.match(impactSection, /aafe test --diff/);
assert.match(impactSection, /ui_test_paths/);
assert.match(impactSection, /submit\.cli/);

const forecast = architectureImpactTestForecastSkillContent('.ai-agent');
assert.match(forecast, /impact_class/);
assert.match(forecast, /ui_test_paths/);
assert.match(forecast, /Step 2\.5/);
assert.match(forecast, /tapd-submit-backfill\.md/);
assert.match(forecast, /本 Skill 不自动开浏览器/);

const selfTest = minimalConvergentSelfTestSkillContent('.ai-agent');
assert.match(selfTest, /aafe test --diff/);
assert.match(selfTest, /test\//);
assert.match(selfTest, /ui_test_paths/);
assert.match(selfTest, /Step 2\.5/);
assert.match(selfTest, /Hand off to submit/);
assert.match(selfTest, /user_declined_browser_mcp/);
assert.match(selfTest, /请提供要测试的完整页面 URL/);

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

const tapdSection = tapdSubmitRuleSection();
assert.match(tapdSection, /comments_create/);
assert.match(tapdSection, /submit\.cli/);
assert.match(tapdSection, /Commit\/PR Gate|询问 Commit/);

const tapdSkill = tapdSubmitBackfillSkillContent('.ai-agent');
assert.match(tapdSkill, /Commit\/PR Gate/);
assert.match(tapdSkill, /Phase B — Ask Commit/);
assert.match(tapdSkill, /submit\.cli/);
assert.match(tapdSkill, /gtm commit/);
assert.match(tapdSkill, /gtm pr/);
assert.match(tapdSkill, /gh pr create/);
assert.match(tapdSkill, /aafe update --submit-cli/);
assert.match(tapdSkill, /GTM Task Start/);
assert.match(tapdSkill, /gtm create issue/);
assert.match(tapdSkill, /最后 9 位/);
assert.match(tapdSkill, /Phase D — Try PR/);
assert.match(tapdSkill, /Phase E — Ask TAPD backfill/);
assert.match(tapdSkill, /有关联 TAPD 时/);

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

const reqSkill = requirementIntakeAnalysisSkillContent('.ai-agent');
assert.match(reqSkill, /Phase 1 — Analyze & clarify/);
assert.match(reqSkill, /Phase 2 — Historical/);
assert.match(reqSkill, /target_mode_id: \"plan\"/);
assert.match(reqSkill, /memory-recaller/);

const reqSection = requirementIntakeRuleSection({ agentPrefix: '.ai-agent' });
assert.match(reqSection, /Requirement Intake/);

const flatReq = requirementIntakeRuleMdc();
assert.match(flatReq, /requirement-intake-analysis/);

console.log('completion/tapd rules generator tests passed');
