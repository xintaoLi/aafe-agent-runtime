import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { taskCompletionHookScript } from './hookScripts.js';
import {
  requirementIntakeProjectRuleMdc,
  requirementIntakeRuleMdc
} from './requirementAnalysisRules.js';
import {
  taskCompletionImpactProjectRuleMdc,
  taskCompletionImpactRuleMdc
} from './completionImpactRules.js';
import {
  tapdSubmitProjectRuleMdc,
  tapdSubmitRuleMdc
} from './tapdSubmitRules.js';
import {
  fileLicenseProjectRuleMdc,
  fileLicenseRuleMdc
} from './fileLicenseRules.js';
import {
  workflowModePointerRuleMdc,
  workflowModeProjectRuleMdc
} from './workflowModeRules.js';
import {
  aafeTestFromPrCursorSkill,
  aafeTestFromPrPointerRuleMdc,
  AAFE_TEST_FROM_PR_SKILL_DIR
} from './e2eFromPrRules.js';
import { taskSpineHookContext, taskSpinePointerLine } from './taskSpine.js';
import {
  createCursorPathContext,
  rewriteCursorContent
} from './pathRewrite.js';
import { RETAIN_IN_INSTALL_DIR } from './workspace.js';

export { rewriteCursorContent, createCursorPathContext } from './pathRewrite.js';

export function buildCursorLayerPaths(workspaceRoot, moduleName) {
  return {
    rulesDir: path.join(workspaceRoot, '.cursor', 'rules', moduleName),
    skillsDir: path.join(workspaceRoot, '.cursor', 'skills', moduleName),
    hooksDir: path.join(workspaceRoot, '.cursor', 'hooks', moduleName),
    contextDir: path.join(workspaceRoot, '.cursor', 'context', moduleName),
    hooksJson: path.join(workspaceRoot, '.cursor', 'hooks.json')
  };
}

export async function writeLayeredCursorAdapters({
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {},
  plan = {}
}) {
  const paths = buildCursorLayerPaths(workspaceRoot, moduleName);
  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const editors = new Set(plan.editors ?? ['cursor']);
  if (!editors.has('cursor')) return { paths, ctx, migrated: false };

  if (options.migrateInstallCursor && options.installRoot) {
    await migrateInstallCursorToWorkspace({
      installRoot: options.installRoot,
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      options
    });
  }

  // Refresh project-owned rule bodies only when missing; path refs stay workspace-relative for layered installs.
  if (options.installRoot) {
    await writeIfAllowed(
      path.join(options.installRoot, '.ai-agent/rules/task-completion-impact.mdc'),
      taskCompletionImpactProjectRuleMdc({ agentPrefix: ctx.agentPrefix }),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(options.installRoot, '.ai-agent/rules/requirement-intake-analysis.mdc'),
      requirementIntakeProjectRuleMdc({ agentPrefix: ctx.agentPrefix }),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(options.installRoot, '.ai-agent/rules/tapd-submit-backfill.mdc'),
      tapdSubmitProjectRuleMdc({ agentPrefix: ctx.agentPrefix }),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(options.installRoot, '.ai-agent/rules/new-file-license.mdc'),
      fileLicenseProjectRuleMdc({ agentPrefix: ctx.agentPrefix }),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(options.installRoot, '.ai-agent/rules/workflow-mode.mdc'),
      workflowModeProjectRuleMdc({ agentPrefix: ctx.agentPrefix }),
      { ...options, force: false }
    );
  }

  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-skill-router.mdc'), cursorSkillRouterRules(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-architecture-runtime.mdc'), cursorRules(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-task-completion-impact.mdc'), taskCompletionImpactRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-requirement-intake-analysis.mdc'), requirementIntakeRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-tapd-submit-backfill.mdc'), tapdSubmitRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-workflow-mode.mdc'), workflowModePointerRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-new-file-license.mdc'), fileLicenseRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.rulesDir, 'aafe-test-from-pr.mdc'), aafeTestFromPrPointerRuleMdc(ctx), options);
  await writeIfAllowed(path.join(paths.skillsDir, 'aafe-runtime', 'SKILL.md'), nativeEditorSkill('Cursor', ctx), options);
  await writeIfAllowed(
    path.join(paths.skillsDir, AAFE_TEST_FROM_PR_SKILL_DIR, 'SKILL.md'),
    aafeTestFromPrCursorSkill(ctx),
    options
  );
  await writeIfAllowed(path.join(paths.skillsDir, 'ENTRY.md'), editorSkillEntry('Cursor', ctx), options);
  await writeIfAllowed(path.join(paths.hooksDir, 'run-hook.cmd'), cursorHookRunner(), options);
  await writeIfAllowed(path.join(paths.hooksDir, 'aafe-session-start'), cursorSessionStartHook(ctx), options);
  await writeIfAllowed(path.join(paths.hooksDir, 'aafe-task-completion'), cursorTaskCompletionHook(ctx), options);
  await writeIfAllowed(path.join(paths.contextDir, 'module.json'), moduleContextManifest(ctx), options);
  await mergeWorkspaceHooksJson(paths.hooksJson, moduleName, ctx, options);
  await makeExecutable(path.join(paths.hooksDir, 'aafe-session-start'));
  await makeExecutable(path.join(paths.hooksDir, 'aafe-task-completion'));
  await makeExecutable(path.join(paths.hooksDir, 'run-hook.cmd'));

  return { paths, ctx, migrated: Boolean(options.migrateInstallCursor) };
}

