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

import { estimateTokens } from '../../../src/ide-bridge/context/tokens.js';

// Prefer a durable Run handle so timing out also cancels the underlying work.
// Legacy SDKs may only expose prompt(); their cancellation is unavailable.
export async function scratchPrompt(sdk, prompt, options, { timeoutMs, tokenBudget = 4096, label = 'scratch' }) {
  const estimate = estimateTokens(prompt);
  if (estimate > tokenBudget) throw new Error(`${label}-context-budget-exceeded:${estimate}/${tokenBudget}`);
  if (typeof sdk?.Agent?.create !== 'function') {
    if (typeof sdk?.Agent?.prompt !== 'function') throw new Error('cursor-sdk-prompt-unavailable');
    return sdk.Agent.prompt(prompt, options);
  }
  let agent;
  let run;
  let expired = false;
  let timer;
  const timeoutError = () => new Error(`${label}-timeout-${timeoutMs}ms`);
  const cancel = async () => {
    if (typeof run?.cancel === 'function' && run.supports?.('cancel') !== false) await run.cancel();
  };
  const work = (async () => {
    try {
      agent = await sdk.Agent.create(options);
      if (expired) throw timeoutError();
      run = await agent.send(prompt, { mode: 'plan' });
      if (expired) { await cancel(); throw timeoutError(); }
      return await run.wait();
    } finally {
      clearTimeout(timer);
      const dispose = agent?.[Symbol.asyncDispose] ?? agent?.close;
      if (dispose) await dispose.call(agent);
    }
  })();
  return Promise.race([work, new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      void cancel().catch(() => {});
      reject(timeoutError());
    }, timeoutMs);
  })]);
}
