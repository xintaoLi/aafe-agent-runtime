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

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

export const AUTH_MODES = Object.freeze([
  'none',
  'reuse',
  'auto',
  'headed',
  'reuse-or-headed',
  'reuse-or-auto'
]);

export const DEFAULT_E2E_AUTH = Object.freeze({
  mode: 'reuse-or-headed',
  stateDir: '.aafe/e2e/auth',
  env: 'default',
  checkUrl: null,
  readySelector: null,
  loginUrl: null,
  usernameEnv: 'AAFE_E2E_USERNAME',
  passwordEnv: 'AAFE_E2E_PASSWORD',
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  timeoutMs: 300000,
  verifyTimeoutMs: 20000
});

export const NEED_AUTH_CODE = 'need-auth';
export const NEED_AUTH_PROMPT = [
  'E2E 每次执行会先探测用户给出的地址：HTTP 200 且未跳到登录页则跳过 SSO（适合 Dev 本地代理）。',
  '否则再校验登录态；未登录或已过期会重新登录并更新 .aafe/e2e/auth。',
  '当前需要人工 SSO。请在可弹出浏览器的终端执行：',
  '  aafe e2e auth --base-url=\'<本次测试地址>\'',
  '登录完成后按 Enter 保存。也可用 --auth-mode=none 跳过认证。',
  '账号密码只用环境变量，不要写入 .aafe.config.json。认证文件不要提交到 git。'
].join('\n');

export function normalizeAuthMode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['none', 'off', 'skip', 'no'].includes(raw)) return 'none';
  if (['reuse', 'storage', 'storage-state'].includes(raw)) return 'reuse';
  if (['auto', 'password', 'credentials'].includes(raw)) return 'auto';
  if (['headed', 'manual', 'sso', 'interactive'].includes(raw)) return 'headed';
  if (['reuse-or-headed', 'local', 'verify'].includes(raw)) return 'reuse-or-headed';
  if (['reuse-or-auto', 'ci'].includes(raw)) return 'reuse-or-auto';
  return AUTH_MODES.includes(raw) ? raw : null;
}

export function sanitizeAuthEnvName(value) {
  const raw = String(value ?? '').trim() || 'default';
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
}

export function resolveAuthStatePath(root, auth = {}, runtime = {}) {
  if (runtime.storageState) {
    const override = String(runtime.storageState).trim();
    if (override) return path.resolve(root, override);
  }
  const stateDir = auth.stateDir || DEFAULT_E2E_AUTH.stateDir;
  const envName = sanitizeAuthEnvName(runtime.authEnv || process.env.AAFE_E2E_ENV || auth.env || DEFAULT_E2E_AUTH.env);
  return path.resolve(root, stateDir, `${envName}.json`);
}

export function resolveCheckUrl(checkUrl, baseUrl) {
  const raw = String(checkUrl ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = originOf(baseUrl);
  if (!origin) return null;
  const suffix = raw.startsWith('/') ? raw : `/${raw}`;
  return `${origin}${suffix}`;
}

function originOf(baseUrl) {
  try {
    return new URL(String(baseUrl ?? '')).origin;
  } catch {
    return '';
  }
}

export async function storageStateLooksValid(filePath) {
  if (!filePath) return false;
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return false;
  }
  try {
    const data = JSON.parse(raw);
    const cookies = Array.isArray(data.cookies) ? data.cookies.length : 0;
    const origins = Array.isArray(data.origins) ? data.origins.length : 0;
    return cookies + origins > 0;
  } catch {
    return false;
  }
}

export async function checkAuthAgainstUrl(playwright, storageStatePath, checkUrl) {
  if (!playwright?.request || !checkUrl) return true;
  const context = await playwright.request.newContext({ storageState: storageStatePath });
  try {
    const response = await context.get(checkUrl, { timeout: 15000 });
    return response.status() < 400;
  } catch {
    return false;
  } finally {
    await context.dispose().catch(() => {});
  }
}

