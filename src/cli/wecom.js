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

import { access } from 'node:fs/promises';

// The default npm package intentionally excludes the separately installed Bot.
// Keep even importing this CLI adapter safe without any ai-bots files.
async function loadWeComModules() {
  const entry = new URL('../../ai-bots/wecom/src/index.js', import.meta.url);
  try {
    await access(entry);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('wecom-not-installed: 默认 AAFE CLI 不包含企微 Bot。请在 AAFE 源码的 ai-bots/wecom 目录独立安装依赖，再通过源码 CLI 执行 bot start --wecom（或在该目录 npm start）；普通 CLI 命令无需安装 Bot。');
  }
  // Do not hide missing dependencies *inside* an installed Bot as not installed.
  const [bot, models, understanding] = await Promise.all([
    import(entry.href),
    import('../../ai-bots/wecom/src/models.js'),
    import('../../ai-bots/wecom/src/understand.js')
  ]);
  return { ...bot, ...models, INTENT_KINDS: understanding.INTENT_KINDS };
}

/**
 * Thin resident entry. Unlike `aafe task`, this process keeps TaskManager open
 * until SIGINT/SIGTERM or a WeCom kick.
 */
export async function runWeComCommand(root, args = []) {
  const options = parseWeComArgs(args);
  if (options.checkModels) {
    const code = await checkWeComModels(options.root ?? root, options);
    process.exitCode = code;
    return;
  }
  const { startWeComBot } = await loadWeComModules();
  await startWeComBot({
    root: options.root ?? root,
    recoverOnStart: options.recoverOnStart,
    localConfigPath: options.config
  });
}

export function parseWeComArgs(args = []) {
  const options = { probes: [] };
  for (const arg of args) {
    if (arg.startsWith('--root=')) { options.root = arg.slice(7); continue; }
    if (arg.startsWith('--config=')) { options.config = arg.slice(9); continue; }
    if (arg === '--no-recover') { options.recoverOnStart = false; continue; }
    if (arg === '--check-models') { options.checkModels = true; continue; }
    if (arg === '--offline') { options.offline = true; continue; }
    if (arg.startsWith('--probe=')) { options.probes.push(arg.slice(8)); continue; }
  }
  return options;
}

/**
 * The gate a new rule has to pass before it is trusted: structure, a real
 * model name from the account's own model list, and a dry run showing which
 * rule wins for a sample message.
 *
 * @returns {Promise<number>} process exit code
 */
export async function checkWeComModels(root, {
  config: localConfigPath = null,
  offline = false,
  probes = [],
  loadConfig = null,
  listModels = loadCursorModelIds,
  out = console
} = {}) {
  const { loadWeComBotConfig, createModelRouter, validateModelRules, INTENT_KINDS } = await loadWeComModules();
  const config = await (loadConfig ?? loadWeComBotConfig)({ root, localConfigPath });
  if (config.agent?.provider === 'codex') {
    out.log(`当前引擎：Codex；模型：${config.codex?.model ?? 'CLI 默认'}。跳过 Cursor 模型接口与路由规则校验。`);
    return 0;
  }
  const rules = config.models?.rules ?? [];
  let known = null;
  if (!offline) {
    try {
      known = await listModels(config.apiKey);
    } catch (error) {
      out.warn?.(`模型列表获取失败，跳过在线校验：${error instanceof Error ? error.message : error}`);
    }
  }

  const { ok, rules: accepted, errors } = validateModelRules(rules, { models: known });
  const configErrors = config.models?.configErrors ?? [];
  // Print what would actually run, so a rejected rule is never shown as active.
  const router = createModelRouter({
    rules: accepted,
    fallback: config.models?.default,
    logger: { error() {} }
  });

  out.log('规则表（顺序即优先级，已剔除无效规则）：');
  for (const rule of router.list()) {
    const when = [
      rule.stage === 'task' ? null : `stage=${rule.stage}`,
      rule.intent ? `intent=${rule.intent.join('|')}` : null,
      rule.match ? `match=/${rule.match}/i` : null,
      rule.not ? `not=/${rule.not}/i` : null,
      rule.minConfidence != null ? `conf>=${rule.minConfidence}` : null
    ].filter(Boolean).join(' ') || '无条件';
    out.log(`  ${rule.id.padEnd(18)} → ${rule.model.padEnd(20)} ${when}${rule.note ? `  # ${rule.note}` : ''}`);
  }
  out.log(`  ${'fallback'.padEnd(18)} → ${router.fallback}`);

  for (const error of [...configErrors, ...errors]) out.error?.(`无效规则：${error}`);
  if (known) out.log(`\n在线校验：账号可用模型 ${known.length} 个`);

  // The task stage also matches on the classification, which a dry run cannot
  // produce without paying for a model, so every possible outcome is listed.
  // `followup` is left out: it continues an existing task and reuses the model
  // pinned there, so it never reaches the table.
  for (const probe of probes) {
    const intentPick = router.select({ stage: 'intent', text: probe });
    out.log(`\n干跑「${probe}」`);
    out.log(`  意图分析 → ${intentPick.model}（${intentPick.ruleId}）`);
    for (const kind of INTENT_KINDS.filter((item) => item !== 'followup')) {
      const pick = router.select({ stage: 'task', intent: { kind, confidence: 1 }, text: probe });
      out.log(`  任务执行 · intent=${kind.padEnd(9)} → ${pick.model.padEnd(20)}（${pick.ruleId}）`);
    }
    out.log('  任务执行 · intent=followup  → 复用原任务已钉定的模型');
  }

  const failed = !ok || configErrors.length > 0;
  out.log(failed ? '\n校验未通过，无效规则不会生效。' : '\n校验通过。');
  return failed ? 1 : 0;
}

async function loadCursorModelIds(apiKey) {
  if (!apiKey) throw new Error('cursor-api-key-missing');
  const sdk = await import('@cursor/sdk');
  const list = await sdk.Cursor.models.list({ apiKey });
  return (list?.models ?? list ?? []).map((item) => item.id ?? item.name).filter(Boolean);
}
