import { bootstrapProject } from './bootstrap.js';
import { runAnalyzeCommand } from './analyze.js';
import { runDDDCommand } from './ddd.js';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';
import { runMemoryCommand } from './memory.js';
import { runKnowledgeCommand } from './knowledge.js';
import { runKnowledgeWebCommand } from './knowledgeWeb.js';
import { runConfigUiCommand } from './configUi.js';
import { runTaskCompletion } from './taskCompletion.js';
import { runPatternCommand } from './patterns.js';
import { runSkillsCommand } from './skills.js';
import { runE2eSetupCommand } from './e2eSetup.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runFileLicenseCommand } from './fileLicense.js';
import { runUpdateCommand } from './update.js';
import { runMigrateCommand } from './migrate.js';
import { createRuntimeFromProject } from '../agent-platform/skill-runtime/configLoader.js';
import { resolveWorkspaceLayout } from './workspace.js';
import { discoverProjectContext } from '../project/projectContext.js';
import {
  runContextCommand,
  runDiagnoseCommand,
  runImpactCommand,
  runPlanCommand,
  runPlatformRunCommand,
  runTestCommand
} from './platform.js';
import { runRepoPrCommand } from './repoSubmit.js';
import { runTaskCommand } from './tasks.js';
import { runSDDCommand } from './sdd.js';

export async function runCli(argv) {
  const command = argv[2] ?? 'help';
  const options = parseOptions(argv.slice(3));

  if (command === 'init') {
    const installRoot = process.cwd();
    const detection = await detectProject(installRoot);
    const layout = await resolveWorkspaceLayout(installRoot, detection.editors);
    const existingConfig = await readProjectConfig(installRoot);
    const initOptions = await collectInitOptions(detection, { ...options, existingConfig, root: installRoot }, layout);
    await bootstrapProject(installRoot, detection, initOptions);
    if (initOptions.workspaceLayout?.layeredEditors) {
      console.log(`AAFE runtime initialized in install dir. Editor adapters were written to workspace root for module "${initOptions.workspaceLayout.moduleName}".`);
      console.log('.ai-agent and .docs remain in the install directory; editor pointers were rewritten accordingly.');
      return;
    }
    console.log('AAFE runtime initialized.');
    return;
  }

  if (command === 'detect') {
    console.log(JSON.stringify(await detectProject(process.cwd()), null, 2));
    return;
  }

  if (command === 'project' || command === 'projects') {
    const subcommand = argv[3] ?? 'context';
    if (subcommand !== 'context') throw new Error(`Unknown project command: ${subcommand}`);
    console.log(JSON.stringify(await discoverProjectContext(options.projectRoot ?? process.cwd(), {
      host: options.host,
      workspaceRoot: options.workspaceRoot
    }), null, 2));
    return;
  }

  if (command === 'doctor') {
    const report = await doctorProject(process.cwd());
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'fail') process.exitCode = 1;
    return;
  }

  if (command === 'migrate') {
    await runMigrateCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'sync') {
    const detection = await detectProject(process.cwd());
    await bootstrapProject(process.cwd(), detection, { ...options, sync: true, yes: true });
    console.log('AAFE runtime synced.');
    return;
  }

  if (command === 'analyze' || command === 'analyse') {
    await runAnalyzeCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'memory') {
    await runMemoryCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'license') {
    await runFileLicenseCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'knowledge') {
    await runKnowledgeCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'knowledge-web') {
    await runKnowledgeWebCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'config' || command === 'ui') {
    await runConfigUiCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'task-completion') {
    const results = await runTaskCompletion(process.cwd(), { dryRun: options.dryRun });
    console.log(JSON.stringify({ status: results.some((item) => item.status === 'fail') ? 'fail' : 'pass', results }, null, 2));
    if (results.some((item) => item.status === 'fail')) process.exitCode = 1;
    return;
  }

  if (command === 'pattern') {
    await runPatternCommand(argv.slice(3));
    return;
  }

  if (command === 'skills' || command === 'skill') {
    await runSkillsCommand(argv.slice(3));
    return;
  }

  if (command === 'ddd') {
    await runDDDCommand(argv.slice(3));
    return;
  }

  if (command === 'update' || command === 'updaet' || command === 'refresh') {
    await runUpdateCommand(argv.slice(3));
    return;
  }

  if (command === 'context') {
    await runContextCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'impact') {
    await runImpactCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'plan') {
    await runPlanCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'test') {
    await runTestCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'e2e') {
    await runE2eSetupCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'repo') {
    const subcommand = argv[3] ?? 'help';
    if (subcommand !== 'pr') {
      throw new Error('Usage: aafe repo pr --title= --body= --base= --head=');
    }
    const result = await runRepoPrCommand(process.cwd(), argv.slice(4));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'diagnose') {
    await runDiagnoseCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'task' || command === 'tasks') {
    await runTaskCommand(process.cwd(), argv.slice(3));
    return;
  }

  if (command === 'sdd' || command === 'openspec') {
    await runSDDCommand(process.cwd(), argv.slice(3));
    return;
  }

  // `run` now drives the Planner + Orchestrator. The former skill-pipeline
  // behaviour moved to `pipeline`, still reachable via `run --legacy`.
  if (command === 'run' || command === 'execute' || command === 'pipeline') {
    const args = argv.slice(3);
    const legacy = command === 'pipeline' || args.includes('--legacy');
    if (!legacy) {
      await runPlatformRunCommand(process.cwd(), args);
      return;
    }
    const prompt = parsePrompt(args);
    if (!prompt) {
      throw new Error('Missing prompt. Usage: aafe pipeline "<frontend task>"');
    }
    const runtime = await createRuntimeFromProject(options.projectRoot ?? process.cwd(), {
      memory: options.memory,
      host: options.host,
      workspaceRoot: options.workspaceRoot
    });
    const result = await runtime.execute({ prompt });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHelp();
}

