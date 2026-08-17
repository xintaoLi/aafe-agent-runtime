import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requirementIntakeRuleSection } from './requirementAnalysisRules.js';
import { taskCompletionImpactRuleSection } from './completionImpactRules.js';
import { tapdSubmitRuleSection } from './tapdSubmitRules.js';
import { createCursorPathContext } from './pathRewrite.js';
import { RETAIN_IN_INSTALL_DIR } from './workspace.js';

export function buildCodeBuddyLayerPaths(workspaceRoot, moduleName, layered = true) {
  const moduleDir = layered
    ? path.join(workspaceRoot, '.codebuddy', moduleName)
    : path.join(workspaceRoot, '.codebuddy');
  const ruleName = layered ? `aafe-${moduleName}` : 'aafe';
  return {
    moduleDir,
    layered,
    ruleName,
    aafeMd: path.join(moduleDir, 'aafe.md'),
    moduleJson: path.join(moduleDir, 'module.json'),
    moduleSkill: path.join(moduleDir, 'skills', 'aafe-runtime', 'SKILL.md'),
    moduleSkillEntry: path.join(moduleDir, 'skills', 'ENTRY.md'),
    hooksDir: path.join(moduleDir, 'hooks'),
    moduleSettings: path.join(moduleDir, 'settings.json'),
    moduleMcp: path.join(moduleDir, 'mcp.json'),
    nativeRule: path.join(workspaceRoot, '.codebuddy', 'rules', ruleName, 'RULE.mdc'),
    nativeSkill: path.join(workspaceRoot, '.codebuddy', 'skills', 'aafe-runtime', 'SKILL.md'),
    nativeSettings: path.join(workspaceRoot, '.codebuddy', 'settings.json'),
    nativeMcp: path.join(workspaceRoot, '.codebuddy', 'mcp.json')
  };
}

export async function writeLayeredCodeBuddyAdapters({
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {}
}) {
  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const paths = buildCodeBuddyLayerPaths(workspaceRoot, moduleName, true);
  await writeCodeBuddyAdapters({ workspaceRoot, ctx, paths, options });
  return { paths, ctx };
}

export async function writeFlatCodeBuddyAdapters(root, options = {}) {
  const ctx = createCursorPathContext('root', '.');
  const paths = buildCodeBuddyLayerPaths(root, 'root', false);
  await writeCodeBuddyAdapters({ workspaceRoot: root, ctx, paths, options });
  return { paths, ctx };
}

async function writeCodeBuddyAdapters({ workspaceRoot, ctx, paths, options }) {
  const aafeMd = buildCodeBuddyRules(ctx, paths);
  const nativeRule = buildCodeBuddyNativeRule(ctx, paths, aafeMd);
  const skill = buildCodeBuddyNativeSkill(ctx, paths);
  const settings = buildCodeBuddySettings(ctx, paths);
  const sessionHook = codeBuddySessionStartHook();
  const hookRunner = codeBuddyHookRunner();

  await writeIfAllowed(paths.aafeMd, aafeMd, options);
  await writeIfAllowed(paths.moduleSkill, skill, options);
  await writeIfAllowed(paths.moduleSkillEntry, buildEditorSkillEntry(ctx), options);
  if (paths.layered) {
    await writeIfAllowed(paths.moduleJson, buildModuleManifest(ctx), options);
  }
  await writeIfAllowed(path.join(paths.hooksDir, 'run-hook.cmd'), hookRunner, options);
  await writeIfAllowed(path.join(paths.hooksDir, 'aafe-session-start'), sessionHook, options);
  await writeIfAllowed(paths.moduleSettings, settings, options);

  await writeIfAllowed(paths.nativeRule, nativeRule, options);
  await writeIfAllowed(paths.nativeSkill, skill, options);
  await mergeNativeSettings(paths.nativeSettings, settings, options);
  await promoteMcpJson(paths, options);

  await makeExecutable(path.join(paths.hooksDir, 'aafe-session-start'));
  await makeExecutable(path.join(paths.hooksDir, 'run-hook.cmd'));
}

