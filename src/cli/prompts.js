import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { enrichWorkspaceLayout, formatWorkspaceAnalysis, normalizeModuleName } from './workspace.js';
import {
  buildTapdConfigFromAnswers,
  defaultTapdBugStatus,
  defaultTapdStoryStatus
} from './tapdConfig.js';
import {
  buildSubmitConfigFromAnswers,
  defaultSubmitConfig,
  resolveSubmitConfig
} from './submitConfig.js';
import {
  buildWorkflowModeConfigFromAnswers,
  defaultWorkflowModeConfig,
  resolveWorkflowModeConfig
} from './workflowMode.js';
import {
  buildAgentModeConfigFromAnswers,
  resolveAgentModeConfig
} from './agentMode.js';
import { formatModelChoices, listAgentModels, resolveModelChoice } from './agentModels.js';
import { detectProject } from './detect.js';
import { inspectPlaywrightSetup, installPlaywrightDeps } from './e2eSetup.js';
import { isE2eEnabled } from '../testing/e2e/config.js';

export async function collectInitOptions(detection, options, workspaceLayout = null) {
  if (options.yes || options.nonInteractive) {
    if (workspaceLayout?.layeredEditors) {
      for (const line of formatWorkspaceAnalysis(workspaceLayout)) console.log(line);
      console.log('');
    }
    const enrichedLayout = workspaceLayout
      ? await enrichWorkspaceLayout(workspaceLayout, {
        moduleName: options.moduleName,
        migrateInstallEditors: options.migrateInstallEditors ?? options.migrateInstallCursor ?? workspaceLayout.hasInstallDirEditors,
        migrateInstallCursor: options.migrateInstallCursor
      })
      : null;
    const submitConfig = resolveSubmitConfig(options.existingConfig ?? {}, {
      cli: options.submitCli ?? options.submitConfig?.cli
    });
    const workflowModeConfig = resolveWorkflowModeConfig(options.existingConfig ?? {}, {
      workflow: options.workflowMode ?? options.workflowModeConfig?.workflow
    });
    const agentModeConfig = resolveAgentModeConfig(options.existingConfig ?? {}, {
      enabled: options.agentMode ?? options.agentModeConfig?.enabled,
      mode: options.cursorRuntime ?? options.agentModeConfig?.mode,
      model: options.cursorModel ?? options.agentModeConfig?.model,
      apiKeyEnv: options.cursorApiKeyEnv ?? options.agentModeConfig?.apiKeyEnv,
      repository: options.cursorRepository ?? options.agentModeConfig?.repository,
      mcpEnabled: options.mcpEnabled ?? options.agentModeConfig?.mcp?.enabled,
      mcpConfig: options.mcpConfig ?? options.agentModeConfig?.mcp?.config,
      mcpSettingSources: options.mcpSettingSources ?? options.agentModeConfig?.mcp?.settingSources
    });
    const e2eConfig = resolveNonInteractiveE2eConfig(options, options.existingConfig?.e2e);
    if (e2eConfig.enabled && options.installPlaywright) {
      const root = options.root ?? process.cwd();
      await ensurePlaywrightForPrompt(root, { yes: true, dryRun: options.dryRun });
    }
    return {
      ...options,
      workspaceLayout: enrichedLayout ?? workspaceLayout,
      tapdConfig: options.tapdConfig ?? null,
      submitConfig,
      workflowModeConfig,
      agentModeConfig,
      e2eConfig
    };
  }

  const rl = createInterface({ input, output });
  try {
    const framework = await ask(rl, `Framework (${detection.framework || 'generic'}): `, detection.framework || 'generic');
    const scenarios = await ask(rl, `Scenarios comma-separated (${detection.scenarios.join(',') || 'complex'}): `, detection.scenarios.join(',') || 'complex');
    const editors = await ask(rl, `Editors comma-separated (${detection.editors.join(',') || 'cursor'}): `, detection.editors.join(',') || 'cursor');
    const memoryText = await ask(rl, 'Enable project memory? (Y/n): ', 'Y');
    const forceText = await ask(rl, 'Overwrite existing generated files? (y/N): ', 'N');
    const workspaceOptions = workspaceLayout
      ? await collectWorkspaceLayoutOptions(rl, workspaceLayout, options)
      : workspaceLayout;
    const submitConfig = await collectSubmitConfigOptions(rl, options.existingConfig?.submit, options);
    const workflowModeConfig = await collectWorkflowModeConfigOptions(rl, options.existingConfig?.mode, options);
    const agentModeConfig = await collectAgentModeConfigOptions(rl, options.existingConfig?.agent, options);
    const tapdConfig = await collectTapdConfigOptions(rl, options.existingConfig?.tapd);
    const e2eConfig = await collectE2eConfigOptions(rl, options.existingConfig?.e2e, {
      root: options.root ?? process.cwd(),
      dryRun: options.dryRun,
      packageManager: detection.packageManager
    });

    return {
      ...options,
      framework,
      scenarios,
      editors,
      memory: !/^n/i.test(memoryText),
      force: /^y/i.test(forceText),
      workspaceLayout: workspaceOptions,
      submitConfig,
      workflowModeConfig,
      agentModeConfig,
      tapdConfig,
      e2eConfig
    };
  } finally {
    rl.close();
  }
}

