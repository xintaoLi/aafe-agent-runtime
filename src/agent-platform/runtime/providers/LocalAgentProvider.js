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
import { agentFailed, normalizeAgentResponse } from '../../protocol/response.js';

/**
 * Runs builtin agents in-process. `ref` uses the `builtin:<id>` scheme.
 */
export class LocalAgentProvider extends AgentProvider {
  static kind = 'local';

  /**
   * @param {Record<string, { run: (request: object) => Promise<object> }>} implementations
   */
  constructor(implementations = {}) {
    super();
    this.implementations = implementations;
  }

  async invoke(definition, request) {
    const id = String(definition.ref ?? '').startsWith('builtin:')
      ? definition.ref.slice('builtin:'.length)
      : definition.id;
    const impl = this.implementations[id];
    if (!impl) {
      return agentFailed(`local-agent-not-found:${id}`);
    }
    try {
      return normalizeAgentResponse(await impl.run(request));
    } catch (error) {
      return agentFailed(`local-agent-threw:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
