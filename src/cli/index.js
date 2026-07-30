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
import { collectInitOptions } from './prompts.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runUpdateCommand } from './update.js';
import { createRuntimeFromProject } from '../runtime/configLoader.js';
import { resolveWorkspaceLayout } from './workspace.js';

export async function runCli(argv) {
  const command = argv[2] ?? 'help';
  const options = parseOptions(argv.slice(3));

  if (command === 'init') {
    const installRoot = process.cwd();
    const detection = await detectProject(installRoot);
    const layout = await resolveWorkspaceLayout(installRoot, detection.editors);
    const existingConfig = await readProjectConfig(installRoot);
    const initOptions = await collectInitOptions(detection, { ...options, existingConfig }, layout);
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

  if (command === 'run' || command === 'execute') {
    const prompt = parsePrompt(argv.slice(3));
    if (!prompt) {
      throw new Error('Missing prompt. Usage: aafe run "<frontend task>"');
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
  analyze   Generate architecture locator, Knowledge Center memory and project architecture skills
  memory    Manage project self-growing memory
  knowledge  Initialize or update project Knowledge views in .docs
  knowledge-web  Generate or serve the Knowledge Web visualization
  task-completion  Run automatic post-task Knowledge update, Runtime update and doctor
  skills    List or install downloadable AAFE Agent Skills from GitHub
  pattern   Interview and select design patterns for features
  ddd       Analyze domain-driven design model for business features
  run       Execute the architecture runtime pipeline for a task
  update    Refresh installed project .ai-agent capabilities from the current aafe package

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

TAPD (init/update interactive):
  When prompted, answer Y/Yes/是 to configure TAPD commit/submit backfill in .aafe.config.json

Analyze options:
  --dry-run
  --no-write
  --max-files=<number>
  --max-entries=<number>
  --architecture-docs=<path>  Architecture docs directory, defaults to .docs

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
