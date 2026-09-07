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

import { AgentProvider } from './AgentProvider.js';
import { agentFailed, agentSuccess } from '../../protocol/response.js';
import { CodexTaskRuntime } from '../CodexTaskRuntime.js';
import { randomUUID } from 'node:crypto';

/**
 * Orchestrator entry using the same local CLI transport as durable bot tasks.
 */
export class CodexAgentProvider extends AgentProvider {
  static kind = 'codex';

  constructor({ cwd = process.cwd(), spawnProcess } = {}) {
    super();
    this.cwd = cwd;
    this.spawnProcess = spawnProcess;
  }

  async invoke(definition, request) {
    const runtime = new CodexTaskRuntime({ spawnProcess: this.spawnProcess });
    try {
      const result = await runtime.run({ id: randomUUID(), model: definition.model }, JSON.stringify({
        goal: request.goal, input: request.input, context: request.context, constraints: request.constraints
      }), {
        cwd: definition.cwd ?? request.context?.root ?? this.cwd,
        mode: definition.runtime === 'cloud' ? 'cloud' : 'local',
        executionMode: request.capability === 'implementation' && request.constraints?.readOnly !== true ? 'agent' : 'plan',
        tokenBudget: request.constraints?.tokenBudget ?? 12000,
        codex: { ...definition.codex, ...(request.constraints?.timeoutMs ? { timeoutMs: request.constraints.timeoutMs } : {}) }
      });
      return agentSuccess(result, { metrics: { tokens: result.usage.totalTokens, cost: result.usage.cost } });
    } catch (error) { return agentFailed(error.message); }
    finally { await runtime.closeAll(); }
  }
}
