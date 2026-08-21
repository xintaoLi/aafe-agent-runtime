import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentRegistry, createRegistryFromConfig } from '../src/agent-platform/registry/AgentRegistry.js';
import { createAgentDefinition } from '../src/agent-platform/registry/definition.js';
import { defaultAgentsConfig, resolveAgentsConfig } from '../src/agent-platform/config/agentsConfig.js';
import { ExecutionGraph } from '../src/agent-platform/orchestrator/ExecutionGraph.js';
import { AgentOrchestrator } from '../src/agent-platform/orchestrator/AgentOrchestrator.js';
import { RulePlanner } from '../src/agent-platform/planner/RulePlanner.js';
import { LlmPlanner } from '../src/agent-platform/planner/LlmPlanner.js';
import { normalizeDecision } from '../src/agent-platform/planner/decision.js';
import { createTask } from '../src/agent-platform/protocol/request.js';
import { agentSkipped, agentSuccess, normalizeAgentResponse } from '../src/agent-platform/protocol/response.js';
import { LocalAgentProvider } from '../src/agent-platform/runtime/providers/LocalAgentProvider.js';
import { parseJsonLoose } from '../src/llm/LlmClient.js';
import { KnowledgeStore } from '../src/knowledge/store/KnowledgeStore.js';
import { buildModuleGraph, propagateImpact } from '../src/knowledge/graph/relations.js';
import { deriveRisk } from '../src/knowledge/model/index.js';
import { validateFlowTraceable, validateHasEvidence } from '../src/knowledge/validator/rules.js';
import { ImpactAnalyzerAgent } from '../src/agents/impact-analyzer/index.js';
import { KnowledgeValidatorAgent } from '../src/agents/knowledge-validator/index.js';
import { ContextAgent } from '../src/agents/context-agent/index.js';
import { TestAgent } from '../src/agents/test-agent/index.js';
import { expandSynonyms, scoreOverlap, tokenize } from '../src/agents/impact-analyzer/tokenize.js';
import { estimateTokens } from '../src/ide-bridge/context/tokens.js';
import { renderContextPackage } from '../src/ide-bridge/context/render.js';
import { evaluateDDDGate } from '../src/ddd/DDDGate.js';
import { resolveDDDScope, DDD_RULE_ORDER, DDD_SKILL_ORDER } from '../src/ddd/DDDScope.js';
import { analyzeDDD } from '../src/ddd/DDDAdvisor.js';
import { evaluatePatternGate } from '../src/patterns/PatternGate.js';
import { composePatterns } from '../src/patterns/PatternComposer.js';
import { detectProblems, assessComplexity } from '../src/patterns/PatternProblems.js';
import { scoreAll, isJustified } from '../src/patterns/PatternScore.js';
import { detectAntiPatterns, ANTI_PATTERN_CATALOG, ANTI_PATTERN_RULES } from '../src/patterns/AntiPatternDetector.js';
import { PATTERN_DOMAINS, PATTERN_INDEX, PATTERN_BY_ID } from '../src/patterns/catalog.js';
import { patternRuntimeFiles } from '../src/cli/patternRuntimeFiles.js';
import { planMigrations, relocate, runMigrations } from '../src/cli/migrate.js';
import { taskCompletionHookScript } from '../src/cli/hookScripts.js';
import { createDefaultRuntime, defaultGates, defaultPipelines, defaultSkills } from '../src/agent-platform/skill-runtime/defaults.js';
import { dddRuntimeFiles } from '../src/cli/dddRuntimeFiles.js';
import { validateSchema, formatSchemaErrors } from '../src/agent-platform/schema/validate.js';
import { coerceAndValidate } from '../src/agent-platform/schema/repair.js';
import { ContractLoader } from '../src/agent-platform/schema/loader.js';
import { AgentRuntime } from '../src/agent-platform/runtime/AgentRuntime.js';
import { ExecutionPolicy, FORBIDDEN_COMMAND_PATTERNS } from '../src/agent-platform/policy/ExecutionPolicy.js';
import { listRuns, replayRun } from '../src/agent-platform/state/RunStore.js';
import { expandEnvRefs } from '../src/agent-platform/config/agentsConfig.js';
import { renderImpactMarkdown } from '../src/knowledge/report/impactMarkdown.js';
import { ModuleResolver, extractBundlerAliases } from '../src/static-analysis/resolve/ModuleResolver.js';
import { AnalysisCache } from '../src/static-analysis/cache/AnalysisCache.js';
import { KnowledgeIndex, openKnowledgeIndex } from '../src/knowledge/search/KnowledgeIndex.js';

// --- capability resolution ---------------------------------------------------
const registry = createRegistryFromConfig(defaultAgentsConfig().agents);
assert.equal(registry.resolveCapability('requirement-impact').agent.id, 'impact-analyzer');
assert.equal(registry.resolveCapability('context-packaging').agent.id, 'context-agent');
assert.equal(registry.resolveCapability('test-planning').agent.id, 'test-agent');
assert.equal(registry.resolveCapability('failure-analysis').agent.id, 'failure-analyzer');
assert.match(registry.resolveCapability('nope').reason, /no-agent-provides-capability/);
assert.equal(registry.hasCapability('knowledge-validation'), true);

// A disabled agent must be distinguishable from a nonexistent one, otherwise a
// planner keeps proposing something that will never be served.
const disabledRegistry = createRegistryFromConfig({
  ...defaultAgentsConfig().agents,
  'test-agent': { ...defaultAgentsConfig().agents['test-agent'], enabled: false }
});
assert.equal(disabledRegistry.resolveCapability('test-planning').agent, null);
assert.match(disabledRegistry.resolveCapability('test-planning').reason, /capability-disabled/);

const capabilityList = registry.capabilityList();
assert.ok(capabilityList.every((entry) => Array.isArray(entry.capabilities)));
assert.equal(capabilityList.find((entry) => entry.id === 'impact-analyzer').unavailableReason, null);
assert.ok(registry.servableCapabilities().includes('requirement-impact'));

// A replacement agent takes over a capability without any planner change.
const swapped = new AgentRegistry();
swapped.register(createAgentDefinition('impact-analyzer', { enabled: false }));
swapped.register(createAgentDefinition('impact-analyzer-v2', {
  capabilities: ['requirement-impact'],
  enabled: true,
  provider: 'local'
}));
assert.equal(swapped.resolveCapability('requirement-impact').agent.id, 'impact-analyzer-v2');

// --- agents config -----------------------------------------------------------
const deprecated = resolveAgentsConfig({}, { analyze: { llm: { agents: { testing: true, architecture: true } } } });
assert.equal(deprecated.config.agents['test-agent'].enabled, true);
assert.match(deprecated.warnings.join(' '), /analyze\.llm\.agents is deprecated/);

const badPlanner = resolveAgentsConfig({ planner: { provider: 'magic' } }, {});
assert.equal(badPlanner.config.planner.provider, 'rule');
assert.match(badPlanner.warnings.join(' '), /unknown planner\.provider/);

const llmNoEndpoint = resolveAgentsConfig({ planner: { provider: 'llm' } }, {});
assert.match(llmNoEndpoint.warnings.join(' '), /endpoint is not set/);

// Endpoints and keys belong in the environment, not in a committed config file.
assert.equal(expandEnvRefs('https://${AAFE_HOST}/v1', { AAFE_HOST: 'api.test' }), 'https://api.test/v1');
assert.equal(expandEnvRefs('https://${MISSING}/v1', {}), 'https://${MISSING}/v1');
const envConfig = resolveAgentsConfig(
  { agents: { 'code-intelligence': { provider: 'http', endpoint: 'https://${AAFE_TEST_HOST}/agent' } } },
  {},
  { env: { AAFE_TEST_HOST: 'agents.internal' } }
);
assert.equal(envConfig.config.agents['code-intelligence'].endpoint, 'https://agents.internal/agent');
const envMissing = resolveAgentsConfig(
  { agents: { 'code-intelligence': { provider: 'http', endpoint: '${AAFE_ABSENT}' } } },
  {},
  { env: {} }
);
assert.equal(envMissing.config.agents['code-intelligence'].endpoint, null);
assert.match(envMissing.warnings.join(' '), /environment variable that is not set/);

// --- schema validation, coercion and contracts -------------------------------
const personSchema = {
  type: 'object',
  required: ['name', 'tags'],
  properties: {
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    level: { type: 'integer', minimum: 0 }
  }
};
assert.equal(validateSchema({ name: 'a', tags: ['x'] }, personSchema).valid, true);
assert.equal(validateSchema({ name: 'a' }, personSchema).valid, false);
assert.match(formatSchemaErrors(validateSchema({ name: 1, tags: [] }, personSchema).errors), /\/name/);
// An absent optional property is not the same as a present invalid one.
assert.equal(validateSchema({ name: 'a', tags: [], level: undefined }, personSchema).valid, true);

// if/then/else drives the capability-dependent agent outputs.
const conditional = {
  type: 'object',
  properties: { mode: { type: 'string' } },
  if: { properties: { mode: { const: 'diff' } }, required: ['mode'] },
  then: { required: ['diffRef'] },
  else: { required: ['requirement'] }
};
assert.equal(validateSchema({ mode: 'diff', diffRef: 'HEAD' }, conditional).valid, true);
assert.equal(validateSchema({ mode: 'diff' }, conditional).valid, false);
assert.equal(validateSchema({ requirement: 'x' }, conditional).valid, true);

// Deterministic coercion first, so a formatting slip costs no model round trip.
const coerced = coerceAndValidate({ name: 'a', tags: 'x', level: '3' }, personSchema);
assert.equal(coerced.valid, true);
assert.deepEqual(coerced.value.tags, ['x']);
assert.equal(coerced.value.level, 3);
assert.ok(coerced.repairs.length > 0);
assert.equal(coerceAndValidate('{"name":"a","tags":[]}', personSchema).valid, true);
assert.equal(coerceAndValidate({ tags: [] }, personSchema).valid, false);

// Every builtin agent ships the prompt+input+output triple it is validated against.
const contracts = new ContractLoader();
for (const agentId of ['planner', 'code-intelligence', 'impact-analyzer', 'test-agent', 'failure-analyzer', 'knowledge-validator', 'context-agent']) {
  const loaded = await contracts.contractsFor(createAgentDefinition(agentId));
  assert.ok(loaded.prompt && loaded.prompt.length > 200, `${agentId} prompt is missing`);
  assert.ok(loaded.inputSchema, `${agentId} input schema is missing`);
  assert.ok(loaded.outputSchema, `${agentId} output schema is missing`);
}
assert.deepEqual(contracts.warnings, []);

// --- agent runtime -----------------------------------------------------------
const remoteDefinition = createAgentDefinition('impact-analyzer', {
  provider: 'http',
  endpoint: 'https://example.invalid/agent',
  schemaMode: 'enforce'
});
const impactRequest = {
  taskId: 't', runId: 'r', capability: 'requirement-impact', goal: 'g',
  input: { requirement: 'g' }, constraints: {}
};

const offContract = await new AgentRuntime({
  providers: { http: { invoke: async () => ({ status: 'success', result: { nope: true } }) } }
}).invoke(remoteDefinition, impactRequest);
assert.equal(offContract.status, 'failed');
assert.match(offContract.reason, /output-schema-violation/);
assert.equal(offContract.contract.input, 'ok');

