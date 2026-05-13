import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function collectInitOptions(detection, options) {
  if (options.yes || options.nonInteractive) return options;
  const rl = createInterface({ input, output });
  try {
    const framework = await ask(rl, `Framework (${detection.framework || 'generic'}): `, detection.framework || 'generic');
    const scenarios = await ask(rl, `Scenarios comma-separated (${detection.scenarios.join(',') || 'complex'}): `, detection.scenarios.join(',') || 'complex');
    const editors = await ask(rl, `Editors comma-separated (${detection.editors.join(',') || 'cursor'}): `, detection.editors.join(',') || 'cursor');
    const memoryText = await ask(rl, 'Enable project memory? (Y/n): ', 'Y');
    const forceText = await ask(rl, 'Overwrite existing generated files? (y/N): ', 'N');
    return {
      ...options,
      framework,
      scenarios,
      editors,
      memory: !/^n/i.test(memoryText),
      force: /^y/i.test(forceText)
    };
  } finally {
    rl.close();
  }
}

async function ask(rl, question, fallback) {
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}
