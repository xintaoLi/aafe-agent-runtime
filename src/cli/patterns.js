import { analyzePatternFit, buildPatternInterview } from '../patterns/PatternAdvisor.js';

export async function runPatternCommand(args) {
  const action = args[0] ?? 'help';
  const options = parseOptions(args.slice(1));
  const prompt = options.prompt || options.rest.join(' ');

  if (action === 'ask') {
    console.log(JSON.stringify({ questions: buildPatternInterview(prompt) }, null, 2));
    return;
  }

  if (action === 'select') {
    const result = analyzePatternFit({
      prompt,
      constraints: {
        extensible: options.extensible,
        stateful: options.stateful,
        undoable: options.undoable,
        multiStep: options.multiStep
      }
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHelp();
}

function parseOptions(args) {
  const options = { rest: [] };
  for (const arg of args) {
    if (arg.startsWith('--prompt=')) options.prompt = arg.slice('--prompt='.length);
    else if (arg === '--extensible') options.extensible = true;
    else if (arg === '--stateful') options.stateful = true;
    else if (arg === '--undoable') options.undoable = true;
    else if (arg === '--multi-step') options.multiStep = true;
    else options.rest.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`aafe pattern <command>

Commands:
  ask <feature>       Generate design-pattern interview questions
  select <feature>    Recommend design patterns

Options:
  --extensible
  --stateful
  --undoable
  --multi-step
`);
}