export async function migrateInstallCursorToWorkspace({
  installRoot,
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {}
}) {
  const sourceCursor = path.join(installRoot, '.cursor');
  if (!(await isDirectory(sourceCursor))) return { migrated: false, reason: 'missing-install-cursor' };

  const paths = buildCursorLayerPaths(workspaceRoot, moduleName);
  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const backupDir = path.join(installRoot, `.cursor.aafe-migrated-${Date.now()}`);

  await migrateTree(sourceCursor, {
    rules: paths.rulesDir,
    skills: paths.skillsDir,
    hooks: paths.hooksDir,
    context: paths.contextDir,
    hooksJson: paths.hooksJson
  }, ctx, options);

  if (!options.dryRun) {
    await rename(sourceCursor, backupDir);
    await writeFile(
      path.join(backupDir, 'AAFE-MIGRATION-README.txt'),
      [
        'This .cursor directory was migrated to the workspace root by @aafe/agent-runtime.',
        `Workspace root: ${workspaceRoot}`,
        `Install dir: ${installRoot}`,
        `Module name: ${moduleName}`,
        `Module path: ${moduleRelativePath}`,
        `Target layer: .cursor/{rules,skills,hooks,context}/${moduleName}/`,
        '',
        'Migration policy:',
        '- ONLY .cursor content is moved/merged to workspace root.',
        `- ${RETAIN_IN_INSTALL_DIR.join(', ')} remain in the install directory and are NOT copied to workspace root.`,
        `- References inside .cursor were rewritten to point to ${moduleRelativePath}/.ai-agent, ${moduleRelativePath}/.docs and ${moduleRelativePath}/.aafe.config.json.`,
        '',
        'You can remove this backup after verifying the workspace-root Cursor configuration.'
      ].join('\n')
    );
  }

  return { migrated: true, backupDir: options.dryRun ? null : backupDir };
}

function moduleContextManifest(ctx) {
  return `${JSON.stringify({
    moduleName: ctx.moduleName,
    moduleRelativePath: ctx.moduleRelativePath,
    agentPrefix: ctx.agentPrefix,
    docsPrefix: ctx.docsPath,
    configPath: ctx.configPath,
    hooksPrefix: ctx.cursorHooksPrefix,
    moduleGlob: ctx.moduleGlob,
    retainInInstallDir: [...RETAIN_IN_INSTALL_DIR],
    cursorOnlyAtWorkspaceRoot: true,
    generatedBy: '@aafe/agent-runtime',
    note: 'Only .cursor lives at workspace root. Runtime knowledge (.ai-agent/.docs) stays in install dir; .cursor files are pointers with rewritten paths.'
  }, null, 2)}\n`;
}

