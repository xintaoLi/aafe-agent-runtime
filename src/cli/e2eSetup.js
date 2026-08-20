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
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from './detect.js';
import { DEFAULT_E2E_CONFIG, isE2eEnabled, readProjectConfig } from '../testing/e2e/config.js';
import { detectPlaywright } from '../testing/e2e/runner.js';

export const PLAYWRIGHT_PACKAGES = Object.freeze(['playwright', '@playwright/test']);

export async function inspectPlaywrightSetup(root) {
  const pkg = await readJson(path.join(root, 'package.json'));
  const declared = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {})
  };
  const declaredNames = PLAYWRIGHT_PACKAGES.filter((name) => declared[name]);
  const resolved = detectPlaywright(root);
  return {
    declared: declaredNames,
    resolved: resolved?.id ?? null,
    installed: Boolean(resolved),
    missing: !resolved
  };
}

export function buildPlaywrightInstallCommand(packageManager = 'npm') {
  if (packageManager === 'pnpm') {
    return { bin: 'pnpm', args: ['add', '-D', ...PLAYWRIGHT_PACKAGES] };
  }
  if (packageManager === 'yarn') {
    return { bin: 'yarn', args: ['add', '-D', ...PLAYWRIGHT_PACKAGES] };
  }
  if (packageManager === 'bun') {
    return { bin: 'bun', args: ['add', '-D', ...PLAYWRIGHT_PACKAGES] };
  }
  return { bin: 'npm', args: ['install', '-D', ...PLAYWRIGHT_PACKAGES] };
}

export async function installPlaywrightDeps(root, {
  packageManager = 'npm',
  browsers = true,
  dryRun = false
} = {}) {
  const add = buildPlaywrightInstallCommand(packageManager);
  const browser = { bin: 'npx', args: ['playwright', 'install', 'chromium'] };
  if (dryRun) {
    return { dryRun: true, commands: [add, browser] };
  }
  await runCommand(add.bin, add.args, { cwd: root });
  if (browsers) await runCommand(browser.bin, browser.args, { cwd: root });
  return { dryRun: false, installed: true, commands: [add, ...(browsers ? [browser] : [])] };
}

export async function patchE2eConfig(root, patch = {}) {
  const config = await readProjectConfig(root);
  config.e2e = { ...DEFAULT_E2E_CONFIG, ...(config.e2e ?? {}), ...patch };
  await writeFile(path.join(root, '.aafe.config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config.e2e;
}

export async function ensurePlaywrightInstalled(root, { yes = false, dryRun = false, packageManager } = {}) {
  const setup = await inspectPlaywrightSetup(root);
  if (!setup.missing) return { ...setup, action: 'already-installed' };
  const manager = packageManager ?? (await detectProject(root)).packageManager;
  if (!yes) return { ...setup, action: 'missing', packageManager: manager };
  const installed = await installPlaywrightDeps(root, { packageManager: manager, dryRun });
  return { ...setup, action: dryRun ? 'would-install' : 'installed', packageManager: manager, installed };
}

export async function runE2eSetupCommand(root, args = []) {
  const { subcommand, options } = parseE2eSetupArgs(args);
  if (subcommand === 'status') {
    const config = await readProjectConfig(root);
    const setup = await inspectPlaywrightSetup(root);
    const payload = {
      command: 'aafe e2e status',
      enabled: isE2eEnabled(config.e2e),
      playwright: setup,
      enableWith: 'aafe e2e enable'
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  if (subcommand === 'disable') {
    const e2e = await patchE2eConfig(root, { enabled: false });
    const payload = { command: 'aafe e2e disable', enabled: e2e.enabled };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  if (subcommand === 'install') {
    const result = await ensurePlaywrightInstalled(root, {
      yes: options.yes || options.installPlaywright,
      dryRun: options.dryRun
    });
    if (result.action === 'missing') {
      console.error('未检测到 playwright。加上 --yes 安装：`aafe e2e install --yes`。');
      process.exitCode = 3;
    }
    console.log(JSON.stringify({ command: 'aafe e2e install', ...result }, null, 2));
    return result;
  }

  const e2e = await patchE2eConfig(root, { enabled: true });
  let playwright = await ensurePlaywrightInstalled(root, {
    yes: options.yes || options.installPlaywright,
    dryRun: options.dryRun
  });
  if (playwright.action === 'missing' && process.stdin.isTTY && !options.yes) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question('Playwright is not installed. Install playwright + @playwright/test and Chromium? (Y/n): ')).trim() || 'Y';
      if (!/^n/i.test(answer)) {
        playwright = await ensurePlaywrightInstalled(root, { yes: true, dryRun: options.dryRun });
      }
    } finally {
      rl.close();
    }
  }
  if (playwright.action === 'missing') {
    console.error('E2E 已启用，但未检测到 playwright / @playwright/test。');
    console.error('安装：`aafe e2e install --yes`，或 `npm install -D playwright @playwright/test` 后 `npx playwright install chromium`。');
  }
  const payload = { command: 'aafe e2e enable', enabled: e2e.enabled, playwright };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

export function parseE2eSetupArgs(args = []) {
  const known = new Set(['enable', 'disable', 'status', 'install']);
  const subcommand = known.has(args[0]) ? args[0] : 'status';
  const rest = known.has(args[0]) ? args.slice(1) : args;
  return {
    subcommand,
    options: {
      yes: rest.includes('--yes') || rest.includes('-y'),
      dryRun: rest.includes('--dry-run'),
      installPlaywright: rest.includes('--install-playwright')
    }
  };
}

function runCommand(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit', cwd });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${bin} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}