// The agent is handed its own prompt and schemas, so a remote implementation
// never has to ship a copy of the contract it must satisfy.
let seenRequest = null;
const goodImpact = {
  source: 'requirement',
  affectedFiles: [], affectedModules: [], affectedFeatures: [], affectedDataFlows: [], affectedTests: [],
  risk: 'low', confidence: 0.5
};
const onContract = await new AgentRuntime({
  providers: {
    http: {
      invoke: async (_definition, request) => {
        seenRequest = request;
        return { status: 'success', result: goodImpact };
      }
    }
  }
}).invoke(remoteDefinition, impactRequest);
assert.equal(onContract.status, 'success');
assert.equal(onContract.contract.output, 'ok');
assert.ok(seenRequest.contract.prompt.length > 200);
assert.equal(seenRequest.agent.endpoint, 'https://example.invalid/agent');

// warn mode keeps the payload but never reports it as a clean success.
const warned = await new AgentRuntime({
  providers: { http: { invoke: async () => ({ status: 'success', result: { nope: true } }) } }
}).invoke(
  createAgentDefinition('impact-analyzer', { provider: 'http', endpoint: 'https://x', schemaMode: 'warn' }),
  impactRequest
);
assert.equal(warned.status, 'partial');
assert.match(warned.reason, /output-schema-violation/);

// A repairable answer is repaired rather than failed.
let repairAttempt = 0;
const repaired = await new AgentRuntime({
  providers: {
    http: {
      invoke: async () => {
        repairAttempt += 1;
        return repairAttempt === 1
          ? { status: 'success', result: { ...goodImpact, risk: 'nonsense' } }
          : { status: 'success', result: goodImpact };
      }
    }
  }
}).invoke(remoteDefinition, impactRequest);
assert.equal(repaired.status, 'success');
assert.match(repaired.contract.output, /ok-after-repair/);

// Evidence that points at nothing is dropped, not carried into the context.
const evidenceChecked = await new AgentRuntime({
  providers: {
    http: {
      invoke: async () => ({
        status: 'success',
        result: goodImpact,
        evidence: [{ type: 'ast', file: 'src/a.js' }, { nonsense: true }]
      })
    }
  }
}).invoke(remoteDefinition, impactRequest);
assert.equal(evidenceChecked.evidence.length, 1);
assert.match(evidenceChecked.contract.evidence, /dropped 1/);

// --- execution policy --------------------------------------------------------
const policy = new ExecutionPolicy({ maxTokens: 100, maxCost: 0.5, allowNetwork: false });
assert.equal(policy.assertWithinBudget({ tokens: 50, cost: 0.1 }), null);
assert.match(policy.assertWithinBudget({ tokens: 500 }), /token-budget-exhausted/);
assert.match(policy.assertWithinBudget({ cost: 5 }), /cost-budget-exhausted/);
assert.match(
  policy.assertProviderAllowed({ id: 'x', provider: 'http' }),
  /network-disabled-for-http-agent/
);
assert.match(
  policy.assertNotDestructive({ id: 'x', provider: 'cli', ref: 'rm -rf {{root}}' }),
  /destructive-operation-denied/
);
assert.match(
  policy.assertNotDestructive({ id: 'x', provider: 'cli', ref: 'git push origin main' }),
  /destructive-operation-denied/
);
assert.equal(policy.assertNotDestructive({ id: 'x', provider: 'cli', ref: 'npx vitest run' }), null);
assert.ok(FORBIDDEN_COMMAND_PATTERNS.length > 0);
// A per-agent override may tighten the run policy but never widen it.
assert.equal(new ExecutionPolicy({ maxParallel: 2 }).maxParallel, 2);

// --- impact markdown ---------------------------------------------------------
const markdown = renderImpactMarkdown(
  { goal: '增加用户手机号搜索', kind: 'requirement' },
  {
    source: 'requirement',
    affectedModules: [{ id: 'user', label: 'user', score: 0.9, why: 'lexical match', evidence: [{ type: 'ast', file: 'src/user/a.js', startLine: 3 }] }],
    affectedFiles: [], affectedFeatures: [], affectedDataFlows: [], affectedBusinessFlows: [],
    affectedTests: [], risk: 'medium', confidence: 0.62
  }
);
assert.match(markdown, /^# 影响分析/);
assert.match(markdown, /风险：中/);
assert.match(markdown, /63%|62%/);
assert.match(markdown, /src\/user\/a\.js:3/);
assert.match(markdown, /预测基线/);

// --- module resolution: tsconfig paths and bundler aliases -------------------
const aliasRepo = await mkdtemp(path.join(tmpdir(), 'aafe-alias-'));
try {
  const writeFixtureFile = async (relative, content) => {
    const file = path.join(aliasRepo, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  };

  // tsconfig files carry comments and trailing commas in practice.
  await writeFixtureFile('tsconfig.json', `{
    // project paths
    "compilerOptions": {
      "baseUrl": ".",
      "paths": { "@/*": ["src/*"], "~utils": ["src/lib/utils.ts"] },
    },
  }`);
  await writeFixtureFile('webpack.config.js',
    'module.exports = { resolve: { alias: { "$assets": path.resolve(__dirname, "src/assets"), "@c": "./src/components" } } };');
  await writeFixtureFile('src/components/Button.jsx', 'export default 1;');
  await writeFixtureFile('src/lib/utils.ts', 'export const a = 1;');
  await writeFixtureFile('src/assets/logo.js', 'export default 2;');
  await writeFixtureFile('src/babel/core.js', 'export default 3;');

  const resolver = await new ModuleResolver(aliasRepo).load();
  assert.deepEqual(resolver.sources, ['tsconfig.json', 'webpack.config.js']);
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '@/components/Button'), 'src/components/Button.jsx');
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '~utils'), 'src/lib/utils.ts');
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '$assets/logo'), 'src/assets/logo.js');
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '@c/Button'), 'src/components/Button.jsx');
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '../components/Button'), 'src/components/Button.jsx');
  // baseUrl-relative imports are what TypeScript allows and bundlers mirror.
  assert.equal(await resolver.resolve('src/pages/Home.jsx', 'src/lib/utils'), 'src/lib/utils.ts');
  assert.equal(await resolver.resolve('src/pages/Home.jsx', 'react'), null);
  // `@/*` matches only at a path boundary: `@babel/core` is a package even
  // though `src/babel/core.js` happens to exist.
  assert.equal(await resolver.resolve('src/pages/Home.jsx', '@babel/core'), null);
  assert.equal(await resolver.resolve('src/pages/Home.jsx', 'node:fs'), null);
  assert.equal(resolver.isInternal('@/components/Button'), true);
  assert.equal(resolver.isInternal('react'), false);

  // A repo with no alias config still resolves relative imports.
  const bare = await new ModuleResolver(aliasRepo, { exists: async () => false }).load();
  assert.equal(await bare.resolve('src/a.js', './b'), null);
} finally {
  await rm(aliasRepo, { recursive: true, force: true });
}

// Commas inside `path.resolve(__dirname, 'src')` must not split the entry.
assert.deepEqual(
  extractBundlerAliases('resolve:{alias:{"@":path.resolve(__dirname, "src"),"@ui":"./src/ui"}}'),
  [{ prefix: '@', target: 'src' }, { prefix: '@ui', target: 'src/ui' }]
);
assert.deepEqual(extractBundlerAliases('module.exports = {}'), []);

// --- cross-run extraction cache ----------------------------------------------
const cacheRepo = await mkdtemp(path.join(tmpdir(), 'aafe-cache-'));
try {
  const cold = new AnalysisCache({ root: cacheRepo, extractorVersion: '1.0.0' });
  await cold.load();
  assert.equal(cold.get('src/a.js', 'hash-a'), null);
  cold.set('src/a.js', 'hash-a', { imports: ['./b'] });
  cold.set('src/b.js', 'hash-b', { imports: [] });
  await cold.save();

  const warm = new AnalysisCache({ root: cacheRepo, extractorVersion: '1.0.0' });
  await warm.load();
  assert.deepEqual(warm.get('src/a.js', 'hash-a'), { imports: ['./b'] });
  // Content, not mtime: an edit changes the hash and only that entry misses.
  assert.equal(warm.get('src/a.js', 'hash-a-modified'), null);
  assert.equal(warm.stats.hits, 1);
  assert.equal(warm.stats.misses, 1);

  // A file this run never looked at must not resurrect on the next one.
  await warm.save();
  const pruned = new AnalysisCache({ root: cacheRepo, extractorVersion: '1.0.0' });
  await pruned.load();
  assert.equal(pruned.get('src/b.js', 'hash-b'), null, 'untouched entries are pruned on save');

  // An extractor change invalidates everything: a stale entry would silently
  // reintroduce facts the current code would never produce.
  const upgraded = new AnalysisCache({ root: cacheRepo, extractorVersion: '2.0.0' });
  await upgraded.load();
  assert.equal(upgraded.get('src/a.js', 'hash-a'), null);

  const disabled = new AnalysisCache({ root: cacheRepo, enabled: false });
  await disabled.load();
  disabled.set('src/a.js', 'hash-a', { imports: [] });
  assert.equal(disabled.get('src/a.js', 'hash-a'), null);
  assert.equal(await disabled.save(), null);
} finally {
  await rm(cacheRepo, { recursive: true, force: true });
}

// --- execution graph state machine -------------------------------------------
const graph = new ExecutionGraph();
const id = graph.reserveNodeId();
assert.equal(id, 'N1');
const node = graph.addNode({ id, agent: 'a', capability: 'c', inputRef: 'ref' });
assert.equal(node.status, 'pending');
graph.transition(node.id, 'running');
graph.transition(node.id, 'success', { outputRef: 'out' });
assert.equal(graph.get('N1').outputRef, 'out');
assert.throws(() => graph.transition('N1', 'running'), /Illegal execution node transition/);
assert.throws(() => graph.transition('N99', 'running'), /Unknown execution node/);
assert.deepEqual(graph.summary(), { pending: 0, running: 0, success: 1, failed: 0, skipped: 0 });

const depGraph = new ExecutionGraph();
const first = depGraph.addNode({ agent: 'a', capability: 'c1', inputRef: 'r' });
depGraph.addNode({ agent: 'b', capability: 'c2', inputRef: 'r', dependencies: [first.id] });
assert.deepEqual(depGraph.ready().map((item) => item.id), [first.id]);
depGraph.transition(first.id, 'running');
depGraph.transition(first.id, 'success');
assert.equal(depGraph.ready().length, 1);

// --- response protocol -------------------------------------------------------
assert.equal(normalizeAgentResponse(null).status, 'failed');
assert.equal(normalizeAgentResponse({ status: 'weird' }).status, 'failed');
assert.equal(normalizeAgentResponse({ status: 'success', result: 1 }).result, 1);
assert.deepEqual(
  normalizeAgentResponse({ status: 'success', nextActions: [{ capability: 'x' }, { reason: 'no capability' }] }).nextActions,
  [{ capability: 'x', reason: '' }]
);