async function migrateTree(sourceCursor, targets, ctx, options) {
  const mappings = [
    ['rules', path.join(sourceCursor, 'rules'), targets.rules],
    ['skills', path.join(sourceCursor, 'skills'), targets.skills],
    ['hooks', path.join(sourceCursor, 'hooks'), targets.hooks],
    ['context', path.join(sourceCursor, 'context'), targets.context]
  ];

  for (const [, sourceDir, targetDir] of mappings) {
    if (!(await isDirectory(sourceDir))) continue;
    await copyDirectoryWithRewrite(sourceDir, targetDir, ctx, options, sourceCursor);
  }

  const sourceHooksJson = path.join(sourceCursor, 'hooks.json');
  if (await exists(sourceHooksJson)) {
    const content = rewriteCursorContent(await readFile(sourceHooksJson, 'utf8'), ctx, 'hooks.json');
    await mergeHooksJsonContent(targets.hooksJson, {
      ...moduleHooksFromLegacy(content, ctx.moduleName),
      agentPrefix: ctx.agentPrefix
    }, options);
  }
}

function moduleHooksFromLegacy(content, moduleName) {
  try {
    const parsed = JSON.parse(content);
    return {
      moduleName,
      hooks: parsed.hooks ?? {}
    };
  } catch {
    return { moduleName, hooks: {} };
  }
}

async function copyDirectoryWithRewrite(sourceDir, targetDir, ctx, options, sourceCursorRoot = sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipCursorMigrationEntry(entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryWithRewrite(sourcePath, targetPath, ctx, options, sourceCursorRoot);
      continue;
    }
    if (!entry.isFile()) continue;
    const raw = await readFile(sourcePath, 'utf8');
    const isBinary = raw.includes('\u0000');
    const fileRelPath = path.relative(sourceCursorRoot, sourcePath).split(path.sep).join('/');
    const content = isBinary ? raw : rewriteCursorContent(raw, ctx, fileRelPath);
    await writeIfAllowed(targetPath, content, options);
  }
}

function shouldSkipCursorMigrationEntry(name) {
  return RETAIN_IN_INSTALL_DIR.includes(name) || name === '.ai-agent' || name === '.docs';
}

async function mergeWorkspaceHooksJson(hooksJsonPath, moduleName, ctx, options) {
  const hookPrefix = ctx.cursorHooksPrefix;
  const moduleHooks = {
    moduleName,
    agentPrefix: ctx.agentPrefix,
    hooks: {
    sessionStart: [
      {
        command: `${hookPrefix}/run-hook.cmd aafe-session-start`,
        timeout: 5,
        failClosed: false
      },
      {
        command: `${hookPrefix}/run-hook.cmd aafe-task-completion`,
        timeout: 120,
        failClosed: false
      }
    ]
    }
  };
  await mergeHooksJsonContent(hooksJsonPath, moduleHooks, options);
}

async function mergeHooksJsonContent(hooksJsonPath, moduleEntry, options) {
  const existing = await readHooksJson(hooksJsonPath);
  const merged = mergeModuleHooks(existing, moduleEntry);
  await writeIfAllowed(hooksJsonPath, `${JSON.stringify(merged, null, 2)}\n`, options);
}

function mergeModuleHooks(existing, moduleEntry) {
  const next = existing.version ? { ...existing } : { version: 1, hooks: {}, modules: {} };
  next.version = 1;
  next.hooks = next.hooks ?? {};
  next.modules = next.modules ?? {};
  next.modules[moduleEntry.moduleName] = {
    hooksPrefix: `.cursor/hooks/${moduleEntry.moduleName}`,
    agentPrefix: moduleEntry.agentPrefix ?? null
  };

  for (const [hookName, entries] of Object.entries(moduleEntry.hooks ?? {})) {
    const current = Array.isArray(next.hooks[hookName]) ? [...next.hooks[hookName]] : [];
    for (const entry of entries) {
      if (current.some((item) => item.command === entry.command)) continue;
      current.push(entry);
    }
    next.hooks[hookName] = current;
  }
  return next;
}

