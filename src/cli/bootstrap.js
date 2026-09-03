import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runMigrations } from './migrate.js';
import { taskCompletionHookScript } from './hookScripts.js';
import path from 'node:path';
import { createTemplatePlan, packageRecommendations } from '../templates/TemplateSystem.js';
import { writeLayeredEditorAdapters } from './editorLayer.js';
import { writeFlatCodeBuddyAdapters } from './codebuddyLayer.js';
import { writeFlatHermesAdapters, writeLayeredHermesAdapters } from './hermesLayer.js';
import { writeFlatOpenClawAdapters, writeLayeredOpenClawAdapters } from './openclawLayer.js';
import { getEditorAdapter, getLayeredEditors } from './editorRegistry.js';
import {
  architectureImpactTestForecastSkillContent,
  minimalConvergentSelfTestSkillContent,
  taskCompletionImpactProjectRuleMdc,
  taskCompletionImpactRuleMdc
} from './completionImpactRules.js';
import {
  requirementIntakeAnalysisSkillContent,
  requirementIntakeProjectRuleMdc,
  requirementIntakeRuleMdc
} from './requirementAnalysisRules.js';
import {
  tapdSubmitBackfillSkillContent,
  tapdSubmitProjectRuleMdc,
  tapdSubmitRuleMdc
} from './tapdSubmitRules.js';
import {
  fileLicenseProjectRuleMdc,
  fileLicenseRuleMdc
} from './fileLicenseRules.js';
import { dddPointerRuleMdc, dddRuntimeFiles } from './dddRuntimeFiles.js';
import { patternPointerRuleMdc, patternRuntimeFiles } from './patternRuntimeFiles.js';
import { memoryDiagnosisRuntimeFiles } from './memoryDiagnosisRuntimeFiles.js';
import {
  aafeTestFromPrCursorSkill,
  aafeTestFromPrPointerRuleMdc,
  aafeTestFromPrSkillContent,
  AAFE_TEST_FROM_PR_SKILL_DIR
} from './e2eFromPrRules.js';
import { resolveSubmitConfig } from './submitConfig.js';
import { resolveRepoConfig, stripLegacyE2eRepoTokens } from './repoConfig.js';
import { repoSubmitSkill } from './repoSubmitRules.js';
import { taskSpineHookContext, taskSpineMarkdown, taskSpinePointerLine } from './taskSpine.js';
import { resolveWorkflowModeConfig } from './workflowMode.js';
import { resolveAgentModeConfig } from './agentMode.js';
import {
  workflowModePointerRuleMdc,
  workflowModeProjectRuleMdc,
  workflowModeSkill
} from './workflowModeRules.js';
import { AGENTS_CONFIG_FILE, defaultAgentsConfig } from '../agent-platform/config/agentsConfig.js';

export async function bootstrapProject(root, detection, options = {}) {
  const plan = createTemplatePlan(detection, options);
  await writeRuntime(root, detection, options, plan);
  await writeConfig(root, detection, options, plan);
  // Last on purpose. Migrations retire superseded files and drop legacy config
  // keys, so they have to see the finished layout: the replacement tree must
  // already exist before its predecessor is removed, and `writeConfig` merges
  // the old config forward, so anything dropped earlier would just come back.
  const migration = await runMigrations(root);
  await writeEditorAdapters(root, detection, options, plan);
  await writePackageManifest(root, options, plan);
  return { migration };
}

async function writeRuntime(root, detection, options, plan) {
  const files = runtimeFiles(detection, plan);
  for (const [rel, content] of Object.entries(files)) {
    await writeIfAllowed(path.join(root, rel), content, options);
  }
  // Flat installs: seed project-owned rules here. Layered installs seed in cursorLayer with workspace-relative paths.
  if (!options.workspaceLayout?.layeredEditors) {
    await writeIfAllowed(
      path.join(root, '.ai-agent/rules/task-completion-impact.mdc'),
      taskCompletionImpactProjectRuleMdc(),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(root, '.ai-agent/rules/requirement-intake-analysis.mdc'),
      requirementIntakeProjectRuleMdc(),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(root, '.ai-agent/rules/tapd-submit-backfill.mdc'),
      tapdSubmitProjectRuleMdc(),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(root, '.ai-agent/rules/new-file-license.mdc'),
      fileLicenseProjectRuleMdc(),
      { ...options, force: false }
    );
    await writeIfAllowed(
      path.join(root, '.ai-agent/rules/workflow-mode.mdc'),
      workflowModeProjectRuleMdc(),
      { ...options, force: false }
    );
  }

  // Project-owned knowledge: seed once; never overwrite on update/sync (force: false).
  await writeProjectKnowledgeScaffold(root, detection, options);
}

async function writeConfig(root, _detection, options, plan) {
  const existingConfig = parseConfigJson(await safeRead(path.join(root, '.aafe.config.json')));
  const config = {
    runtime: '.ai-agent',
    template: options.template ?? 'complex',
    memory: {
      enabled: plan.memory,
      path: '.aafe-memory',
      remote: {
        enabled: false,
        url: null,
        projectId: null,
        tokenEnv: 'AAFE_MEMORY_TOKEN',
        timeoutMs: 15000
      },
      categories: ['design', 'component', 'habit', 'convention', 'decision', 'experience', 'project-architecture', 'learning'],
      dedupe: true,
      summary: true,
      experience: {
        enabled: true,
        triggerAfterAttempts: 3,
        writeOnlyAfterSuccess: true,
        record: ['problem_signature', 'success_path', 'decision_path', 'reuse_boundary', 'avoid']
      }
    },
    framework: plan.framework,
    frameworks: plan.frameworks,
    scenarios: plan.scenarios,
    editors: plan.editors,
    packs: plan.packs,
    recommendedPackages: packageRecommendations(plan),
    rerun: {
      enabled: true,
      maxReruns: 1,
      triggers: ['refactor-critic:fail', 'merge_gate:fail']
    },
    hooks: {
      enabled: true,
      sessionStart: '.cursor/hooks/aafe-session-start',
      taskCompletion: '.cursor/hooks/aafe-task-completion',
      failClosed: false
    },
    taskCompletion: {
      enabled: true,
      command: 'aafe task-completion',
      steps: ['aafe knowledge update', 'aafe knowledge-web', 'aafe update', 'aafe doctor'],
      failClosed: false,
      log: '.aafe-memory/knowledge-sync.jsonl'
    },
    projectKnowledge: {
      enabled: true,
      entry: '.ai-agent/project.md',
      skillsPath: '.ai-agent/project-skills',
      index: '.ai-agent/skill-index.md',
      loadMode: 'index-on-demand',
      editorPointersOnly: true
    },
    skills: {
      downloadable: true,
      purpose: 'github-agent-skills-distribution',
      manifestUrl: 'https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/manifest.json',
      defaultTarget: '$SIBOOT_WORKSPACE_PATH/skills',
      installCommand: 'aafe skills install <skill-name> --github',
      boundary: 'Use only for Agent SKILLS download. Use init/update/analyze/doctor for project .ai-agent runtime.'
    },
    analyze: {
      output: '.aafe',
      formats: ['json', 'jsonl', 'md', 'mmd'],
      maxDepth: 40,
      architecture: { enabled: true },
      dataflow: { enabled: true },
      features: { enabled: true },
      business: { enabled: true },
      llm: {
        enabled: false,
        provider: null,
        model: null,
        agents: {
          architecture: false,
          dataflow: false,
          feature: false,
          business: false,
          testing: false
        }
      }
    },
    gates: ['ddd_enablement_gate', 'ddd_gate', 'architecture_gate', 'pattern_enablement_gate', 'pattern_gate', 'implementation_gate', 'merge_gate'],
    e2e: {
      casesDir: 'tests/ui-ai/cases',
      reportDir: '.aafe/e2e/reports',
      specsDir: '.aafe/e2e/specs',
      impactDir: '.aafe/e2e/impact',
      baseUrlEnv: 'AAFE_E2E_BASE_URL',
      baseUrl: null,
      enabled: true,
      auth: {
        mode: 'reuse-or-headed',
        stateDir: '.aafe/e2e/auth',
        env: 'default',
        checkUrl: null,
        readySelector: null,
        usernameEnv: 'AAFE_E2E_USERNAME',
        passwordEnv: 'AAFE_E2E_PASSWORD'
      }
    }
  };

  if (existingConfig.e2e) {
    config.e2e = { ...config.e2e, ...existingConfig.e2e };
  }
  if (options.e2eConfig) {
    config.e2e = { ...config.e2e, ...options.e2eConfig };
  }
  if (config.e2e) config.e2e = stripLegacyE2eRepoTokens(config.e2e);

  config.repo = resolveRepoConfig(existingConfig, options.repoConfig ?? {});

  if (existingConfig.analyze) {
    config.analyze = {
      ...config.analyze,
      ...existingConfig.analyze,
      architecture: { ...config.analyze.architecture, ...(existingConfig.analyze.architecture ?? {}) },
      dataflow: { ...config.analyze.dataflow, ...(existingConfig.analyze.dataflow ?? {}) },
      features: { ...config.analyze.features, ...(existingConfig.analyze.features ?? {}) },
      business: { ...config.analyze.business, ...(existingConfig.analyze.business ?? {}) },
      llm: {
        ...config.analyze.llm,
        ...(existingConfig.analyze.llm ?? {}),
        agents: {
          ...config.analyze.llm.agents,
          ...(existingConfig.analyze.llm?.agents ?? {})
        }
      }
    };
  }

  if (options.tapdConfig) {
    config.tapd = options.tapdConfig;
  } else if (existingConfig.tapd) {
    config.tapd = existingConfig.tapd;
  }

  config.submit = resolveSubmitConfig(existingConfig, {
    cli: options.submitConfig?.cli ?? options.submitCli
  });

  config.mode = resolveWorkflowModeConfig(existingConfig, {
    workflow: options.workflowModeConfig?.workflow ?? options.workflowMode
  });

  config.agent = resolveAgentModeConfig(existingConfig, {
    ...(options.agentModeConfig ?? {}),
    enabled: options.agentModeConfig?.enabled ?? options.agentMode,
    mode: options.agentModeConfig?.mode ?? options.cursorRuntime,
    model: options.agentModeConfig?.model ?? options.cursorModel,
    apiKeyEnv: options.agentModeConfig?.apiKeyEnv ?? options.cursorApiKeyEnv,
    repository: options.agentModeConfig?.repository ?? options.cursorRepository,
    mcp: options.agentModeConfig?.mcp,
    mcpEnabled: options.mcpEnabled,
    mcpConfig: options.mcpConfig,
    mcpSettingSources: options.mcpSettingSources,
    manager: options.agentModeConfig?.manager,
    managerEnabled: options.agentManager,
    maxConcurrentTasks: options.maxConcurrentTasks,
    taskOutput: options.taskOutput,
    validateProjectRuntime: options.validateProjectRuntime,
    recoverOnStart: options.recoverOnStart
  });

  if (existingConfig.taskCompletion && !config.taskCompletion) {
    config.taskCompletion = existingConfig.taskCompletion;
  }

  if (options.workspaceLayout?.layeredEditors) {
    const layout = options.workspaceLayout;
    const layeredEditorIds = getLayeredEditors(plan.editors);
    config.workspace = {
      layeredEditors: true,
      layeredCursor: true,
      installRoot: '.',
      workspaceRoot: layout.workspaceRootRelative,
      moduleName: layout.moduleName,
      moduleRelativePath: layout.moduleRelativePath,
      retainInInstallDir: ['.ai-agent', '.docs', '.aafe.config.json'],
      editorOnlyAtWorkspaceRoot: true,
      agentPrefix: `${layout.moduleRelativePath}/.ai-agent`,
      docsPrefix: `${layout.moduleRelativePath}/.docs`,
      editorLayers: Object.fromEntries(layeredEditorIds.map((id) => {
        const adapter = getEditorAdapter(id);
        return [id, adapter.layerPattern.replace('{module}', layout.moduleName)];
      }))
    };
    if (layeredEditorIds.includes('cursor')) {
      config.hooks = {
        ...config.hooks,
        sessionStart: `.cursor/hooks/${layout.moduleName}/aafe-session-start`,
        taskCompletion: `.cursor/hooks/${layout.moduleName}/aafe-task-completion`
      };
    }
  }

  await writeIfAllowed(path.join(root, '.aafe.config.json'), `${JSON.stringify(config, null, 2)}\n`, options);
  await writeAgentsConfig(root, options);
}

