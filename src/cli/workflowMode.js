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
