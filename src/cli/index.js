import { bootstrapProject } from './bootstrap.js';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';
import { runMemoryCommand } from './memory.js';
import { collectInitOptions } from './prompts.js';

export async function runCli(argv) {
  const command = argv[2] ?? 'help';
  const options = parseOptions(argv.slice(3));

  if (command === 'init') {
    const detection = await detectProject(process.cwd());
    const initOptions = await collectInitOptions(detection, options);
    await bootstrapProject(process.cwd(), detection, initOptions);
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

  if (command === 'memory') {
    await runMemoryCommand(process.cwd(), argv.slice(3));
    return;
  }

  printHelp();
}

function parseOptions(args) {
  const options = {
    yes: args.includes('--yes') || args.includes('-y'),
    force: args.includes('--force'),
    nonInteractive: args.includes('--non-interactive')
  };

  for (const arg of args) {
    if (arg.startsWith('--framework=')) options.framework = arg.slice('--framework='.length);
    if (arg.startsWith('--scenarios=')) options.scenarios = arg.slice('--scenarios='.length);
    if (arg.startsWith('--editors=')) options.editors = arg.slice('--editors='.length);
    if (arg === '--no-memory') options.memory = false;
    if (arg.startsWith('--template=')) options.template = arg.slice('--template='.length);
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
  memory    Manage project self-growing memory

Init options:
  --yes
  --framework=react|next|vue|monorepo|generic
  --scenarios=graph,admin,dashboard,workflow
  --editors=cursor,claude,codebuddy,codex,trace,windsurf,vscode
  --no-memory
  --force
`);
}