/**
 * Agent wiring lives in its own file so it can grow to dozens of agents
 * without bloating `.aafe.config.json`. Written only when missing, since
 * enabling or repointing an agent is a project decision.
 */
async function writeAgentsConfig(root, options) {
  const file = path.join(root, AGENTS_CONFIG_FILE);
  if (await exists(file)) return;
  await writeIfAllowed(file, `${JSON.stringify(defaultAgentsConfig(), null, 2)}\n`, { ...options, force: false });
}

async function writeEditorAdapters(root, detection, options, plan) {
  const editors = new Set(plan.editors);
  if (options.workspaceLayout?.layeredEditors) {
    await writeLayeredEditorAdapters({
      workspaceRoot: options.workspaceLayout.workspaceRoot,
      moduleName: options.workspaceLayout.moduleName,
      moduleRelativePath: options.workspaceLayout.moduleRelativePath,
      options: {
        ...options,
        installRoot: root,
        migrateInstallEditors: options.workspaceLayout.migrateInstallEditors
      },
      plan
    });
    return;
  }

  if (editors.has('cursor')) {
    await writeFlatCursorAdapters(root, options);
  }
  if (editors.has('claude')) {
    await writeIfAllowed(path.join(root, 'CLAUDE.md'), claudeRules(), { ...options, append: true });
  }
  if (editors.has('codebuddy')) {
    await writeFlatCodeBuddyAdapters(root, options);
  }
  if (editors.has('codex')) {
    await writeIfAllowed(path.join(root, '.codex/aafe.md'), genericEditorRules('CodeX'), options);
  }
  if (editors.has('trace')) {
    await writeIfAllowed(path.join(root, '.trace/aafe.md'), genericEditorRules('Trace'), options);
  }
  if (editors.has('windsurf')) {
    await writeIfAllowed(path.join(root, '.windsurfrules'), genericEditorRules('Windsurf'), options);
  }
  if (editors.has('vscode')) {
    await writeIfAllowed(path.join(root, '.vscode/aafe.instructions.md'), genericEditorRules('VS Code'), options);
  }
  if (editors.has('hermes')) {
    await writeFlatHermesAdapters(root, options);
  }
  if (editors.has('openclaw')) {
    await writeFlatOpenClawAdapters(root, options);
  }
}

async function writeFlatCursorAdapters(root, options) {
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-skill-router.mdc'), cursorSkillRouterRules(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-architecture-runtime.mdc'), cursorRules(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-task-completion-impact.mdc'), taskCompletionImpactRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-requirement-intake-analysis.mdc'), requirementIntakeRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-tapd-submit-backfill.mdc'), tapdSubmitRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-workflow-mode.mdc'), workflowModePointerRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-new-file-license.mdc'), fileLicenseRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-ddd-gate.mdc'), dddPointerRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-pattern-gate.mdc'), patternPointerRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/rules/aafe-test-from-pr.mdc'), aafeTestFromPrPointerRuleMdc(), options);
  await writeIfAllowed(path.join(root, '.cursor/skills/aafe-runtime/SKILL.md'), nativeEditorSkill('Cursor'), options);
  await writeIfAllowed(
    path.join(root, `.cursor/skills/${AAFE_TEST_FROM_PR_SKILL_DIR}/SKILL.md`),
    aafeTestFromPrCursorSkill(),
    options
  );
  await writeIfAllowed(path.join(root, '.cursor/skills/ENTRY.md'), editorSkillEntry('Cursor'), options);
  await writeIfAllowed(path.join(root, '.cursor/hooks.json'), cursorHooks(), options);
  await writeIfAllowed(path.join(root, '.cursor/hooks/run-hook.cmd'), cursorHookRunner(), options);
  await writeIfAllowed(path.join(root, '.cursor/hooks/aafe-session-start'), cursorSessionStartHook(), options);
  await writeIfAllowed(path.join(root, '.cursor/hooks/aafe-task-completion'), cursorTaskCompletionHook(), options);
  await makeExecutable(path.join(root, '.cursor/hooks/aafe-session-start'));
  await makeExecutable(path.join(root, '.cursor/hooks/aafe-task-completion'));
  await makeExecutable(path.join(root, '.cursor/hooks/run-hook.cmd'));
}

async function writePackageManifest(root, options, plan) {
  const content = `# AAFE Publishable Packs\n\nRecommended packages for this project:\n\n${packageRecommendations(plan).map((name) => `- ${name}`).join('\n')}\n\nThis file is generated from .aafe.config.json and documents the independent framework/scenario/editor packs that can be published later.\n`;
  await writeIfAllowed(path.join(root, '.ai-agent/packs.md'), content, options);
}