function buildModuleManifest(ctx) {
  return `${JSON.stringify({
    editor: 'codebuddy',
    moduleName: ctx.moduleName,
    moduleRelativePath: ctx.moduleRelativePath,
    agentPrefix: ctx.agentPrefix,
    docsPrefix: ctx.docsPath,
    configPath: ctx.configPath,
    layerPattern: `.codebuddy/${ctx.moduleName}`,
    nativeDiscovery: {
      rules: `.codebuddy/rules/aafe-${ctx.moduleName}/RULE.mdc`,
      skills: '.codebuddy/skills/aafe-runtime/SKILL.md',
      settings: '.codebuddy/settings.json',
      mcp: '.codebuddy/mcp.json'
    },
    retainInInstallDir: [...RETAIN_IN_INSTALL_DIR],
    editorOnlyAtWorkspaceRoot: true,
    generatedBy: '@aafe/agent-runtime',
    note: 'Module layer (.codebuddy/{module}/) is the AAFE sync source; native discovery files live at .codebuddy/{rules,skills,settings.json,mcp.json} because CodeBuddy does not recurse into module subdirectories.'
  }, null, 2)}\n`;
}

function buildEditorSkillEntry(ctx) {
  return [
    `# AAFE Project Skill Entry (CodeBuddy / ${ctx.moduleName})`,
    '',
    `Read \`${ctx.agentPrefix}/skill-index.md\` first, then \`${ctx.agentPrefix}/project.md\` if present.`,
    '',
    'CodeBuddy discovers skills from `.codebuddy/skills/<name>/SKILL.md` (workspace root, non-recursive).',
    'The native discovery entry is `.codebuddy/skills/aafe-runtime/SKILL.md`.',
    ''
  ].join('\n');
}

export function buildCodeBuddyRules(ctx, paths = null) {
  const layered = paths?.layered ?? Boolean(ctx.moduleRelativePath && ctx.moduleRelativePath !== '.');
  const nativeSkillRef = '.codebuddy/skills/aafe-runtime/SKILL.md';
  return [
    `# AAFE Architecture Runtime (${ctx.moduleName})`,
    '',
    requirementIntakeRuleSection(ctx).trimEnd(),
    taskCompletionImpactRuleSection(ctx).trimEnd(),
    tapdSubmitRuleSection(ctx).trimEnd(),
    '## AAFE Skill Router',
    '',
    `For every task in module \`${ctx.moduleRelativePath}\`, read \`${ctx.agentPrefix}/skill-index.md\` first, then \`${ctx.agentPrefix}/project.md\` if present, and only the matching \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\` on demand.`,
    `Native skill entry: \`${nativeSkillRef}\`. Runtime knowledge stays in \`${ctx.agentPrefix}/\`.`,
    layered
      ? `AAFE module source (not scanned by CodeBuddy): \`.codebuddy/${ctx.moduleName}/\`.`
      : '',
    '',
    '## Runtime Pipeline',
    '',
    `Load \`${ctx.agentPrefix}/runtime/engine.md\`, classify with \`${ctx.agentPrefix}/runtime/router.yaml\`, follow pipelines and enforce \`${ctx.agentPrefix}/runtime/gates.yaml\`.`,
    ''
  ].filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n');
}

