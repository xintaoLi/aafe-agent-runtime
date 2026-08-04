import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveEditorPathsFromConfig } from './editorLayer.js';
import { getEditorAdapter } from './editorRegistry.js';

const requiredFiles = [
  '.ai-agent/skill-index.md',
  '.ai-agent/runtime/engine.md',
  '.ai-agent/runtime/router.yaml',
  '.ai-agent/runtime/gates.yaml',
  '.ai-agent/runtime/memory.md',
  '.ai-agent/pipelines/feature.yaml',
  '.ai-agent/pipelines/domain-feature.yaml',
  '.ai-agent/pipelines/pattern-feature.yaml',
  '.ai-agent/skills/architect.md',
  '.ai-agent/skills/ddd-discovery.md',
  '.ai-agent/skills/bounded-context-mapper.md',
  '.ai-agent/skills/aggregate-designer.md',
  '.ai-agent/skills/domain-event-designer.md',
  '.ai-agent/skills/ddd-implementation-planner.md',
  '.ai-agent/skills/pattern-interviewer.md',
  '.ai-agent/skills/pattern-selector.md',
  '.ai-agent/skills/module-pattern-selector.md',
  '.ai-agent/skills/pattern-implementation-planner.md',
  '.ai-agent/scenarios/complex.md',
  '.ai-agent/scenarios/ddd.md',
  '.ai-agent/scenarios/patterns.md',
  '.ai-agent/skills/memory-recaller.md',
  '.ai-agent/skills/memory-writer.md',
  '.ai-agent/skills/experience-recorder.md',
  '.ai-agent/skills/project-architecture-analyzer.md',
  '.ai-agent/skills/downloadable-skills-installer.md',
  '.ai-agent/skills/architecture-impact-test-forecast.md',
  '.ai-agent/skills/minimal-convergent-self-test.md',
  '.ai-agent/skills/tapd-submit-backfill.md',
  '.ai-agent/skills/requirement-intake-analysis.md',
  '.ai-agent/rules/task-completion-impact.mdc',
  '.ai-agent/rules/requirement-intake-analysis.mdc',
  '.ai-agent/rules/tapd-submit-backfill.mdc',
  '.ai-agent/skills/knowledge-center-updater.md',
  '.ai-agent/memory/index.md',
  '.ai-agent/memory/experience.md',
  '.ai-agent/memory/project-architecture.md',
  '.ai-agent/memory/learnings.jsonl',
  '.aafe.config.json'
];

