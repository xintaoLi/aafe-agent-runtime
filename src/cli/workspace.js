import { execFile } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { EDITOR_ADAPTERS } from './editorRegistry.js';

const execFileAsync = promisify(execFile);

export const RETAIN_IN_INSTALL_DIR = ['.ai-agent', '.docs', '.aafe.config.json'];

export async function findWorkspaceRoot(startDir) {
  const resolved = await realpath(path.resolve(startDir));
  const gitRoot = await findGitRoot(resolved);
  return gitRoot ? await realpath(gitRoot) : resolved;
}

async function findGitRoot(startDir) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir });
    const root = stdout.trim();
    return root ? await realpath(root) : null;
  } catch {
    return findGitRootByWalk(startDir);
  }
}

async function findGitRootByWalk(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function toPosixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

export function normalizeModuleName(name, fallback = 'module') {
  const normalized = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export function suggestModuleName(installRoot, moduleRelativePath) {
  if (moduleRelativePath && moduleRelativePath !== '.') {
    const segments = moduleRelativePath.split('/').filter(Boolean);
    if (segments.length) return segments[segments.length - 1];
  }
  return path.basename(installRoot);
}

async function probePath(baseDir, relPath, kind = 'dir') {
  const target = path.join(baseDir, relPath);
  const existsOnDisk = kind === 'dir' ? await isDirectory(target) : await isFile(target);
  return { name: relPath, path: target, exists: existsOnDisk, kind };
}

async function probeEditors(baseDir) {
  const probe = {};
  for (const adapter of Object.values(EDITOR_ADAPTERS)) {
    if (adapter.dirName) {
      probe[adapter.id] = await probePath(baseDir, adapter.dirName, 'dir');
    }
    if (adapter.rootFile) {
      probe[adapter.id] = await probePath(baseDir, adapter.rootFile, 'file');
    }
  }
  return probe;
}

export async function resolveWorkspaceLayout(installRoot, editors = []) {
  const resolvedInstallRoot = await realpath(path.resolve(installRoot));
  const workspaceRoot = await findWorkspaceRoot(resolvedInstallRoot);
  const moduleRelativePath = toPosixRelative(workspaceRoot, resolvedInstallRoot);
  const layeredEditors = moduleRelativePath !== '' && moduleRelativePath !== '.';

  const installProbe = {
    editors: layeredEditors ? await probeEditors(resolvedInstallRoot) : {},
    aiAgent: await probePath(resolvedInstallRoot, '.ai-agent', 'dir'),
    docs: await probePath(resolvedInstallRoot, '.docs', 'dir'),
    config: await probePath(resolvedInstallRoot, '.aafe.config.json', 'file')
  };
  const workspaceProbe = layeredEditors
    ? {
      editors: await probeEditors(workspaceRoot),
      aiAgent: await probePath(workspaceRoot, '.ai-agent', 'dir'),
      docs: await probePath(workspaceRoot, '.docs', 'dir'),
      config: await probePath(workspaceRoot, '.aafe.config.json', 'file')
    }
    : null;

  const installEditorIds = layeredEditors
    ? Object.entries(installProbe.editors).filter(([, item]) => item.exists).map(([id]) => id)
    : [];
  const activeEditors = editors.length ? editors : installEditorIds;
  const hasInstallDirEditors = installEditorIds.length > 0;
  const installEditorSummary = Object.fromEntries(
    Object.entries(installProbe.editors).map(([id, item]) => [id, item.exists])
  );
  const workspaceEditorSummary = workspaceProbe
    ? Object.fromEntries(Object.entries(workspaceProbe.editors).map(([id, item]) => [id, item.exists]))
    : {};

  return {
    installRoot: resolvedInstallRoot,
    workspaceRoot,
    moduleRelativePath: layeredEditors ? moduleRelativePath : '.',
    layeredEditors,
    layeredCursor: layeredEditors,
    editors: activeEditors,
    installEditorIds,
    hasInstallDirEditors,
    hasInstallDirCursor: layeredEditors && Boolean(installProbe.editors.cursor?.exists),
    hasWorkspaceRootCursor: layeredEditors && Boolean(workspaceProbe?.editors.cursor?.exists),
    hasInstallDirAiAgent: installProbe.aiAgent.exists,
    hasInstallDirDocs: installProbe.docs.exists,
    hasWorkspaceRootAiAgent: Boolean(workspaceProbe?.aiAgent.exists),
    hasWorkspaceRootDocs: Boolean(workspaceProbe?.docs.exists),
    shouldPromptEditorMigration: layeredEditors && hasInstallDirEditors,
    shouldPromptCursorMigration: layeredEditors && Boolean(installProbe.editors.cursor?.exists),
    migrateInstallEditors: hasInstallDirEditors,
    migrateInstallCursor: Boolean(installProbe.editors.cursor?.exists),
    retainInInstallDir: [...RETAIN_IN_INSTALL_DIR],
    editorOnlyAtWorkspaceRoot: layeredEditors,
    cursorOnlyAtWorkspaceRoot: layeredEditors,
    suggestedModuleName: suggestModuleName(resolvedInstallRoot, moduleRelativePath),
    workspaceRootRelative: layeredEditors ? toPosixRelative(resolvedInstallRoot, workspaceRoot) : '.',
    installProbe,
    workspaceProbe,
    installEditorSummary,
    workspaceEditorSummary
  };
}

export async function enrichWorkspaceLayout(layout, options = {}) {
  if (!layout.layeredEditors) {
    return { ...layout, moduleName: null, migrateInstallEditors: false, migrateInstallCursor: false };
  }

  const moduleName = normalizeModuleName(
    options.moduleName ?? layout.suggestedModuleName,
    layout.suggestedModuleName
  );
  const migrateInstallEditors = options.migrateInstallEditors
    ?? options.migrateInstallCursor
    ?? layout.hasInstallDirEditors;

  return {
    ...layout,
    moduleName,
    migrateInstallEditors,
    migrateInstallCursor: options.migrateInstallCursor ?? Boolean(layout.installEditorSummary?.cursor)
  };
}

export function formatWorkspaceAnalysis(layout) {
  if (!layout?.layeredEditors) return [];

  const editorLines = Object.entries(layout.installEditorSummary ?? {})
    .filter(([, exists]) => exists)
    .map(([id]) => {
      const adapter = EDITOR_ADAPTERS[id];
      const marker = adapter?.dirName ?? adapter?.rootFile ?? id;
      return `  [install] ${marker}: found for ${adapter?.label ?? id} (must live at workspace root)`;
    });

  const lines = [
    'Workspace analysis:',
    `  install dir: ${layout.installRoot}`,
    `  workspace root: ${layout.workspaceRoot}`,
    `  module path: ${layout.moduleRelativePath}`,
    '  policy: only editor adapter dirs/files (.cursor, .codebuddy, CLAUDE.md, .codex, ...) are created/migrated at workspace root.',
    '  retain in install dir: .ai-agent, .docs, .aafe.config.json',
    `  [install] .ai-agent: ${layout.hasInstallDirAiAgent ? 'found (keep here)' : 'not found yet'}`,
    `  [install] .docs: ${layout.hasInstallDirDocs ? 'found (keep here)' : 'not found yet'}`,
    ...editorLines,
    `  [root] .ai-agent: ${layout.hasWorkspaceRootAiAgent ? 'found (avoid root pollution)' : 'not found'}`,
    `  [root] .docs: ${layout.hasWorkspaceRootDocs ? 'found (avoid root pollution unless shared)' : 'not found'}`
  ];

  if (layout.hasInstallDirEditors) {
    lines.push('  action: migrate/merge install-dir editor adapters to workspace root and rewrite pointers to install-dir resources.');
  } else {
    lines.push('  action: create workspace-root layered editor adapters with pointers to install-dir resources.');
  }

  return lines;
}

async function exists(filePath) {
  try {
    await access(filePath);
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

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