function parsePrompt(args) {
  return args
    .filter((arg) => !arg.startsWith('--') && arg !== '-y')
    .join(' ')
    .trim();
}

function parseOptions(args) {
  const options = {
    yes: args.includes('--yes') || args.includes('-y'),
    force: args.includes('--force'),
    nonInteractive: args.includes('--non-interactive'),
    dryRun: args.includes('--dry-run')
  };

  for (const arg of args) {
    if (arg.startsWith('--framework=')) options.framework = arg.slice('--framework='.length);
    if (arg.startsWith('--scenarios=')) options.scenarios = arg.slice('--scenarios='.length);
    if (arg.startsWith('--editors=')) options.editors = arg.slice('--editors='.length);
    if (arg === '--no-memory') options.memory = false;
    if (arg.startsWith('--template=')) options.template = arg.slice('--template='.length);
    if (arg.startsWith('--architecture-docs=')) options.architectureDocs = arg.slice('--architecture-docs='.length);
    if (arg.startsWith('--knowledge-docs=')) options.knowledgeDocs = arg.slice('--knowledge-docs='.length);
    if (arg.startsWith('--module-name=')) options.moduleName = arg.slice('--module-name='.length);
    if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length).toLowerCase();
    if (arg.startsWith('--project-root=')) options.projectRoot = arg.slice('--project-root='.length);
    if (arg.startsWith('--workspace-root=')) options.workspaceRoot = arg.slice('--workspace-root='.length);
    if (arg === '--migrate-cursor') options.migrateInstallEditors = true;
    if (arg === '--migrate-editors') options.migrateInstallEditors = true;
    if (arg === '--no-migrate-cursor') options.migrateInstallEditors = false;
    if (arg === '--no-migrate-editors') options.migrateInstallEditors = false;
    if (arg.startsWith('--submit-cli=')) options.submitCli = arg.slice('--submit-cli='.length);
    if (arg.startsWith('--workflow-mode=')) options.workflowMode = arg.slice('--workflow-mode='.length);
    if (arg.startsWith('--agent-mode=')) options.agentMode = arg.slice('--agent-mode='.length);
    if (arg === '--agent-mode') options.agentMode = true;
    if (arg === '--no-agent-mode') options.agentMode = false;
    if (arg.startsWith('--agent-manager=')) options.agentManager = arg.slice('--agent-manager='.length);
    if (arg === '--agent-manager') options.agentManager = true;
    if (arg === '--no-agent-manager') options.agentManager = false;
    if (arg.startsWith('--max-concurrent-tasks=')) options.maxConcurrentTasks = Number.parseInt(arg.slice('--max-concurrent-tasks='.length), 10);
    if (arg.startsWith('--task-output=')) options.taskOutput = arg.slice('--task-output='.length);
    if (arg === '--no-agent-readiness-check') options.validateProjectRuntime = false;
    if (arg === '--no-agent-recovery') options.recoverOnStart = false;
    if (arg === '--sdd') options.sddEnabled = true;
    if (arg === '--no-sdd') options.sddEnabled = false;
    if (arg.startsWith('--sdd-root=')) options.sddRoot = arg.slice('--sdd-root='.length);
    if (arg.startsWith('--sdd-schema=')) options.sddSchema = arg.slice('--sdd-schema='.length);
    if (arg === '--no-sdd-approval') options.sddApprovalRequired = false;
    if (arg.startsWith('--cursor-api-key-env=')) options.cursorApiKeyEnv = arg.slice('--cursor-api-key-env='.length);
    if (arg.startsWith('--cursor-model=')) options.cursorModel = arg.slice('--cursor-model='.length);
    if (arg.startsWith('--cursor-runtime=')) options.cursorRuntime = arg.slice('--cursor-runtime='.length);
    if (arg.startsWith('--cursor-repository=')) options.cursorRepository = arg.slice('--cursor-repository='.length);
    if (arg.startsWith('--mcp-config=')) options.mcpConfig = arg.slice('--mcp-config='.length);
    if (arg.startsWith('--mcp-setting-sources=')) options.mcpSettingSources = arg.slice('--mcp-setting-sources='.length);
    if (arg === '--no-mcp') options.mcpEnabled = false;
    if (arg === '--e2e') options.e2e = true;
    if (arg === '--no-e2e') options.e2e = false;
    if (arg === '--install-playwright') options.installPlaywright = true;
  }
  return options;
}