export async function collectWorkspaceLayoutOptions(rl, layout, options = {}) {
  if (!layout?.layeredEditors) return layout;

  console.log('');
  for (const line of formatWorkspaceAnalysis(layout)) console.log(line);
  console.log('');
  console.log('Editor adapters (.cursor / .codebuddy / CLAUDE.md / .codex / ...) only work from workspace root.');
  console.log('.ai-agent, .docs and .aafe.config.json will remain in the install directory.');
  console.log('References inside workspace-root editor files will point to install-dir paths.');
  console.log('');

  const moduleNameInput = await ask(
    rl,
    `Module name for layered editor config (${layout.suggestedModuleName}): `,
    options.moduleName ?? layout.suggestedModuleName
  );
  const moduleName = normalizeModuleName(moduleNameInput, layout.suggestedModuleName);

  let migrateInstallEditors = false;
  if (layout.hasInstallDirEditors) {
    console.log('');
    console.log(`Found install-dir editor adapters: ${layout.installEditorIds.join(', ')}`);
    console.log('Only these editor adapter files/dirs will be migrated/merged to workspace root.');
    console.log('Install-dir .ai-agent / .docs will NOT be moved to workspace root.');
    const migrateText = await ask(rl, 'Migrate install-dir editor adapters to workspace root? (Y/n): ', 'Y');
    migrateInstallEditors = !/^n/i.test(migrateText);
  } else if (options.migrateInstallEditors || options.migrateInstallCursor) {
    migrateInstallEditors = true;
  }

  return enrichWorkspaceLayout(layout, { moduleName, migrateInstallEditors, migrateInstallCursor: migrateInstallEditors && layout.installEditorSummary?.cursor });
}

export async function prepareWorkspaceLayoutForCommand(layout, options = {}, existingConfig = {}) {
  if (!layout?.layeredEditors) return layout;

  if (options.yes || options.nonInteractive) {
    if (!options.quiet) {
      for (const line of formatWorkspaceAnalysis(layout)) console.log(line);
      console.log('');
    }
    return enrichWorkspaceLayout(layout, {
      moduleName: options.moduleName ?? existingConfig.workspace?.moduleName,
      migrateInstallEditors: options.migrateInstallEditors ?? options.migrateInstallCursor ?? layout.hasInstallDirEditors,
      migrateInstallCursor: options.migrateInstallCursor
    });
  }

  const rl = createInterface({ input, output });
  try {
    return await collectWorkspaceLayoutOptions(rl, layout, {
      ...options,
      moduleName: options.moduleName ?? existingConfig.workspace?.moduleName
    });
  } finally {
    rl.close();
  }
}

export async function prepareTapdConfigForCommand(options = {}, existingConfig = {}) {
  if (options.tapdConfig) return options.tapdConfig;
  if (options.yes || options.nonInteractive) {
    return existingConfig.tapd ?? null;
  }

  const rl = createInterface({ input, output });
  try {
    return await collectTapdConfigOptions(rl, existingConfig.tapd);
  } finally {
    rl.close();
  }
}

