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

import { spawn } from 'node:child_process';
import { AgentProvider } from './AgentProvider.js';
import { agentFailed, normalizeAgentResponse } from '../../protocol/response.js';

/**
 * Agents exposed as executables. `ref` is a shell-less argv string such as
 * `my-agent --mode=impact`; the AgentRequest is piped in on stdin and the
 * AgentResponse is expected as JSON on stdout.
 */
export class CliAgentProvider extends AgentProvider {
  static kind = 'cli';

  constructor({ cwd = process.cwd(), env = process.env } = {}) {
    super();
    this.cwd = cwd;
    this.env = env;
  }

  async invoke(definition, request) {
    const argv = String(definition.ref ?? '').trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) {
      return agentFailed(`cli-agent-invalid-ref:${definition.id}`);
    }

    try {
      const { stdout, code } = await run(argv, {
        cwd: this.cwd,
        env: this.env,
        input: JSON.stringify(request),
        timeoutMs: request.constraints?.timeoutMs ?? 120000
      });
      if (code !== 0) {
        return agentFailed(`cli-agent-exit-code:${code}`);
      }
      return normalizeAgentResponse(JSON.parse(stdout));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return agentFailed(`cli-agent-failed:${message}`);
    }
  }
}

function run([command, ...args], { cwd, env, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(stderr.trim() || `exit code ${code}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });

    child.stdin.end(input);
  });
}
