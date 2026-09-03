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

export const TASK_STATUSES = Object.freeze([
  'created',
  'queued',
  'planning',
  'ready',
  'running',
  'waiting',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'blocked'
]);

export const TERMINAL_TASK_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);

const TRANSITIONS = Object.freeze({
  created: ['queued', 'cancelled', 'blocked'],
  queued: ['planning', 'running', 'cancelled', 'blocked'],
  planning: ['queued', 'ready', 'waiting', 'failed', 'cancelled', 'blocked'],
  ready: ['queued', 'running', 'cancelled', 'blocked'],
  running: ['waiting', 'verifying', 'completed', 'failed', 'cancelled', 'blocked'],
  waiting: ['queued', 'running', 'cancelled', 'blocked'],
  verifying: ['completed', 'failed', 'waiting', 'cancelled', 'blocked'],
  completed: ['queued', 'blocked'],
  failed: ['queued', 'blocked'],
  cancelled: ['queued', 'blocked'],
  blocked: ['queued', 'cancelled']
});

export function isTaskStatus(value) {
  return TASK_STATUSES.includes(value);
}

export function isTerminalTaskStatus(value) {
  return TERMINAL_TASK_STATUSES.includes(value);
}

export function canTransitionTask(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertTaskTransition(from, to) {
  if (!isTaskStatus(from)) throw new Error(`unknown-task-status:${from}`);
  if (!isTaskStatus(to)) throw new Error(`unknown-task-status:${to}`);
  if (!canTransitionTask(from, to)) {
    throw new Error(`illegal-task-transition:${from}->${to}`);
  }
}