export async function doctorProject(root) {
  const missing = [];
  const config = await safeRead(path.join(root, '.aafe.config.json'));
  const projectConfig = parseJson(config);
  const layered = Boolean(projectConfig.workspace?.layeredEditors ?? projectConfig.workspace?.layeredCursor);
  const cursorLayout = resolveEditorPathsFromConfig(root, projectConfig, 'cursor');
  const files = [...requiredFiles];
  if (projectConfig.editors?.includes('cursor')) {
    if (cursorLayout.layered) {
      const { paths, moduleName } = cursorLayout;
      files.push(
        path.join('.cursor', 'rules', moduleName, 'aafe-skill-router.mdc'),
        path.join('.cursor', 'rules', moduleName, 'aafe-architecture-runtime.mdc'),
        path.join('.cursor', 'rules', moduleName, 'aafe-requirement-intake-analysis.mdc'),
        path.join('.cursor', 'rules', moduleName, 'aafe-task-completion-impact.mdc'),
        path.join('.cursor', 'rules', moduleName, 'aafe-tapd-submit-backfill.mdc'),
        path.join('.cursor', 'skills', moduleName, 'aafe-runtime', 'SKILL.md'),
        path.join('.cursor', 'hooks.json'),
        path.join('.cursor', 'hooks', moduleName, 'run-hook.cmd'),
        path.join('.cursor', 'hooks', moduleName, 'aafe-session-start'),
        path.join('.cursor', 'context', moduleName, 'module.json')
      );
      if (projectConfig.taskCompletion?.enabled) {
        files.push(path.join('.cursor', 'hooks', moduleName, 'aafe-task-completion'));
      }
    } else {
      files.push('.cursor/rules/aafe-skill-router.mdc', '.cursor/rules/aafe-architecture-runtime.mdc', '.cursor/rules/aafe-requirement-intake-analysis.mdc', '.cursor/rules/aafe-task-completion-impact.mdc', '.cursor/rules/aafe-tapd-submit-backfill.mdc', '.cursor/skills/aafe-runtime/SKILL.md', '.cursor/hooks.json', '.cursor/hooks/run-hook.cmd', '.cursor/hooks/aafe-session-start');
      if (projectConfig.taskCompletion?.enabled) files.push('.cursor/hooks/aafe-task-completion');
    }
  }
  if (projectConfig.editors?.includes('codebuddy')) {
    if (layered && projectConfig.workspace?.moduleName) {
      const moduleName = projectConfig.workspace.moduleName;
      files.push(
        path.join('.codebuddy', moduleName, 'aafe.md'),
        path.join('.codebuddy', moduleName, 'skills', 'aafe-runtime', 'SKILL.md')
      );
    } else {
      files.push('.codebuddy/skills/aafe-runtime/SKILL.md');
    }
  }
  for (const editorId of ['codex', 'trace', 'vscode']) {
    if (!projectConfig.editors?.includes(editorId)) continue;
    const adapter = getEditorAdapter(editorId);
    if (layered && projectConfig.workspace?.moduleName && adapter?.moduleFiles?.[0]) {
      files.push(path.join(adapter.dirName, projectConfig.workspace.moduleName, adapter.moduleFiles[0]));
    }
  }

  for (const rel of files) {
    const absolute = layered && isWorkspaceRootEditorPath(rel)
      ? path.join(cursorLayout.workspaceRoot, rel)
      : path.join(root, rel);
    if (!(await exists(absolute))) missing.push(rel);
  }

  const warnings = [];
  const gates = await safeRead(path.join(root, '.ai-agent/runtime/gates.yaml'));
  const router = await safeRead(path.join(root, '.ai-agent/runtime/router.yaml'));
  const featurePipeline = await safeRead(path.join(root, '.ai-agent/pipelines/feature.yaml'));
  const domainPipeline = await safeRead(path.join(root, '.ai-agent/pipelines/domain-feature.yaml'));
  const skillIndex = await safeRead(path.join(root, '.ai-agent/skill-index.md'));
  const cursorSkillRouter = await safeRead(cursorLayout.layered
    ? path.join(cursorLayout.paths.rulesDir, 'aafe-skill-router.mdc')
    : path.join(root, '.cursor/rules/aafe-skill-router.mdc'));
  const sessionStartHook = await safeRead(cursorLayout.layered
    ? path.join(cursorLayout.paths.hooksDir, 'aafe-session-start')
    : path.join(root, '.cursor/hooks/aafe-session-start'));
  const hasProjectSkills = await isDirectory(path.join(root, '.ai-agent/project-skills'));
  const cursorSkillCopies = await listCursorSkillCopies(cursorLayout.layered ? cursorLayout.workspaceRoot : root, cursorLayout.layered ? cursorLayout.moduleName : null);


  if (gates && !gates.includes('ddd_gate')) warnings.push('ddd_gate is not configured');
  if (gates && !gates.includes('architecture_gate')) warnings.push('architecture_gate is not configured');
  if (gates && !gates.includes('pattern_gate')) warnings.push('pattern_gate is not configured');
  if (gates && !gates.includes('merge_gate')) warnings.push('merge_gate is not configured');
  if (router && !router.includes('domainFeature')) warnings.push('domainFeature route is not configured');
  if (featurePipeline && !featurePipeline.includes('ddd-discovery')) warnings.push('feature pipeline does not run DDD discovery');
  if (featurePipeline && !featurePipeline.includes('memory-recaller')) warnings.push('feature pipeline does not recall project memory');
  if (config && !config.includes('project-architecture')) warnings.push('project architecture index is not documented in generated memory config');
  if (config && !config.includes('"skills"')) warnings.push('downloadable skills config is not documented in .aafe.config.json');
  if (featurePipeline && !featurePipeline.includes('pattern-interviewer')) warnings.push('feature pipeline does not interview design pattern constraints');
  if (featurePipeline && !featurePipeline.includes('pattern-selector')) warnings.push('feature pipeline does not select design patterns');
  if (featurePipeline && !featurePipeline.includes('module-pattern-selector')) warnings.push('feature pipeline does not select patterns per module');
  if (featurePipeline && !featurePipeline.includes('memory-writer')) warnings.push('feature pipeline does not write project memory');
  if (domainPipeline && !domainPipeline.includes('bounded-context-mapper')) warnings.push('domain pipeline does not map bounded contexts');
  if (domainPipeline && !domainPipeline.includes('aggregate-designer')) warnings.push('domain pipeline does not design aggregates');
  if (config && !config.includes('"memory"')) warnings.push('memory config is not enabled');
  if (projectConfig.editors?.includes('cursor') && !projectConfig.hooks?.enabled) warnings.push('Cursor hooks are not enabled in .aafe.config.json');
  if (hasProjectSkills && !skillIndex) warnings.push('project-skills/ exists but .ai-agent/skill-index.md is missing; project knowledge has no generated router');
  if (skillIndex && !skillIndex.includes('On-demand project skill loading')) warnings.push('.ai-agent/skill-index.md does not look like the index-on-demand router');
  const cursorNativeSkill = await safeRead(cursorLayout.layered
    ? path.join(cursorLayout.paths.skillsDir, 'aafe-runtime', 'SKILL.md')
    : path.join(root, '.cursor/skills/aafe-runtime/SKILL.md'));
  if (projectConfig.editors?.includes('cursor') && !cursorSkillRouter) warnings.push('Cursor skill router rule is missing; Cursor may not automatically enter project skill index');
  if (projectConfig.editors?.includes('cursor') && cursorNativeSkill && !cursorNativeSkill.startsWith('---\nname:')) warnings.push('Cursor native skill entry lacks standard SKILL.md frontmatter');
  if (projectConfig.editors?.includes('cursor') && cursorSkillRouter && !cursorSkillRouter.includes('alwaysApply: true')) warnings.push('Cursor skill router is not alwaysApply; project skill index may not auto-load');
  if (cursorSkillCopies.length) warnings.push('.cursor/skills contains non-ENTRY skill copies (' + cursorSkillCopies.join(', ') + '); keep project knowledge only in .ai-agent');
  if (cursorLayout.layered && (await exists(path.join(root, '.cursor')))) {
    warnings.push('install-dir .cursor still exists; editor adapters should live at workspace root. Run aafe update --migrate-editors.');
  }
  if (cursorLayout.layered && (await exists(path.join(root, '.codebuddy')))) {
    warnings.push('install-dir .codebuddy still exists; migrate/merge it to workspace root layered config.');
  }
  if (cursorLayout.layered && projectConfig.workspace?.hasWorkspaceRootAiAgent !== false) {
    const workspaceRoot = cursorLayout.workspaceRoot;
    if (await isDirectory(path.join(workspaceRoot, '.ai-agent'))) {
      warnings.push('workspace root contains .ai-agent; keep runtime knowledge in install dir to avoid monorepo pollution.');
    }
    if (await isDirectory(path.join(workspaceRoot, '.docs'))) {
      warnings.push('workspace root contains .docs; keep module docs in install dir unless this repo intentionally shares root docs.');
    }
  }
  if (projectConfig.workspace?.layeredEditors && !cursorLayout.layered) {
    warnings.push('workspace.layeredEditors is configured but moduleName is missing; rerun aafe update with --module-name');
  }
  if (sessionStartHook && (sessionStartHook.includes('<AAFE_RUNTIME>') || sessionStartHook.includes('runtime/engine.md') || sessionStartHook.includes('runtime/router.yaml') || sessionStartHook.includes('runtime/gates.yaml'))) warnings.push('sessionStart hook still injects runtime file contents; use short AAFE_SKILL_ROUTER context instead');
  if (projectConfig.projectKnowledge && projectConfig.projectKnowledge.loadMode !== 'index-on-demand') warnings.push('projectKnowledge.loadMode should be index-on-demand');
  if ((projectConfig.editors?.length ?? 0) > 1 && projectConfig.projectKnowledge?.loadMode !== 'index-on-demand') warnings.push('multiple editors are enabled but projectKnowledge.loadMode is not index-on-demand');

  return {
    status: missing.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    missing,
    warnings
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
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

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function listCursorSkillCopies(root, moduleName = null) {
  const skillsDir = moduleName
    ? path.join(root, '.cursor', 'skills', moduleName)
    : path.join(root, '.cursor/skills');
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries
      .map((entry) => entry.name)
      .filter((name) => !['ENTRY.md', 'aafe-runtime', '.DS_Store'].includes(name));
  } catch {
    return [];
  }
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isWorkspaceRootEditorPath(rel) {
  return rel.startsWith('.cursor')
    || rel.startsWith('.codebuddy')
    || rel.startsWith('.codex')
    || rel.startsWith('.trace')
    || rel.startsWith('.vscode');
}
