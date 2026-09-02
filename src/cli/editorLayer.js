import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EDITOR_ADAPTERS, getEditorAdapter, getLayeredEditors } from './editorRegistry.js';
import { requirementIntakeRuleSection } from './requirementAnalysisRules.js';
import { taskCompletionImpactRuleSection } from './completionImpactRules.js';
import { tapdSubmitRuleSection } from './tapdSubmitRules.js';
import { createCursorPathContext, rewriteCursorContent } from './pathRewrite.js';
import { writeLayeredCursorAdapters, migrateInstallCursorToWorkspace, buildCursorLayerPaths } from './cursorLayer.js';
import { writeLayeredCodeBuddyAdapters } from './codebuddyLayer.js';
import { writeLayeredHermesAdapters } from './hermesLayer.js';
import { writeLayeredOpenClawAdapters } from './openclawLayer.js';
import {
  requirementIntakeProjectRuleMdc
} from './requirementAnalysisRules.js';
import {
  taskCompletionImpactProjectRuleMdc
} from './completionImpactRules.js';
import {
  tapdSubmitProjectRuleMdc
} from './tapdSubmitRules.js';
import {
  fileLicenseProjectRuleMdc,
  fileLicenseRuleSection
} from './fileLicenseRules.js';
import {
  workflowModeProjectRuleMdc
} from './workflowModeRules.js';
import { RETAIN_IN_INSTALL_DIR } from './workspace.js';

export async function writeLayeredEditorAdapters({
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {},
  plan = {}
}) {
  const editors = getLayeredEditors(plan.editors ?? ['cursor']);
  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const results = [];

  // Seed project-owned rules once for any layered editor (not only Cursor).
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

  for (const editorId of editors) {
    if (options.migrateInstallEditors !== false && options.installRoot && editorId !== 'cursor') {
      await migrateInstallEditorToWorkspace({
        editorId,
        installRoot: options.installRoot,
        workspaceRoot,
        moduleName,
        moduleRelativePath,
        options
      });
    }

    if (editorId === 'cursor') {
      await writeLayeredCursorAdapters({
        workspaceRoot,
        moduleName,
        moduleRelativePath,
        options: {
          ...options,
          installRoot: options.installRoot,
          migrateInstallCursor: options.migrateInstallEditors !== false
        },
        plan: { editors: ['cursor'] }
      });
      continue;
    }

    await writeLayeredGenericEditor({
      editorId,
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      ctx,
      options
    });
  }

  return { ctx, results };
}

export async function migrateInstallEditorToWorkspace({
  editorId,
  installRoot,
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {}
}) {
  const adapter = getEditorAdapter(editorId);
  if (!adapter?.layered) return { migrated: false, reason: 'unsupported-editor' };

  if (editorId === 'cursor') {
    return migrateInstallCursorToWorkspace({
      installRoot,
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      options
    });
  }

  if (adapter.migrateKind === 'root-file') {
    return migrateRootFileEditor({ adapter, installRoot, workspaceRoot, moduleName, moduleRelativePath, options });
  }

  const sourceDir = path.join(installRoot, adapter.dirName);
  if (!(await isDirectory(sourceDir))) return { migrated: false, reason: 'missing-install-editor-dir' };

  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const targetModuleDir = path.join(workspaceRoot, adapter.dirName, moduleName);
  await copyDirectoryWithRewrite(sourceDir, targetModuleDir, ctx, options, sourceDir, adapter);

  if (!options.dryRun) {
    const backupDir = path.join(installRoot, `${adapter.dirName}.aafe-migrated-${Date.now()}`);
    await rename(sourceDir, backupDir);
    await writeMigrationReadme(backupDir, { adapter, installRoot, workspaceRoot, moduleName, moduleRelativePath });
  }

  return { migrated: true, editorId };
}