function printHelp() {
  console.log(`aafe <command>

Commands:
  init      Initialize .ai-agent runtime, memory and editor rules
  detect    Detect framework, editor and scenario
  project   Resolve current project directory and enumerate local Rules/Skills
            --host=cursor|codebuddy delegates activation to the editor
            --host=openclaw|hermes loads bounded project instructions in Runtime
            --project-root=<path> supports hosts whose process cwd is elsewhere
  doctor    Validate installed runtime files
  sync      Refresh generated runtime files
  analyze   Generate architecture locator, .ai-agent/.docs AST analysis and on-demand skills
  memory    Manage project self-growing memory
  license   Local fast BlueKing license check/ensure/mark (no AI; do not Read memory file)
  knowledge  Initialize or update project Knowledge views in .docs
  knowledge-web  Generate or serve the Knowledge Web visualization
  config    Local visual UI for CLI config (alias: ui)
  task-completion  Run automatic post-task Knowledge update, Runtime update and doctor
  skills    List or install downloadable AAFE Agent Skills from GitHub
  pattern   Interview and select design patterns for features
  ddd       Analyze domain-driven design model for business features
  context   Build the minimal traceable context package for an IDE agent
  impact    Predict the blast radius of a requirement or a git diff
  plan      Show the planner decision trace for a task
  run       Run the Planner + Orchestrator loop for a task
  pipeline  Run the legacy skill pipeline (former "run" behaviour)
  test      Plan/generate Playwright YAML cases from analyze, diff or PR; --run executes e2e
  e2e       Enable/disable Playwright E2E later (aafe e2e enable|disable|status|install|auth)
  repo      GitHub PR via repo.githubAccessToken (aafe repo pr). Does not require gh
  diagnose  Turn a failing test report into a located root cause
  task      Manage isolated durable Cursor Cloud tasks (create|list|status|continue|cancel|recover)
  update    Refresh installed project .ai-agent capabilities from the current aafe package
  migrate   Move files and config left by older versions to their current locations (--dry-run)

Init options:
  --yes
  --framework=react|next|vue|monorepo|generic
  --scenarios=complex,graph,admin,dashboard,workflow,patterns,ddd
  --editors=cursor,claude,codebuddy,codex,trace,windsurf,vscode
  --no-memory
  --force
  --module-name=<name>     Layered editor module name when install dir is not workspace root
  --migrate-editors        Migrate install-dir editor adapters to workspace root
  --migrate-cursor         Alias of --migrate-editors
  --no-migrate-editors     Skip editor adapter migration during init/update
  --no-migrate-cursor      Alias of --no-migrate-editors
  --submit-cli=git|gtm     Commit/PR provider written to .aafe.config.json → submit.cli (default: git)
  --workflow-mode=ask|autonomous  Gate interaction: ask user (default) or LLM auto-decide Commit/PR/backfill
  --agent-mode[=on|off]    Enable Cursor SDK execution for aafe run via .aafe.config.json → agent.enabled
  --agent-manager[=on|off]  Enable durable Cursor Cloud task management
  --max-concurrent-tasks=N  Maximum managed Cloud tasks running at once (default: 4)
  --task-output=<path>      Managed task state root (default: .aafe)
  --sdd / --no-sdd         Enable or disable automatic SDD task gating
  --sdd-root=<path>         OpenSpec project root (default: openspec)
  --sdd-schema=<name>       SDD artifact schema (core supports spec-driven)
  --no-sdd-approval        Do not require explicit artifact approval
  --cursor-api-key-env=CURSOR_API_KEY  Env var name used by Cursor SDK (default)
  --cursor-model=<id>      Cursor model for agent mode (default: composer-2.5)
  --cursor-runtime=local|cloud  Cursor SDK runtime for agent mode
  --mcp-config=<path>     Write agent.mcp.config (Cursor mcp.json) for aafe run
  --mcp-setting-sources=project,user  Load Cursor MCP/settings sources (default: none)
  --no-mcp                Disable MCP for agent-mode execution
  --e2e                    Enable Playwright E2E in .aafe.config.json (default)
  --no-e2e                 Disable E2E
  --install-playwright     When enabling E2E, install playwright + @playwright/test (and Chromium)

TAPD (init/update interactive):
  When prompted, answer Y/Yes/是 to configure TAPD commit/submit backfill in .aafe.config.json

E2E (init/update interactive, or later):
  e2e.enabled defaults to true. Prompt default is Y; pass --no-e2e to disable. Missing Playwright may prompt to install.
  Later: aafe e2e enable | aafe e2e disable | aafe e2e status | aafe e2e install --yes | aafe e2e auth

Submit CLI:
  .aafe.config.json → "submit": { "cli": "git" | "gtm" }
  git (default): Git CLI + Token API / aafe repo pr (gh optional fallback)
  gtm: gtm commit / gtm pr (project GTM config required; errors not forced)

Code repo:
  .aafe.config.json → "repo": { "githubAccessToken", "gongfengAccessToken", "reviewers", "labels" }
  If githubAccessToken / GITHUB_TOKEN is set, GitHub fetch/pull/push/PR use that token (aafe repo pr). gh is not required.
  reviewers / labels (string arrays) are attached when creating GitHub PR or Gongfeng MR.

Workflow mode:
  .aafe.config.json → "mode": { "workflow": "ask" | "autonomous" }
  ask (default): confirm at each gate (requirement / Plan / impact / Commit / PR / TAPD backfill)
  autonomous: LLM decides those gates per .ai-agent/skills/workflow-mode.md; Hard Ask still stops for missing user-only facts

Agent mode:
  .aafe.config.json → agent.enabled / agent.mcp
  Overlay on aafe run only: analyze / context / impact / plan / test / IDE handoff stay unchanged.
  When enabled (or --agent=cursor), the generated context package is then executed via Cursor SDK.
  MCP is attached only to that Cursor step: agent.mcp.servers, agent.mcp.config, or --mcp-config=.
  Ambient Cursor MCP is off unless agent.mcp.settingSources / --mcp-setting-sources is set.
  A real key may stay in the env var, or be set manually as agent.apiKey.
  One-shot override: aafe run "<task>" --agent=off keeps the existing planner-only path.

Analyze options:
  --output=.aafe               Analysis knowledge output (default; also analyze.output)
  --docs-out=<path>            Alias of --output (legacy)
  --formats=json,jsonl,md,mmd  Output formats (default includes Mermaid .mmd)
  --mmd                        Kept for compatibility (mmd already in default)
  --architecture-docs=.docs    Human architecture docs for Knowledge (unchanged)
  --max-depth=<n>              Entry import BFS depth (default 40)
  --max-files=<number>
  --force                      Overwrite analyze output and migrate leftover files from older layouts (keeps e2e/ and runs/)
  --skip-existing              Skip writing output when it already has content
  --llm                        Request reserved LLM path (no-op unless configured)
  --quiet                      Suppress human progress output
  --dry-run                    Preview without writing
  --no-write                   Analyze without writing artifacts

Agent platform (context / impact / plan / run):
  aafe context --requirement="增加用户手机号搜索" [--format=ai|json|md] [--out=<path>]
  aafe context --diff[=<ref>] [--format=ai|json|md]
  aafe impact  --requirement="..." | --diff[=<ref>]  [--format=json|md]
  aafe plan    --requirement="..." [--dry-run]
  aafe run     "<task>"            Planner + Orchestrator full loop
  aafe run     "<task>" --agent=cursor [--model=<id>|--cursor-model=<id>] [--cursor-api-key-env=CURSOR_API_KEY] [--mcp-config=<path>] Execute via Cursor SDK
  aafe run     --list [--limit=20] List stored runs under <output>/runs/
  aafe run     --replay=<runId>    Read-only replay of a stored run, with node payloads
  aafe test    --requirement="..." | --diff[=<ref>] | --coverage | --pr=<url>  [--run] [--base-url=<url>] [--url-role=A|B|C] [--auth-mode=none|reuse|headed|auto|reuse-or-headed] [--update]
  aafe diagnose --failure=<report.json|log.txt> [--diff[=<ref>]]
  aafe task create --requirement="..." --repository=<url> [--base-branch=main] [--no-run]
  aafe task list | status <taskId> | continue <taskId> "<message>" | cancel <taskId> | recover
  aafe sdd create [--task-id=<id>|--requirement="..."] [--change=<id>] [--slug=<slug>]
  aafe sdd status|propose|spec|design|tasks|validate|approve|apply-context|trace|revisions|verify|sync|archive <taskId>
  aafe pipeline "<task>"           Legacy skill pipeline (alias: aafe run --legacy)
  --no-write                       Do not persist the run under <output>/runs/
  --no-ide-agent                   Do not hand unserved capabilities to the IDE agent
                                   (same as AAFE_IDE_AGENT=0 or ideAgent.enabled: false)
  Agent wiring lives in .aafe.agents.json (planner provider, per-agent contract, policies).
  Contracts (prompt + input/output schema) default to builtin:<agent-id> and may be
  overridden per agent; endpoint/model/prompt/schema fields expand \${ENV_VAR}.

Knowledge retrieval:
  aafe knowledge search "<query>" [--kind=module,route,symbol] [--limit=20] [--rebuild]
  aafe knowledge index             Rebuild and persist the retrieval index

Skills options:
  aafe skills list --github
  aafe skills install aafe-vue-complex-runtime --github
  --target=<skills-dir>
  --manifest-url=<url>
  --repo=<owner/repo>
  --branch=<branch>
  --dry-run
  --force

Config UI:
  aafe config              Start local visual config at http://127.0.0.1:4318/
  aafe ui                  Alias of aafe config
  --port=4318 --host=127.0.0.1 --no-open --background

Knowledge options:
  aafe knowledge init|update|sync
  aafe knowledge-web --serve
  --architecture-docs=<path>
  --knowledge-docs=<path>
  --dry-run

Update options:
  --dry-run
  --upgrade-package      Also upgrade the globally installed aafe package before refreshing project runtime
  --package-manager=npm|pnpm|yarn|bun
  --registry=<registry-url>
  --no-sync
  --sync-force
  --editors=cursor|codebuddy|cursor,codebuddy
  --submit-cli=git|gtm   Update .aafe.config.json submit.cli without full interactive prompts
  --workflow-mode=ask|autonomous  Update .aafe.config.json mode.workflow without full interactive prompts
  --agent-mode[=on|off]  Update .aafe.config.json agent.enabled
  --mcp-config=<path>    Update agent.mcp.config (Cursor mcp.json)
  --mcp-setting-sources=project,user  Update agent.mcp.settingSources
  --no-mcp               Disable agent.mcp.enabled
  --interactive          Allow interactive prompts during update (e.g. submit CLI / TAPD / E2E)
  --e2e / --no-e2e       Enable or disable Playwright E2E without full interactive prompts
  --install-playwright   Install playwright deps when enabling E2E
  --analyze / --force-analyze   Force-run aafe analyze after runtime refresh (default; overwrites facts and migrates leftover output)
  --no-analyze           Skip analyze during update
  --yes                  Accept defaults without prompting (force analyze stays on)
`);
}

async function readProjectConfig(root) {
  try {
    const raw = await readFile(path.join(root, '.aafe.config.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