function runtimeFiles(_detection, plan) {
  const files = {
    '.ai-agent/skill-index.md': skillIndex(),
    '.ai-agent/runtime/engine.md': engine(),
    '.ai-agent/runtime/router.yaml': router(),
    '.ai-agent/runtime/gates.yaml': gates(),
    '.ai-agent/runtime/protocol.md': protocol(),
    '.ai-agent/runtime/memory.md': memoryRuntime(),
    '.ai-agent/skills/memory-recaller.md': memoryRecallerSkill(),
    '.ai-agent/skills/memory-writer.md': memoryWriterSkill(),
    '.ai-agent/skills/experience-recorder.md': experienceRecorderSkill(),
    '.ai-agent/skills/project-architecture-analyzer.md': projectArchitectureAnalyzerSkill(),
    '.ai-agent/skills/architecture-on-demand.md': architectureOnDemandSkillTemplate(),
    '.ai-agent/skills/dataflow-on-demand.md': dataflowOnDemandSkillTemplate(),
    '.ai-agent/skills/downloadable-skills-installer.md': downloadableSkillsInstallerSkill(),
    '.aafe-memory/index.md': memoryIndex(),
    '.aafe-memory/project-design.md': memoryProjectDesign(),
    '.aafe-memory/components.md': memoryComponents(),
    '.aafe-memory/development-habits.md': memoryDevelopmentHabits(),
    '.aafe-memory/conventions.md': memoryConventions(),
    '.aafe-memory/decisions.md': memoryDecisions(),
    '.aafe-memory/experience.md': memoryExperience(),
    '.aafe-memory/project-architecture.md': memoryProjectArchitecture(),
    '.aafe-memory/learnings.jsonl': '',
    ...dddRuntimeFiles('.ai-agent'),
    ...patternRuntimeFiles('.ai-agent'),
    ...memoryDiagnosisRuntimeFiles('.ai-agent'),
    '.ai-agent/scenarios/ddd.md': dddPack(),
    '.ai-agent/skills/architect.md': architectSkill(),
    '.ai-agent/skills/module-decomposer.md': decomposerSkill(),
    '.ai-agent/skills/pattern-gate.md': patternGateSkill(),
    '.ai-agent/skills/pattern-discovery.md': patternDiscoverySkill(),
    '.ai-agent/skills/pattern-interviewer.md': patternInterviewerSkill(),
    '.ai-agent/skills/pattern-selector.md': selectorSkill(),
    '.ai-agent/skills/pattern-composer.md': patternComposerSkill(),
    '.ai-agent/skills/module-pattern-selector.md': modulePatternSelectorSkill(),
    '.ai-agent/skills/pattern-anti-pattern-audit.md': patternAntiPatternAuditSkill(),
    '.ai-agent/skills/pattern-validator.md': patternValidatorSkill(),
    '.ai-agent/skills/ddd-pattern-bridge.md': dddPatternBridgeSkill(),
    '.ai-agent/skills/pattern-implementation-planner.md': patternImplementationPlannerSkill(),
    '.ai-agent/scenarios/patterns.md': patternsPack(),
    '.ai-agent/scenarios/complex.md': complexPack(),
    '.ai-agent/skills/evolution-predictor.md': predictorSkill(),
    '.ai-agent/skills/refactor-critic.md': criticSkill(),
    '.ai-agent/skills/architecture-impact-test-forecast.md': architectureImpactTestForecastSkill(),
    '.ai-agent/skills/requirement-intake-analysis.md': requirementIntakeAnalysisSkill(),
    '.ai-agent/skills/minimal-convergent-self-test.md': minimalConvergentSelfTestSkill(),
    '.ai-agent/skills/aafe-test-from-pr.md': aafeTestFromPrSkillContent('.ai-agent'),
    '.ai-agent/skills/tapd-submit-backfill.md': tapdSubmitBackfillSkill(),
    '.ai-agent/skills/repo-submit.md': repoSubmitSkill(),
    '.ai-agent/skills/workflow-mode.md': workflowModeSkill(),
    '.ai-agent/skills/knowledge-center-updater.md': knowledgeCenterUpdaterSkill(),
    '.ai-agent/skills/adr-generator.md': adrSkill(),
    '.ai-agent/pipelines/feature.yaml': featurePipeline(),
    '.ai-agent/pipelines/domain-feature.yaml': domainFeaturePipeline(),
    '.ai-agent/pipelines/pattern-feature.yaml': patternFeaturePipeline(),
    '.ai-agent/pipelines/memory-diagnosis.yaml': memoryDiagnosisPipeline(),
    '.ai-agent/pipelines/refactor.yaml': refactorPipeline(),
    '.ai-agent/pipelines/bugfix.yaml': bugfixPipeline(),
    '.ai-agent/pipelines/performance.yaml': performancePipeline(),
    '.ai-agent/frameworks/react.md': reactPack(),
    '.ai-agent/frameworks/next.md': nextPack(),
    '.ai-agent/frameworks/vue.md': vuePack(),
    '.ai-agent/frameworks/monorepo.md': monorepoPack(),
    '.ai-agent/scenarios/admin.md': adminPack(),
    '.ai-agent/scenarios/dashboard.md': dashboardPack(),
    '.ai-agent/scenarios/workflow.md': workflowPack(),
    '.ai-agent/scenarios/graph.md': graphPack()
  };

  if (!plan.scenarios.includes('graph')) {
    files['.ai-agent/pipelines/graph-feature.yaml'] = graphFeaturePipeline();
  }
  return files;
}

async function writeProjectKnowledgeScaffold(root, detection, options) {
  const preserve = { ...options, force: false };
  const projectName = detection?.packageName ?? path.basename(root);

  await writeIfAllowed(
    path.join(root, '.ai-agent/project.md'),
    projectKnowledgeEntry(projectName, detection),
    preserve
  );

  const domains = [
    ['architecture', projectSkillArchitecture()],
    ['components', projectSkillComponents()],
    ['api-services', projectSkillApiServices()],
    ['coding-patterns', projectSkillCodingPatterns()],
    ['self-update', projectSkillSelfUpdate()]
  ];

  for (const [domain, content] of domains) {
    await writeIfAllowed(
      path.join(root, `.ai-agent/project-skills/${domain}/SKILL.md`),
      content,
      preserve
    );
  }
}

function projectKnowledgeEntry(projectName, detection = {}) {
  const framework = detection.framework ?? 'generic';
  return `# Project Knowledge · ${projectName}

This file is **project-owned**. \`aafe init\` / \`aafe update\` create it only when missing and will not overwrite edits.

## Quick Map

- Framework: \`${framework}\`
- Runtime: \`.ai-agent/\`
- Analyze output: see \`.aafe.config.json\` → \`analyze.output\` (default \`.aafe/\`)
- Human architecture docs: \`.docs/\` (Knowledge Center source)

## How to Use Project Skills

1. Read \`.ai-agent/skill-index.md\` first.
2. Read this file for project-specific routing.
3. Load only the matching \`.ai-agent/project-skills/<domain>/SKILL.md\`:
   - architecture → routes / modules / boundaries
   - components → UI / Vue / React components
   - api-services → request / API / adapters
   - coding-patterns → conventions / lint / tests
   - self-update → how to grow project skills after changes
4. For deep static facts after \`aafe analyze\`, use on-demand architecture/dataflow skills against the configured analyze output.

## Domain Routing Hints

| Task keywords | Domain skill |
| --- | --- |
| route, page, module, boundary, map | architecture |
| component, UI, props, emit | components |
| api, request, service, axios, fetch | api-services |
| lint, convention, test pattern | coding-patterns |
| update skill docs, refresh knowledge | self-update |

## Ownership

- Generated / refreshed by package: \`skill-index.md\`, \`runtime/**\`, \`pipelines/**\`, editor adapters
- Project-owned (preserved): \`project.md\`, \`project-skills/**\`, \`rules/**\`, \`memory/**\`
`;
}

function projectSkillArchitecture() {
  return `---
name: architecture
description: Project architecture map — routes, modules, boundaries. Use WHEN locating pages, modules, or design docs.
---

# Project Skill · Architecture

## When to use

- Locate routes, pages, modules, or architecture boundaries
- Before broad source search for feature ownership

## Protocol

1. Read \`.ai-agent/project.md\` Quick Map.
2. Read \`.ai-agent/skills/project-architecture-locator.md\` if present.
3. For deep facts: \`.ai-agent/skills/architecture-on-demand.md\` against analyze output (default \`.aafe/\`).
4. Do not invent DDD layers; prefer static facts + evidence.

## Maintain

Update this skill after major routing or module boundary changes. Run \`aafe analyze\` to refresh machine facts.
`;
}

function projectSkillComponents() {
  return `---
name: components
description: Project UI components / Vue / React conventions. Use WHEN editing components, props, emits, or global registration.
---

# Project Skill · Components

## When to use

- Component props/emits contracts
- Shared UI registration patterns

## Protocol

1. Prefer locator / analyze module \`components.json\` when available.
2. Record durable conventions here (naming, folder layout, global components).

## Maintain

Extend this file with project-specific component rules as they stabilize.
`;
}

function projectSkillApiServices() {
  return `---
name: api-services
description: Project API / request / data-access adapters. Use WHEN changing services, clients, or request layers.
---

# Project Skill · API Services

## When to use

- API client / request wrapper changes
- Service adapter boundaries

## Protocol

1. Document base client, error handling, and auth injection patterns here.
2. Pair with dataflow on-demand skill for call-graph evidence after analyze.

## Maintain

Keep only durable API conventions; leave ephemeral endpoints out.
`;
}

function projectSkillCodingPatterns() {
  return `---
name: coding-patterns
description: Project coding conventions, lint, and test patterns. Use WHEN aligning style, tests, or shared patterns.
---

# Project Skill · Coding Patterns

## When to use

- Coding conventions / lint expectations
- Preferred test layout

## Protocol

1. Prefer repo lint/test configs as source of truth.
2. Capture team habits that are not obvious from configs.

## Maintain

Update after agreed convention changes.
`;
}

function projectSkillSelfUpdate() {
  return `---
name: self-update
description: How to grow project.md and project-skills after architecture or domain changes. Use WHEN refreshing project knowledge.
---

# Project Skill · Self Update

## When to use

- After major route/module/API changes
- When project knowledge docs are stale

## Protocol

1. Run \`aafe analyze\` to refresh machine facts under analyze output.
2. Update \`.ai-agent/project.md\` Quick Map if entry/domains changed.
3. Update only the affected \`.ai-agent/project-skills/<domain>/SKILL.md\`.
4. Do not copy knowledge into editor directories (\`.cursor\`, etc.).

## Maintain

\`aafe update\` refreshes runtime adapters; it must not wipe this skill.
`;
}