async function migrateRootFileEditor({ adapter, installRoot, workspaceRoot, moduleName, moduleRelativePath, options }) {
  const sourceFile = path.join(installRoot, adapter.rootFile);
  if (!(await exists(sourceFile))) return { migrated: false, reason: 'missing-install-editor-file' };

  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const raw = await readFile(sourceFile, 'utf8');
  const rewritten = rewriteCursorContent(raw, ctx, adapter.rootFile);
  const block = buildRootFileModuleBlock(adapter, moduleName, moduleRelativePath, rewritten);
  const targetFile = path.join(workspaceRoot, adapter.rootFile);
  const previous = await safeRead(targetFile);
  const next = mergeRootFileModuleBlock(previous, block, moduleName);
  await writeIfAllowed(targetFile, next, options);

  if (!options.dryRun) {
    const backupFile = path.join(installRoot, `${adapter.rootFile}.aafe-migrated-${Date.now()}`);
    await rename(sourceFile, backupFile);
    await writeMigrationReadme(path.dirname(backupFile), {
      adapter,
      installRoot,
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      note: `Install-dir ${adapter.rootFile} merged into workspace-root ${adapter.rootFile}.`
    }, `${path.basename(backupFile)}.README.txt`);
  }

  return { migrated: true, editorId: adapter.id };
}

async function writeLayeredGenericEditor({ editorId, workspaceRoot, moduleName, moduleRelativePath, ctx, options }) {
  const adapter = getEditorAdapter(editorId);
  if (!adapter) return;

  const moduleDir = path.join(workspaceRoot, adapter.dirName, moduleName);
  if (editorId === 'codebuddy') {
    await writeLayeredCodeBuddyAdapters({
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      options
    });
    return;
  }
  if (editorId === 'hermes') {
    await writeLayeredHermesAdapters({
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      options
    });
    return;
  }
  if (editorId === 'openclaw') {
    await writeLayeredOpenClawAdapters({
      workspaceRoot,
      moduleName,
      moduleRelativePath,
      options
    });
    return;
  }

  const fileName = adapter.moduleFiles?.[0] ?? 'aafe.md';
  const label = adapter.label;
  await writeIfAllowed(path.join(moduleDir, fileName), buildGenericEditorRules(label, ctx), options);
  await writeIfAllowed(path.join(moduleDir, 'module.json'), buildModuleManifest(adapter, ctx), options);
}

function buildModuleManifest(adapter, ctx) {
  return `${JSON.stringify({
    editor: adapter.id,
    moduleName: ctx.moduleName,
    moduleRelativePath: ctx.moduleRelativePath,
    agentPrefix: ctx.agentPrefix,
    docsPrefix: ctx.docsPath,
    configPath: ctx.configPath,
    layerPattern: adapter.layerPattern.replace('{module}', ctx.moduleName),
    retainInInstallDir: [...RETAIN_IN_INSTALL_DIR],
    editorOnlyAtWorkspaceRoot: true,
    generatedBy: '@aafe/agent-runtime'
  }, null, 2)}\n`;
}

function buildGenericEditorRules(name, ctx) {
  return [
    `# AAFE Architecture Runtime for ${name} (${ctx.moduleName})`,
    '',
    requirementIntakeRuleSection(ctx).trimEnd(),
    taskCompletionImpactRuleSection(ctx).trimEnd(),
    tapdSubmitRuleSection(ctx).trimEnd(),
    fileLicenseRuleSection(ctx).trimEnd(),
    '## AAFE Skill Router',
    '',
    `For module \`${ctx.moduleRelativePath}\`, read \`${ctx.agentPrefix}/skill-index.md\` first, then \`${ctx.agentPrefix}/project.md\` if present, then only matching \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\` on demand.`,
    'Editor adapter files are pointers only; do not copy project knowledge into editor directories.',
    '',
    '## Runtime Pipeline',
    '',
    `Use \`${ctx.agentPrefix}\` as the architecture runtime source of truth.`,
    ''
  ].join('\n');
}

function buildRootFileModuleBlock(adapter, moduleName, moduleRelativePath, body) {
  return [
    `<!-- AAFE:module:${moduleName} editor:${adapter.id} path:${moduleRelativePath} -->`,
    `# AAFE Architecture Runtime (${adapter.label} / ${moduleName})`,
    '',
    body.trim(),
    `<!-- /AAFE:module:${moduleName} -->`,
    ''
  ].join('\n');
}