export async function prepareWorkflowModeConfigForCommand(options = {}, existingConfig = {}) {
  if (options.workflowModeConfig) {
    return resolveWorkflowModeConfig(existingConfig, {
      workflow: options.workflowModeConfig.workflow ?? options.workflowMode
    });
  }
  if (options.workflowMode) {
    return resolveWorkflowModeConfig(existingConfig, { workflow: options.workflowMode });
  }
  if (options.yes || options.nonInteractive) {
    return resolveWorkflowModeConfig(existingConfig);
  }

  const rl = createInterface({ input, output });
  try {
    return await collectWorkflowModeConfigOptions(rl, existingConfig.mode, options);
  } finally {
    rl.close();
  }
}

export async function prepareAgentModeConfigForCommand(options = {}, existingConfig = {}) {
  if (options.agentModeConfig) {
    return resolveAgentModeConfig(existingConfig, options.agentModeConfig);
  }
  if (
    options.agentMode !== undefined
    || options.cursorRuntime
    || options.cursorModel
    || options.cursorApiKeyEnv
    || options.cursorRepository
    || options.mcpConfig
    || options.mcpSettingSources
    || options.mcpEnabled !== undefined
    || options.agentManager !== undefined
    || options.maxConcurrentTasks !== undefined
    || options.taskOutput
    || options.validateProjectRuntime !== undefined
    || options.recoverOnStart !== undefined
  ) {
    return resolveAgentModeConfig(existingConfig, {
      enabled: options.agentMode,
      mode: options.cursorRuntime,
      model: options.cursorModel,
      apiKeyEnv: options.cursorApiKeyEnv,
      repository: options.cursorRepository,
      mcpEnabled: options.mcpEnabled,
      mcpConfig: options.mcpConfig,
      mcpSettingSources: options.mcpSettingSources,
      managerEnabled: options.agentManager,
      maxConcurrentTasks: options.maxConcurrentTasks,
      taskOutput: options.taskOutput,
      validateProjectRuntime: options.validateProjectRuntime,
      recoverOnStart: options.recoverOnStart
    });
  }
  if (options.yes || options.nonInteractive) {
    return resolveAgentModeConfig(existingConfig);
  }

  const rl = createInterface({ input, output });
  try {
    return await collectAgentModeConfigOptions(rl, existingConfig.agent, options);
  } finally {
    rl.close();
  }
}

export async function prepareSubmitConfigForCommand(options = {}, existingConfig = {}) {
  if (options.submitConfig) {
    return resolveSubmitConfig(existingConfig, { cli: options.submitConfig.cli ?? options.submitCli });
  }
  if (options.submitCli) {
    return resolveSubmitConfig(existingConfig, { cli: options.submitCli });
  }
  if (options.yes || options.nonInteractive) {
    return resolveSubmitConfig(existingConfig);
  }

  const rl = createInterface({ input, output });
  try {
    return await collectSubmitConfigOptions(rl, existingConfig.submit, options);
  } finally {
    rl.close();
  }
}

/**
 * Decide whether `aafe update` should run `aafe analyze --force`.
 * Default is true. Prompt only on a TTY when the caller did not pass a flag.
 *
 * @param {{ analyze?: boolean, yes?: boolean, dryRun?: boolean }} options
 * @param {{ isTTY?: boolean }} [env]
 * @returns {{ forceAnalyze: boolean, shouldPrompt: boolean }}
 */
export function resolveForceAnalyzeDecision(options = {}, { isTTY = Boolean(process.stdin.isTTY) } = {}) {
  if (options.analyze === false) return { forceAnalyze: false, shouldPrompt: false };
  if (options.analyze === true) return { forceAnalyze: true, shouldPrompt: false };
  if (options.dryRun || options.yes || !isTTY) return { forceAnalyze: true, shouldPrompt: false };
  return { forceAnalyze: true, shouldPrompt: true };
}

export async function prepareForceAnalyzeForCommand(options = {}, env = {}) {
  const decision = resolveForceAnalyzeDecision(options, env);
  if (!decision.shouldPrompt) return decision.forceAnalyze;

  const rl = createInterface({ input, output });
  try {
    console.log('');
    console.log('Analyze: refresh architecture facts under analyze.output (default `.aafe/`).');
    console.log('Force overwrites existing facts and migrates leftover files from older layouts.');
    console.log('Preserves `.aafe/e2e/` and `.aafe/runs/`.');
    console.log('');
    const answer = await ask(rl, 'Force execute analyze? (Y/n): ', 'Y');
    return !isNegative(answer);
  } finally {
    rl.close();
  }
}