async function readHooksJson(hooksJsonPath) {
  try {
    return JSON.parse(await readFile(hooksJsonPath, 'utf8'));
  } catch {
    return { version: 1, hooks: {}, modules: {} };
  }
}

function cursorSkillRouterRules(ctx) {
  return [
    '---',
    `description: AAFE Skill Index On-Demand Router (${ctx.moduleName})`,
    'alwaysApply: false',
    `globs: ${ctx.moduleGlob}`,
    '---',
    '',
    `# AAFE Skill Index On-Demand Router (${ctx.moduleName})`,
    '',
    'For every task in this repository module:',
    `1. Read \`${ctx.agentPrefix}/skill-index.md\` first.`,
    `2. If present, read \`${ctx.agentPrefix}/project.md\` for project-specific quick map and domain routing hints.`,
    `3. Read \`.aafe.config.json\` → \`mode.workflow\` (default \`ask\`). Load \`${ctx.agentPrefix}/skills/workflow-mode.md\` before the first interactive gate.`,
    `3b. ${taskSpinePointerLine(ctx.agentPrefix)}`,
    `4. Only when the task matches a domain, read the matching \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\`.`,
    `5. For non-trivial frontend work, then follow \`${ctx.agentPrefix}/runtime/*\` and \`${ctx.agentPrefix}/pipelines/*\`.`,
    '6. Editor directories are pointers only. Do not copy, rewrite, or maintain project knowledge in `.cursor`.',
    '7. Do not eagerly read all project skills.',
    ''
  ].join('\n');
}

function editorSkillEntry(name, ctx) {
  return [
    `# AAFE Project Skill Entry (${name} / ${ctx.moduleName})`,
    '',
    'This file is a thin pointer generated by @aafe/agent-runtime.',
    '',
    `Read \`${ctx.agentPrefix}/skill-index.md\` first, then \`${ctx.agentPrefix}/project.md\` if present, and only then load the matching \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\` on demand.`,
    '',
    'Do not copy project knowledge into this editor directory. The single source of truth is the module `.ai-agent` directory.',
    ''
  ].join('\n');
}

function nativeEditorSkill(name, ctx) {
  return [
    '---',
    'name: aafe-runtime',
    `description: Use the AAFE project runtime for architecture-aware frontend work in module ${ctx.moduleName}. Read the generated skill index first, then load only matching project skills on demand.`,
    '---',
    '',
    `# AAFE Runtime (${name} / ${ctx.moduleName})`,
    '',
    `1. Read \`${ctx.agentPrefix}/skill-index.md\` first and follow **Task Spine**.`,
    `2. Read \`${ctx.agentPrefix}/project.md\` when present.`,
    `3. Load only the matching \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\`.`,
    `4. ${taskSpinePointerLine(ctx.agentPrefix)}`,
    `5. For non-trivial work, follow \`${ctx.agentPrefix}/runtime/engine.md\`, \`${ctx.agentPrefix}/runtime/router.yaml\` and the selected pipeline.`,
    `6. Preserve successful decisions and reusable solutions in \`${ctx.agentPrefix}/memory/\`.`,
    '',
    `The module \`${ctx.agentPrefix}\` directory is the single source of truth; this file is only the editor discovery entry.`,
    ''
  ].join('\n');
}

