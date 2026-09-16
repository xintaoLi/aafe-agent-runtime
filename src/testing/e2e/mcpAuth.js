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



import { readProjectConfig } from './config.js';
import { resolveCursorMcpForRun } from '../../cli/agentMcp.js';
import path from 'node:path';

export async function resolveTokenMcp(config) {
  if (config.auth?.mcp === false) return null;
  const selected = config.auth?.mcp?.server;
  const roots = [...new Set([config.configRoot ?? config.root, config.mcpConfigRoot].filter(Boolean))];
  for (const root of roots) {
    const project = await readProjectConfig(root, { strict: true });
    // Configuration only, not a Cursor invocation. Resolve file paths at source.
    const resolved = await resolveCursorMcpForRun(project.agent?.mcp ?? {}, { root });
    if (!resolved.enabled) return null;
    if (resolved.warnings?.length) throw new Error('mcp-auth-config-unreadable');
    const matches = Object.entries(resolved.servers).filter(([name, server]) =>
      server.enabled !== false && server.disabled !== true &&
      (selected ? name === selected : /git[-_]?code.*(?:token|mcp)|git[-_]?code$/i.test(name) ||
        Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === 'x-cookie-provider-token')));
    if (matches.length > 1) throw new Error('mcp-auth-ambiguous-server');
    if (matches.length) {
      const server = matches[0][1];
      return server.command ? { ...server, cwd: path.resolve(root, server.cwd ?? '.') } : server;
    }
  }
  if (selected) throw new Error('mcp-auth-server-unavailable');
  return null;
}

export function extractLoginCookie(result) {
  if (result?.isError) throw new Error('mcp-auth-tool-failed');
  let payload = result?.structuredContent;
  if (!payload) {
    for (const block of result?.content ?? []) {
      if (block.type !== 'text') continue;
      try { payload = JSON.parse(block.text); } catch { continue; }
      if (payload?.cookies) break;
    }
  }
  const token = payload?.cookies?.bk_token;
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('mcp-auth-cookie-invalid');
  return token; // Preserve encoding and whitespace exactly; never log or persist.
}

export async function getLoginCookie(server, root, timeoutMs = null) {
  timeoutMs = Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : Math.min(Math.max(Number(server?.timeoutMs) || Number(server?.timeout) * 1000 || 60000, 1000), 15 * 60 * 1000);
  const tool = 'get_login_cookie';
  if (server.disabled_tools?.includes(tool) ||
      (server.enabled_tools && !server.enabled_tools.includes(tool))) throw new Error('mcp-auth-tool-disabled');
  if (/\$\{[^}]+\}/.test(JSON.stringify(server))) throw new Error('mcp-auth-env-unresolved');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'aafe-e2e-auth', version: '1.0.0' }, { capabilities: {} });
  let transport;
  try {
    if (server.url) {
      const url = new URL(server.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      // Never follow redirects with the configured credential headers.
      const safeFetch = (input, init) => {
        const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (target.origin !== url.origin) throw new Error('mcp-auth-origin-mismatch');
        return fetch(input, { ...init, redirect: 'error' });
      };
      const options = { requestInit: { headers: server.headers ?? {} }, fetch: safeFetch,
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } };
      if (server.type === 'sse') {
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
        transport = new SSEClientTransport(url, options);
      } else {
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        transport = new StreamableHTTPClientTransport(url, options);
      }
    } else {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      transport = new StdioClientTransport({ command: server.command, args: server.args ?? [],
        cwd: path.resolve(root, server.cwd ?? '.'), env: { ...process.env, ...server.env }, stderr: 'ignore' });
    }
    await client.connect(transport, { timeout: timeoutMs });
    let cursor;
    let found = false;
    for (let page = 0; page < 20; page++) {
      const listed = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs });
      if (listed.tools.some((item) => item.name === tool)) { found = true; break; }
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    if (!found) throw new Error();
    // Exactly one call: timeouts may have triggered a remote pipeline already.
    return extractLoginCookie(await client.callTool({ name: tool, arguments: {} }, undefined, { timeout: timeoutMs }));
  } catch {
    // Tool errors, URLs and transport diagnostics can contain credentials.
    throw new Error('mcp-auth-acquire-failed');
  } finally {
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
  }
}

export function tokenCookie(token, baseUrl) {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('mcp-auth-target-invalid');
  return { name: 'bk_token', value: token, url: url.origin + '/', secure: url.protocol === 'https:' };
}

export async function verifyTokenSession(playwright, config, cookies) {
  const origin = new URL(config.baseUrl).origin;
  let browser, context;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();
    const timeout = Math.min(Number(config.auth.verifyTimeoutMs) || 20000, 60000);
    const response = await page.goto(config.baseUrl, { waitUntil: 'load', timeout });
    const final = new URL(page.url());
    if (!response || response.status() >= 400 || final.origin !== origin ||
        /(?:^|[/#?])(?:login|signin|accounts|sso|cas|oauth|auth|passport)(?:[/?#]|$)/i.test(final.pathname + final.hash)) return false;
    if (config.auth.readySelector) {
      await page.locator(config.auth.readySelector).first().waitFor({ state: 'visible', timeout });
    }
    if (config.auth.checkUrl) {
      const check = new URL(config.auth.checkUrl, origin);
      if (check.origin !== origin) return false;
      const result = await context.request.get(check.href, { timeout, maxRedirects: 0 });
      if (result.status() !== 200) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function prepareTokenAuth(config, server, {
  acquire = getLoginCookie, verify = verifyTokenSession, playwright
} = {}) {
  let target;
  try {
    target = tokenCookie('', config.baseUrl);
    if (config.auth?.checkUrl && new URL(config.auth.checkUrl, target.url).origin !== new URL(target.url).origin) {
      throw new Error('mcp-auth-check-origin-invalid');
    }
  } catch {
    return authFailure('target-config');
  }
  try {
    playwright ??= await import('playwright');
  } catch {
    return authFailure('playwright-unavailable');
  }
  let token;
  try {
    token = await acquire(server, config.root);
  } catch {
    return authFailure('token-acquire');
  }
  const cookies = [tokenCookie(token, config.baseUrl)];
  try {
    if (!await verify(playwright, config, cookies)) return authFailure('login-verify');
  } catch {
    return authFailure('login-verify');
  }
  return { mode: 'mcp', cookies, verified: true };
}

function authFailure(stage) {
  return {
    needInput: 'auth',
    reason: `mcp-auth-${stage}-failed`,
    prompt: `Get Token MCP 认证失败（阶段：${stage}）；本轮未重试，未执行 E2E。请检查对应阶段后继续。`
  };
}