export async function prepareE2eConfigForCommand(options = {}, existingConfig = {}, { root = process.cwd() } = {}) {
  if (options.e2eConfig) return options.e2eConfig;
  const existing = existingConfig.e2e ?? {};
  if (options.e2e === false) return { ...existing, enabled: false };
  if (options.e2e === true) {
    if (options.installPlaywright || options.yes) {
      await ensurePlaywrightForPrompt(root, {
        yes: options.installPlaywright === true || options.yes === true,
        dryRun: options.dryRun
      });
    } else if (process.stdin.isTTY) {
      const rl = createInterface({ input, output });
      try {
        const detection = await detectProject(root);
        await maybeInstallPlaywright(rl, root, { packageManager: detection.packageManager, dryRun: options.dryRun });
      } finally {
        rl.close();
      }
    }
    return { ...existing, enabled: true };
  }

  const shouldPrompt = options.promptE2e === true
    || (!(options.yes || options.nonInteractive) && options.promptE2e !== false);
  if (!shouldPrompt) {
    return { ...existing, enabled: isE2eEnabled(existing) };
  }

  const rl = createInterface({ input, output });
  try {
    const detection = await detectProject(root);
    return await collectE2eConfigOptions(rl, existing, {
      root,
      dryRun: options.dryRun,
      packageManager: detection.packageManager
    });
  } finally {
    rl.close();
  }
}

export async function collectE2eConfigOptions(rl, existingE2e = null, {
  root = process.cwd(),
  dryRun = false,
  packageManager = 'npm'
} = {}) {
  console.log('');
  console.log('E2E: generate Playwright YAML cases (`aafe test --diff|--coverage|--pr`) and write reports to `.aafe/e2e/reports/`.');
  console.log('Can also be enabled later with `aafe e2e enable`.');
  console.log('');

  if (existingE2e?.enabled === true) {
    const reconfigureText = await ask(rl, 'E2E is already enabled. Reconfigure E2E settings? (y/N): ', 'N');
    if (!isAffirmative(reconfigureText)) {
      await maybeInstallPlaywright(rl, root, { packageManager, dryRun });
      return { ...existingE2e, enabled: true };
    }
  } else {
    const enableText = await ask(rl, 'Enable Playwright E2E (`aafe test`)? (Y/n): ', 'Y');
    if (!isAffirmative(enableText)) return { ...existingE2e, enabled: false };
  }

  await maybeInstallPlaywright(rl, root, { packageManager, dryRun });
  return { ...existingE2e, enabled: true };
}

function resolveNonInteractiveE2eConfig(options = {}, existingE2e = {}) {
  if (options.e2e === false) return { ...existingE2e, enabled: false };
  if (options.e2e === true) return { ...existingE2e, enabled: true };
  return { ...existingE2e, enabled: isE2eEnabled(existingE2e) };
}

async function maybeInstallPlaywright(rl, root, { packageManager, dryRun }) {
  const setup = await inspectPlaywrightSetup(root);
  if (!setup.missing) {
    console.log(`Playwright already available (${setup.resolved ?? setup.declared.join(', ')}).`);
    return;
  }
  const installText = await ask(
    rl,
    'Playwright is not installed. Install playwright + @playwright/test and Chromium? (Y/n): ',
    'Y'
  );
  if (/^n/i.test(installText.trim())) {
    console.log('Skipped. Later: `aafe e2e install --yes` or `npm install -D playwright @playwright/test`.');
    return;
  }
  await installPlaywrightDeps(root, { packageManager, dryRun, browsers: true });
}

async function ensurePlaywrightForPrompt(root, { yes, dryRun }) {
  const setup = await inspectPlaywrightSetup(root);
  if (!setup.missing || !yes) return setup;
  const detection = await detectProject(root);
  return installPlaywrightDeps(root, { packageManager: detection.packageManager, dryRun, browsers: true });
}

