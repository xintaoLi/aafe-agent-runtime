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

export const CODEX_RUNTIME_NOT_IMPLEMENTED = 'codex-runtime-not-implemented';

/**
 * Reserved Codex task runtime. The WeCom / TaskManager entry exists so a task
 * can name `provider: "codex"`; the CLI / SDK wiring is intentionally absent.
 *
 * TODO: invoke Codex (CLI or SDK) with the same durable contract as
 * CursorTaskRuntime — one Agent per task, many Runs, recover / cancel / close.
 */
export class CodexTaskRuntime {
  static kind = 'codex';

  constructor({ onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
  }

  get kind() {
    return /** @type {typeof CodexTaskRuntime} */ (this.constructor).kind;
  }

  async run(task) {
    // TODO: start a Codex run for `task` and stream progress events.
    throw new Error(`${CODEX_RUNTIME_NOT_IMPLEMENTED}:${task?.id ?? 'unknown'}`);
  }

  async continue(task, prompt, options = {}) {
    return this.run(task, prompt, options);
  }

  async recover(task) {
    // TODO: reattach to an in-flight Codex run after process restart.
    return { status: 'missing', agentId: task?.codex?.agentId ?? null, runId: task?.codex?.activeRunId ?? null };
  }

  async cancel() {
    // TODO: cancel the active Codex run.
    return { cancelled: false, reason: CODEX_RUNTIME_NOT_IMPLEMENTED };
  }

  async close() {}

  async closeAll() {}
}