// --- planner terminates ------------------------------------------------------
const fakeKnowledge = { staleness: async () => ({ stale: false, reason: 'fresh' }) };

async function drivePlanner(planner, kind, respond) {
  const task = createTask({ kind, goal: 'g', requirement: 'r' });
  const state = new (await import('../src/agent-platform/state/ExecutionState.js')).ExecutionState({
    task, runId: 'test', root: '.'
  });
  const localGraph = new ExecutionGraph();
  const actions = [];
  for (let step = 0; step < 50; step += 1) {
    const decision = await planner.decide({
      task,
      state,
      graph: localGraph,
      registry,
      knowledge: fakeKnowledge,
      capabilities: registry.capabilityMap(),
      constraints: {}
    });
    actions.push(decision.action === 'invoke_agent' ? decision.capability : decision.action);
    if (['complete', 'fail', 'need_user_input'].includes(decision.action)) return actions;
    const capability = decision.capability;
    const responseNode = localGraph.addNode({ agent: 'x', capability, inputRef: 'r' });
    localGraph.transition(responseNode.id, 'running');
    localGraph.transition(responseNode.id, 'success');
    state.record(responseNode, respond(capability));
  }
  throw new Error('planner did not terminate');
}

const requirementTrace = await drivePlanner(new RulePlanner(), 'requirement', () => agentSuccess({}));
assert.deepEqual(requirementTrace, ['requirement-impact', 'knowledge-validation', 'context-packaging', 'complete']);

const diffTrace = await drivePlanner(new RulePlanner(), 'diff', () => agentSuccess({}));
assert.deepEqual(diffTrace, ['change-impact', 'knowledge-validation', 'context-packaging', 'complete']);

// Unavailable capabilities degrade to need_user_input instead of looping.
const failureTrace = await drivePlanner(new RulePlanner(), 'failure', () => agentSkipped('agent-not-implemented'));
assert.equal(failureTrace.at(-1), 'need_user_input');

// Agent suggestions are consumed but bounded.
const suggesting = new RulePlanner({ maxSuggestions: 1 });
const suggestTrace = await drivePlanner(suggesting, 'requirement', (capability) =>
  agentSuccess({}, { nextActions: [{ capability: 'risk-analysis', reason: `after ${capability}` }] }));
assert.ok(suggestTrace.includes('risk-analysis'));
assert.equal(suggestTrace.at(-1), 'complete');

// A planner that keeps proposing the same capability still terminates.
const stubborn = { maxSteps: 12, decide: async () => ({ action: 'invoke_agent', capability: 'requirement-impact', reason: 'loop' }) };
const loopTrace = await drivePlanner({
  maxSteps: 12,
  decide: async (ctx) => (ctx.state.step >= 5 ? { action: 'fail', reason: 'guard' } : stubborn.decide(ctx))
}, 'requirement', () => agentSuccess({}));
assert.equal(loopTrace.at(-1), 'fail');

// --- llm planner falls back --------------------------------------------------
const unusableClient = { isConfigured: () => false, unavailableReason: () => 'llm-endpoint-missing' };
const llmPlanner = new LlmPlanner(unusableClient, { fallback: new RulePlanner() });
const llmTrace = await drivePlanner(llmPlanner, 'requirement', () => agentSuccess({}));
assert.deepEqual(llmTrace, ['requirement-impact', 'knowledge-validation', 'context-packaging', 'complete']);
assert.ok(llmPlanner.fallbackReasons.every((reason) => reason === 'llm-endpoint-missing'));

const badJsonClient = {
  isConfigured: () => true,
  unavailableReason: () => null,
  chatJson: async () => ({ status: 'success', data: { action: 'invoke_agent', capability: 'not-a-capability' } })
};
const contractPlanner = new LlmPlanner(badJsonClient, { fallback: new RulePlanner() });
const contractTrace = await drivePlanner(contractPlanner, 'requirement', () => agentSuccess({}));
assert.equal(contractTrace.at(-1), 'complete');
assert.ok(contractPlanner.fallbackReasons.includes('llm-decision-out-of-contract'));

assert.equal(normalizeDecision({ action: 'complete', reason: 'done' }).action, 'complete');
assert.equal(normalizeDecision({ action: 'nope' }), null);
assert.equal(normalizeDecision({ action: 'invoke_agent' }), null);
assert.equal(normalizeDecision({ action: 'parallel', tasks: [] }), null);
assert.deepEqual(parseJsonLoose('prefix ```json\n{"a":1}\n``` suffix'), { a: 1 });
assert.equal(parseJsonLoose('not json'), null);

// --- tokenizer and scoring ---------------------------------------------------
const query = expandSynonyms(tokenize('增加用户手机号搜索'));
assert.ok(query.has('user'));
assert.ok(query.has('phone'));
assert.ok(query.has('search'));
assert.ok(!tokenize('the and for').has('the'));
assert.ok(tokenize('UserPhoneList').has('phone'));
assert.equal(scoreOverlap(new Set(), new Set(['a'])).score, 0);
assert.ok(scoreOverlap(new Set(['phone']), new Set(['phonenumber'])).score > 0);

// --- risk derivation ---------------------------------------------------------
assert.equal(deriveRisk({ moduleCount: 1, fileCount: 1 }), 'low');
assert.equal(deriveRisk({ moduleCount: 3, fileCount: 10 }), 'medium');
assert.equal(deriveRisk({ moduleCount: 6, fileCount: 30, architectureRisks: 2 }), 'high');

// --- reverse dependency propagation -----------------------------------------
const relationGraph = buildModuleGraph([
  { from: 'module:app', to: 'module:ui' },
  { from: 'module:ui', to: 'module:core' },
  { from: 'module:core', to: 'module:core' }
]);
const reached = propagateImpact(relationGraph, ['core']);
assert.equal(reached.get('core').distance, 0);
assert.equal(reached.get('ui').distance, 1);
assert.equal(reached.get('app').distance, 2);
assert.ok(reached.get('app').score < reached.get('ui').score);
assert.equal(propagateImpact(relationGraph, ['core'], { maxDepth: 1 }).has('app'), false);

// --- validator rules ---------------------------------------------------------
assert.equal(validateHasEvidence('feature', { id: 'f', evidence: [] }).verdict, 'downgrade');
assert.equal(validateHasEvidence('feature', { id: 'f', evidence: [{ file: 'a.js' }] }).verdict, 'ok');
assert.equal(validateFlowTraceable({ id: 'x', nodes: ['a/b.js'] }, new Set(['a/b.js'])).verdict, 'ok');
assert.equal(validateFlowTraceable({ id: 'x', nodes: ['gone.js'] }, new Set()).verdict, 'downgrade');
assert.equal(validateFlowTraceable({ id: 'x', nodes: ['a/gone.js'] }, new Set(['a/b.js'])).verdict, 'reject');

// --- token estimation and context budget -------------------------------------
assert.ok(estimateTokens('中文中文中文') > estimateTokens('abcdef'));
assert.equal(estimateTokens(''), 0);

const bigImpact = {
  source: 'requirement',
  affectedFiles: Array.from({ length: 400 }, (_, i) => ({ id: `src/file-${i}.js`, label: `src/file-${i}.js`, score: 0.5, why: 'match', evidence: [] })),
  affectedModules: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, label: `m${i}`, score: 0.9, why: 'seed', evidence: [] })),
  affectedFeatures: [],
  affectedDataFlows: [],
  affectedBusinessFlows: [],
  affectedTests: [],
  risk: 'high',
  confidence: 0.8
};
const budgeted = await new ContextAgent().run({
  capability: 'context-packaging',
  constraints: { tokenBudget: 900 },
  context: { task: { kind: 'requirement', goal: 'g' }, priorResults: { 'requirement-impact': { result: bigImpact } } }
});
assert.equal(budgeted.status, 'partial');
assert.ok(budgeted.result.truncated.length > 0);
assert.ok(budgeted.result.affectedFiles.length < bigImpact.affectedFiles.length);
assert.ok(budgeted.result.tokenEstimate <= 900 * 1.2);

const unbudgeted = await new ContextAgent().run({
  capability: 'context-packaging',
  constraints: { tokenBudget: 100000 },
  context: { task: { kind: 'requirement', goal: 'g' }, priorResults: { 'requirement-impact': { result: bigImpact } } }
});
assert.equal(unbudgeted.status, 'success');
assert.deepEqual(unbudgeted.result.truncated, []);

const noImpact = await new ContextAgent().run({ capability: 'context-packaging', context: {} });
assert.equal(noImpact.status, 'skipped');
assert.equal(noImpact.nextActions[0].capability, 'requirement-impact');

// Facts, relations and snippets: the package must carry what the IDE agent
// would otherwise spend its first turns re-deriving.
const snippetRepo = await mkdtemp(path.join(tmpdir(), 'aafe-snippet-'));
try {
  await mkdir(path.join(snippetRepo, 'src'), { recursive: true });
  await writeFile(
    path.join(snippetRepo, 'src/target.js'),
    ['/*', ' * license banner', ' */', '', 'export function target() {', '  return 42;', '}', ''].join('\n'),
    'utf8'
  );

  const packaged = await new ContextAgent().run({
    capability: 'context-packaging',
    constraints: { tokenBudget: 100000 },
    context: {
      root: snippetRepo,
      task: { kind: 'requirement', goal: 'g' },
      priorResults: {
        'requirement-impact': {
          result: {
            source: 'requirement',
            affectedFiles: [{ id: 'src/target.js', label: 'src/target.js', score: 0.9, why: 'match', evidence: [] }],
            affectedModules: [{
              id: 'core', label: 'core', score: 0.9, why: 'seed',
              evidence: [{ type: 'ast', file: 'src/target.js', reason: 'declares target' }]
            }],
            affectedFeatures: [], affectedDataFlows: [], affectedBusinessFlows: [],
            affectedTests: [], risk: 'medium', confidence: 0.7
          }
        }
      }
    }
  });

  assert.equal(packaged.status, 'success');
  assert.ok(packaged.result.facts.some((fact) => fact.kind === 'impact-source'));
  assert.ok(packaged.result.relations.some((relation) => relation.type === 'module-contains'));

  const snippet = packaged.result.codeSnippets.find((item) => item.path === 'src/target.js');
  assert.ok(snippet, 'the cited file should be included as a snippet');
  // Anchoring at line 1 would spend the budget showing the license banner.
  assert.match(snippet.content, /export function target/);
  assert.ok(!snippet.content.includes('license banner'));
  assert.match(renderContextPackage(packaged.result, 'ai'), /Code — src\/target\.js/);

  const noCode = await new ContextAgent().run({
    capability: 'context-packaging',
    input: { includeCode: false },
    constraints: { tokenBudget: 100000 },
    context: {
      root: snippetRepo,
      task: { kind: 'requirement', goal: 'g' },
      priorResults: { 'requirement-impact': { result: bigImpact } }
    }
  });
  assert.deepEqual(noCode.result.codeSnippets, []);

  // Snippets are the first thing dropped when the budget bites.
  const squeezed = await new ContextAgent().run({
    capability: 'context-packaging',
    constraints: { tokenBudget: 400 },
    context: {
      root: snippetRepo,
      task: { kind: 'requirement', goal: 'g' },
      priorResults: {
        'requirement-impact': { result: { ...bigImpact, affectedModules: packaged.result.affectedModules } }
      }
    }
  });
  assert.deepEqual(squeezed.result.codeSnippets, []);
  assert.ok(squeezed.result.truncated.some((entry) => entry.startsWith('codeSnippets')));
} finally {
  await rm(snippetRepo, { recursive: true, force: true });
}