async function writeIfAllowed(filePath, content, options) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const previous = await safeRead(filePath);
  const fileExists = await exists(filePath);

  if (options.preserveMemory && isMemoryFile(filePath) && fileExists) return;

  if (options.append) {
    if (previous.includes('AAFE Architecture Runtime')) return;
    const next = (previous.trimEnd() + '\n\n' + content).trimStart();
    if (fileExists && previous === next) return;
    await writeFile(filePath, next);
    return;
  }

  if (!options.force && fileExists) return;
  if (fileExists && previous === content) return;
  await writeFile(filePath, content);
}
function isMemoryFile(filePath) {
  return filePath.split(path.sep).includes('memory');
}

async function exists(filePath) {
  try {
    await readFile(filePath, 'utf8');
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

async function makeExecutable(filePath) {
  try {
    await chmod(filePath, 0o755);
  } catch {
    // Hook files are best-effort on platforms that support executable bits.
  }
}

function skillIndex() {
  return `# AAFE Skill Index On-Demand Router

This file is generated by @aafe/agent-runtime and is safe to refresh with \`aafe update\`.
It is the thin routing protocol for project knowledge. Project-specific knowledge remains in
\`.ai-agent/project.md\` and \`.ai-agent/project-skills/**\`.

## Default loading order for every task

1. Read this file first: \`.ai-agent/skill-index.md\`.
2. If present, read \`.ai-agent/project.md\` for the project quick map and domain routing hints.
2b. Read \`.aafe.config.json\` → \`mode.workflow\` (default \`ask\`). Load \`.ai-agent/skills/workflow-mode.md\`
   before the first interactive gate (需求澄清 / Plan / 影响分析 / Commit / PR / TAPD 回填).
3. If the task is about architecture, self-update, project rules, or knowledge maintenance, load the matching
   project skill from \`.ai-agent/project-skills/<domain>/SKILL.md\` when it exists.
4. For non-trivial frontend feature/refactor/bugfix/performance work, then enter the AAFE runtime:
   - \`.ai-agent/runtime/engine.md\`
   - \`.ai-agent/runtime/router.yaml\`
   - selected \`.ai-agent/pipelines/*.yaml\`
   - \`.ai-agent/runtime/gates.yaml\`

${taskSpineMarkdown('.ai-agent')}

## On-demand project skill loading

Load only the domain skill that matches the current task. Common domain hints:

- components / UI / Vue / React / TSX / global components / registration -> components skill
- hooks / composables / stateful behavior / side effects -> hooks or composables skill
- services / API / request / data access / client adapter -> api-services skill
- routes / pages / module boundaries / architecture map -> architecture skill or \`.ai-agent/skills/architecture-on-demand.md\`
- entry / build tool / AST module map -> \`.ai-agent/skills/project-architecture-locator.md\` then architecture-on-demand
- dataflow / store / API flow / impact edges -> \`.ai-agent/skills/dataflow-on-demand.md\`
- conventions / coding patterns / lint / tests -> coding-patterns or conventions skill
- knowledge update / project skill maintenance / self-growing docs -> self-update skill

## DDD is opt-in

Load \`.ai-agent/ddd/**\` **only** when the user explicitly asks for Domain-Driven Design.
Entity, Aggregate, Repository, Service, Domain or Clean Architecture appearing in the codebase
is never enough. Start at \`.ai-agent/ddd/rules/ddd-gate.md\`, or run \`aafe ddd gate "<request>"\`;
if the gate says disabled, do not read any other file under \`.ai-agent/ddd/\`.

## Frontend design patterns are opt-in

Load \`.ai-agent/frontend-engineering/**\` **only** when the user explicitly asks for design-pattern
work. factory, adapter, observer, strategy, singleton, store or reducer appearing in the codebase
is never enough. Start at \`.ai-agent/frontend-engineering/rules/pattern-gate.md\`, or run
\`aafe pattern gate "<request>"\`; if the gate says disabled, do not read any other file under
\`.ai-agent/frontend-engineering/\`.

When enabled, identify problems first (\`aafe pattern discover\`), then compose — a project gets a
minimum sufficient *composition* of patterns, never one pattern applied globally, and "no pattern
needed" is a valid answer.

Deep analyze docs live under the configured output (default \`.aafe/\`, set \`analyze.output\` or \`--output=\`). Read \`manifest.json\` first; load only matched JSON slices. Never eagerly read entire graph JSONL.

The exact project domains are owned by the project and should be discovered from \`.ai-agent/project.md\`
and \`.ai-agent/project-skills/*/SKILL.md\` descriptions.

## Commands you may run yourself

Run these directly when the situation below applies. Do not wait to be asked, and do not
ask the user to run them for you. Resolve the binary as \`node_modules/.bin/aafe\` when it is
not on \`PATH\`; if neither resolves, fall back to reading files and say so.

| Situation | Command |
| --- | --- |
| Locating a module, route, component, feature or symbol | \`aafe knowledge search "<terms>" [--kind=...]\` |
| \`knowledge search\` returns nothing and \`.aafe/\` is missing or stale | \`aafe analyze\` |
| Assembling evidence for a requirement before editing | \`aafe context --requirement="<text>"\` |
| Reporting blast radius after a change | \`aafe impact --diff\` or \`aafe impact --requirement="<text>"\` |
| Deciding whether DDD applies | \`aafe ddd gate "<request>"\`, then \`aafe ddd scope\` |
| Deciding whether design patterns apply | \`aafe pattern gate "<request>"\`, then \`aafe pattern discover\` |
| Planning tests for a change | \`aafe test --diff\` or \`aafe test --requirement="<text>"\` |
| Full functional coverage from analyze | \`aafe test --coverage\` |
| Generate cases from a PR vs its target branch | \`aafe test --pr=<url>\` |
| 分析此PR / 按 PR 补测试 / 贴 PR 链接生成用例 | \`aafe test --pr=<url>\` |
| 生成用例并执行 E2E、出报告 | 先 \`aafe test --pr=<url>\`；缺测试地址则询问用户并等待，再 \`--run --base-url=<url>\`（含 \`#\` 须加引号；有路径/参数时确认 A/B/C 并加 \`--url-role\`） |
| Enable Playwright E2E after init | \`aafe e2e enable\` |
| 采集 SSO 登录态供 E2E 复用 | \`aafe e2e auth --base-url=<url>\`；\`--run\` 先探测地址，200 且非登录跳转则跳过 SSO，否则校验/续期登录 |
| A test run failed and the cause is unclear | \`aafe diagnose --failure=<report>\` |
| Runtime files look stale or inconsistent | \`aafe doctor\`, then \`aafe migrate --dry-run\` |
| Switching ask vs autonomous workflow | \`aafe update --workflow-mode=ask|autonomous\` |
| 创建 GitHub PR（用 repo.githubAccessToken，不依赖 gh） | \`aafe repo pr --title= --body= --base= --head=\` |

Prefer \`aafe knowledge search\` over a blind repository grep: it ranks across modules, routes,
components, features and symbols, and normalizes \`userPhoneSearch\`, \`user-phone-search.js\` and
the equivalent Chinese phrase onto the same tokens.

These commands mostly read and report. Writers: \`aafe analyze\` (refreshes analyze output), \`aafe migrate\` (moves legacy files), and \`aafe test --write/--run\` (YAML cases + \`.aafe/e2e/reports\`). Everything else leaves the project untouched, so running one to check an assumption is cheap.

## Forbidden

- Do not copy project knowledge into .cursor, .codebuddy, .vscode, .codex, .trace, .windsurf, or other editor directories.
- Do not eagerly read every \`.ai-agent/project-skills/*/SKILL.md\` file.
- Do not eagerly read every analyze output module/graph file.
- Do not treat editor \`skills/ENTRY.md\` files as full knowledge; they are pointers to this index.
- Do not inject full runtime files into session hooks; read runtime files on demand.
- Do not install or run \`uitest\` / \`@aafe/ai-test\` / \`npx uitest\`. PR and E2E belong to \`aafe test\`. Do not write \`ai-ui-test\` / \`uitest-from-pr\` back into \`.cursor/\`.

## Ownership and update policy

Generated and refreshable by \`aafe update\`:
- this file
- \`.ai-agent/runtime/**\`
- \`.ai-agent/pipelines/**\`
- editor adapter pointers and rules

Project-owned and preserved by \`aafe update\`:
- \`.ai-agent/project.md\`
- \`.ai-agent/project-skills/**\`
- \`.ai-agent/rules/**\`
- \`.aafe-memory/**\`
`;
}

function engine() {
  return `# AAFE Architecture Runtime Engine

ROLE: Skill Orchestrator for frontend engineering agents.

Responsibilities:
1. Classify every request before implementation.
2. Select the matching architecture pipeline.
3. Execute skills in order and preserve structured state.
4. Enforce gates before code generation or merge.
5. Compose implementation plans from architecture outputs.
6. Run critique after implementation and request rerun on failure.

Never:
- Skip architecture analysis for feature, refactor or performance work.
- Implement before architecture_gate passes.
- Hide tradeoffs or future extension risks.
- Mix domain, infrastructure and presentation responsibilities.
`;
}

function router() {
  return `routes:
  feature:
    pipeline: feature
  domainFeature:
    pipeline: domain-feature
  refactor:
    pipeline: refactor
  bugfix:
    pipeline: bugfix
  performance:
    pipeline: performance
  graphFeature:
    pipeline: graph-feature
  patternFeature:
    pipeline: pattern-feature
  memoryDiagnosis:
    pipeline: memory-diagnosis
`;
}

function gates() {
  return `gates:
  # Enablement is a separate question from completeness: may we do DDD at all,
  # versus is the model finished.
  ddd_enablement_gate:
    requires:
      - ddd_decision
      - ddd_scope
  memory_oom_gate:
    requires:
      - memory_decision
      - memory_scope
  ddd_gate:
    requires:
      - ubiquitous_language
      - bounded_contexts
      - aggregates
  # Architecture soundness does not depend on having named a design pattern,
  # so pattern_selection is deliberately not required here.
  architecture_gate:
    requires:
      - boundaries
      - decomposition
  # Same split as DDD: may we do pattern work at all, versus is the composition
  # complete and audited.
  pattern_enablement_gate:
    requires:
      - pattern_decision
  pattern_gate:
    requires:
      - pattern_problems
      - pattern_composition
      - pattern_anti_patterns
  implementation_gate:
    requires:
      - risk_review
      - extension_points
  merge_gate:
    requires:
      - critic_pass
`;
}

function protocol() {
  return `# Skill State Protocol

Every skill must output:

\`\`\`json
{
  "status": "pass | warn | fail",
  "summary": "short decision summary",
  "artifacts": {},
  "risks": [],
  "nextHints": []
}
\`\`\`

Artifacts should expose stable keys used by gates, such as boundaries, decomposition, pattern_selection, risk_review, extension_points and critic_pass.
`;
}

function memoryRuntime() {
  return `# Project Memory Runtime

AAFE Memory gives each project a self-growing learning layer.

Before architecture work:
- recall relevant project design memory
- recall component contracts and conventions
- apply development habits and team rules

After work:
- capture durable project design learnings
- record component contracts and reusable patterns
- record coding habits, conventions and architecture decisions
- record verified solution ideas for repeated problems when the experience sedimentation rule is met

Memory categories:
- design: project architecture and module boundaries
- component: component contracts, composition and usage rules
- habit: development habits and preferences
- convention: naming, layout, testing and review standards
- decision: ADR-like durable decisions and tradeoffs
- experience: successful solution ideas for repeated problems after three failed/insufficient attempts
- project-architecture: generated index of routes, components, modules and design docs for quick AI locating
- learning: general project-specific lessons

Experience sedimentation rule:
- When the same problem has been handled three times and still exists, record the final successful solution after it is verified.
- Record only the stable solution idea, decision path and applicable boundary; do not write the full trial-and-error process.
- Prefer concise entries with problem signature, success path, why it worked and when to reuse it.
`;
}

function memoryRecallerSkill() {
  return `# Skill: Memory Recaller

Before architecture analysis, retrieve relevant project memory from .aafe-memory.

Use memory to understand:
- project design
- existing component contracts
- team development habits
- coding conventions
- previous architecture decisions
- repeated-problem experience and successful solution paths

Recall priority:
1. summary.md for compact context.
2. Topic files relevant to the request.
3. project-architecture.md and project-architecture-locator.md when the request requires locating routes, components, modules or design docs.
4. experience.md when the request resembles a recurring failure or regression.
5. learnings.jsonl for structured recent memory.

Required artifacts:
- memory_context
`;
}

function memoryWriterSkill() {
  return `# Skill: Memory Writer

After implementation or critique, write durable learnings into .aafe-memory.

Capture only stable project knowledge:
- project design rules
- component contracts
- reusable patterns
- development habits
- conventions
- architecture decisions and tradeoffs
- repeated-problem experience when the experience sedimentation rule is met

Memory entry requirements:
- choose exactly one type: design | component | habit | convention | decision | experience | learning
- include a short title, concise content, tags and source
- write durable knowledge only; avoid temporary task details or noisy logs

Use experience only for verified solution ideas after a problem has repeated three times.

Required artifacts:
- memory_write
`;
}

function experienceRecorderSkill() {
  return `# Skill: Experience Recorder

Record verified solution ideas for repeated problems.

Trigger condition:
- The same problem has been handled three times and still exists or regresses.
- A final solution has been verified as successful.

Write to .aafe-memory/experience.md and learnings.jsonl with type=experience.

Capture only:
- problem signature
- successful solution idea
- decision path
- applicable boundary
- avoid/retry warning

Do not capture:
- full trial-and-error logs
- temporary debugging details
- blame, emotions or noisy conversation history

Required artifacts:
- experience_memory
`;
}

function projectArchitectureAnalyzerSkill() {
  return `# Skill: Project Architecture Analyzer

Generate and use a compact project architecture locator before broad source reading.

When to use:
- The user asks where a route, page, component, module or design document is implemented.
- The agent needs to understand a project quickly before editing.
- The project structure has changed and the architecture index may be stale.
- Entry / build-tool / AST-based module maps need refresh.

Command:

\`\`\`bash
aafe analyze
aafe analyze --output=.aafe
aafe analyze --formats=json,jsonl,md,mmd
aafe analyze --mmd
aafe analyze --force
aafe analyze --skip-existing
aafe analyze --llm
\`\`\`

Generated artifacts:
- configurable analyze output (default \`.aafe/\`, via \`analyze.output\` or \`--output=\`)
- formats: default \`json,jsonl,md,mmd\` (Agent: json/jsonl; Human: mmd/md)
- per-module slices under \`modules/<id>/\`
- .ai-agent/skills/project-architecture-locator.md
- .ai-agent/skills/architecture-on-demand.md
- .ai-agent/skills/dataflow-on-demand.md
- .aafe-memory/project-architecture.md

Usage rules:
1. Read project-architecture-locator.md first for route/component/module locating.
2. Deep facts live under the configured output (default \`.aafe\`); load only one \`modules/<id>/\` slice.
3. Agent reads JSON/JSONL; humans may open \`.mmd\` when enabled.
4. For deep architecture, use architecture-on-demand.md.
5. For dataflow, use dataflow-on-demand.md.
6. For human architecture docs / Knowledge Center, still use project \`.docs\` via \`--architecture-docs\`.
7. Re-run aafe analyze after large routing, component or module changes.

Required artifacts:
- project_architecture_index
`;
}

function architectureOnDemandSkillTemplate() {
  return `# Skill: Architecture On-Demand

Use after \`aafe analyze\` has written the configured output directory (default \`.aafe\`).

When to use:
- Need module boundaries, owned routes, or key files for a feature area
- Avoid loading the full architecture dump

Protocol:
1. Read \`<analyze.output>/manifest.json\` and \`architecture/index.md\`
2. Load only matching slices from \`architecture/analysis.json\`
3. Never eagerly read all graph JSONL

Command:

\`\`\`bash
aafe analyze --output=.aafe
\`\`\`
`;
}

function dataflowOnDemandSkillTemplate() {
  return `# Skill: Dataflow On-Demand

Use after \`aafe analyze\` has written the configured output directory (default \`.aafe\`).

When to use:
- Tracing route → page → store/API/hooks flow for one module
- Impact analysis that needs data edges without full-repo scan

Protocol:
1. Read \`<analyze.output>/dataflow/index.md\`
2. Load only needed flows from \`dataflow/analysis.json\`
3. Use evidence to jump back to source files

Command:

\`\`\`bash
aafe analyze --output=.aafe
\`\`\`
`;
}

function downloadableSkillsInstallerSkill() {
  return `# Skill: Downloadable Skills Installer

Install published AAFE Agent Skills from GitHub into a target Agent Skills directory.

This skill is only for the GitHub Agent SKILLS download scenario. It must not be used to initialize or update \`.ai-agent\` inside a business project.

When to use:
- The user wants to download an AAFE Skill from GitHub.
- The user wants to install published AAFE Agent SKILLS into a specified Agent / AI tool Skills directory.
- The user explicitly provides or relies on an Agent Skills target directory.

Do not use when:
- The user wants a business project to install or update \`@aafe/agent-runtime\`.
- The user wants to generate or refresh project \`.ai-agent/\`, \`.aafe.config.json\` or editor runtime files.
- For project runtime work, use \`aafe init\`, \`aafe update\`, \`aafe analyze\` and \`aafe doctor\` instead.

Commands:

\`\`\`bash
aafe skills list --github
aafe skills install aafe-vue-complex-runtime --github
\`\`\`

Target resolution:
1. If \`--target=<dir>\` is provided, install into that Agent Skills directory.
2. Else if \`$SIBOOT_WORKSPACE_PATH\` exists, install into \`$SIBOOT_WORKSPACE_PATH/skills\`.
3. Else install into \`./skills\` under the current working directory.

Idempotency:
- If the target \`SKILL.md\` already has the same content, leave it unchanged.
- Use \`--dry-run\` before writing when the target directory is uncertain.
- Use \`--force\` only when the user explicitly wants to rewrite the target file.

Published manifest:
- https://raw.githubusercontent.com/xintaoLi/aafe-agent-runtime/main/skills/manifest.json

Required artifacts:
- downloadable_skills_install_plan
`;
}

function memoryIndex() {
  return `# Project Memory

This directory stores project-specific learning for AI agents.

Memory categories:
- project-design: architecture, module boundaries and domain concepts
- components: reusable components, props contracts and composition rules
- development-habits: team preferences and recurring implementation habits
- conventions: naming, file layout, coding rules and review standards
- decisions: architecture decisions and tradeoffs
- experience: verified solution ideas for repeated problems
- project-architecture: generated index of routes, components, modules and design documents
- summary.md: compact project memory summary
- learnings.jsonl: append-only structured memory log
`;
}

function memoryProjectDesign() {
  return `# Project Design Memory

Record architecture, domain boundaries, module ownership, state ownership and long-term design constraints here.
`;
}

function memoryComponents() {
  return `# Component Memory

Record component contracts, composition rules, reusable patterns, anti-patterns and usage examples here.
`;
}

function memoryDevelopmentHabits() {
  return `# Development Habits Memory

Record team habits, preferred implementation style, review preferences and recurring workflow choices here.
`;
}

function memoryConventions() {
  return `# Conventions Memory

Record naming rules, folder layout, import rules, testing expectations and style conventions here.
`;
}

function memoryDecisions() {
  return `# Architecture Decisions Memory

Record durable decisions, alternatives, tradeoffs and consequences here.
`;
}

function memoryExperience() {
  return `# Experience Memory

Record verified solution ideas for repeated problems here.

Write an entry only when:
- the same problem has been handled three times and still persists or regresses;
- a later solution has been verified as successful;
- the knowledge is reusable beyond the current temporary task.

Entry format:

## [Problem Signature]

- Attempts: 3+
- Success path: concise solution idea and decision path
- Reuse when: applicable context and boundaries
- Avoid: approaches that looked plausible but should not be repeated
`;
}

function memoryProjectArchitecture() {
  return `# Project Architecture Index

Generated by \`aafe analyze\`.

This file stores a compact index of main routes, components, modules and design documents so AI agents can quickly locate relevant context without reading excessive source files.

Run \`aafe analyze\` after major routing, module, component or design-document changes.
`;
}

function architectSkill() {
  return `# Skill: Architect

Analyze the request as a senior frontend architect before coding.

Output must include:
- domain boundaries
- impacted modules
- scaling risks
- coupling risks
- architecture decision summary

Required artifacts:
- boundaries
- risk_review
`;
}

function decomposerSkill() {
  return `# Skill: Module Decomposer

Decompose work into clear layers:
- domain
- application
- infrastructure
- presentation
- shared

Check that responsibilities do not leak across layers.

Required artifacts:
- decomposition
`;
}

function patternGateSkill() {
  return `# Skill: Pattern Gate

Decide whether the frontend design-pattern system may run at all.

Design-pattern skills are opt-in. The presence of factory, adapter, observer,
strategy, singleton, store, reducer, hook or middleware in the codebase is never
sufficient to activate them.

Steps:
1. Run \`aafe pattern gate "<request>"\`.
2. disabled -> stop. Handle the task as ordinary development work.
3. ambiguous -> ask the user. Do not activate silently.
4. enabled -> continue to discovery, not to selection.

Full rule: \`.ai-agent/frontend-engineering/rules/pattern-gate.md\`

Required artifacts:
- pattern_decision
`;
}

function patternDiscoverySkill() {
  return `# Skill: Pattern Discovery

Identify the architectural and business problems before any pattern is named.

Analyze module boundaries, component boundaries, state boundaries, data flow,
event flow, async flow, dependency graph, rendering flow, API boundaries,
business logic, UI logic, infrastructure logic, extension points, variation
points and performance bottlenecks.

Rules:
1. Describe the actual problems. Do NOT assign design patterns here.
2. Separate problems observed in the codebase from problems inferred from wording.
3. Assess problem complexity; it sets the over-engineering bar for later steps.

Required artifacts:
- pattern_problems
- pattern_variation_points
- pattern_complexity
`;
}

function patternComposerSkill() {
  return `# Skill: Pattern Composer

Compose the selected patterns into a coherent architecture. This is the step
that makes the system something other than a pattern lookup table.

Rules:
1. Every pattern gets an explicit responsibility and boundary (RULE-003, RULE-007).
2. Pull in required collaborators; a pattern missing its dependency is incomplete.
3. Detect conflicts — two patterns claiming the same responsibility (RULE-009).
4. Detect redundancy — interchangeable alternatives to one problem (RULE-010).
5. Prefer the simplest sufficient composition (RULE-011).
6. Pattern count is not a quality metric (RULE-012). Fewer may be better (RULE-013).

Required artifacts:
- pattern_composition
- pattern_relations
- pattern_conflicts
`;
}

function patternAntiPatternAuditSkill() {
  return `# Skill: Pattern Anti-Pattern Audit

Audit both the project and the composition this system just proposed.

Distinguish:
- observed — the project demonstrably does this; needs evidence
- predicted — our own recommendation would cause this

Auditing our own output is the only honest way to enforce ANTI-PATTERN-003
(cost without payoff) and ANTI-PATTERN-004 (count is not quality).

Catalog: \`.ai-agent/frontend-engineering/rules/anti-pattern.md\`

Required artifacts:
- pattern_anti_patterns
`;
}

function patternValidatorSkill() {
  return `# Skill: Pattern Validator

Check the composition against the problems it claims to solve.

Rules:
1. Every selected pattern must trace back to an identified problem.
2. Every identified problem must be answered by a pattern or explicitly left to
   direct implementation.
3. Confirm the composition is the minimum sufficient one.

Required artifacts:
- pattern_validation
`;
}

function dddPatternBridgeSkill() {
  return `# Skill: DDD ↔ Pattern Bridge

DDD decides the business model and boundaries; design patterns solve the
variation, collaboration, state, creation, communication, data access and
performance problems inside those boundaries.

Mapping:
- Bounded Context -> module / feature boundary (Feature Module, Public API)
- Aggregate -> State Machine, Command, Repository
- Domain Service -> Strategy, Specification
- Domain Event -> Domain Event, Observer, Pub/Sub
- Application Service -> Facade, Mediator

These are candidates, not conclusions. A Domain Service becomes a Strategy only
when something actually varies.

Required artifacts:
- ddd_pattern_bridge
`;
}

function patternInterviewerSkill() {
  return `# Skill: Pattern Interviewer

Before selecting a design pattern, analyze the feature and ask targeted questions when constraints are unclear.

Question dimensions:
- Will this feature need multiple interchangeable implementations?
- Is there complex state transition or lifecycle control?
- Does the operation need undo/redo/replay/audit?
- Is the process a multi-step pipeline with reusable stages?
- Does it need plugin/registry-based extension?

Required artifacts:
- pattern_interview
`;
}

function selectorSkill() {
  return `# Skill: Pattern Selector

Runs only after \`pattern-gate\` enabled the system and \`pattern-discovery\`
identified the problems. Selecting before discovery is guessing.

Candidates come from the 16 pattern domains in
\`.ai-agent/frontend-engineering/rules/<domain>-rules.md\`, not from a fixed
shortlist.

Selection rules:
1. Score every candidate: ProblemFit + ChangeIsolation + ComplexityReduction +
   ReusePotential + PerformanceBenefit − ImplementationCost − CognitiveCost −
   CouplingRisk − OverengineeringRisk.
2. A benefit only counts when the identified problem asks for it.
3. Select a pattern only when it answers a problem and scores positively.
4. Selecting nothing is a valid outcome (PATTERN-SYSTEM-002).
5. Never return a single pattern as the project's architecture
   (PATTERN-SYSTEM-001); patterns are composed.
6. Record rejected candidates and why.

Required artifacts:
- pattern_selection
- pattern_candidates
- pattern_rejected
`;
}

function modulePatternSelectorSkill() {
  return `# Skill: Module Pattern Selector

For complex frontend features, select design patterns per module instead of forcing one global pattern.

Module dimensions:
- domain: invariants, entities, value objects and repository ports
- application: use cases, orchestration and command flow
- infrastructure: API adapters, providers and extension registries
- presentation: UI composition, interaction state and view contracts

Selection rules:
1. Each module gets its own problem set and its own minimum sufficient composition.
2. Different modules may use different patterns when business behavior differs.
3. Pattern landing must include contract, implementation boundary and verification.
4. Do not leak infrastructure or presentation pattern choices into domain logic.
5. A module with no identified problem gets no pattern.

Required artifacts:
- module_pattern_selection
`;
}

function patternImplementationPlannerSkill() {
  return `# Skill: Pattern Implementation Planner

Turn the selected pattern composition into an implementation plan. Plan the
composition as a whole: the relations between patterns are part of the design,
not an afterthought.

Output:
- interfaces/contracts to introduce
- modules/files to create or change
- extension points
- migration impact
- testing strategy

Required artifacts:
- pattern_implementation_plan
- extension_points
`;
}

function predictorSkill() {
  return `# Skill: Evolution Predictor

Predict likely changes in the next 3-12 months.

Output:
- 3 likely feature expansions
- extension points
- anti-fragile abstractions
- risks of over-engineering

Required artifacts:
- extension_points
`;
}

function criticSkill() {
  return `# Skill: Refactor Critic

Review generated or proposed code for:
- hidden coupling
- poor extensibility
- mixed concerns
- abstraction leakage
- state ownership ambiguity
- framework-specific pitfalls

Required artifacts:
- critic_pass
`;
}

function architectureImpactTestForecastSkill() {
  return architectureImpactTestForecastSkillContent('.ai-agent');
}

function minimalConvergentSelfTestSkill() {
  return minimalConvergentSelfTestSkillContent('.ai-agent');
}

function requirementIntakeAnalysisSkill() {
  return requirementIntakeAnalysisSkillContent('.ai-agent');
}

function tapdSubmitBackfillSkill() {
  return tapdSubmitBackfillSkillContent('.ai-agent');
}

function parseConfigJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function knowledgeCenterUpdaterSkill() {
  return `# Skill: Knowledge Center Updater

After every feature, fix, refactor or architecture change:

1. Run aafe knowledge update in the target project.
2. Run aafe knowledge-web to refresh the modular visual Knowledge Web.
3. Read the current .docs architecture sources and Mermaid diagrams.
4. Update generated relationship views under .docs/aafe-generated/.
4. Preserve original .docs documents and only update generated views automatically.
5. Use the generated views as Knowledge Center input.
6. Update the modular impact.html page with the current impact scope and recommended tests.
7. Run the mandatory architecture impact and test forecast before reporting completion.

Generated views:
- .docs/aafe-generated/组件关系.md
- .docs/aafe-generated/业务关系与数据流.md
- .docs/aafe-generated/影响范围与测试预测.md

Do not claim that generated documentation is a complete business truth. Include source paths, scan version and unresolved conflicts.
`;
}

function adrSkill() {
  return `# Skill: ADR Generator

Generate Architecture Decision Records for non-trivial decisions.

Format:
# Decision
# Context
# Alternatives
# Tradeoffs
# Consequences
# Follow-ups
`;
}

function featurePipeline() {
  // No DDD and no pattern steps. An ordinary feature must not be turned into a
  // modelling or design-pattern exercise by the pipeline it happens to land in.
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: evolution-predictor
  - gate: architecture_gate
  - skill: adr-generator
  - gate: implementation_gate
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function domainFeaturePipeline() {
  // Gate -> Scope -> Discovery -> Strategic -> Tactical -> Architecture ->
  // Mapping -> Refactor -> Validation. Everything after ddd-scope self-skips
  // when the request did not ask for it, so a narrow "设计 Aggregate" runs a
  // handful of steps rather than the whole chain.
  return `pipeline:
  - skill: ddd-gate
  - skill: ddd-scope
  - gate: ddd_enablement_gate
  - skill: memory-recaller
  - skill: ddd-project-discovery
  - skill: ddd-domain-discovery
  - gate: ddd_gate
  - skill: ddd-strategic-design
  - skill: ddd-bounded-context
  - skill: ddd-context-map
  - skill: ddd-tactical-design
  - skill: ddd-aggregate
  - skill: ddd-domain-event
  - skill: ddd-application-design
  - skill: ddd-architecture
  - skill: ddd-code-mapping
  - skill: architect
  - skill: module-decomposer
  - skill: ddd-pattern-bridge
  - skill: evolution-predictor
  - skill: ddd-refactoring
  - skill: ddd-validation
  - skill: ddd-documentation
  - gate: implementation_gate
  - skill: adr-generator
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function patternFeaturePipeline() {
  // Gate -> Discovery -> Selection -> Composition -> Audit -> Validation.
  // Discovery runs before anything is named, and every step after the gate
  // self-skips when design-pattern intent was not established.
  return `pipeline:
  - skill: pattern-gate
  - gate: pattern_enablement_gate
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: pattern-discovery
  - skill: pattern-interviewer
  - skill: pattern-selector
  - skill: pattern-composer
  - skill: module-pattern-selector
  - skill: pattern-anti-pattern-audit
  - gate: pattern_gate
  - skill: pattern-validator
  - skill: pattern-implementation-planner
  - skill: adr-generator
  - gate: implementation_gate
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function memoryDiagnosisPipeline() {
  return `pipeline:
  - skill: memory-oom-gate
  - skill: memory-scope
  - gate: memory_oom_gate
  - skill: memory-diagnosis
  - skill: memory-agent-selector
  - skill: memory-writer
`;
}

function refactorPipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: refactor-critic
  - gate: architecture_gate
  - skill: adr-generator
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function bugfixPipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function performancePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: module-decomposer
  - skill: evolution-predictor
  - gate: architecture_gate
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function graphFeaturePipeline() {
  return `pipeline:
  - skill: memory-recaller
  - skill: architect
  - skill: graph-architect
  - skill: layout-strategy-selector
  - skill: runtime-evolution-predictor
  - skill: module-decomposer
  - gate: architecture_gate
  - skill: adr-generator
  - skill: refactor-critic
  - skill: experience-recorder
  - skill: memory-writer
  - gate: merge_gate
`;
}

function reactPack() {
  return `# Framework Pack: React

Focus:
- hooks boundary
- context overuse
- state slicing
- render optimization
- server state vs client state ownership
`;
}

function nextPack() {
  return `# Framework Pack: Next.js

Focus:
- server/client boundary
- route segmentation
- cache strategy
- data fetching ownership
- edge/runtime constraints
`;
}

function vuePack() {
  return `# Framework Pack: Vue

Focus:
- composable design
- reactive ownership
- store boundaries
- component responsibility split
`;
}

function monorepoPack() {
  return `# Framework Pack: Monorepo

Focus:
- package boundary
- dependency graph
- public contract governance
- build pipeline ownership
`;
}

function adminPack() {
  return `# Scenario Pack: Admin

Focus:
- RBAC/ABAC evolution
- route permissions
- auditability
- form/table abstraction boundaries
`;
}

function dashboardPack() {
  return `# Scenario Pack: Dashboard

Focus:
- data model ownership
- visualization composition
- cache refresh strategy
- metric definition governance
`;
}

function workflowPack() {
  return `# Scenario Pack: Workflow

Focus:
- state machine modeling
- approval lifecycle
- event history
- rollback and audit requirements
`;
}

function graphPack() {
  return `# Scenario Pack: Graph

Focus:
- graph boundary
- node lifecycle
- edge ownership
- layout strategy
- execution semantics
- command history
`;
}

function dddPack() {
  return `# Scenario Pack: Domain-Driven Design

Use this pack for business-heavy features where domain language and business invariants matter.

Workflow:
1. Discover ubiquitous language.
2. Identify bounded contexts and context map.
3. Design aggregates around invariants.
4. Identify entities, value objects, repositories and domain services.
5. Identify domain events and consistency boundaries.
6. Map domain model to frontend/application architecture.

DDD building blocks:
- Ubiquitous Language
- Subdomain
- Bounded Context
- Context Map
- Aggregate Root
- Entity
- Value Object
- Repository
- Domain Service
- Domain Event
- Anti-Corruption Layer
`;
}

function patternsPack() {
  return `# Scenario Pack: Design Patterns

Use this pack when implementing new features that may need a design pattern.

Workflow:
1. Analyze feature variability, lifecycle, state, extensibility and operation history.
2. Ask pattern interview questions if constraints are unclear.
3. Select the simplest sufficient pattern.
4. Produce a concrete landing plan before coding.
5. Record the decision and tradeoffs in Memory/ADR.

Pattern map:
- Strategy: interchangeable algorithms/providers
- Factory: complex object creation
- Registry: plugin or extension point
- State Machine: complex lifecycle and illegal states
- Command: undo/redo/replay/audit
- Pipeline: multi-stage processing
- Observer: decoupled event notification
- Adapter: third-party or compatibility boundary
- Composition: UI behavior composition
`;
}

function complexPack() {
  return `# Scenario Pack: Complex Frontend

Use this pack as the default scenario for non-trivial frontend systems.

Workflow:
1. Split the feature by real business modules before selecting patterns.
2. Select patterns independently for domain, application, infrastructure and presentation modules.
3. Keep each selected pattern inside its module boundary.
4. Land each pattern with contract, implementation and verification.
5. Reject one global pattern when module responsibilities differ.

Module pattern map:
- domain: State Machine, Repository Port, Domain Service, Specification
- application: Command, Pipeline, Use Case Orchestrator
- infrastructure: Adapter, Registry, Strategy
- presentation: Composition, Observer, State Machine
- graph-runtime: Command, Strategy, Registry, Observer
`;
}

function cursorSkillRouterRules() {
  return '---\ndescription: AAFE Skill Index On-Demand Router\nalwaysApply: true\n---\n\n# AAFE Skill Index On-Demand Router\n\nFor every task in this repository:\n1. Read `.ai-agent/skill-index.md` first.\n2. If present, read `.ai-agent/project.md` for project-specific quick map and domain routing hints.\n3. Read `.aafe.config.json` → `mode.workflow` (default `ask`). Load `.ai-agent/skills/workflow-mode.md` before the first interactive gate.\n3b. ' + taskSpinePointerLine('.ai-agent') + '\n4. Only when the task matches a domain, read the matching `.ai-agent/project-skills/<domain>/SKILL.md`.\n5. For non-trivial frontend work, then follow `.ai-agent/runtime/*` and `.ai-agent/pipelines/*`.\n6. Editor directories are pointers only. Do not copy, rewrite, or maintain project knowledge in `.cursor`.\n7. Do not eagerly read all project skills.\n8. `aafe` is runnable from this repo (`node_modules/.bin/aafe` when not on `PATH`). See the\n   "Commands you may run yourself" table in `.ai-agent/skill-index.md` and run them yourself\n   instead of asking the user to. Prefer `aafe knowledge search` over a blind grep when locating code.\n';
}

function editorSkillEntry(name) {
  return '# AAFE Project Skill Entry ({name})\n\nThis file is a thin pointer generated by @aafe/agent-runtime.\n\nRead `.ai-agent/skill-index.md` first, then `.ai-agent/project.md` if present, and only then load the matching `.ai-agent/project-skills/<domain>/SKILL.md` on demand.\n\nDo not copy project knowledge into this editor directory. The single source of truth is `.ai-agent`.\n'.replace('{name}', name);
}

function nativeEditorSkill(name) {
  return [
    '---',
    'name: aafe-runtime',
    'description: Use the AAFE project runtime for architecture-aware frontend work. Read the generated skill index first, then load only matching project skills on demand.',
    '---',
    '',
    `# AAFE Runtime (${name})`,
    '',
    '1. Read `.ai-agent/skill-index.md` first and follow **Task Spine**.',
    '2. Read `.ai-agent/project.md` when present.',
    '3. Load only the matching `.ai-agent/project-skills/<domain>/SKILL.md`.',
    `4. ${taskSpinePointerLine('.ai-agent')}`,
    '5. For non-trivial work, follow `.ai-agent/runtime/engine.md`, `.ai-agent/runtime/router.yaml` and the selected pipeline.',
    '6. Preserve successful decisions and reusable solutions in `.aafe-memory/`.',
    '',
    'The project `.ai-agent/` directory is the single source of truth; this file is only the editor discovery entry.',
    ''
  ].join('\n');
}

function cursorRules() {
  return '---\ndescription: AAFE Architecture Runtime\nalwaysApply: true\n---\n\n# AAFE Architecture Runtime\n\nFor every non-trivial frontend task after the Skill Router step:\n0. Read `.aafe.config.json` → `mode.workflow` (default `ask`) and follow `aafe-workflow-mode.mdc` / `workflow-mode.md` before the first interactive gate.\n0a. ' + taskSpinePointerLine('.ai-agent') + '\n0b. After concrete requirement is obtained (TAPD pull or user spec), follow `aafe-requirement-intake-analysis.mdc` / `requirement-intake-analysis.md`: TAPD pull + branch association; TAPD ID mismatch must continue branch switch/create unless user already confirmed current branch → if TAPD contains Figma, fetch structured design + screenshot via Figma MCP → clarify ambiguities → history search → code scope & root cause → sizing gate (direct fix vs Plan mode).\n1. Read `.ai-agent/runtime/engine.md`.\n2. Classify the task using `.ai-agent/runtime/router.yaml`.\n3. Follow the selected `.ai-agent/pipelines/*.yaml`.\n4. Enforce `.ai-agent/runtime/gates.yaml` before implementation.\n5. Read `.ai-agent/skills/project-architecture-locator.md` first when locating routes, components, modules or design docs.\n5b. For deep architecture/dataflow, use `.ai-agent/skills/architecture-on-demand.md` / `dataflow-on-demand.md` against the configured analyze output (default `.aafe/`, never the full tree).\n6. Use framework, DDD, design-pattern and scenario packs when relevant.\n7. For business-heavy features, run DDD Discovery before module decomposition.\n8. For new features, run Pattern Interview before Pattern Selection.\n9. For complex frontend work, select and land patterns per module based on real business responsibility.\n10. Output DDD Model, Architecture, Module Boundaries, Pattern Interview, Pattern Selection, Module Pattern Selection, Tradeoffs, Implementation and Critique.\n11. Before final response, follow `aafe-task-completion-impact.mdc` (Task Spine [3]): task assessment — only ask impact/self-test when code changed (skip docs/requirements-only); UI sub-asks only for code + UI impact; pre-generate `ui_test_paths`; TAPD + Figma tasks use local diff to generate impact units/test paths, then use Figma evidence to narrow impact and assertions.\n12. After self-test: follow `aafe-tapd-submit-backfill.mdc` + `repo-submit.md` (Task Spine [4]). TAPD backfill only when task has TAPD association and `tapd.enabled`; PR still uses repo-submit.\n13. File license: follow `aafe-new-file-license.mdc` — new files add header; edits use local `aafe license ensure <path>` (never AI-Read memory JSONL).\n';
}

function cursorHooks() {
  return `${JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [
        {
          command: '.cursor/hooks/run-hook.cmd aafe-session-start',
          timeout: 5,
          failClosed: false
        },
        {
          command: '.cursor/hooks/run-hook.cmd aafe-task-completion',
          timeout: 120,
          failClosed: false
        }
      ]
    }
  }, null, 2)}\n`;
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

function cursorTaskCompletionHook() {
  return taskCompletionHookScript();
}

function cursorSessionStartHook() {
  return `#!/usr/bin/env bash\nset -euo pipefail\n\ncat <<'JSON'\n{\n  "additional_context": "${taskSpineHookContext('.ai-agent')}"\n}\nJSON\nexit 0\n`;
}

function claudeRules() {
  return '# AAFE Architecture Runtime\n\n## Workflow mode\n\nRead `.aafe.config.json` → `mode.workflow` (default `ask`). `ask` keeps confirm-at-gate. `autonomous` lets the LLM decide Commit / PR / backfill / Plan / impact per `.ai-agent/skills/workflow-mode.md`. Hard Ask still stops for missing user-only facts.\n\n## Requirement intake (before analysis / code)\n\nAfter concrete requirement: close branch decision first; TAPD ID mismatch must switch/create branch unless user already confirmed current branch; then clarify → history search → scope & root cause → Plan gate if large (>5 fn/files or >300 new lines). See `.ai-agent/skills/requirement-intake-analysis.md`.\n\n## Task completion impact and test (conditional)\n\nTask assessment: only ask impact/self-test for code changes (skip docs/requirements-only). UI MCP asks only for code + UI impact. After self-test: TAPD backfill only if task has TAPD association.\n\n## TAPD submit backfill\n\nOnly with TAPD association + tapd.enabled: Commit → PR → comment-only backfill (ask or autonomous per workflow mode). No TAPD link in task → skip all TAPD asks. See `.ai-agent/skills/tapd-submit-backfill.md`.\n\n## Mandatory completion review\n\nAfter impact analysis is confirmed or autonomously started, report scope, tests, and unverified risks.\n\n## AAFE Skill Router\n\nFor every task, read `.ai-agent/skill-index.md` first, then `.ai-agent/project.md` if present, then only the matching `.ai-agent/project-skills/<domain>/SKILL.md` on demand. Do not copy project knowledge into editor directories and do not eagerly read all project skills.\n\n## Runtime Pipeline\n\nFor non-trivial frontend engineering tasks, load `.ai-agent/runtime/engine.md`, classify requests with `.ai-agent/runtime/router.yaml`, follow the matching pipeline, run DDD discovery for business-heavy features, run pattern interview for new features, select patterns per module for complex frontend work, enforce gates, and only implement after DDD, architecture and pattern gates pass.\n';
}

function genericEditorRules(name) {
  return '# AAFE Architecture Runtime for __NAME__\n\n## Workflow mode\n\nRead `.aafe.config.json` → `mode.workflow` (default `ask`). See `.ai-agent/skills/workflow-mode.md`.\n\n## Requirement intake\n\nBefore analysis/design/code: close branch decision first; TAPD ID mismatch must switch/create branch unless user already confirmed current branch; then clarify requirement → history → scope/root cause → Plan if large. See `.ai-agent/skills/requirement-intake-analysis.md`.\n\n## Task completion impact and test (conditional)\n\nOnly run impact/self-test for code changes. UI MCP only for code + UI impact. TAPD backfill only if task has TAPD association.\n\n## TAPD submit backfill\n\nTAPD association required for backfill. See `.ai-agent/skills/tapd-submit-backfill.md`.\n\n## AAFE Skill Router\n\nFor every task, read `.ai-agent/skill-index.md` first, then `.ai-agent/project.md` if present, then only the matching `.ai-agent/project-skills/<domain>/SKILL.md` on demand. Editor adapter files are pointers only; do not copy project knowledge into editor directories and do not eagerly read all project skills.\n\n## Runtime Pipeline\n\nUse `.ai-agent` as the project architecture runtime. For non-trivial frontend work, route requests through `runtime/router.yaml`, run DDD discovery for business-heavy features, run pattern interview for new features, select patterns per module for complex frontend work, execute pipeline steps, enforce gates, and run refactor critique before finalizing code.\n'.replace('__NAME__', name);
}