export async function collectWorkflowModeConfigOptions(rl, existingMode = null, options = {}) {
  const current = resolveWorkflowModeConfig({ mode: existingMode }, { workflow: options.workflowMode });
  console.log('');
  console.log('Workflow mode: choose how AAFE gates ask vs auto-decide.');
  console.log('  ask         — 询问模式：各环节向用户确认后再继续  [default]');
  console.log('  autonomous  — 自主判断模式：LLM 判定是否 Commit / PR / 回填 / Plan / 影响分析');
  console.log('');

  const answer = await ask(
    rl,
    `Workflow mode (ask|autonomous) [${current.workflow}]: `,
    current.workflow
  );
  return buildWorkflowModeConfigFromAnswers({ workflow: answer }, existingMode ?? defaultWorkflowModeConfig());
}

export async function collectAgentModeConfigOptions(rl, existingAgent = null, options = {}) {
  const current = resolveAgentModeConfig({ agent: existingAgent }, {
    enabled: options.agentMode,
    mode: options.cursorRuntime,
    model: options.cursorModel,
    apiKeyEnv: options.cursorApiKeyEnv,
    repository: options.cursorRepository,
    mcpEnabled: options.mcpEnabled,
    mcpConfig: options.mcpConfig,
    mcpSettingSources: options.mcpSettingSources,
    managerEnabled: options.agentManager,
    maxConcurrentTasks: options.maxConcurrentTasks,
    taskOutput: options.taskOutput,
    validateProjectRuntime: options.validateProjectRuntime,
    recoverOnStart: options.recoverOnStart
  });
  console.log('');
  console.log('Agent mode: when enabled, `aafe run` executes the context package through Cursor SDK.');
  console.log('The API key value is not prompted here; keep it in an environment variable or fill config.agent.apiKey manually.');
  console.log('MCP servers can be pointed at a mcp.json, listed under agent.mcp.servers, or loaded from Cursor setting sources.');
  console.log('');

  const enabled = await ask(
    rl,
    `Enable Cursor Agent mode? (y/N) [${current.enabled ? 'Y' : 'N'}]: `,
    current.enabled ? 'Y' : 'N'
  );
  if (!isAffirmative(enabled)) {
    return buildAgentModeConfigFromAnswers({ enabled: false }, existingAgent ?? current);
  }

  const mode = await ask(rl, `Cursor runtime (local|cloud) [${current.mode}]: `, current.mode);
  const apiKeyEnv = await ask(rl, `Cursor API key env [${current.apiKeyEnv}]: `, current.apiKeyEnv);
  const listed = await listAgentModels({
    apiKeyEnv,
    current: current.model
  });
  if (listed.models.length > 0) {
    console.log('Available Cursor models (number or id):');
    console.log(formatModelChoices(listed.models));
    if (listed.source !== 'cursor') {
      console.log('Live model list unavailable; showing built-in choices. Set the API key env to refresh.');
    }
  }
  const modelAnswer = await ask(rl, `Cursor model [${current.model}]: `, current.model);
  const model = resolveModelChoice(modelAnswer, listed.models) ?? current.model;
  const repository = await ask(rl, `Cursor cloud repository (optional) [${current.repository ?? ''}]: `, current.repository ?? '');
  const mcpConfig = await ask(
    rl,
    `MCP config file (optional, Cursor mcp.json) [${current.mcp.config ?? ''}]: `,
    current.mcp.config ?? ''
  );
  const mcpSettingSources = await ask(
    rl,
    `MCP setting sources (optional, project|user|plugins|all) [${current.mcp.settingSources.join(',') || ''}]: `,
    current.mcp.settingSources.join(',') || ''
  );

  return buildAgentModeConfigFromAnswers({
    enabled: true,
    mode,
    model,
    apiKeyEnv,
    repository: repository || null,
    mcpEnabled: true,
    mcpConfig: mcpConfig || null,
    mcpSettingSources: mcpSettingSources || []
  }, existingAgent ?? current);
}