// --- renderers ---------------------------------------------------------------
for (const format of ['ai', 'json', 'md']) {
  const rendered = renderContextPackage(unbudgeted.result, format);
  assert.ok(rendered.length > 0, `${format} render is empty`);
}
assert.match(renderContextPackage(unbudgeted.result, 'ai'), /AAFE Task Context/);
assert.match(renderContextPackage(unbudgeted.result, 'md'), /^# AAFE Task Context/);
assert.deepEqual(JSON.parse(renderContextPackage(unbudgeted.result, 'json')).risk, 'high');

// --- test agent scoping ------------------------------------------------------
// Test planning without an impact report is a missing precondition, not a
// failure: the agent says what it needs instead of inventing a scope.
const testNoScope = await new TestAgent().run({ capability: 'test-planning', context: {} });
assert.equal(testNoScope.status, 'skipped');
assert.equal(testNoScope.nextActions[0].capability, 'requirement-impact');

const testPlan = await new TestAgent().run({
  capability: 'test-planning',
  context: { task: { kind: 'requirement', goal: 'g' }, priorResults: { 'requirement-impact': { result: bigImpact } } }
});
assert.ok(['success', 'partial'].includes(testPlan.status));
assert.ok(Array.isArray(testPlan.result.scenarios));

// Running the project's suite is a side effect the caller must opt into.
const testRunDenied = await new TestAgent().run({
  capability: 'e2e-execution',
  constraints: { allowTestExecution: false },
  context: { task: { kind: 'test', goal: 'g' }, priorResults: { 'requirement-impact': { result: bigImpact } } }
});
assert.equal(testRunDenied.status, 'skipped');

// --- impact on a fixture repository -----------------------------------------
const fixture = await mkdtemp(path.join(tmpdir(), 'aafe-fixture-'));
try {
  await writeFixture(fixture);
  const knowledge = new KnowledgeStore({ root: fixture, output: '.aafe' });
  assert.equal(await knowledge.exists(), true);
  assert.deepEqual((await knowledge.staleness()).stale, false);
  assert.equal(await knowledge.findModuleByFile('src/user/UserList.jsx'), 'user');
  assert.equal(await knowledge.findModuleByFile('src/user/NewFile.jsx'), 'user');
  assert.equal(await knowledge.findModuleByFile('bklog/web/src/user/UserList.jsx'), 'user');
  assert.equal(await knowledge.findModuleByFile('nope/x.js'), null);

  const impact = await new ImpactAnalyzerAgent({ knowledge }).run({
    capability: 'requirement-impact',
    input: { requirement: '增加用户手机号搜索' },
    context: { root: fixture, knowledge, task: { kind: 'requirement' } }
  });
  assert.equal(impact.status, 'success');
  const moduleIds = impact.result.affectedModules.map((item) => item.id);
  assert.ok(moduleIds.includes('user'), `expected the user module, got ${moduleIds.join(',')}`);
  assert.ok(moduleIds.includes('app'), 'the dependent app module should be reached by propagation');
  assert.ok(!moduleIds.includes('billing'), 'unrelated modules must not be reported');
  assert.ok(impact.result.affectedModules.every((item) => Array.isArray(item.evidence)));
  assert.ok(impact.nextActions.some((action) => action.capability === 'knowledge-validation'));

  // Seeds now come from the search index, so its scoring has to land inside the
  // range the output schema allows. An unbounded score also saturated
  // confidence, making every requirement report claim certainty.
  for (const list of [impact.result.affectedModules, impact.result.affectedFiles, impact.result.affectedFeatures]) {
    assert.ok(list.every((item) => item.score >= 0 && item.score <= 1), 'impact scores must stay inside [0,1]');
  }
  assert.ok(impact.result.confidence > 0 && impact.result.confidence < 1, `confidence must discriminate, got ${impact.result.confidence}`);
  assert.ok(
    impact.result.affectedModules.every((item) => typeof item.why === 'string' && item.why.length > 0),
    'every module must say why it was reached'
  );

  // The feature list keeps its analyzer-assigned confidence weighting.
  assert.ok(impact.result.affectedFeatures.some((item) => item.id === 'feature:user-search'));

  const unrelated = await new ImpactAnalyzerAgent({ knowledge }).run({
    capability: 'requirement-impact',
    input: { requirement: 'zzzz qqqq wwww' },
    context: { root: fixture, knowledge, task: { kind: 'requirement' } }
  });
  assert.equal(unrelated.status, 'partial');

  // --- orchestrator over the fixture ----------------------------------------
  const orchestrator = new AgentOrchestrator({
    registry,
    planner: new RulePlanner(),
    providers: {
      local: new LocalAgentProvider({
        'code-intelligence': { run: async () => agentSuccess({ source: 'stub' }) },
        'impact-analyzer': new ImpactAnalyzerAgent({ knowledge }),
        'knowledge-validator': new KnowledgeValidatorAgent({ knowledge }),
        'context-agent': new ContextAgent({ knowledge })
      })
    },
    root: fixture,
    write: false,
    knowledge
  });
  const run = await orchestrator.execute(createTask({
    kind: 'requirement',
    goal: '增加用户手机号搜索',
    requirement: '增加用户手机号搜索'
  }));
  assert.equal(run.status, 'complete');
  assert.ok(run.contextPackage);
  assert.ok(run.contextPackage.tokenEstimate > 0);
  // Fixture knowledge is fresh, so the planner skips project-analysis entirely.
  assert.deepEqual(run.nodes.map((item) => item.capability),
    ['requirement-impact', 'knowledge-validation', 'context-packaging']);
  assert.ok(run.nodes.every((item) => item.status === 'success'));
  assert.ok(run.nodes.every((item) => item.inputRef.startsWith('memory://')), 'write:false must not touch disk');

  // A failing agent surfaces as a failed run rather than an exception.
  const failing = new AgentOrchestrator({
    registry,
    planner: new RulePlanner(),
    providers: { local: new LocalAgentProvider({}) },
    root: fixture,
    write: false,
    knowledge
  });
  const failedRun = await failing.execute(createTask({ kind: 'requirement', goal: 'x', requirement: 'x' }));
  assert.equal(failedRun.status, 'failed');
  assert.ok(failedRun.nodes.every((item) => item.status === 'failed'));

  // --- dependency-ordered parallel execution ---------------------------------
  const order = [];
  const traced = (id, delay) => ({
    run: async () => {
      order.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(`end:${id}`);
      return agentSuccess({ id });
    }
  });
  const dagRegistry = new AgentRegistry();
  for (const [id, capability] of [['a', 'cap-a'], ['b', 'cap-b'], ['c', 'cap-c']]) {
    dagRegistry.register(createAgentDefinition(id, { capabilities: [capability], enabled: true, provider: 'local' }));
  }
  const dagOrchestrator = new AgentOrchestrator({
    registry: dagRegistry,
    // The planner asks for three capabilities at once, but declares that
    // `cap-c` reads what `cap-a` produced.
    planner: {
      maxSteps: 8,
      decide: async (ctx) => (ctx.state.step > 0
        ? { action: 'complete', reason: 'done' }
        : {
          action: 'parallel',
          reason: 'fan out',
          tasks: [
            { capability: 'cap-a', input: null },
            { capability: 'cap-b', input: null },
            { capability: 'cap-c', input: null, dependsOn: ['cap-a'] }
          ]
        })
    },
    providers: { local: new LocalAgentProvider({ a: traced('a', 30), b: traced('b', 1), c: traced('c', 1) }) },
    policies: { maxParallel: 4 },
    root: fixture,
    write: false
  });
  const dagRun = await dagOrchestrator.execute(createTask({ kind: 'requirement', goal: 'g', requirement: 'g' }));
  assert.equal(dagRun.status, 'complete');
  assert.ok(dagRun.nodes.every((item) => item.status === 'success'));
  assert.ok(order.indexOf('end:a') < order.indexOf('start:c'), `c must wait for a: ${order.join(' ')}`);
  assert.ok(order.indexOf('start:b') < order.indexOf('end:a'), `b must not wait for a: ${order.join(' ')}`);

  // A dependency that never succeeds skips its dependents instead of hanging.
  const brokenDag = new AgentOrchestrator({
    registry: dagRegistry,
    planner: {
      maxSteps: 6,
      decide: async (ctx) => (ctx.state.step > 0
        ? { action: 'complete', reason: 'done' }
        : {
          action: 'parallel',
          reason: 'fan out',
          tasks: [
            { capability: 'cap-a', input: null },
            { capability: 'cap-c', input: null, dependsOn: ['cap-a'] }
          ]
        })
    },
    providers: { local: new LocalAgentProvider({ a: { run: async () => agentSkipped('nope') }, c: traced('c2', 1) }) },
    root: fixture,
    write: false
  });
  const brokenRun = await brokenDag.execute(createTask({ kind: 'requirement', goal: 'g', requirement: 'g' }));
  const skippedC = brokenRun.nodes.find((item) => item.capability === 'cap-c');
  assert.equal(skippedC.status, 'skipped');
  assert.match(skippedC.reason, /dependency-not-satisfied/);

  // --- cancellation ----------------------------------------------------------
  const abort = new AbortController();
  const cancellable = new AgentOrchestrator({
    registry: dagRegistry,
    planner: { maxSteps: 5, decide: async () => ({ action: 'invoke_agent', capability: 'cap-a', reason: 'again' }) },
    providers: {
      local: new LocalAgentProvider({
        a: { run: async () => { abort.abort(); return agentSuccess({}); } }
      })
    },
    root: fixture,
    write: false
  });
  const cancelled = await cancellable.execute(
    createTask({ kind: 'requirement', goal: 'g', requirement: 'g' }),
    { signal: abort.signal }
  );
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.nodes.length, 1, 'no further agent may start after the abort');

  // --- run-wide budget -------------------------------------------------------
  const budgetOrchestrator = new AgentOrchestrator({
    registry: dagRegistry,
    planner: { maxSteps: 5, decide: async () => ({ action: 'invoke_agent', capability: 'cap-a', reason: 'spend' }) },
    providers: {
      local: new LocalAgentProvider({
        a: { run: async () => agentSuccess({}, { metrics: { tokens: 900 } }) }
      })
    },
    policies: { maxTokens: 1000 },
    root: fixture,
    write: false
  });
  const overspent = await budgetOrchestrator.execute(createTask({ kind: 'requirement', goal: 'g', requirement: 'g' }));
  assert.equal(overspent.status, 'failed');
  assert.match(overspent.reason, /token-budget-exhausted/);
  assert.equal(overspent.metrics.tokens, 1800, 'the check runs between steps, not mid-call');

  // --- knowledge write-back --------------------------------------------------
  const written = await knowledge.applyKnowledgeUpdates([
    { op: 'upsert', kind: 'feature', id: 'feature:learned', name: 'learned', evidence: [{ type: 'ast', file: 'src/user/UserList.jsx' }] },
    { op: 'upsert', kind: 'feature', id: 'feature:groundless', name: 'groundless', evidence: [] },
    { op: 'drop', kind: 'feature', id: 'feature:wrong', name: 'wrong', reason: 'file does not exist' },
    { id: '', op: 'upsert' }
  ], { runId: 'test-run', write: true });
  assert.equal(written.applied, 3);
  assert.equal(written.skipped, 1);
  assert.equal(written.upserted, 1);
  assert.equal(written.downgraded, 1, 'a claim with no evidence must not be stored as validated');
  assert.equal(written.dropped, 1);

  const storedItems = await knowledge.agentKnowledge();
  assert.ok(storedItems.some((item) => item.id === 'feature:learned' && item.validated === true));
  assert.ok(storedItems.some((item) => item.id === 'feature:groundless' && item.validated === false));

  // The next run must be able to see what was already thrown out.
  const verdicts = await knowledge.knowledgeVerdicts();
  assert.ok(verdicts.rejected.has('feature:wrong'));
  assert.ok(verdicts.weak.has('feature:groundless'));

  // --- run store list / replay ----------------------------------------------
  const persisted = new AgentOrchestrator({
    registry,
    planner: new RulePlanner(),
    providers: {
      local: new LocalAgentProvider({
        'impact-analyzer': new ImpactAnalyzerAgent({ knowledge }),
        'knowledge-validator': new KnowledgeValidatorAgent({ knowledge }),
        'context-agent': new ContextAgent({ knowledge })
      })
    },
    root: fixture,
    write: true,
    knowledge
  });
  const storedRun = await persisted.execute(createTask({
    kind: 'requirement', goal: '增加用户手机号搜索', requirement: '增加用户手机号搜索'
  }));
  assert.equal(storedRun.status, 'complete');

  const runs = await listRuns(fixture, '.aafe');
  assert.ok(runs.some((entry) => entry.runId === storedRun.runId));
  assert.equal(runs[0].status, 'complete');

  // --- knowledge retrieval index --------------------------------------------
  const searchIndex = await new KnowledgeIndex({ root: fixture, output: '.aafe' }).build(knowledge);
  assert.ok(searchIndex.size > 0);

  const byPath = searchIndex.search('UserList');
  assert.ok(byPath.some((hit) => hit.id === 'component:user:UserList'));
  assert.ok(byPath.every((hit) => hit.score > 0));

  // A path and a camel-cased symbol are the same answer to the same question.
  assert.ok(searchIndex.search('user phone search').some((hit) => hit.file === 'src/user/userPhoneSearch.js'));
  assert.ok(searchIndex.search('billing', { kinds: ['module'] }).every((hit) => hit.kind === 'module'));
  assert.deepEqual(searchIndex.search('zzzzqqqq'), []);
  assert.equal(searchIndex.search('user', { limit: 2 }).length, 2);

  const indexRef = await searchIndex.save();
  assert.match(indexRef, /search\.json$/);
  const reloaded = new KnowledgeIndex({ root: fixture, output: '.aafe' });
  assert.equal(await reloaded.load(), true);
  assert.equal(reloaded.size, searchIndex.size);
  assert.deepEqual(reloaded.search('UserList'), searchIndex.search('UserList'));

  // The store is the way agents reach it, and it caches the index per instance.
  const viaStore = await knowledge.search('UserList');
  assert.ok(viaStore.length > 0);
  assert.equal((await knowledge.searchIndex()) === (await knowledge.searchIndex()), true);

  // Scores feed ImpactItem.score, whose schema caps them at 1. A kind weight
  // summed per matched term used to push them past 4.
  const spread = searchIndex.search('user phone search list billing invoice app', { limit: 500 });
  assert.ok(spread.length > 0);
  assert.ok(spread.every((hit) => hit.score >= 0 && hit.score <= 1), 'index scores must stay inside [0,1]');
  assert.equal(searchIndex.search('user', { minScore: 0.9 }).every((hit) => hit.score >= 0.9), true);

  // A long Chinese requirement emits far more recall bigrams than real terms.
  // Counting those bigrams as full query terms drove coverage — and the whole
  // impact report — to zero.
  const cjk = searchIndex.search('增加用户手机号搜索');
  assert.ok(cjk.some((hit) => hit.module === 'user'), `CJK query must reach the user module, got ${cjk.map((hit) => hit.id).join(',')}`);

  // Exact postings alone miss run-together identifiers.
  assert.ok(searchIndex.search('user').some((hit) => hit.id === 'file:src/user/userPhoneSearch.js'));
  assert.ok(searchIndex.search('phone').some((hit) => hit.label === 'src/user/userPhoneSearch.js'));

  // The module entry carries its routes and components, so a module is
  // reachable by vocabulary its id never mentions.
  assert.ok(searchIndex.search('Invoice', { kinds: ['module'] }).some((hit) => hit.id === 'module:billing'));

  // Symbol hits resolve their owning module at build time.
  const symbolHit = searchIndex.search('searchByPhone', { kinds: ['symbol'] })[0];
  assert.equal(symbolHit?.kind, 'symbol');
  assert.equal(symbolHit?.module, 'user');

  // An index older than the analysis it describes points agents at code that
  // has moved, so it must lose to a rebuild.
  const future = new Date(Date.now() + 60_000);
  await utimes(path.join(fixture, '.aafe/modules/index.json'), future, future);
  assert.equal(await new KnowledgeIndex({ root: fixture, output: '.aafe' }).load(), false, 'a stale index must not load');
  const past = new Date(Date.now() - 60_000);
  await utimes(path.join(fixture, '.aafe/modules/index.json'), past, past);
  assert.equal(await new KnowledgeIndex({ root: fixture, output: '.aafe' }).load(), true);

  // Older on-disk formats are rebuilt rather than misread.
  await writeFile(
    path.join(fixture, '.aafe/knowledge/index/json/search.json'),
    JSON.stringify({ version: 1, entries: [{ id: 'x', kind: 'module' }], postings: { x: [0] } }),
    'utf8'
  );
  assert.equal(await new KnowledgeIndex({ root: fixture, output: '.aafe' }).load(), false);
  const healed = await openKnowledgeIndex(knowledge, { root: fixture, output: '.aafe' });
  assert.ok(healed.size > 1, 'openKnowledgeIndex must rebuild past a version mismatch');
  await searchIndex.save();

  const replayed = await replayRun(fixture, '.aafe', storedRun.runId);
  assert.equal(replayed.run.runId, storedRun.runId);
  assert.equal(replayed.nodes.length, storedRun.nodes.length);
  assert.ok(replayed.nodes.every((node) => node.output !== null), 'every node payload must be recoverable');
  assert.ok(replayed.contextPackage.tokenEstimate > 0);
  assert.equal(await replayRun(fixture, '.aafe', 'no-such-run'), null);

  // --- DDD enablement gate -------------------------------------------------
  // The property under test is that DDD stays off by default. Every string
  // below is either a DDD.md activation example or one of its explicit
  // non-activation signals.
  for (const request of [
    '用 DDD 重构这个项目', '按照 DDD 设计这个模块', '给当前项目做 DDD 建模',
    '建立 Bounded Context', '设计 Aggregate', '进行领域驱动设计',
    '帮我按照 DDD 分析这个项目的 Repository 层', 'Domain Model 设计',
    '领域模型重构', 'aggregate design for orders', '划分限界上下文'
  ]) {
    assert.equal(evaluateDDDGate(request).decision, 'enabled', `must enable DDD: ${request}`);
  }

  for (const request of [
    '分析这个项目架构', '帮我重构这个 Service', '分析 Repository', '设计微服务架构',
    '优化代码结构', '帮我分析这个项目的 Repository 层', 'Entity 设计',
    'Clean Architecture 分析', 'Repository 模式', '优化聚合查询性能',
    '模块拆分', '性能优化', '修复登录报错', '设计一个 API'
  ]) {
    assert.equal(evaluateDDDGate(request).decision, 'disabled', `must not enable DDD: ${request}`);
  }

  for (const request of ['帮我做领域建模', 'domain modeling for this app']) {
    const decision = evaluateDDDGate(request);
    assert.equal(decision.decision, 'ambiguous', `must ask rather than guess: ${request}`);
    assert.ok(decision.clarification, 'an ambiguous gate decision must carry a question to ask');
  }

  // DDD vocabulary in the request is recorded but must not sway the decision.
  const terminologyOnly = evaluateDDDGate('帮我分析这个项目的 Repository 层和 Entity 设计');
  assert.equal(terminologyOnly.enabled, false);
  assert.ok(terminologyOnly.signals.ignoredTerminology.length > 0, 'gate must record the terminology it ignored');

  assert.equal(evaluateDDDGate('分析当前项目并完整落地 DDD').scope, 'full');
  assert.equal(evaluateDDDGate('设计 Aggregate').scope, 'partial');

  // --- DDD scope: minimum required skill set --------------------------------
  const aggregateScope = resolveDDDScope('设计 Aggregate');
  assert.deepEqual(aggregateScope.skills, [
    'ddd-gate', 'ddd-project-discovery', 'ddd-domain-discovery', 'ddd-tactical-design', 'ddd-aggregate'
  ]);
  for (const skill of ['ddd-refactoring', 'ddd-documentation', 'ddd-context-map']) {
    assert.ok(aggregateScope.skipped.includes(skill), `${skill} must not activate for a narrow aggregate request`);
  }
  // Rules load lazily, so a tactical request must not drag in refactoring or
  // validation rules.
  assert.deepEqual(aggregateScope.rules, ['ddd-gate', 'ddd-scope', 'ddd-strategic-rules', 'ddd-tactical-rules']);

  const fullScope = resolveDDDScope('分析当前项目并完整落地 DDD');
  assert.equal(fullScope.skills.length, DDD_SKILL_ORDER.length, 'a full request activates every skill');
  assert.deepEqual(fullScope.rules, [...DDD_RULE_ORDER]);
  assert.deepEqual(fullScope.skills, [...DDD_SKILL_ORDER], 'skills must be emitted in the mandated order');

  const deniedScope = resolveDDDScope('帮我分析这个项目的 Repository 层');
  assert.deepEqual(deniedScope.skills, [], 'the termination rule forbids any skill after a disabled gate');
  assert.deepEqual(deniedScope.rules, [], 'no DDD rule may load after a disabled gate');

  // --- Evidence-driven advisor ---------------------------------------------
  const promptOnly = await analyzeDDD({ prompt: '按 DDD 设计订单与支付的聚合' });
  assert.equal(promptOnly.evidenceBased, false);
  assert.equal(promptOnly.observedCount, 0);
  assert.ok(promptOnly.inferredCount > 0);
  assert.equal(promptOnly.status, 'warn', 'a model with no project evidence must not report pass');
  assert.ok(
    promptOnly.boundedContexts.every((concept) => concept.kind === 'inferred' && concept.confidence < 0.5),
    'concepts guessed from wording must be marked inferred and low confidence'
  );

  const grounded = await analyzeDDD({ prompt: 'user search by phone', knowledge });
  assert.ok(grounded.observedCount > 0, 'the advisor must read the analyzed project');
  assert.equal(grounded.evidenceBased, true);
  const observed = grounded.ubiquitousLanguage.filter((concept) => concept.kind === 'observed');
  assert.ok(observed.length > 0, 'features discovered by analysis become observed vocabulary');
  assert.ok(observed.every((concept) => concept.confidence >= 0.5));
  assert.ok(
    grounded.boundedContexts.every((concept) => Array.isArray(concept.evidence)),
    'every context must carry an evidence array, even when empty'
  );
  // Analysis debris must not be presented as business vocabulary.
  assert.ok(
    grounded.ubiquitousLanguage.every((concept) => !/[$`{}]|\.spec|\.test/.test(concept.name)),
    'template-literal and test-file fragments must be filtered out of the ubiquitous language'
  );

  // --- Routing and pipeline -------------------------------------------------
  const runtime = createDefaultRuntime({ root: fixture, memory: false, knowledge });

  assert.equal(runtime.classify('帮我重构这个 Service 的 Repository 层'), 'refactor',
    'a repository refactor must not be rerouted into domain modelling');
  assert.equal(runtime.classify('修复登录报错'), 'bugfix');
  assert.equal(runtime.classify('用 DDD 重构这个项目的订单模块'), 'domainFeature',
    'explicit DDD intent must outrank the generic refactor keyword');
  assert.equal(runtime.classify('设计 Aggregate:订单聚合'), 'domainFeature');

  assert.ok(
    !defaultPipelines.feature.steps.some((step) => String(step.skill ?? '').startsWith('ddd-')),
    'the generic feature pipeline must not run DDD skills'
  );

  const narrowRun = await runtime.execute({ prompt: '按 DDD 设计订单聚合' });
  assert.equal(narrowRun.results['ddd-gate'].status, 'pass');
  assert.equal(narrowRun.results.ddd_enablement_gate.status, 'pass');
  assert.equal(narrowRun.results.ddd_gate.status, 'pass');
  assert.equal(narrowRun.results.merge_gate.status, 'pass', 'a narrow DDD scope must still reach the merge gate');
  assert.equal(narrowRun.results['ddd-aggregate'].artifacts.skipped, undefined, 'the requested skill must run');
  for (const skill of ['ddd-context-map', 'ddd-refactoring', 'ddd-documentation']) {
    assert.equal(narrowRun.results[skill].artifacts.skipped, skill, `${skill} must self-skip when out of scope`);
  }

  // Reaching the pipeline without DDD intent halts at the gate.
  const haltedRun = await runtime.executor.execute(defaultPipelines['domain-feature'], {
    request: { prompt: '帮我分析这个项目的 Repository 层' }
  });
  assert.equal(haltedRun.results['ddd-gate'].status, 'fail');
  assert.equal(haltedRun.results['ddd-scope'], undefined, 'nothing may run after the gate refuses');
  assert.equal(haltedRun.results['ddd-domain-discovery'], undefined);

  // Pipelines written before the DDD.md rework still resolve.
  for (const legacy of ['ddd-discovery', 'bounded-context-mapper', 'aggregate-designer', 'domain-event-designer', 'ddd-implementation-planner']) {
    assert.ok(defaultSkills[legacy], `legacy skill id ${legacy} must stay resolvable`);
  }

  // --- Generated ddd/ tree --------------------------------------------------
  const dddFiles = dddRuntimeFiles('.ai-agent');
  assert.equal(Object.keys(dddFiles).length, 39, 'the pack is 1 SKILL + 8 rules + 15 skills + 15 schemas');
  for (const skill of DDD_SKILL_ORDER) {
    assert.ok(dddFiles[`.ai-agent/ddd/skills/${skill}/SKILL.md`], `missing SKILL.md for ${skill}`);
  }
  for (const rule of DDD_RULE_ORDER) {
    assert.ok(dddFiles[`.ai-agent/ddd/rules/${rule}.md`], `missing rule file for ${rule}`);
  }
  for (const [name, content] of Object.entries(dddFiles)) {
    if (name.endsWith('.schema.json')) JSON.parse(content);
  }
  assert.match(dddFiles['.ai-agent/ddd/SKILL.md'], /DDD is opt-in/);
  assert.match(dddFiles['.ai-agent/ddd/rules/ddd-gate.md'], /MUST NOT activate DDD/);

  // --- Frontend pattern enablement gate --------------------------------------
  for (const request of [
    '用设计模式优化这个编辑器', '前端设计模式分析', '优化模式组合',
    'design patterns for this app', 'pattern refactoring',
    '用 Strategy Pattern 重构计价', '这里适合用策略模式吗', '检查有没有反模式'
  ]) {
    assert.equal(evaluatePatternGate(request).decision, 'enabled', `pattern gate must enable: ${request}`);
  }

  // The whole point of the gate: pattern vocabulary in a maintenance request is
  // not a request for pattern analysis.
  for (const request of [
    '重构这个 adapter', '给这个 service 加个 factory', '把 observer 换成 store',
    '写一个 strategy 函数', '这个 command 有 bug',
    '普通代码重构', '性能优化', '组件开发', '状态管理怎么做', 'React 开发规范'
  ]) {
    assert.equal(evaluatePatternGate(request).decision, 'disabled', `pattern gate must stay closed: ${request}`);
  }

  for (const request of ['架构设计怎么做', '代码结构最佳实践']) {
    const decision = evaluatePatternGate(request);
    assert.equal(decision.decision, 'ambiguous', `pattern gate must ask: ${request}`);
    assert.ok(decision.clarification, 'an ambiguous decision must carry a question');
  }

  assert.equal(evaluatePatternGate('系统性梳理前端设计模式').scope, 'full');
  assert.equal(evaluatePatternGate('用设计模式优化这个编辑器').scope, 'partial');
  assert.ok(
    evaluatePatternGate('重构这个 adapter').signals.ignoredTerminology.length > 0,
    'the gate must record the pattern vocabulary it deliberately ignored'
  );

  // --- Composition, not selection --------------------------------------------
  const editor = composePatterns({
    prompt: '做一个复杂前端编辑器：不同编辑模式、复杂状态流转、撤销重做、插件扩展、大量节点渲染卡顿'
  });
  assert.ok(editor.patterns.length >= 5, 'a multi-problem request must produce a composition, not one pattern');
  assert.ok(editor.relations.length > 0, 'a composition must be a graph, not a list');
  for (const pattern of editor.patterns) {
    assert.ok(pattern.responsibility, `RULE-003: ${pattern.id} must have an explicit responsibility`);
    assert.ok(pattern.evidence.length > 0, `${pattern.id} must carry evidence`);
  }
  const editorIds = editor.patterns.map((pattern) => pattern.id);
  for (const expected of ['state-machine', 'command', 'registry', 'virtualization']) {
    assert.ok(editorIds.includes(expected), `editor composition should include ${expected}`);
  }

  // §12's worked example: the six patterns the spec names for an orderComposition module.
  const orderComposition = composePatterns({
    prompt: '订单管理：多种计价规则、审批状态流转、用户操作需要审计、数据访问散落、对接第三方支付、需要统一入口'
  });
  const orderCompositionIds = orderComposition.patterns.map((pattern) => pattern.id);
  for (const expected of ['state-machine', 'strategy', 'command', 'repository', 'adapter', 'facade']) {
    assert.ok(orderCompositionIds.includes(expected), `orderComposition composition should include ${expected}`);
  }

  // PATTERN-SYSTEM-002: no pattern is a valid answer.
  const trivial = composePatterns({ prompt: '给设置页加一个开关，保存到接口' });
  assert.equal(trivial.patterns.length, 0, 'a trivial request must not receive patterns');
  assert.equal(trivial.complexity, 'none');
  assert.match(trivial.rationale.join(' '), /PATTERN-SYSTEM-002/);

  // RULE-009 and RULE-010: overlapping responsibility is resolved and reported,
  // interchangeable alternatives are dropped rather than both shipped.
  assert.ok(
    orderComposition.conflicts.some((conflict) => conflict.between.includes('state-machine') && conflict.between.includes('reducer')),
    'State Machine and Reducer both own state transitions and must be reported as a conflict'
  );
  assert.ok(orderComposition.conflicts.every((conflict) => conflict.resolution), 'every conflict must be resolved explicitly');
  assert.ok(
    !orderCompositionIds.includes('reducer'),
    'the losing side of a responsibility conflict must not stay in the composition'
  );

  const debounced = composePatterns({ prompt: '搜索框输入太频繁了，请求打爆了' });
  assert.deepEqual(debounced.patterns.map((pattern) => pattern.id), ['debounce'],
    'a single problem must produce a single pattern, not a padded composition');
  assert.ok(
    debounced.redundantPatterns.some((entry) => entry.pattern === 'throttle'),
    'RULE-010: an interchangeable alternative must be reported as redundant'
  );

  // A pattern whose collaborator is missing is an incomplete design.
  const undoable = composePatterns({ prompt: '编辑器需要撤销重做，操作历史要能回放，状态流转复杂，插件可扩展' });
  const undoIds = undoable.patterns.map((pattern) => pattern.id);
  if (undoIds.includes('undo-redo')) {
    assert.ok(undoIds.includes('command'), 'Undo/Redo without Command is incomplete');
  }

  // --- Scoring ---------------------------------------------------------------
  const patternProblems = detectProblems('订单需要多种计价规则');
  assert.ok(patternProblems.some((problem) => problem.id === 'algorithm-variation'));
  const [strategyScore] = scoreAll({
    patterns: [PATTERN_BY_ID.get('strategy')],
    problems: patternProblems,
    complexity: assessComplexity(patternProblems)
  });
  assert.ok(strategyScore.score > 0, 'Strategy must score positively for a variation problem');
  assert.ok(strategyScore.breakdown.problemFit >= 2);
  assert.equal(strategyScore.breakdown.overengineeringRisk, 0);

  // The same pattern against an unrelated problem must be penalised, not ranked.
  const [strategyMisfit] = scoreAll({
    patterns: [PATTERN_BY_ID.get('cqrs')],
    problems: detectProblems('给设置页加一个开关'),
    complexity: 1
  });
  assert.ok(strategyMisfit.breakdown.overengineeringRisk > 0, 'CQRS on a trivial problem must carry over-engineering risk');
  assert.ok(!isJustified(strategyMisfit), 'an unjustified pattern must not clear the selection bar');

  // Benefits only count when the problem asks for them.
  const [virtualizationOffTopic] = scoreAll({
    patterns: [PATTERN_BY_ID.get('virtualization')],
    problems: detectProblems('审批状态流转很复杂'),
    complexity: 2
  });
  assert.equal(virtualizationOffTopic.breakdown.performanceBenefit, 0,
    'a performance benefit must not be credited to a non-performance problem');

  // --- Anti-patterns ---------------------------------------------------------
  const observedAntiPatterns = detectAntiPatterns({
    projectFacts: [{ text: '这个组件是个巨型组件，什么都干', evidence: ['src/Page.tsx'] }]
  });
  assert.ok(observedAntiPatterns.findings.some((finding) => finding.id === 'god-component' && finding.kind === 'observed'));
  assert.equal(observedAntiPatterns.findings.find((finding) => finding.id === 'god-component').severity, 'high',
    'project evidence outranks a passing mention');

  // The audit must apply to our own recommendation, not only to the project.
  const audited = detectAntiPatterns({ composition: orderComposition });
  assert.ok(
    audited.findings.some((finding) => finding.kind === 'predicted'),
    'ANTI-PATTERN-003/004 must be checked against the proposed composition'
  );
  assert.equal(ANTI_PATTERN_CATALOG.length, 25, 'the spec lists 25 anti-patterns');
  assert.equal(ANTI_PATTERN_RULES.length, 7);

  // --- Catalog ---------------------------------------------------------------
  assert.equal(PATTERN_DOMAINS.length, 16);
  assert.equal(PATTERN_DOMAINS.reduce((total, domain) => total + domain.patterns.length, 0), 304);
  const scorableDomains = new Set(PATTERN_INDEX.map((pattern) => pattern.domain));
  for (const domain of PATTERN_DOMAINS) {
    assert.ok(scorableDomains.has(domain.id), `${domain.id} has no scorable pattern`);
  }
  const patternIds = new Set(PATTERN_INDEX.map((pattern) => pattern.id));
  for (const pattern of PATTERN_INDEX) {
    for (const key of ['requires', 'conflictsWith', 'alternatives', 'flowsTo']) {
      for (const reference of pattern[key]) {
        assert.ok(patternIds.has(reference), `${pattern.id}.${key} references unknown pattern ${reference}`);
      }
    }
  }

  // --- Pattern routing and pipeline ------------------------------------------
  assert.equal(runtime.classify('用设计模式重构订单模块'), 'patternFeature');
  assert.equal(runtime.classify('重构这个 adapter'), 'refactor',
    'bare pattern vocabulary must not reroute into pattern analysis');
  assert.equal(runtime.classify('给这个 service 加个 factory'), 'feature');

  assert.ok(
    !defaultPipelines.feature.steps.some((step) => String(step.skill ?? '').startsWith('pattern-')),
    'the generic feature pipeline must not run pattern skills'
  );
  assert.ok(
    !defaultGates.architecture_gate.requires.includes('pattern_selection'),
    'architecture soundness must not depend on naming a design pattern'
  );

  const patternRun = await runtime.execute({
    prompt: '用设计模式重构订单模块：多种计价规则、审批状态流转、操作需要审计、对接第三方支付'
  });
  assert.equal(patternRun.results['pattern-gate'].status, 'pass');
  assert.equal(patternRun.results.pattern_enablement_gate.status, 'pass');
  assert.equal(patternRun.results.pattern_gate.status, 'pass');
  assert.equal(patternRun.results.merge_gate.status, 'pass');
  assert.ok(
    patternRun.results['pattern-discovery'].artifacts.pattern_problems.length > 0,
    'discovery must identify problems before selection names anything'
  );
  assert.ok(
    patternRun.results['pattern-selector'].artifacts.pattern_selection.length > 1,
    'the runtime must return a composition, not a single recommendation'
  );
  assert.equal(patternRun.results['pattern-validator'].artifacts.pattern_validation.unanswered.length, 0,
    'every identified problem must be covered or explicitly listed');

  // Reaching the pattern pipeline without pattern intent halts at the gate.
  const patternHalted = await runtime.executor.execute(defaultPipelines['pattern-feature'], {
    request: { prompt: '重构这个 adapter' }
  });
  assert.equal(patternHalted.results['pattern-gate'].status, 'fail');
  assert.equal(patternHalted.results['pattern-discovery'], undefined, 'nothing may run after the gate refuses');

  // A project that upgraded the package but has not run `aafe update` still has
  // the pre-gate pipeline and gates on disk. Skipped pattern skills keep
  // publishing the old artifact keys so that pipeline still reaches the end.
  const legacyRuntime = createDefaultRuntime({
    memory: false,
    gates: {
      pattern_gate: { requires: ['pattern_interview', 'pattern_selection', 'module_pattern_selection'] },
      architecture_gate: { requires: ['boundaries', 'decomposition', 'pattern_selection'] },
      merge_gate: { requires: ['critic_pass'] }
    },
    pipelines: {
      feature: {
        steps: [
          { skill: 'architect' }, { skill: 'module-decomposer' },
          { skill: 'pattern-interviewer' }, { skill: 'pattern-selector' },
          { skill: 'module-pattern-selector' }, { gate: 'pattern_gate' },
          { gate: 'architecture_gate' }, { skill: 'refactor-critic' }, { gate: 'merge_gate' }
        ]
      }
    },
    router: { routes: { feature: { pipeline: 'feature' } } }
  });
  const unmigrated = await legacyRuntime.execute({ prompt: '加一个用户搜索功能' });
  assert.equal(unmigrated.results['pattern_gate'].status, 'pass',
    'an un-migrated pipeline must not deadlock on a gate for work it declined to do');
  assert.equal(unmigrated.results['merge_gate'].status, 'pass', 'the un-migrated pipeline must run to completion');
  assert.deepEqual(unmigrated.results['pattern-selector'].artifacts.pattern_selection, [],
    'the compatibility artifact must stay empty so a skip is never read as a result');

  // §15: the DDD pipeline maps building blocks onto pattern roles without
  // activating the pattern chain.
  const bridged = await runtime.execute({ prompt: '用 DDD 设计订单聚合' });
  assert.ok(bridged.results['ddd-pattern-bridge'], 'the DDD pipeline must run the pattern bridge');

  // --- Generated frontend-engineering/ tree ----------------------------------
  const patternFiles = patternRuntimeFiles('.ai-agent');
  assert.equal(Object.keys(patternFiles).length, 61,
    'the pack is 1 SKILL + 22 rules + 23 skills + 11 schemas + 4 references');
  for (const domain of PATTERN_DOMAINS) {
    assert.ok(patternFiles[`.ai-agent/frontend-engineering/rules/${domain.id}-rules.md`], `missing rules for ${domain.id}`);
    assert.ok(patternFiles[`.ai-agent/frontend-engineering/skills/${domain.id}/SKILL.md`], `missing SKILL.md for ${domain.id}`);
  }
  for (const [name, content] of Object.entries(patternFiles)) {
    if (name.endsWith('.schema.json')) JSON.parse(content);
  }
  assert.match(patternFiles['.ai-agent/frontend-engineering/SKILL.md'], /PATTERN-SYSTEM-001/);
  assert.match(patternFiles['.ai-agent/frontend-engineering/rules/pattern-gate.md'], /MUST NOT be activated merely/);
  assert.match(patternFiles['.ai-agent/frontend-engineering/rules/pattern-composition.md'], /RULE-014/);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

// --- IDE agent global switch --------------------------------------------------
{
  const resolve = (raw, env = {}) => resolveAgentsConfig(raw, {}, { env }).config;
  const registryFor = (raw, env = {}) => {
    const config = resolve(raw, env);
    return createRegistryFromConfig(config.agents, { ideAgent: config.ideAgent });
  };

  // Seeded on, so an unwired capability reaches the agent already in the editor
  // instead of ending the run at "no agent provides this".
  assert.equal(defaultAgentsConfig().ideAgent.enabled, true);
  const fallback = registryFor({}).resolveCapability('some-unwired-capability');
  assert.equal(fallback.agent.id, 'ide-agent');
  assert.equal(fallback.agent.provider, 'ide');
  assert.deepEqual(fallback.agent.capabilities, ['some-unwired-capability'],
    'the handoff must claim only what it was asked for');

  // A configured agent still wins; the fallback never displaces real wiring.
  assert.equal(registryFor({}).resolveCapability('requirement-impact').agent.id, 'impact-analyzer');

  // Three ways out, narrowest first.
  assert.equal(registryFor({ ideAgent: { enabled: false } }).resolveCapability('x').agent, null);
  assert.equal(registryFor({}, { AAFE_IDE_AGENT: '0' }).resolveCapability('x').agent, null);
  assert.equal(registryFor({}, { AAFE_IDE_AGENT: 'off' }).resolveCapability('x').agent, null);
  assert.equal(
    registryFor({ ideAgent: { enabled: false } }, { AAFE_IDE_AGENT: '1' }).resolveCapability('x').agent.id,
    'ide-agent',
    'the environment must be able to re-enable what the project turned off'
  );
  assert.equal(resolve({}, { AAFE_IDE_AGENT: '' }).ideAgent.enabled, true,
    'an empty value is not a decision');

  // A project that already pointed the developer role elsewhere was saying it
  // does not want IDE handoffs, and must not acquire them by upgrading.
  assert.equal(resolve({ developer: { provider: 'http' } }).ideAgent.enabled, false);
  assert.equal(resolve({ developer: { provider: 'http' }, ideAgent: { enabled: true } }).ideAgent.enabled, true,
    'an explicit ideAgent block outranks the legacy developer block');

  // An allowlist routes a capability to the IDE even when an agent serves it.
  const forced = registryFor({ ideAgent: { capabilities: ['requirement-impact'] } })
    .resolveCapability('requirement-impact');
  assert.equal(forced.agent.id, 'ide-agent');
  assert.equal(forced.reason, 'ide-agent-requested');

  const badList = resolveAgentsConfig({ ideAgent: { capabilities: 'requirement-impact' } }, {}, { env: {} });
  assert.deepEqual(badList.config.ideAgent.capabilities, []);
  assert.ok(badList.warnings.some((w) => /ideAgent\.capabilities must be an array/.test(w)));
}

// --- agent-facing entry points -----------------------------------------------
{
  // The documented install is a devDependency, which puts the binary in
  // node_modules/.bin and nowhere on PATH. A hook that only probes `command -v`
  // silently skips the entire post-task chain in exactly that setup.
  const flat = taskCompletionHookScript();
  assert.match(flat, /node_modules\/\.bin\/aafe/, 'the hook must find a devDependency install');
  assert.match(flat, /dir="\$\(dirname "\$dir"\)"/, 'walking up must cover hoisted monorepo installs');
  assert.match(flat, /command -v aafe/, 'a global install must still work');
  assert.match(flat, /AAFE="\$\(resolve_aafe\)" \|\| exit 0/, 'an absent CLI must stay silent, not install anything');
  assert.doesNotMatch(flat, /^\s*aafe task-completion/m, 'the bare binary name must not be invoked directly');

  // Layered installs run from the workspace root, so the hook has to descend
  // into the module before resolving anything.
  const layered = taskCompletionHookScript({ moduleRelativePath: 'bklog/web' });
  assert.match(layered, /MODULE_DIR="bklog\/web"/);
  assert.ok(layered.indexOf('MODULE_DIR') < layered.indexOf('resolve_aafe'),
    'the module directory must be entered before the CLI is resolved');
}

// --- project migrations ------------------------------------------------------
const migrationRoot = await mkdtemp(path.join(tmpdir(), 'aafe-migrate-'));
try {
  const write = async (rel, content) => {
    await mkdir(path.dirname(path.join(migrationRoot, rel)), { recursive: true });
    await writeFile(path.join(migrationRoot, rel), content, 'utf8');
  };
  const readJsonFile = async (rel) => JSON.parse(await readFile(path.join(migrationRoot, rel), 'utf8'));
  const fileExists = async (rel) => {
    try {
      await readFile(path.join(migrationRoot, rel));
      return true;
    } catch {
      return false;
    }
  };
  const pathMissing = async (absolute) => {
    try {
      await readdir(absolute);
      return false;
    } catch {
      return true;
    }
  };

  // A project as an older release left it behind.
  await write('.ai-agent/skills/ddd-discovery.md', 'legacy');
  await write('.ai-agent/skills/aggregate-designer.md', 'legacy');
  await write('.ai-agent/memory/file-license-ok.json', JSON.stringify({
    fingerprint: 'legacy-fp',
    files: {
      'src/a.ts': { ok: true, style: 'block-star', at: '2026-01-01T00:00:00.000Z' },
      'src/skipped.ts': { ok: false }
    }
  }));
  await write('.aafe.config.json', JSON.stringify({
    analyze: { docsOut: '.legacy-out', llm: { agents: { architecture: true, testing: true } } }
  }));

  // Superseded skills stay until their replacement exists, so that a failed or
  // partial update never leaves the project with neither copy.
  let pending = await planMigrations(migrationRoot);
  assert.ok(!pending.some((entry) => entry.id === 'superseded-flat-ddd-skills'),
    'flat DDD skills must survive while .ai-agent/ddd/ is absent');
  assert.ok(await fileExists('.ai-agent/skills/ddd-discovery.md'));

  // Same for agent wiring: writing a stub .aafe.agents.json here would stop
  // bootstrap from ever seeding the real defaults.
  assert.ok(!pending.some((entry) => entry.id === 'analyze-llm-agents'),
    'legacy agent wiring must wait for .aafe.agents.json to exist');

  await write('.ai-agent/ddd/SKILL.md', 'ddd pack');
  await write('.aafe.agents.json', JSON.stringify({
    version: 1,
    agents: { 'test-agent': { enabled: false, provider: 'local', ref: 'builtin:test-agent' } }
  }));

  pending = await planMigrations(migrationRoot);
  assert.equal(pending.length, 4, 'every legacy artefact must be detected once the layout is complete');
  assert.deepEqual(await readJsonFile('.aafe.config.json'), {
    analyze: { docsOut: '.legacy-out', llm: { agents: { architecture: true, testing: true } } }
  }, 'planning must not touch the project');

  const dry = await runMigrations(migrationRoot, { dryRun: true });
  assert.equal(dry.migrated, 4);
  assert.ok(await fileExists('.ai-agent/memory/file-license-ok.json'), 'a dry run must change nothing');

  const report = await runMigrations(migrationRoot);
  assert.equal(report.migrated, 4);

  assert.equal(await fileExists('.ai-agent/skills/ddd-discovery.md'), false);
  assert.equal(await fileExists('.ai-agent/skills/aggregate-designer.md'), false);

  // The legacy blob's own fingerprint has to survive: reusing the current
  // template's would silently vouch for headers nobody re-checked.
  assert.equal(await fileExists('.ai-agent/memory/file-license-ok.json'), false);
  const licenseLines = (await readFile(path.join(migrationRoot, '.ai-agent/memory/file-license-ok.jsonl'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(licenseLines.length, 1, 'entries that were never ok must not be carried over');
  assert.deepEqual(licenseLines[0], {
    path: 'src/a.ts', ok: true, fp: 'legacy-fp', style: 'block-star', at: '2026-01-01T00:00:00.000Z'
  });

  const migratedConfig = await readJsonFile('.aafe.config.json');
  assert.equal(migratedConfig.analyze.output, '.legacy-out', 'the configured output must keep pointing at the same place');
  assert.equal('docsOut' in migratedConfig.analyze, false);
  assert.equal('agents' in migratedConfig.analyze.llm, false);

  const migratedAgents = await readJsonFile('.aafe.agents.json');
  assert.deepEqual(migratedAgents.agents['test-agent'], {
    enabled: true, provider: 'local', ref: 'builtin:test-agent'
  }, 'carrying the legacy flag must not drop the rest of the wiring');

  assert.equal((await runMigrations(migrationRoot)).migrated, 0, 'migrations must be idempotent');

  // analyze output: the config key is a pick-one because reads resolve
  // `output ?? docsOut`, but the artefacts on disk get merged when doing so
  // cannot lose anything.
  const analyzeCase = async (name, { docsOut, output, legacyFiles = [], currentFiles = [] }) => {
    const caseRoot = path.join(migrationRoot, 'analyze-cases', name);
    await mkdir(caseRoot, { recursive: true });
    await writeFile(path.join(caseRoot, '.aafe.config.json'),
      JSON.stringify({ analyze: { docsOut, output } }), 'utf8');
    for (const [dir, files] of [[docsOut, legacyFiles], [output, currentFiles]]) {
      for (const rel of files) {
        await mkdir(path.dirname(path.join(caseRoot, dir, rel)), { recursive: true });
        await writeFile(path.join(caseRoot, dir, rel), dir, 'utf8');
      }
    }
    await runMigrations(caseRoot);
    return caseRoot;
  };

  // Only the legacy directory holds artefacts, so moving them makes the config
  // and the disk agree without overwriting anything.
  const mergedRoot = await analyzeCase('merged', {
    docsOut: '.legacy-analyze',
    output: '.aafe',
    legacyFiles: ['index.json', 'modules/a/README.md']
  });
  assert.equal(
    await readFile(path.join(mergedRoot, '.aafe/modules/a/README.md'), 'utf8'), '.legacy-analyze',
    'nested artefacts must survive the merge'
  );
  assert.equal(await pathMissing(path.join(mergedRoot, '.legacy-analyze')), true);
  assert.equal(JSON.parse(await readFile(path.join(mergedRoot, '.aafe.config.json'), 'utf8')).analyze.output, '.aafe');

  // Both hold artefacts: merging would file an older analysis next to the
  // current one with nothing marking it stale, so the old directory is left
  // for the user to delete.
  const keptRoot = await analyzeCase('kept', {
    docsOut: '.legacy-analyze',
    output: '.aafe',
    legacyFiles: ['index.json'],
    currentFiles: ['index.json']
  });
  assert.equal(await readFile(path.join(keptRoot, '.aafe/index.json'), 'utf8'), '.aafe',
    'a stale artefact must never overwrite the current one');
  assert.equal(await pathMissing(path.join(keptRoot, '.legacy-analyze')), false);

  // A legacy path pointing outside the project is reported, never moved.
  const escapeRoot = await analyzeCase('escape', { docsOut: '../../elsewhere', output: '.aafe' });
  assert.equal(JSON.parse(await readFile(path.join(escapeRoot, '.aafe.config.json'), 'utf8')).analyze.output, '.aafe');

  // relocate(): directories merge, and content already at the destination was
  // written by the current version, so it wins over the stale copy.
  await write('old/keep.md', 'from old');
  await write('old/nested/deep.md', 'from old');
  await write('new/keep.md', 'from new');
  const moved = await relocate(path.join(migrationRoot, 'old'), path.join(migrationRoot, 'new'));
  assert.deepEqual(moved, [path.join(migrationRoot, 'new/nested/deep.md')]);
  assert.equal(await readFile(path.join(migrationRoot, 'new/keep.md'), 'utf8'), 'from new');
  assert.equal(await fileExists('old/keep.md'), false, 'the source must be gone either way');
  assert.deepEqual(await relocate(path.join(migrationRoot, 'old'), path.join(migrationRoot, 'new')), [],
    'relocating an absent path is a no-op');
} finally {
  await rm(migrationRoot, { recursive: true, force: true });
}

console.log('agent platform tests passed');

/**
 * Minimal `.aafe/` output: two related modules plus an unrelated one, which is
 * enough to assert both lexical matching and dependency propagation.
 */
async function writeFixture(root) {
  const write = async (relative, value) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  };

  await write('.aafe/manifest.json', {
    version: '1',
    project: { name: 'fixture', root: '.', version: '1.0.0' },
    analysis: { version: '0.3.0', timestamp: Date.now(), commit: null, formats: ['json'] },
    output: '.aafe'
  });
  await write('.aafe/index.json', { project: 'fixture', stats: { files: 3 }, entrypoints: [] });
  await write('.aafe/modules/index.json', {
    modules: [
      { id: 'user', entry: 'modules/user/index.json', summary: {} },
      { id: 'app', entry: 'modules/app/index.json', summary: {} },
      { id: 'billing', entry: 'modules/billing/index.json', summary: {} }
    ]
  });

  const moduleFixtures = {
    user: {
      files: ['src/user/UserList.jsx', 'src/user/userPhoneSearch.js'],
      routes: [{ path: '/user/list', name: 'UserList' }],
      components: [{ name: 'UserList' }],
      dependencies: []
    },
    app: {
      files: ['src/app/App.jsx'],
      routes: [],
      components: [{ name: 'App' }],
      dependencies: ['module:user']
    },
    billing: {
      files: ['src/billing/Invoice.jsx'],
      routes: [{ path: '/billing', name: 'Invoice' }],
      components: [{ name: 'Invoice' }],
      dependencies: []
    }
  };

  for (const [id, fixtureModule] of Object.entries(moduleFixtures)) {
    await write(`.aafe/modules/${id}/index.json`, {
      id,
      summary: {},
      routes: fixtureModule.routes,
      components: fixtureModule.components,
      dependencies: fixtureModule.dependencies
    });
    await write(`.aafe/modules/${id}/json/architecture.json`, {
      module: id,
      architecture: { kind: 'module', boundaries: { files: fixtureModule.files } }
    });
    await write(`.aafe/modules/${id}/json/routes.json`, { routes: fixtureModule.routes });
    await write(`.aafe/modules/${id}/json/components.json`, { components: fixtureModule.components });
    await write(`.aafe/modules/${id}/json/features.json`, { features: [] });
    await write(`.aafe/modules/${id}/json/dataflow.json`, { dataflow: { flows: [] } });
  }

  await write('.aafe/knowledge/relations/json/modules.json', {
    relations: [{ from: 'module:app', to: 'module:user', type: 'MODULE_DEPENDS', evidence: [] }]
  });
  await write('.aafe/knowledge/relations/json/components.json', { relations: [] });
  await write('.aafe/knowledge/relations/json/dataflow.json', { relations: [] });
  await write('.aafe/knowledge/features/json/candidates.json', {
    candidates: [{
      id: 'feature:user-search',
      name: 'user search',
      entrypoints: ['src/user/userPhoneSearch.js'],
      evidence: [{ type: 'source', file: 'src/user/userPhoneSearch.js', reason: 'entry' }],
      confidence: 0.8
    }]
  });
  await write('.aafe/knowledge/business/json/candidates.json', { candidates: [] });
  await write('.aafe/knowledge/architecture/json/analysis.json', { modules: [], dependencies: [], risks: [] });
  await write('.aafe/knowledge/repository/json/symbols.json', {
    symbols: [
      { id: 'symbol:userPhoneSearch', name: 'searchByPhone', fileId: 'file:src/user/userPhoneSearch.js' },
      { id: 'symbol:invoiceTotal', name: 'invoiceTotal', fileId: 'file:src/billing/Invoice.jsx' }
    ]
  });
}