export function sessionLooksLoggedOut(pageUrl, appOrigin) {
  if (!pageUrl || !appOrigin) return true;
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return true;
  }
  if (url.origin !== appOrigin) return true;
  const haystack = `${url.pathname}${url.hash}${url.search}`;
  return /(?:^|[/#?])(?:login|signin|sign-in|sso|cas|oauth|auth|passport)(?:[/?#]|$)/i.test(haystack);
}

export function accessAllowsSkipAuth({ status, finalUrl, appOrigin }) {
  if (Number(status) !== 200) return false;
  return !sessionLooksLoggedOut(finalUrl, appOrigin);
}

function httpUrlForProbe(pageUrl) {
  try {
    const url = new URL(String(pageUrl ?? ''));
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function resolveRedirectUrl(location, baseUrl) {
  const raw = String(location ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

/**
 * Hit the user-supplied page with no cookies. Dev proxy / local server often
 * returns 200 without SSO; skip login in that case. Hash is not sent over HTTP.
 */
export async function probeAnonymousAccess(config) {
  const startUrl = config.auth?.loginUrl || config.baseUrl;
  const appOrigin = originOf(startUrl);
  const probeUrl = httpUrlForProbe(startUrl);
  if (!startUrl || !appOrigin || !probeUrl) return { skipAuth: false, reason: 'missing-base-url' };
  const verifyMs = Number(config.auth?.verifyTimeoutMs) > 0 ? Number(config.auth.verifyTimeoutMs) : 20000;
  const timeoutMs = Math.min(Math.max(verifyMs, 1000), 8000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' }
    });
    const status = response.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const finalUrl = resolveRedirectUrl(response.headers.get('location'), probeUrl);
      return {
        skipAuth: false,
        status,
        url: finalUrl || probeUrl,
        reason: sessionLooksLoggedOut(finalUrl || probeUrl, appOrigin) ? 'login-redirect' : `http-${status}`
      };
    }
    const skipAuth = accessAllowsSkipAuth({ status, finalUrl: probeUrl, appOrigin });
    return {
      skipAuth,
      status,
      url: probeUrl,
      reason: skipAuth
        ? 'anonymous-200'
        : (sessionLooksLoggedOut(probeUrl, appOrigin) ? 'login-redirect' : `http-${status}`)
    };
  } catch (error) {
    return {
      skipAuth: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyAuthSession(playwright, config, statePath) {
  const startUrl = config.auth?.loginUrl || config.baseUrl;
  const appOrigin = originOf(startUrl);
  if (!startUrl || !appOrigin) return { ok: false, reason: 'missing-base-url' };
  const checkUrl = resolveCheckUrl(config.auth?.checkUrl, config.baseUrl);
  if (checkUrl) {
    const apiOk = await checkAuthAgainstUrl(playwright, statePath, checkUrl);
    if (!apiOk) return { ok: false, reason: 'check-url' };
  }
  const verifyMs = Number(config.auth?.verifyTimeoutMs) > 0 ? Number(config.auth.verifyTimeoutMs) : 20000;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: 'load', timeout: verifyMs });
    if (sessionLooksLoggedOut(page.url(), appOrigin)) {
      return { ok: false, reason: 'redirected-to-login', url: page.url() };
    }
    if (config.auth?.readySelector) {
      const visible = await page.locator(config.auth.readySelector).first().isVisible().catch(() => false);
      if (!visible) return { ok: false, reason: 'ready-selector' };
    }
    await mkdir(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    return { ok: true, refreshed: true, url: page.url() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Resolve whether to reuse / capture / skip auth. Does not launch a browser
 * unless the chosen mode needs a fresh storageState.
 */
export async function prepareE2eAuth({
  config,
  interactive = Boolean(process.stdin.isTTY),
  env = process.env,
  probeOnly = false
} = {}) {
  const mode = config.authMode ?? 'reuse-or-headed';
  if (mode === 'none') return { mode, storageState: null };

  const statePath = config.authStatePath;
  const hasState = await storageStateLooksValid(statePath);
  if (probeOnly) {
    if (hasState) return { mode, storageState: statePath, reused: true, pendingVerify: true };
    if (mode === 'reuse') {
      return needAuthResult('认证文件缺失或已过期。请先 `aafe e2e auth`，或使用默认的 --auth-mode=reuse-or-headed 重新登录。');
    }
    return { mode, storageState: null, pendingAnonymous: true };
  }

  try {
    const anonymous = await probeAnonymousAccess(config);
    if (anonymous.skipAuth) {
      console.error('E2E 认证：目标地址 HTTP 200 且未跳转登录（如 Dev 本地代理），跳过 SSO。');
      return { mode, storageState: null, skipped: true, reason: anonymous.reason };
    }
    console.error(`E2E 认证：匿名访问未通过（${anonymous.reason}），继续校验登录态。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`E2E 认证：匿名探测失败（${message}），继续校验登录态。`);
  }

  if (hasState) {
    try {
      const playwright = await import('playwright');
      const verified = await verifyAuthSession(playwright, config, statePath);
      if (verified.ok) {
        console.error('E2E 认证：已登录且未过期，已刷新 storageState。');
        return { mode, storageState: statePath, reused: true, verified: true };
      }
      console.error(`E2E 认证：未登录或已过期（${verified.reason}），开始重新登录。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`E2E 认证：校验失败（${message}），开始重新登录。`);
    }
  } else {
    console.error('E2E 认证：没有可用登录态，开始登录。');
  }

  if (mode === 'reuse') {
    return needAuthResult('认证文件缺失或已过期。请先 `aafe e2e auth`，或改用 --auth-mode=reuse-or-headed 重新登录。');
  }

  const captureMode = mode === 'reuse-or-auto' || mode === 'auto' ? 'auto' : 'headed';
  if (captureMode === 'auto') {
    const missing = missingAutoAuthConfig(config, env);
    if (missing) {
      if (mode === 'reuse-or-auto') {
        return runHeadedCaptureOrNeed(config, interactive);
      }
      return needAuthResult(missing);
    }
    const captured = await captureAuthState({ config, mode: 'auto', env });
    if (captured.needInput) return captured;
    return confirmCapturedSession(config, captured.storageState, mode);
  }

  const headed = await runHeadedCaptureOrNeed(config, interactive);
  if (headed.needInput) return headed;
  return confirmCapturedSession(config, headed.storageState, mode);
}

async function confirmCapturedSession(config, statePath, mode) {
  if (!statePath) return needAuthResult(NEED_AUTH_PROMPT);
  try {
    const playwright = await import('playwright');
    const verified = await verifyAuthSession(playwright, config, statePath);
    if (!verified.ok) {
      return needAuthResult('重新登录后仍未进入业务页（可能 SSO 未回调完成）。请确认已回到业务系统后再保存。');
    }
  } catch {
    // Chromium probe failed after save; keep the new state for the upcoming cases.
  }
  return { mode, storageState: statePath, captured: true, verified: true };
}

export async function captureAuthState({ config, mode = 'headed', env = process.env } = {}) {
  const playwright = await import('playwright');
  const statePath = config.authStatePath;
  await mkdir(path.dirname(statePath), { recursive: true });
  const startUrl = config.auth.loginUrl || config.baseUrl;
  if (!startUrl) return needAuthResult(NEED_AUTH_PROMPT);

  const headed = mode === 'headed';
  const browser = await playwright.chromium.launch({ headless: !headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: 'load', timeout: config.auth.timeoutMs });
    if (mode === 'auto') {
      await fillAutoLogin(page, config, env);
    } else {
      const waited = await waitForManualLogin(config.auth.timeoutMs);
      if (!waited.ok) {
        return needAuthResult(waited.prompt || NEED_AUTH_PROMPT);
      }
    }
    if (config.auth.readySelector) {
      await page.locator(config.auth.readySelector).first().waitFor({
        state: 'visible',
        timeout: Math.min(config.auth.timeoutMs, 60000)
      });
    }
    await context.storageState({ path: statePath });
    if (!await storageStateLooksValid(statePath)) {
      return needAuthResult('登录完成后没有保存到 Cookie / LocalStorage。请确认已回到业务页后再保存。');
    }
    const checkUrl = resolveCheckUrl(config.auth.checkUrl, config.baseUrl);
    if (checkUrl && !await checkAuthAgainstUrl(playwright, statePath, checkUrl)) {
      return needAuthResult(`认证校验失败：${checkUrl} 仍返回 4xx。请重新登录或检查 e2e.auth.checkUrl。`);
    }
    return { storageState: statePath, captured: true, mode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return needAuthResult(`采集认证失败：${message}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function missingAutoAuthConfig(config, env) {
  const username = String(env[config.auth.usernameEnv] ?? '').trim();
  const password = String(env[config.auth.passwordEnv] ?? '').trim();
  if (!username || !password) {
    return `自动登录需要环境变量 ${config.auth.usernameEnv} 和 ${config.auth.passwordEnv}，不要把密码写进配置。扫码 / MFA 请改用 --auth-mode=headed 或 \`aafe e2e auth\`。`;
  }
  if (!config.auth.usernameSelector || !config.auth.passwordSelector) {
    return '自动登录需要在 .aafe.config.json 配置 e2e.auth.usernameSelector / passwordSelector / submitSelector。企业微信扫码请用 headed。';
  }
  return null;
}

async function fillAutoLogin(page, config, env) {
  const username = String(env[config.auth.usernameEnv] ?? '');
  const password = String(env[config.auth.passwordEnv] ?? '');
  await page.locator(config.auth.usernameSelector).first().fill(username);
  await page.locator(config.auth.passwordSelector).first().fill(password);
  if (config.auth.submitSelector) {
    await page.locator(config.auth.submitSelector).first().click();
  } else {
    await page.locator(config.auth.passwordSelector).first().press('Enter');
  }
  const origin = originOf(config.baseUrl);
  if (origin) {
    await page.waitForURL((url) => url.origin === origin, { timeout: config.auth.timeoutMs });
  }
}

async function waitForManualLogin(timeoutMs) {
  if (!process.stdin.isTTY) {
    return { ok: false, prompt: NEED_AUTH_PROMPT };
  }
  console.error('请在打开的浏览器中完成 SSO 登录，确认已回到业务系统后，回到此终端按 Enter 保存认证态。');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await Promise.race([
      rl.question(''),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('auth-timeout')), timeoutMs);
      })
    ]);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'auth-timeout') {
      return { ok: false, prompt: `人工登录等待超时（${timeoutMs}ms）。请重跑 \`aafe e2e auth\`。` };
    }
    throw error;
  } finally {
    rl.close();
  }
}

async function runHeadedCaptureOrNeed(config, interactive) {
  if (!interactive) return needAuthResult(NEED_AUTH_PROMPT);
  const captured = await captureAuthState({ config, mode: 'headed' });
  if (captured.needInput) return captured;
  return { mode: config.authMode, storageState: captured.storageState, captured: true };
}

function needAuthResult(prompt) {
  return {
    needInput: 'auth',
    askUser: true,
    prompt,
    persistBaseUrl: false,
    storageState: null
  };
}
