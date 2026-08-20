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

/**
 * Transport abstraction for agent invocation (RFC §31).
 *
 * Nothing outside a provider is allowed to open a socket or spawn a process;
 * that is what keeps `policies.allowNetwork` enforceable in one place.
 *
 * @typedef {import('../../protocol/request.js').AgentRequest} AgentRequest
 * @typedef {import('../../protocol/response.js').AgentResponse} AgentResponse
 */
export class AgentProvider {
  /** @type {string} */
  static kind = 'abstract';

  get kind() {
    return /** @type {typeof AgentProvider} */ (this.constructor).kind;
  }

  /**
   * @param {import('../../registry/definition.js').AgentDefinition} _definition
   * @param {AgentRequest} _request
   * @returns {Promise<AgentResponse>}
   */
  async invoke(_definition, _request) {
    throw new Error(`AgentProvider.invoke not implemented by ${this.kind}`);
  }
}
