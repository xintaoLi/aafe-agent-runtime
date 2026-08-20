import {
  analyzePatternComposition,
  analyzePatternProblems,
  analyzeModulePatternFit,
  auditAntiPatterns,
  buildPatternInterview
} from '../patterns/PatternAdvisor.js';
import { evaluatePatternGate } from '../patterns/PatternGate.js';
import { PATTERN_DOMAINS, PATTERN_INDEX } from '../patterns/catalog.js';
import { KnowledgeStore } from '../knowledge/store/KnowledgeStore.js';

export async function runPatternCommand(args) {
  const action = args[0] ?? 'help';
  const options = parseOptions(args.slice(1));
  const prompt = options.prompt || options.rest.join(' ');

  if (action === 'help') {
    printHelp();
    return;
  }

  if (action === 'catalog') {
    printCatalog(options);
    return;
  }

  if (!prompt) {
    console.error(`aafe pattern ${action} 需要一段需求描述`);
    process.exitCode = 1;
    return;
  }

  const decision = evaluatePatternGate(prompt);

  if (action === 'gate') {
    console.log(JSON.stringify(decision, null, 2));
    return;
  }

  if (action === 'ask') {
    console.log(JSON.stringify({ questions: buildPatternInterview(prompt) }, null, 2));
    return;
  }

  // The gate guards the commands that *propose* patterns. Without it,
  // `aafe pattern select "重构这个 adapter"` would happily invent a composition
  // for a request that never asked for one.
  //
  // `audit` is exempt: it only names problems in code that already exists and
  // never introduces an abstraction, so gating it adds friction without
  // protecting anything.
  const gated = action !== 'audit';
  if (gated && !decision.enabled && !options.force) {
    console.log(JSON.stringify({
      status: 'blocked',
      decision: decision.decision,
      reason: decision.reason,
      clarification: decision.clarification,
      hint: '设计模式能力是显式开启的。确认确实需要模式分析后，可加 --force 跳过门禁。'
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const knowledge = options.noEvidence ? null : new KnowledgeStore({ root: process.cwd() });

  if (action === 'discover') {
    console.log(JSON.stringify(await analyzePatternProblems({ prompt, knowledge }), null, 2));
    return;
  }

  if (action === 'select' || action === 'compose') {
    const analysis = await analyzePatternComposition({ prompt, knowledge });
    console.log(JSON.stringify(options.summary ? summarize(analysis) : analysis, null, 2));
    return;
  }

  if (action === 'modules') {
    console.log(JSON.stringify(await analyzeModulePatternFit({ prompt, knowledge }), null, 2));
    return;
  }

  if (action === 'audit') {
    console.log(JSON.stringify(await auditAntiPatterns({ prompt, knowledge }), null, 2));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

/** The composition without the scoring internals, for reading in a terminal. */
function summarize(analysis) {
  const { composition } = analysis;
  return {
    status: analysis.status,
    evidenceMode: analysis.evidenceMode,
    problems: composition.problem.map((problem) => problem.text),
    complexity: composition.complexity,
    patterns: composition.patterns.map((pattern) => ({
      pattern: pattern.name,
      responsibility: pattern.responsibility,
      score: pattern.score
    })),
    flows: composition.flows.map((flow) => flow.steps.join(' → ')),
    conflicts: composition.conflicts.map((conflict) => conflict.resolution),
    redundant: composition.redundantPatterns.map((entry) => entry.pattern),
    antiPatterns: analysis.antiPatterns.findings.map((finding) => `${finding.rule} ${finding.name}`),
    rationale: composition.rationale
  };
}

function printCatalog(options) {
  if (options.scorable) {
    console.log(JSON.stringify(PATTERN_INDEX.map((pattern) => ({
      id: pattern.id,
      name: pattern.name,
      domain: pattern.domain,
      role: pattern.role,
      problem: pattern.problem,
      justifiedAt: pattern.justifiedAt
    })), null, 2));
    return;
  }
  console.log(JSON.stringify(PATTERN_DOMAINS.map((domain) => ({
    id: domain.id,
    name: domain.name,
    patterns: domain.patterns,
    rules: domain.rules.map((rule) => rule.id)
  })), null, 2));
}

function parseOptions(args) {
  const options = { rest: [] };
  for (const arg of args) {
    if (arg.startsWith('--prompt=')) options.prompt = arg.slice('--prompt='.length);
    else if (arg === '--force') options.force = true;
    else if (arg === '--no-evidence') options.noEvidence = true;
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--scorable') options.scorable = true;
    else options.rest.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`aafe pattern <command> "<需求描述>"

设计模式能力是显式开启的：只有请求中明确表达设计模式诉求时才会激活。

Commands:
  gate <request>      判断是否应该启用设计模式能力（enabled / disabled / ambiguous）
  discover <request>  只做问题与变化点识别，不给出任何模式
  select <request>    识别问题 → 评分候选 → 组合，输出完整分析
  compose <request>   同 select
  modules <request>   按模块分别给出模式组合
  audit <request>     反模式审计
  ask <request>       生成选型前需要澄清的问题
  catalog             输出 16 个模式域与 304 个模式清单

Options:
  --summary           只输出结论，省略评分细节
  --force             绕过门禁（仅在确认需要模式分析时使用）
  --no-evidence       不读取 .aafe 项目分析结果
  --scorable          catalog 只输出可评分模式及其元数据
`);
}
