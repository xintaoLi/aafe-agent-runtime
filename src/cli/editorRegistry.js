export const WORKSPACE_ROOT_EDITORS = ['cursor', 'codebuddy', 'claude', 'codex', 'trace', 'windsurf', 'vscode', 'hermes', 'openclaw'];

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
    // Module layer is AAFE sync source; CodeBuddy only discovers flat
    // .codebuddy/{rules,skills,settings.json,mcp.json} (non-recursive).
    layerPattern: '.codebuddy/{module}',
    nativeDiscovery: {
      rules: '.codebuddy/rules/aafe-{module}/RULE.mdc',
      skills: '.codebuddy/skills/aafe-runtime/SKILL.md',
      settings: '.codebuddy/settings.json',
      mcp: '.codebuddy/mcp.json'
    },
    subdirs: ['skills', 'hooks', 'rules'],
    moduleFiles: ['aafe.md', 'settings.json', 'module.json']
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
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes Agent',
    dirName: '.hermes',
    rootFile: 'AGENTS.md',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'root-file',
    layerPattern: 'AGENTS.md#AAFE-module-{module}',
    appendMode: true
  },
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    dirName: '.openclaw',
    rootFile: 'AGENTS.md',
    workspaceRootOnly: true,
    layered: true,
    migrateKind: 'root-file',
    layerPattern: 'AGENTS.md#AAFE-module-{module}',
    appendMode: true
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
