export const WORKSPACE_ROOT_EDITORS = ['cursor', 'codebuddy', 'claude', 'codex', 'trace', 'windsurf', 'vscode'];

export const EDITOR_ADAPTERS = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    dirName: '.cursor',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'directory',
    layerPattern: '.cursor/{rules,skills,hooks,context}/{module}',
    subdirs: ['rules', 'skills', 'hooks', 'context']
  },
  codebuddy: {
    id: 'codebuddy',
    label: 'CodeBuddy',
    dirName: '.codebuddy',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'directory',
    layerPattern: '.codebuddy/{module}',
    subdirs: ['skills'],
    moduleFiles: ['aafe.md']
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    dirName: null,
    rootFile: 'CLAUDE.md',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'root-file',
    layerPattern: 'CLAUDE.md#AAFE-module-{module}',
    appendMode: true
  },
  codex: {
    id: 'codex',
    label: 'CodeX',
    dirName: '.codex',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'directory',
    layerPattern: '.codex/{module}',
    moduleFiles: ['aafe.md']
  },
  trace: {
    id: 'trace',
    label: 'Trace',
    dirName: '.trace',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'directory',
    layerPattern: '.trace/{module}',
    moduleFiles: ['aafe.md']
  },
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf',
    dirName: null,
    rootFile: '.windsurfrules',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'root-file',
    layerPattern: '.windsurfrules#AAFE-module-{module}',
    appendMode: true
  },
  vscode: {
    id: 'vscode',
    label: 'VS Code',
    dirName: '.vscode',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'directory',
    layerPattern: '.vscode/{module}',
    moduleFiles: ['aafe.instructions.md']
  }
};

export function getEditorAdapter(editorId) {
  return EDITOR_ADAPTERS[editorId] ?? null;
}

export function normalizeEditors(editors = []) {
  return [...new Set((Array.isArray(editors) ? editors : String(editors).split(','))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean))];
}

export function getWorkspaceRootEditors(editors = []) {
  return normalizeEditors(editors).filter((id) => EDITOR_ADAPTERS[id]?.workspaceRootOnly);
}

export function getLayeredEditors(editors = []) {
  return getWorkspaceRootEditors(editors).filter((id) => EDITOR_ADAPTERS[id]?.layered);
}
