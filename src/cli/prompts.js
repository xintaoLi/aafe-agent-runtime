import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { enrichWorkspaceLayout, formatWorkspaceAnalysis, normalizeModuleName } from './workspace.js';

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
    return { ...options, workspaceLayout: enrichedLayout ?? workspaceLayout };
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

    return {
      ...options,
      framework,
      scenarios,
      editors,
      memory: !/^n/i.test(memoryText),
      force: /^y/i.test(forceText),
      workspaceLayout: workspaceOptions
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

async function ask(rl, question, fallback) {
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}
