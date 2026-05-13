import { analyzeDDD, buildDDDInterview } from '../ddd/DDDAdvisor.js';

export async function runDDDCommand(args) {
  const action = args[0] ?? 'help';
  const options = parseOptions(args.slice(1));
  const prompt = options.prompt || options.rest.join(' ');

  if (action === 'ask') {
    console.log(JSON.stringify({ questions: buildDDDInterview(prompt) }, null, 2));
    return;
  }

  if (action === 'analyze') {
    console.log(JSON.stringify(analyzeDDD({ prompt }), null, 2));
    return;
  }

  printHelp();
}

function parseOptions(args) {
  const options = { rest: [] };
  for (const arg of args) {
    if (arg.startsWith('--prompt=')) options.prompt = arg.slice('--prompt='.length);
    else options.rest.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`aafe ddd <command>

Commands:
  ask <feature>       Generate DDD discovery questions
  analyze <feature>   Infer bounded contexts, aggregates and domain model
`);
}