export async function collectSubmitConfigOptions(rl, existingSubmit = null, options = {}) {
  const current = resolveSubmitConfig({ submit: existingSubmit }, { cli: options.submitCli });
  console.log('');
  console.log('Submit CLI provider: choose how Commit / PR are executed.');
  console.log('  git  — Git CLI (+ gh for PR)  [default]');
  console.log('  gtm  — GTM CLI (`gtm commit` / `gtm pr`; project GTM config required)');
  console.log('');

  const answer = await ask(
    rl,
    `Submit CLI (git|gtm) [${current.cli}]: `,
    current.cli
  );
  return buildSubmitConfigFromAnswers({ cli: answer }, existingSubmit ?? defaultSubmitConfig());
}

export async function collectTapdConfigOptions(rl, existingTapd = null) {
  console.log('');
  console.log('TAPD integration: backfill self-test + impact scope on commit/push/submit.');
  console.log('Pure GitHub projects can skip this (default: No).');
  console.log('');

  if (existingTapd?.enabled) {
    const reconfigureText = await ask(rl, 'TAPD is already configured. Reconfigure TAPD settings? (y/N): ', 'N');
    if (!/^y|^yes|^是/i.test(reconfigureText.trim())) {
      return existingTapd;
    }
  } else {
    const enableText = await ask(rl, 'Enable TAPD integration for commit/submit backfill? (y/N): ', 'N');
    if (!isAffirmative(enableText)) return null;
  }

  const defaults = {
    story: defaultTapdStoryStatus(),
    bug: defaultTapdBugStatus()
  };

  const username = await ask(rl, `TAPD username (${existingTapd?.username ?? ''}): `, existingTapd?.username ?? '');
  const apiPassword = await ask(rl, `TAPD api_password (${maskSecret(existingTapd?.api_password)}): `, existingTapd?.api_password ?? '');
  const workspaceId = await ask(rl, `TAPD workspace_id (optional, auto-extracted from TAPD URL if empty) (${existingTapd?.workspace_id ?? ''}): `, existingTapd?.workspace_id ?? '');

  console.log('');
  console.log('Story status mapping (comma-separated chains for status_doing):');
  const storyStatusBacklog = await ask(rl, `  status_backlog (${defaults.story.status_backlog}): `, existingTapd?.tapd_story?.status_backlog ?? defaults.story.status_backlog);
  const storyStatusTodo = await ask(rl, `  status_todo (${defaults.story.status_todo}): `, existingTapd?.tapd_story?.status_todo ?? defaults.story.status_todo);
  const storyStatusDoing = await ask(rl, `  status_doing (${defaults.story.status_doing}): `, existingTapd?.tapd_story?.status_doing ?? defaults.story.status_doing);
  const storyStatusDone = await ask(rl, `  status_done / for_test (${defaults.story.status_done}): `, existingTapd?.tapd_story?.status_done ?? defaults.story.status_done);
  const storyStatusRelease = await ask(rl, `  status_release (${defaults.story.status_release}): `, existingTapd?.tapd_story?.status_release ?? defaults.story.status_release);

  console.log('');
  console.log('Bug status mapping:');
  const bugStatusDoing = await ask(rl, `  status_doing (${defaults.bug.status_doing}): `, existingTapd?.tapd_bug?.status_doing ?? defaults.bug.status_doing);
  const bugStatusDone = await ask(rl, `  status_done (${defaults.bug.status_done}): `, existingTapd?.tapd_bug?.status_done ?? defaults.bug.status_done);
  const bugStatusRelease = await ask(rl, `  status_release (${defaults.bug.status_release}): `, existingTapd?.tapd_bug?.status_release ?? defaults.bug.status_release);

  return buildTapdConfigFromAnswers({
    username,
    api_password: apiPassword,
    workspace_id: workspaceId,
    story_status_backlog: storyStatusBacklog,
    story_status_todo: storyStatusTodo,
    story_status_doing: storyStatusDoing,
    story_status_done: storyStatusDone,
    story_status_release: storyStatusRelease,
    bug_status_doing: bugStatusDoing,
    bug_status_done: bugStatusDone,
    bug_status_release: bugStatusRelease
  });
}

function isAffirmative(text) {
  const normalized = (text ?? '').trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes' || normalized === '是';
}

function isNegative(text) {
  const normalized = (text ?? '').trim().toLowerCase();
  return normalized === 'n' || normalized === 'no' || normalized === '否';
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function ask(rl, question, fallback) {
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}
