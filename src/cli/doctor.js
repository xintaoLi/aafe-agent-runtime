import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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
  const files = [...requiredFiles];
  if (projectConfig.editors?.includes('cursor')) {
    files.push('.cursor/rules/aafe-skill-router.mdc', '.cursor/skills/aafe-runtime/SKILL.md', '.cursor/hooks.json', '.cursor/hooks/run-hook.cmd', '.cursor/hooks/aafe-session-start');
    if (projectConfig.taskCompletion?.enabled) files.push('.cursor/hooks/aafe-task-completion');
  }
  if (projectConfig.editors?.includes('codebuddy')) {
    files.push('.codebuddy/skills/aafe-runtime/SKILL.md');
  }

  for (const rel of files) {
    if (!(await exists(path.join(root, rel)))) missing.push(rel);
  }

  const warnings = [];
  const gates = await safeRead(path.join(root, '.ai-agent/runtime/gates.yaml'));
  const router = await safeRead(path.join(root, '.ai-agent/runtime/router.yaml'));
  const featurePipeline = await safeRead(path.join(root, '.ai-agent/pipelines/feature.yaml'));
  const domainPipeline = await safeRead(path.join(root, '.ai-agent/pipelines/domain-feature.yaml'));
  const skillIndex = await safeRead(path.join(root, '.ai-agent/skill-index.md'));
  const cursorSkillRouter = await safeRead(path.join(root, '.cursor/rules/aafe-skill-router.mdc'));
  const sessionStartHook = await safeRead(path.join(root, '.cursor/hooks/aafe-session-start'));
  const hasProjectSkills = await isDirectory(path.join(root, '.ai-agent/project-skills'));
  const cursorSkillCopies = await listCursorSkillCopies(root);


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
  const cursorNativeSkill = await safeRead(path.join(root, '.cursor/skills/aafe-runtime/SKILL.md'));
  if (projectConfig.editors?.includes('cursor') && !cursorSkillRouter) warnings.push('Cursor skill router rule is missing; Cursor may not automatically enter project skill index');
  if (projectConfig.editors?.includes('cursor') && cursorNativeSkill && !cursorNativeSkill.startsWith('---\nname:')) warnings.push('Cursor native skill entry lacks standard SKILL.md frontmatter');
  if (projectConfig.editors?.includes('cursor') && cursorSkillRouter && !cursorSkillRouter.includes('alwaysApply: true')) warnings.push('Cursor skill router is not alwaysApply; project skill index may not auto-load');
  if (cursorSkillCopies.length) warnings.push('.cursor/skills contains non-ENTRY skill copies (' + cursorSkillCopies.join(', ') + '); keep project knowledge only in .ai-agent');
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

async function listCursorSkillCopies(root) {
  const skillsDir = path.join(root, '.cursor/skills');
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
