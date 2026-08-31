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
 * Agents exposed as MCP tools over stdio (RFC §31).
 *
 * `ref` is `<command and args>#<toolName>`, for example:
 *   "npx -y @acme/impact-mcp#analyze_impact"
 *
 * A server is spawned per invocation rather than pooled. That costs a process
 * start, but it keeps a crashed or wedged agent from poisoning later nodes in
 * the run, which matters more here than latency.
 */
export class McpAgentProvider extends AgentProvider {
  static kind = 'mcp';

  constructor({ cwd = process.cwd(), env = process.env, clientInfo = { name: 'aafe', version: '0.2.0' } } = {}) {
    super();
    this.cwd = cwd;
    this.env = env;
    this.clientInfo = clientInfo;
  }

  async invoke(definition, request) {
    const parsed = parseRef(definition.ref);
    if (!parsed) return agentFailed(`mcp-agent-invalid-ref:${definition.id}`);

    const session = new McpStdioSession({
      argv: parsed.argv,
      cwd: this.cwd,
      env: this.env,
      timeoutMs: request.constraints?.timeoutMs ?? 120000
    });

    try {
      await session.start();
      await session.initialize(this.clientInfo);
      const payload = await session.callTool(parsed.tool, { request });
      return normalizeAgentResponse(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return agentFailed(`mcp-agent-failed:${message}`);
    } finally {
      session.dispose();
    }
  }
}

/**
 * @returns {{argv:string[], tool:string}|null}
 */
export function parseRef(ref) {
  const value = String(ref ?? '').trim();
  const hash = value.lastIndexOf('#');
  if (hash <= 0) return null;

  const argv = value.slice(0, hash).trim().split(/\s+/).filter(Boolean);
  const tool = value.slice(hash + 1).trim();
  return argv.length > 0 && tool ? { argv, tool } : null;
}

/**
 * Minimal MCP client: just enough of the protocol to initialize a stdio server
 * and call one tool. Depending on the official SDK for two request shapes
 * would add a runtime dependency to a package that otherwise has one.
 */
export class McpStdioSession {
  constructor({ argv, cwd, env, timeoutMs = 120000 }) {
    this.argv = argv;
    this.cwd = cwd;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
  }

  async start() {
    const [command, ...args] = this.argv;
    this.child = spawn(command, args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#consume(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.child.on('error', (error) => this.#rejectAll(error));
    this.child.on('close', (code) => {
      this.#rejectAll(new Error(`server exited with code ${code}${this.stderr ? `: ${this.stderr.trim()}` : ''}`));
    });
  }

  async initialize(clientInfo) {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo
    });
    // The spec requires the client to confirm before any tool call.
    this.notify('notifications/initialized');
    return result;
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) {
      throw new Error(textOf(result) || 'tool reported an error');
    }
    return extractPayload(result);
  }

  request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.#write(message);
    });
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  dispose() {
    if (!this.child) return;
    this.child.removeAllListeners('close');
    this.child.kill('SIGTERM');
    this.child = null;
  }

  #write(message) {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * Servers emit newline-delimited JSON; anything unparsable is log noise a
   * server wrote to stdout by mistake and is skipped rather than fatal.
   */
  #consume(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.#dispatch(message);
    }
  }

  #dispatch(message) {
    if (message.id === undefined || !this.pending.has(message.id)) return;
    const entry = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(message.error.message ?? 'jsonrpc error'));
      return;
    }
    entry.resolve(message.result);
  }

  #rejectAll(error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}

/**
 * An MCP tool returns content blocks. An agent is expected to answer with a
 * JSON AgentResponse, either structured or as a JSON text block.
 */
export function extractPayload(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = textOf(result);
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
