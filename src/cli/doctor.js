import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveEditorPathsFromConfig } from './editorLayer.js';
import { getEditorAdapter } from './editorRegistry.js';
import { AGENTS_CONFIG_FILE, loadAgentsConfig } from '../agent-platform/config/agentsConfig.js';
import { createRegistryFromConfig } from '../agent-platform/registry/AgentRegistry.js';
import { dddRuntimePaths } from './dddRuntimeFiles.js';
import { patternRuntimePaths } from './patternRuntimeFiles.js';
import { inspectPlaywrightSetup } from './e2eSetup.js';
import { isE2eEnabled } from '../testing/e2e/config.js';

/** Capabilities the default planner sequences depend on. */
const REQUIRED_CAPABILITIES = [
  'project-analysis',
  'requirement-impact',
  'change-impact',
  'knowledge-validation',
  'context-packaging'
];

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
  ...dddRuntimePaths('.ai-agent'),
  ...patternRuntimePaths('.ai-agent'),
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
  '.ai-agent/skills/architecture-on-demand.md',
  '.ai-agent/skills/dataflow-on-demand.md',
  '.ai-agent/skills/downloadable-skills-installer.md',
  '.ai-agent/skills/architecture-impact-test-forecast.md',
  '.ai-agent/skills/minimal-convergent-self-test.md',
  '.ai-agent/skills/tapd-submit-backfill.md',
  '.ai-agent/skills/requirement-intake-analysis.md',
  '.ai-agent/rules/task-completion-impact.mdc',
  '.ai-agent/rules/requirement-intake-analysis.mdc',
  '.ai-agent/rules/tapd-submit-backfill.mdc',
  '.ai-agent/rules/new-file-license.mdc',
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
        path.join('.cursor', 'rules', moduleName, 'aafe-new-file-license.mdc'),
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
      files.push('.cursor/rules/aafe-skill-router.mdc', '.cursor/rules/aafe-architecture-runtime.mdc', '.cursor/rules/aafe-requirement-intake-analysis.mdc', '.cursor/rules/aafe-task-completion-impact.mdc', '.cursor/rules/aafe-tapd-submit-backfill.mdc', '.cursor/rules/aafe-new-file-license.mdc', '.cursor/skills/aafe-runtime/SKILL.md', '.cursor/hooks.json', '.cursor/hooks/run-hook.cmd', '.cursor/hooks/aafe-session-start');
      if (projectConfig.taskCompletion?.enabled) files.push('.cursor/hooks/aafe-task-completion');
    }
  }
  if (projectConfig.editors?.includes('codebuddy')) {
    if (layered && projectConfig.workspace?.moduleName) {
      const moduleName = projectConfig.workspace.moduleName;
      files.push(
        path.join('.codebuddy', moduleName, 'aafe.md'),
        path.join('.codebuddy', moduleName, 'module.json'),
        path.join('.codebuddy', moduleName, 'skills', 'aafe-runtime', 'SKILL.md'),
        path.join('.codebuddy', moduleName, 'hooks', 'aafe-session-start'),
        path.join('.codebuddy', moduleName, 'hooks', 'run-hook.cmd'),
        path.join('.codebuddy', moduleName, 'settings.json'),
        path.join('.codebuddy', 'rules', `aafe-${moduleName}`, 'RULE.mdc'),
        path.join('.codebuddy', 'skills', 'aafe-runtime', 'SKILL.md'),
        path.join('.codebuddy', 'settings.json')
      );
    } else {
      files.push(
        '.codebuddy/aafe.md',
        '.codebuddy/skills/aafe-runtime/SKILL.md',
        '.codebuddy/rules/aafe/RULE.mdc',
        '.codebuddy/hooks/aafe-session-start',
        '.codebuddy/settings.json'
      );
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
  const patternPipeline = await safeRead(path.join(root, '.ai-agent/pipelines/pattern-feature.yaml'));
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
  if (gates && !gates.includes('ddd_enablement_gate')) warnings.push('ddd_enablement_gate is not configured; DDD skills can run without explicit user intent');
  if (gates && !gates.includes('architecture_gate')) warnings.push('architecture_gate is not configured');
  if (gates && !gates.includes('pattern_gate')) warnings.push('pattern_gate is not configured');
  if (gates && !gates.includes('pattern_enablement_gate')) warnings.push('pattern_enablement_gate is not configured; pattern skills can run without explicit user intent');
  if (gates && /pattern_selection/.test(gates.split('architecture_gate')[1]?.split('gate:')[0] ?? '')) {
    warnings.push('architecture_gate still requires pattern_selection; architecture soundness must not depend on naming a design pattern');
  }
  if (gates && !gates.includes('merge_gate')) warnings.push('merge_gate is not configured');
  if (router && !router.includes('domainFeature')) warnings.push('domainFeature route is not configured');
  // The inverse of the old check. DDD in the generic feature pipeline means
  // every ordinary feature gets domain-modelled whether or not it was asked for.
  if (featurePipeline && /\bddd[-_]/.test(featurePipeline)) warnings.push('feature pipeline runs DDD skills unconditionally; DDD must be opt-in via the domain-feature pipeline');
  if (featurePipeline && !featurePipeline.includes('memory-recaller')) warnings.push('feature pipeline does not recall project memory');
  if (config && !config.includes('project-architecture')) warnings.push('project architecture index is not documented in generated memory config');
  if (config && !config.includes('"skills"')) warnings.push('downloadable skills config is not documented in .aafe.config.json');
  // Also inverted. Pattern skills in the generic feature pipeline mean every
  // ordinary feature gets a design-pattern analysis nobody asked for.
  if (featurePipeline && /\bpattern[-_]/.test(featurePipeline)) warnings.push('feature pipeline runs design-pattern skills unconditionally; patterns must be opt-in via the pattern-feature pipeline');
  if (featurePipeline && !featurePipeline.includes('memory-writer')) warnings.push('feature pipeline does not write project memory');
  if (domainPipeline && !domainPipeline.includes('ddd-gate')) warnings.push('domain pipeline does not start with the DDD enablement gate');
  if (domainPipeline && !domainPipeline.includes('ddd-scope')) warnings.push('domain pipeline does not resolve DDD scope; it will run every DDD skill');
  if (domainPipeline && !domainPipeline.includes('ddd-bounded-context')) warnings.push('domain pipeline does not map bounded contexts');
  if (domainPipeline && !domainPipeline.includes('ddd-aggregate')) warnings.push('domain pipeline does not design aggregates');
  if (patternPipeline && !patternPipeline.includes('pattern-gate')) warnings.push('pattern pipeline does not start with the pattern enablement gate');
  if (patternPipeline && !patternPipeline.includes('pattern-discovery')) warnings.push('pattern pipeline selects patterns without identifying problems first');
  if (patternPipeline && !patternPipeline.includes('pattern-composer')) warnings.push('pattern pipeline does not compose patterns; it will produce single-pattern answers');
  if (patternPipeline && !patternPipeline.includes('pattern-anti-pattern-audit')) warnings.push('pattern pipeline does not audit its own composition for anti-patterns');
  if (config && !config.includes('"memory"')) warnings.push('memory config is not enabled');
  if (projectConfig.editors?.includes('cursor') && !projectConfig.hooks?.enabled) warnings.push('Cursor hooks are not enabled in .aafe.config.json');
  if (hasProjectSkills && !skillIndex) warnings.push('project-skills/ exists but .ai-agent/skill-index.md is missing; project knowledge has no generated router');
  const projectKnowledgeEnabled = projectConfig.projectKnowledge?.enabled !== false;
  const projectEntry = projectConfig.projectKnowledge?.entry ?? '.ai-agent/project.md';
  const projectSkillsPath = projectConfig.projectKnowledge?.skillsPath ?? '.ai-agent/project-skills';
  if (projectKnowledgeEnabled && !(await exists(path.join(root, projectEntry)))) {
    warnings.push(`${projectEntry} is missing; run aafe init or aafe update to seed project-owned knowledge entry`);
  }
  if (projectKnowledgeEnabled && !(await isDirectory(path.join(root, projectSkillsPath)))) {
    warnings.push(`${projectSkillsPath}/ is missing; run aafe init or aafe update to seed project-skills`);
  }
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
  if (config && !config.includes('"analyze"')) warnings.push('analyze config block is missing in .aafe.config.json; run aafe update to add output/llm defaults');
  if (isE2eEnabled(projectConfig.e2e)) {
    const playwright = await inspectPlaywrightSetup(root);
    if (playwright.missing) {
      warnings.push('e2e.enabled is true but playwright is not installed; run `aafe e2e install --yes`');
    }
  }
  if (skillIndex && !skillIndex.includes('architecture-on-demand')) warnings.push('.ai-agent/skill-index.md does not mention architecture-on-demand loading');
  const analyzeOutput = projectConfig.analyze?.output ?? projectConfig.analyze?.docsOut ?? '.aafe';
  if (await exists(path.join(root, analyzeOutput)) && !(await exists(path.join(root, analyzeOutput, 'manifest.json')))) {
    warnings.push(`${analyzeOutput} exists but manifest.json is missing; re-run aafe analyze`);
  }

  warnings.push(...await checkAgentPlatform(root, projectConfig));

  return {
    status: missing.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    missing,
    warnings
  };
}

/**
 * The agent platform is only usable when every capability the planner can ask
 * for resolves to an enabled agent with a known provider, so check that rather
 * than just the file's presence.
 */
async function checkAgentPlatform(root, projectConfig) {
  const warnings = [];
  if (!(await exists(path.join(root, AGENTS_CONFIG_FILE)))) {
    warnings.push(`${AGENTS_CONFIG_FILE} is missing; run aafe init or aafe update to seed agent wiring`);
  }

  const { config, warnings: configWarnings } = await loadAgentsConfig(root, projectConfig);
  warnings.push(...configWarnings.map((warning) => `${AGENTS_CONFIG_FILE}: ${warning}`));

  // Resolve without the IDE fallback: it can serve anything, so leaving it on
  // here would mask a capability the project meant to wire up itself.
  const registry = createRegistryFromConfig(config.agents);
  const knownProviders = new Set(['local', 'http', 'cli', 'ide']);
  for (const agent of registry.list()) {
    if (!knownProviders.has(agent.provider)) {
      warnings.push(`agent "${agent.id}" uses unknown provider "${agent.provider}"`);
    }
    if (agent.provider === 'http' && !config.policies.allowNetwork) {
      warnings.push(`agent "${agent.id}" is an http agent but policies.allowNetwork is false`);
    }
  }

  for (const capability of REQUIRED_CAPABILITIES) {
    const { agent, reason } = registry.resolveCapability(capability);
    if (agent) continue;
    warnings.push(config.ideAgent?.enabled
      ? `capability "${capability}" has no configured agent (${reason}); it will be handed to the IDE agent`
      : `capability "${capability}" cannot be resolved (${reason}) and ideAgent.enabled is false`);
  }
  return warnings;
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
