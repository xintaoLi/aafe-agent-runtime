import assert from 'node:assert/strict';
import { DEFAULT_SEMANTIC_ROUTES, evaluateComplexity, LayeredRouter, ModelPolicyEngine } from '../src/index.js';

const router = new LayeredRouter({ routes: DEFAULT_SEMANTIC_ROUTES, semanticAccept: 0.2, semanticMargin: 0 });
assert.equal((await router.route({ message: '终止 task-123' })).action, 'cancel');
assert.equal((await router.route({ message: '修复页面白屏' })).action, 'fix');
assert.equal((await router.route({ message: '继续看看', replyTo: { taskId: 'task-9' } }, { tasks: [] })).targetTaskId, 'task-9');
const ask = await new LayeredRouter({ routes: [], modelFallback: async () => ({ relation: 'clarify', confidence: 0.2 }) }).route({ message: '这个也弄下' });
assert.equal(ask.stage, 'clarification');

assert.equal(evaluateComplexity({ estimatedFiles: 1 }).level, 'L0');
assert.equal(evaluateComplexity({ estimatedFiles: 5, estimatedModules: 2, requiresPlanning: true }).level, 'L2');
assert.equal(evaluateComplexity({ crossRepository: true, destructiveRisk: true, ambiguity: 1 }).level, 'L3');

const policy = new ModelPolicyEngine({
  models: [
    { id: 'fast-code', capabilities: ['file-read', 'file-write'], maxComplexity: 'L2', contextWindow: 32000, costTier: 1, latencyTier: 0 },
    { id: 'deep', capabilities: ['file-read', 'file-write', 'shell'], maxComplexity: 'L3', contextWindow: 200000, costTier: 3, latencyTier: 3 }
  ],
  policies: [{ id: 'normal-code', when: { domain: 'coding', complexity: ['L1', 'L2'] }, prefer: ['fast-code'], fallback: ['deep'] }]
});
assert.equal(policy.select({ route: { domain: 'coding', requiredCapabilities: ['file-read', 'file-write'] }, complexity: 'L1' }).modelId, 'fast-code');
assert.equal(policy.select({ route: { domain: 'coding', requiredCapabilities: ['shell'] }, complexity: 'L3' }).modelId, 'deep');
assert.throws(() => policy.select({ route: { requiredCapabilities: ['browser'] }, complexity: 'L2' }), /no-eligible/);
console.log('routing and model policy tests passed');
