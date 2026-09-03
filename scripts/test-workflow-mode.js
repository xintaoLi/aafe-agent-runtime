import assert from 'node:assert/strict';
import {
  normalizeWorkflowMode,
  resolveWorkflowModeConfig,
  buildWorkflowModeConfigFromAnswers,
  isAutonomousWorkflowMode,
  defaultWorkflowModeConfig,
  WORKFLOW_MODE_ASK,
  WORKFLOW_MODE_AUTONOMOUS
} from '../src/cli/workflowMode.js';
import {
  workflowModePointerRuleMdc,
  workflowModeProjectRuleMdc,
  workflowModeSkillContent,
  workflowModeRuleSection,
  workflowModeGatePreamble
} from '../src/cli/workflowModeRules.js';

assert.equal(normalizeWorkflowMode(undefined), 'ask');
assert.equal(normalizeWorkflowMode('ASK'), 'ask');
assert.equal(normalizeWorkflowMode('inquire'), 'ask');
assert.equal(normalizeWorkflowMode('询问模式'), 'ask');
assert.equal(normalizeWorkflowMode('autonomous'), 'autonomous');
assert.equal(normalizeWorkflowMode('auto'), 'autonomous');
assert.equal(normalizeWorkflowMode('自主判断模式'), 'autonomous');
assert.equal(normalizeWorkflowMode('unknown'), 'ask');

assert.deepEqual(defaultWorkflowModeConfig(), { workflow: WORKFLOW_MODE_ASK });
assert.deepEqual(resolveWorkflowModeConfig({}), { workflow: 'ask' });
assert.deepEqual(resolveWorkflowModeConfig({ mode: { workflow: 'autonomous' } }), { workflow: 'autonomous' });
assert.deepEqual(resolveWorkflowModeConfig({ mode: 'autonomous' }), { workflow: 'autonomous' });
assert.deepEqual(resolveWorkflowModeConfig({}, { workflowMode: 'auto' }), { workflow: 'autonomous' });
assert.deepEqual(resolveWorkflowModeConfig({ mode: { workflow: 'ask' } }, { workflow: 'autonomous' }), {
  workflow: 'autonomous'
});

assert.equal(isAutonomousWorkflowMode('autonomous'), true);
assert.equal(isAutonomousWorkflowMode({ workflow: 'ask' }), false);

assert.deepEqual(buildWorkflowModeConfigFromAnswers({ workflow: '自主判断' }), { workflow: WORKFLOW_MODE_AUTONOMOUS });

const pointer = workflowModePointerRuleMdc();
assert.match(pointer, /workflow-mode\.md/);
assert.match(pointer, /mode\.workflow/);
assert.match(pointer, /autonomous/);
assert.match(pointer, /主动评估改进空间/);
assert.match(pointer, /PR 成功后带 `pr_url`/);

const layered = workflowModePointerRuleMdc({
  agentPrefix: 'bklog/web/.ai-agent',
  moduleGlob: 'bklog/web/**',
  moduleName: 'bklog-web'
});
assert.match(layered, /bklog\/web\/\.ai-agent\/skills\/workflow-mode\.md/);
assert.match(layered, /globs: bklog\/web\/\*\*/);

const project = workflowModeProjectRuleMdc({ agentPrefix: '.ai-agent' });
assert.match(project, /询问模式/);
assert.match(project, /自主判断模式/);
assert.match(project, /Hard Ask/);
assert.match(project, /明显改进空间/);
assert.match(project, /状态逐步流转/);

const skill = workflowModeSkillContent('.ai-agent');
assert.match(skill, /Decision table/);
assert.match(skill, /Hard Ask/);
assert.match(skill, /判定记录/);
assert.match(skill, /aafe update --workflow-mode/);
assert.match(skill, /tapd-submit-backfill\.md/);
assert.match(skill, /Post-implementation improvement/);
assert.match(skill, /临时注入 GitHub Token/);
assert.doesNotMatch(skill, /force push 后自动/);

const section = workflowModeRuleSection({ agentPrefix: '.ai-agent' });
assert.match(section, /全局工作流模式/);
assert.match(section, /Hard Ask/);

const preamble = workflowModeGatePreamble('.ai-agent');
assert.match(preamble, /mode\.workflow/);
assert.match(preamble, /autonomous/);

console.log('workflow mode tests passed');