function buildCodeBuddyNativeRule(ctx, paths, aafeMd) {
  const body = aafeMd.replace(/^# AAFE Architecture Runtime[^\n]*\n+/, '');
  return [
    '---',
    `description: AAFE Architecture Runtime for module ${ctx.moduleName} (${ctx.moduleRelativePath}). Always-on entry that routes every task to ${ctx.agentPrefix}.`,
    'alwaysApply: true',
    'enabled: true',
    '---',
    '',
    `# AAFE Architecture Runtime (${ctx.moduleName})`,
    '',
    paths.layered
      ? `> Source of truth: \`.codebuddy/${ctx.moduleName}/aafe.md\`（由 \`@aafe/agent-runtime\` 生成）。`
      : '> Source of truth: `.codebuddy/aafe.md`（由 `@aafe/agent-runtime` 生成）。',
    '> 本文件是 CodeBuddy 可识别的原生规则副本；`aafe sync/update` 时与模块层保持同步。',
    '',
    body.trim(),
    ''
  ].join('\n');
}

function buildCodeBuddyNativeSkill(ctx, paths) {
  const moduleHint = paths.layered
    ? `module ${ctx.moduleName} (${ctx.moduleRelativePath})`
    : 'this project';
  return [
    '---',
    'name: aafe-runtime',
    `description: Use the AAFE project runtime for architecture-aware frontend work in ${moduleHint}. Load this skill for ANY task that touches this module — components, routes, Vue/React/TS, requirement intake, impact analysis, self-test, or TAPD backfill. It routes to the module knowledge base at ${ctx.agentPrefix}.`,
    '---',
    '',
    `# AAFE Runtime (CodeBuddy / ${ctx.moduleName})`,
    '',
    `模块：\`${ctx.moduleName}\`，物理路径：\`${ctx.moduleRelativePath}\`，知识库根：\`${ctx.agentPrefix}\`。`,
    '',
    '## 加载顺序',
    '',
    `1. Read \`${ctx.agentPrefix}/skill-index.md\` first —— 技能索引，决定要加载哪个 domain。`,
    `2. Read \`${ctx.agentPrefix}/project.md\` when present —— 项目地图与使用约束。`,
    `3. Read \`${ctx.agentPrefix}/runtime/engine.md\`、\`runtime/router.yaml\`、\`runtime/gates.yaml\` —— 执行引擎、任务分类、门禁。`,
    `4. 按需加载匹配的 \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\`，不要一次性全量加载。`,
    '',
    '## 边界',
    '',
    `- 优先在 \`${ctx.moduleRelativePath}\` 范围内改动；跨模块需先确认。`,
    `- 运行时知识只存放在 \`${ctx.agentPrefix}/\`，不要写入 \`.codebuddy/\`。`,
    `- 完整的常驻约束见项目规则 \`.codebuddy/rules/${paths.ruleName}/RULE.mdc\`。`,
    ''
  ].join('\n');
}

function buildCodeBuddySettings(ctx, paths) {
  const hookCommand = paths.layered
    ? `$CODEBUDDY_PROJECT_DIR/.codebuddy/${ctx.moduleName}/hooks/run-hook.cmd aafe-session-start`
    : '$CODEBUDDY_PROJECT_DIR/.codebuddy/hooks/run-hook.cmd aafe-session-start';
  return `${JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
              timeout: 30
            }
          ]
        }
      ]
    }
  }, null, 2)}\n`;
}

async function mergeNativeSettings(settingsPath, moduleSettingsContent, options) {
  if (options.dryRun) return;
  let next;
  try {
    const incoming = JSON.parse(moduleSettingsContent);
    const existing = await readJson(settingsPath);
    next = mergeCodeBuddySettings(existing, incoming);
  } catch {
    next = JSON.parse(moduleSettingsContent);
  }
  await writeIfAllowed(settingsPath, `${JSON.stringify(next, null, 2)}\n`, { ...options, force: true });
}

function mergeCodeBuddySettings(existing, incoming) {
  const next = existing && typeof existing === 'object' ? { ...existing } : {};
  next.hooks = next.hooks && typeof next.hooks === 'object' ? { ...next.hooks } : {};
  const incomingSession = Array.isArray(incoming?.hooks?.SessionStart) ? incoming.hooks.SessionStart : [];
  const currentSession = Array.isArray(next.hooks.SessionStart) ? [...next.hooks.SessionStart] : [];

  for (const entry of incomingSession) {
    const command = entry?.hooks?.[0]?.command;
    if (command && currentSession.some((item) => item?.hooks?.[0]?.command === command)) continue;
    currentSession.push(entry);
  }
  next.hooks.SessionStart = currentSession;
  return next;
}

async function promoteMcpJson(paths, options) {
  if (!(await exists(paths.moduleMcp))) return;
  const content = await safeRead(paths.moduleMcp);
  if (!content.trim()) return;
  await writeIfAllowed(paths.nativeMcp, content.endsWith('\n') ? content : `${content}\n`, options);
}

function codeBuddyHookRunner() {
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

export function codeBuddySessionStartHook() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Drain SessionStart input JSON without hanging on an open pipe.',
    'if [ ! -t 0 ]; then',
    '  while IFS= read -r -t 1 _line || [ -n "${_line:-}" ]; do',
    '    :',
    '  done || true',
    'fi',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    '# hooks/ -> <layer root>, e.g. <workspace>/.codebuddy/<module>',
    'MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"',
    '',
    'if [ -n "${CODEBUDDY_PROJECT_DIR:-}" ]; then',
    '  PROJECT_ROOT="$(cd "${CODEBUDDY_PROJECT_DIR}" && pwd)"',
    'elif [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then',
    '  PROJECT_ROOT="$(cd "${CLAUDE_PROJECT_DIR}" && pwd)"',
    'else',
    '  # layered: <module>/.codebuddy parent; flat: hooks live directly under .codebuddy',
    '  if [ "$(basename "${MODULE_DIR}")" = ".codebuddy" ]; then',
    '    PROJECT_ROOT="$(cd "${MODULE_DIR}/.." && pwd)"',
    '  else',
    '    PROJECT_ROOT="$(cd "${MODULE_DIR}/../.." && pwd)"',
    '  fi',
    'fi',
    '',
    '# moduleRelativePath comes from the AAFE layer descriptor (module.json).',
    'MODULE_REL=""',
    'if [ -f "${MODULE_DIR}/module.json" ]; then',
    '  MODULE_REL="$(sed -n \'s/.*"moduleRelativePath"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' "${MODULE_DIR}/module.json" | head -n 1)"',
    'fi',
    '',
    'AGENT_ROOT=""',
    'for candidate in \\',
    '  "${PROJECT_ROOT}${MODULE_REL:+/${MODULE_REL}}/.ai-agent" \\',
    '  "${PROJECT_ROOT}/.ai-agent"; do',
    '  if [ -d "${candidate}" ]; then',
    '    AGENT_ROOT="${candidate}"',
    '    break',
    '  fi',
    'done',
    '',
    'if [ -z "${AGENT_ROOT}" ]; then',
    '  printf \'{"continue":true}\\n\'',
    '  exit 0',
    'fi',
    '',
    'read_text() {',
    '  if [ -f "$1" ]; then',
    '    while IFS= read -r line || [ -n "$line" ]; do',
    '      printf \'%s\\n\' "$line"',
    '    done < "$1"',
    '  fi',
    '}',
    '',
    'escape_for_json() {',
    '  local s="$1"',
    '  s="${s//\\\\/\\\\\\\\}"',
    '  s="${s//\\"/\\\\\\"}"',
    '  s="${s//$\'\\n\'/\\\\n}"',
    '  s="${s//$\'\\r\'/\\\\r}"',
    '  s="${s//$\'\\t\'/\\\\t}"',
    '  printf \'%s\' "$s"',
    '}',
    '',
    'engine="$(read_text "${AGENT_ROOT}/runtime/engine.md")"',
    'router="$(read_text "${AGENT_ROOT}/runtime/router.yaml")"',
    'gates="$(read_text "${AGENT_ROOT}/runtime/gates.yaml")"',
    '',
    'context="$(printf \'<AAFE_RUNTIME>\\nAAFE Architecture Runtime is active for this repository.\\n\\nEngine:\\n%s\\n\\nRouter:\\n%s\\n\\nGates:\\n%s\\n</AAFE_RUNTIME>\' "${engine}" "${router}" "${gates}")"',
    'escaped_context="$(escape_for_json "$context")"',
    'printf \'{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n\' "$escaped_context"',
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

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}
