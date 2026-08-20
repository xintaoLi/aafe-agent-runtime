import { analyzeDDD, buildDDDInterview } from '../ddd/DDDAdvisor.js';
import { evaluateDDDGate } from '../ddd/DDDGate.js';
import { resolveDDDScope } from '../ddd/DDDScope.js';
import { KnowledgeStore } from '../knowledge/store/KnowledgeStore.js';

export async function runDDDCommand(args) {
  const action = args[0] ?? 'help';
  const options = parseOptions(args.slice(1));
  const prompt = options.prompt || options.rest.join(' ');

  if (action === 'gate') {
    console.log(JSON.stringify(evaluateDDDGate(prompt), null, 2));
    return;
  }

  if (action === 'scope') {
    console.log(JSON.stringify(resolveDDDScope(prompt, { includeOptional: options.all }), null, 2));
    return;
  }

  if (action === 'ask') {
    console.log(JSON.stringify({ questions: buildDDDInterview(prompt) }, null, 2));
    return;
  }

  if (action === 'analyze') {
    // The gate guards the CLI too. Answering a non-DDD question with a domain
    // model is the exact failure mode DDD-SYSTEM-003 exists to prevent.
    const gate = evaluateDDDGate(prompt);
    if (!gate.enabled && !options.force) {
      console.log(JSON.stringify({
        enabled: false,
        decision: gate.decision,
        reason: gate.reason,
        clarification: gate.clarification,
        hint: 'State DDD intent explicitly, or pass --force to analyze anyway'
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const knowledge = options.noEvidence ? null : new KnowledgeStore({ root: process.cwd() });
    const model = await analyzeDDD({ prompt, knowledge });
    console.log(JSON.stringify({ gate, scope: resolveDDDScope(prompt, { gate }), model }, null, 2));
    return;
  }

  printHelp();
}

function parseOptions(args) {
  const options = { rest: [], all: false, force: false, noEvidence: false };
  for (const arg of args) {
    if (arg.startsWith('--prompt=')) options.prompt = arg.slice('--prompt='.length);
    else if (arg === '--all') options.all = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--no-evidence') options.noEvidence = true;
    else options.rest.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`aafe ddd <command> <request>

DDD is opt-in. Skills only run when the request states DDD intent explicitly;
DDD terminology in the codebase never activates them.

Commands:
  gate <request>      Decide whether DDD is enabled (enabled|disabled|ambiguous)
  scope <request>     Show the minimum DDD skill set and rule loading order
  ask <request>       Generate DDD discovery questions
  analyze <request>   Build a domain model, marking each concept observed or inferred

Options:
  --prompt=<text>     Pass the request as a flag instead of positional words
  --all               Include optional skills when resolving scope
  --force             Run analyze even when the gate says DDD is not enabled
  --no-evidence       Skip project knowledge and infer from the request alone
`);
}
