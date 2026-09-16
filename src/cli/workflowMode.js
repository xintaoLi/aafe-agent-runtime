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

export const WORKFLOW_MODE_ASK = 'ask';
export const WORKFLOW_MODE_AUTONOMOUS = 'autonomous';

export const BOT_INTERACTION_POLICY_VERSION = 'blocking-only-v1';

/** A Bot policy overlay, not a bypass of execution permissions or test results. */
export function botInteractionPolicy(mode) {
  if (!isAutonomousWorkflowMode(mode)) return '';
  return [
    'AAFE Bot autonomous interaction policy: blocking-only-v1. Decide routine proceed/skip choices yourself; do not ask for repeated confirmations.',
    'This overlay replaces legacy skill instructions that always Hard Ask for a missing UI URL or URL role. Owner prohibitions, explicit mandatory acceptance requirements and native security permissions still take precedence.',
    'First inspect user-designated settings files and existing task context for the application test URL, proxy and launch settings; a supplied config file is a valid source, not a reason to ask the user to retype a URL. Do not execute arbitrary config code just to inspect it. TAPD/PR links are not application URLs. Never guess an environment or claim that an unverified deployment contains this change.',
    'For local UI verification, reading source project configuration does not forbid task-worktree-only E2E adapters. You may generate or patch AAFE wrapper/proxy/port files inside the isolated task worktree to consume AAFE_E2E_PORT and AAFE_E2E_DEV_URL, while preserving the source project local.settings files and project defaults.',
    'If URL purpose is clear from the task/config, select target/origin/template and explain briefly without an A/B/C approval round. If unclear, do not navigate to a guessed target.',
    'If optional UI validation lacks an application URL after inspection, record UI as not-run/skipped, explain the evidence gap and residual risk, and continue independent checks and otherwise authorized Commit/PR/TAPD delivery. Do not require the phrase "skip UI verification, continue delivery". Do not mark E2E passed. State the missing UI verification in delivery/backfill results.',
    'A missing optional UI URL blocks that test, not every downstream gate. A CLI need-base-url/need-url-role result is still truthful; decide workflow applicability rather than rewriting that result. Re-evaluate old waiting-user records under this policy; old missing-URL asks are not new user restrictions.',
    'Put optional skipped checks and residual risks in summary/evidence, not remainingSteps. Reserve remainingSteps and ask/blocked delivery records for genuinely required unfinished work; do not cascade an optional UI omission into waiting-user:commit/pr/tapd_backfill.',
    'Stop and ask concisely only when a required outcome cannot proceed safely: an explicit owner-required UI-pass prerequisite, actual test failure, missing required authentication, denied permission, unclear target with material consequences, destructive/irreversible action lacking authorization, or a genuine product/security decision. Never turn failed tests or auth/permission errors into successful skips.',
    'Keep valid pending confirmations; combine genuinely missing information into one specific question. This policy neither authorizes unrelated modifications nor disables native approval, branch rules, credential protection or delivery evidence verification.'
  ].join('\n');
}

const ASK_ALIASES = new Set([
  'ask',
  'inquire',
  'inquiry',
  'interactive',
  'askmode',
  '询问',
  '询问模式'
]);

const AUTONOMOUS_ALIASES = new Set([
  'autonomous',
  'auto',
  'judge',
  'autonomousjudge',
  'automode',
  '自主',
  '自主判断',
  '自主判断模式',
  '自动'
]);

export function defaultWorkflowModeConfig() {
  return {
    workflow: WORKFLOW_MODE_ASK
  };
}

/**
 * Normalize global workflow mode.
 * Accepts: ask | inquire | interactive | 询问模式
 *          autonomous | auto | judge | 自主判断模式
 * Default: ask
 */
export function normalizeWorkflowMode(value) {
  const raw = String(value ?? WORKFLOW_MODE_ASK).trim().toLowerCase();
  const compact = raw.replace(/[_-\s]/g, '');
  if (AUTONOMOUS_ALIASES.has(raw) || AUTONOMOUS_ALIASES.has(compact)) {
    return WORKFLOW_MODE_AUTONOMOUS;
  }
  if (ASK_ALIASES.has(raw) || ASK_ALIASES.has(compact)) {
    return WORKFLOW_MODE_ASK;
  }
  return WORKFLOW_MODE_ASK;
}

export function resolveWorkflowModeConfig(projectConfig = {}, overrides = {}) {
  const fromConfig = projectConfig.mode && typeof projectConfig.mode === 'object'
    ? projectConfig.mode
    : {};
  const topLevelString = typeof projectConfig.mode === 'string' ? projectConfig.mode : null;
  const workflow = normalizeWorkflowMode(
    overrides.workflow
      ?? overrides.workflowMode
      ?? fromConfig.workflow
      ?? projectConfig.workflowMode
      ?? topLevelString
      ?? WORKFLOW_MODE_ASK
  );
  return {
    ...defaultWorkflowModeConfig(),
    ...fromConfig,
    workflow
  };
}

export function buildWorkflowModeConfigFromAnswers(answers = {}, existing = null) {
  const base = {
    ...defaultWorkflowModeConfig(),
    ...(existing && typeof existing === 'object' ? existing : {})
  };
  if (answers.workflow != null || answers.workflowMode != null) {
    base.workflow = normalizeWorkflowMode(answers.workflow ?? answers.workflowMode);
  }
  return base;
}

export function isAutonomousWorkflowMode(configOrMode) {
  if (typeof configOrMode === 'string') {
    return normalizeWorkflowMode(configOrMode) === WORKFLOW_MODE_AUTONOMOUS;
  }
  return normalizeWorkflowMode(configOrMode?.workflow) === WORKFLOW_MODE_AUTONOMOUS;
}