function mergeRootFileModuleBlock(previous, block, moduleName) {
  const markerStart = `<!-- AAFE:module:${moduleName}`;
  const markerEnd = `<!-- /AAFE:module:${moduleName} -->`;
  if (previous.includes(markerStart) && previous.includes(markerEnd)) {
    const start = previous.indexOf(markerStart);
    const end = previous.indexOf(markerEnd) + markerEnd.length;
    return `${previous.slice(0, start).trimEnd()}\n\n${block}${previous.slice(end).trimStart() ? `\n${previous.slice(end).trimStart()}` : ''}`.trimStart() + '\n';
  }
  if (previous.includes('AAFE Architecture Runtime') && !previous.includes(markerStart)) {
    return `${previous.trimEnd()}\n\n${block}`;
  }
  return `${previous.trimEnd() ? `${previous.trimEnd()}\n\n` : ''}${block}`;
}

async function copyDirectoryWithRewrite(sourceDir, targetDir, ctx, options, sourceRoot, adapter) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipMigrationEntry(entry.name)) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryWithRewrite(sourcePath, targetPath, ctx, options, sourceRoot, adapter);
      continue;
    }
    if (!entry.isFile()) continue;
    const raw = await readFile(sourcePath, 'utf8');
    const fileRelPath = path.relative(sourceRoot, sourcePath).split(path.sep).join('/');
    const content = raw.includes('\u0000') ? raw : rewriteCursorContent(raw, ctx, fileRelPath);
    await writeIfAllowed(targetPath, content, options);
  }
}

function shouldSkipMigrationEntry(name) {
  return RETAIN_IN_INSTALL_DIR.includes(name) || name === '.ai-agent' || name === '.docs';
}

async function writeMigrationReadme(baseDir, meta, fileName = 'AAFE-MIGRATION-README.txt') {
  await writeFile(path.join(baseDir, fileName), [
    `This ${meta.adapter.dirName ?? meta.adapter.rootFile} entry was migrated to workspace root by @aafe/agent-runtime.`,
    `Editor: ${meta.adapter.label}`,
    `Workspace root: ${meta.workspaceRoot}`,
    `Install dir: ${meta.installRoot}`,
    `Module name: ${meta.moduleName}`,
    `Module path: ${meta.moduleRelativePath}`,
    `Target layer: ${meta.adapter.layerPattern.replace('{module}', meta.moduleName)}`,
    '',
    'Migration policy:',
    '- ONLY editor adapter files/dirs are moved/merged to workspace root.',
    `- ${RETAIN_IN_INSTALL_DIR.join(', ')} remain in the install directory.`,
    meta.note ?? ''
  ].filter(Boolean).join('\n'));
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

export function resolveEditorPathsFromConfig(root, projectConfig = {}, editorId = 'cursor') {
  const workspace = projectConfig.workspace ?? {};
  const layered = workspace.layeredEditors ?? workspace.layeredCursor;
  const moduleName = workspace.moduleName;
  if (!layered || !moduleName) {
    return { layered: false, workspaceRoot: root, moduleName: null, editorId, paths: {} };
  }
  const workspaceRoot = path.resolve(root, workspace.workspaceRoot ?? '..');
  if (editorId === 'cursor') {
    return {
      layered: true,
      workspaceRoot,
      moduleName,
      editorId,
      paths: buildCursorLayerPaths(workspaceRoot, moduleName)
    };
  }
  const adapter = getEditorAdapter(editorId);
  const moduleDir = adapter?.dirName ? path.join(workspaceRoot, adapter.dirName, moduleName) : workspaceRoot;
  return { layered: true, workspaceRoot, moduleName, editorId, paths: { moduleDir } };
}

export function resolveCursorPathsFromConfig(root, projectConfig = {}) {
  return resolveEditorPathsFromConfig(root, projectConfig, 'cursor');
}
