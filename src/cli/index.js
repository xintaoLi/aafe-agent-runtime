import { bootstrapProject } from './bootstrap.js';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';
import { runMemoryCommand } from './memory.js';

export async function runCli(argv) {
  const command = argv[2] ?? 'help';
  const options = parseOptions(argv.slice(3));

  if (command === 'init') {
    const detection = await detectProject(process.cwd());
    await bootstrapProject(process.cwd(), detection, options);
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
    await bootstrapProject(process.cwd(), detection, { ...options, sync: true });
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
  return {
    yes: args.includes('--yes') || args.includes('-y'),
    force: args.includes('--force')
  };
}

function printHelp() {
  console.log(`aafe <command>

Commands:
  init      Initialize .ai-agent runtime and editor rules
  detect    Detect framework, editor and scenario
  doctor    Validate installed runtime files
  sync      Refresh generated runtime files
  memory    Manage project self-growing memory
`);
}
