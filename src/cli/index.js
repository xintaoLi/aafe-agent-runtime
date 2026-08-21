import { bootstrapProject } from './bootstrap.js';
import { runAnalyzeCommand } from './analyze.js';
import { runDDDCommand } from './ddd.js';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';
import { runMemoryCommand } from './memory.js';
import { runKnowledgeCommand } from './knowledge.js';
import { runKnowledgeWebCommand } from './knowledgeWeb.js';
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
import {
  runContextCommand,
  runDiagnoseCommand,
  runImpactCommand,
  runPlanCommand,
  runPlatformRunCommand,
  runTestCommand
} from './platform.js';

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

  if (command === 'diagnose') {
    await runDiagnoseCommand(process.cwd(), argv.slice(3));
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
    const runtime = await createRuntimeFromProject(process.cwd(), { memory: options.memory });
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
    if (arg === '--migrate-cursor') options.migrateInstallEditors = true;
    if (arg === '--migrate-editors') options.migrateInstallEditors = true;
    if (arg === '--no-migrate-cursor') options.migrateInstallEditors = false;
    if (arg === '--no-migrate-editors') options.migrateInstallEditors = false;
    if (arg.startsWith('--submit-cli=')) options.submitCli = arg.slice('--submit-cli='.length);
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
  doctor    Validate installed runtime files
  sync      Refresh generated runtime files
  analyze   Generate architecture locator, .ai-agent/.docs AST analysis and on-demand skills
  memory    Manage project self-growing memory
  license   Local fast BlueKing license check/ensure/mark (no AI; do not Read memory file)
  knowledge  Initialize or update project Knowledge views in .docs
  knowledge-web  Generate or serve the Knowledge Web visualization
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
  diagnose  Turn a failing test report into a located root cause
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
  git (default): Git CLI + gh for PR
  gtm: gtm commit / gtm pr (project GTM config required; errors not forced)

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
  aafe run     --list [--limit=20] List stored runs under <output>/runs/
  aafe run     --replay=<runId>    Read-only replay of a stored run, with node payloads
  aafe test    --requirement="..." | --diff[=<ref>] | --coverage | --pr=<url>  [--run] [--base-url=<url>] [--url-role=A|B|C] [--auth-mode=none|reuse|headed|auto|reuse-or-headed] [--update]
  aafe diagnose --failure=<report.json|log.txt> [--diff[=<ref>]]
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