function cursorRules(ctx) {
  return [
    '---',
    `description: AAFE Architecture Runtime (${ctx.moduleName})`,
    'alwaysApply: false',
    `globs: ${ctx.moduleGlob}`,
    '---',
    '',
    `# AAFE Architecture Runtime (${ctx.moduleName})`,
    '',
    'For every non-trivial frontend task after the Skill Router step:',
    `0. Read \`.aafe.config.json\` → \`mode.workflow\` (default \`ask\`) and follow \`aafe-workflow-mode.mdc\` / \`${ctx.agentPrefix}/skills/workflow-mode.md\` before the first interactive gate.`,
    `0a. ${taskSpinePointerLine(ctx.agentPrefix)}`,
    `0b. After concrete requirement (TAPD or user), follow \`aafe-requirement-intake-analysis.mdc\` / \`${ctx.agentPrefix}/skills/requirement-intake-analysis.md\`: TAPD pull + branch association (ID mismatch must continue branch switch/create unless user already confirmed current branch) → if TAPD contains Figma, fetch structured design + screenshot via Figma MCP → clarify → history → scope/root cause → Plan gate if large.`,
    `1. Read \`${ctx.agentPrefix}/runtime/engine.md\`.`,
    `2. Classify the task using \`${ctx.agentPrefix}/runtime/router.yaml\`.`,
    `3. Follow the selected \`${ctx.agentPrefix}/pipelines/*.yaml\`.`,
    `4. Enforce \`${ctx.agentPrefix}/runtime/gates.yaml\` before implementation.`,
    `5. Read \`${ctx.agentPrefix}/skills/project-architecture-locator.md\` first when locating routes, components, modules or design docs.`,
    `5b. For deep architecture/dataflow, use \`${ctx.agentPrefix}/skills/architecture-on-demand.md\` / \`dataflow-on-demand.md\` against configured analyze output (default \`.aafe/\`, never the full tree).`,
    '6. Use framework, DDD, design-pattern and scenario packs when relevant.',
    '7. For business-heavy features, run DDD Discovery before module decomposition.',
    '8. For new features, run Pattern Interview before Pattern Selection.',
    '9. For complex frontend work, select and land patterns per module based on real business responsibility.',
    '10. Output DDD Model, Architecture, Module Boundaries, Pattern Interview, Pattern Selection, Module Pattern Selection, Tradeoffs, Implementation and Critique.',
    `11. Before final response, follow layered rule \`aafe-task-completion-impact.mdc\`: **task assessment** — only ask impact/self-test when code changed; UI sub-asks only for code + UI impact; pre-generate \`ui_test_paths\`; TAPD + Figma tasks use local diff to generate impact units/test paths, then use Figma evidence to narrow impact and assertions.`,
    `12. After self-test or submit intent: \`aafe-tapd-submit-backfill.mdc\` **only when task has TAPD association** and \`tapd.enabled\`; else skip TAPD backfill asks.`,
    '13. File license: follow `aafe-new-file-license.mdc` — new files add header; edits use local `aafe license ensure <path>` (never AI-Read memory JSONL).',
    ''
  ].join('\n');
}

function cursorHookRunner() {
  return `: << 'CMDBLOCK'
@echo off
if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)
set "HOOK_DIR=%~dp0"
if exist "C:\\Program Files\\Git\\bin\\bash.exe" (
    "C:\\Program Files\\Git\\bin\\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\\Program Files (x86)\\Git\\bin\\bash.exe" (
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
exit /b 0
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec bash "\${SCRIPT_DIR}/\${SCRIPT_NAME}" "$@"
`;
}

function cursorTaskCompletionHook(ctx) {
  return taskCompletionHookScript(ctx);
}

function cursorSessionStartHook(ctx) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'cat <<\'JSON\'',
    '{',
    `  "additional_context": "${taskSpineHookContext(ctx.agentPrefix, ctx.moduleName)}"`,
    '}',
    'JSON',
    'exit 0',
    ''
  ].join('\n');
}

async function writeIfAllowed(filePath, content, options) {
  if (options.dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const previous = await safeRead(filePath);
  const fileExists = await exists(filePath);
  if (!options.force && fileExists) return;
  if (fileExists && previous === content) return;
  await writeFile(filePath, content);
}

async function makeExecutable(filePath) {
  try {
    await chmod(filePath, 0o755);
  } catch {
    // best effort
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function resolveCursorPathsFromConfig(root, projectConfig = {}) {
  const workspace = projectConfig.workspace ?? {};
  const layered = workspace.layeredEditors ?? workspace.layeredCursor;
  if (!layered || !workspace.moduleName) {
    return {
      layered: false,
      workspaceRoot: root,
      moduleName: null,
      paths: buildCursorLayerPaths(root, 'default')
    };
  }

  const workspaceRoot = path.resolve(root, workspace.workspaceRoot ?? '..');
  return {
    layered: true,
    workspaceRoot,
    moduleName: workspace.moduleName,
    paths: buildCursorLayerPaths(workspaceRoot, workspace.moduleName)
  };
}

