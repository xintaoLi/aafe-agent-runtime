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
    return {
      ...options,
      workspaceLayout: enrichedLayout ?? workspaceLayout,
      tapdConfig: options.tapdConfig ?? null,
      submitConfig
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
    const tapdConfig = await collectTapdConfigOptions(rl, options.existingConfig?.tapd);

    return {
      ...options,
      framework,
      scenarios,
      editors,
      memory: !/^n/i.test(memoryText),
      force: /^y/i.test(forceText),
      workspaceLayout: workspaceOptions,
      submitConfig,
      tapdConfig
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
  const workspaceId = await ask(rl, `TAPD workspace_id (${existingTapd?.workspace_id ?? ''}): `, existingTapd?.workspace_id ?? '');
  const milestoneId = await ask(rl, `TAPD milestone_id / iteration_id (${existingTapd?.milestone_id ?? ''}): `, existingTapd?.milestone_id ?? '');

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
    milestone_id: milestoneId,
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

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function ask(rl, question, fallback) {
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}
