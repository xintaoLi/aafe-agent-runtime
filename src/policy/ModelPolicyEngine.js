import { complexityAtMost } from './ComplexityEvaluator.js';

export class ModelPolicyEngine {
  constructor({ models = [], policies = [], history = {} } = {}) {
    this.models = models;
    this.policies = policies;
    this.history = history;
  }
  select({ route, complexity = route?.complexity ?? 'L0', contextTokens = 0, maxCostTier = Infinity } = {}) {
    const required = new Set(route?.requiredCapabilities ?? []);
    const eligible = this.models.filter((model) => model.enabled !== false
      && complexityAtMost(complexity, model.maxComplexity ?? 'L3')
      && Number(model.contextWindow ?? Infinity) >= contextTokens
      && Number(model.costTier ?? 0) <= maxCostTier
      && [...required].every((capability) => (model.capabilities ?? []).includes(capability)));
    if (!eligible.length) throw new Error('model-policy-no-eligible-model');
    const policy = this.policies.find((item) => matches(item.when ?? {}, route, complexity));
    const preferred = [...(policy?.prefer ?? []), ...(policy?.fallback ?? [])];
    const scored = eligible.map((model) => ({ model, score: scoreModel(model, this.history[model.id], preferred) }))
      .sort((a, b) => b.score - a.score || String(a.model.id).localeCompare(String(b.model.id)));
    return { modelId: scored[0].model.id, model: scored[0].model, policyId: policy?.id ?? null,
      reviewRequired: policy?.reviewRequired === true, candidates: scored.map((item) => ({ id: item.model.id, score: item.score })) };
  }
}
function matches(when, route, complexity) {
  if (when.domain && when.domain !== route?.domain) return false;
  if (when.action && when.action !== route?.action) return false;
  if (when.complexity && !(Array.isArray(when.complexity) ? when.complexity : [when.complexity]).includes(complexity)) return false;
  if (when.maxComplexity && !complexityAtMost(complexity, when.maxComplexity)) return false;
  return true;
}
function scoreModel(model, history = {}, preferred = []) {
  const preference = preferred.includes(model.id) ? Math.max(0, 30 - preferred.indexOf(model.id) * 5) : 0;
  return preference + (Number(history.successRate ?? 0.5) * 20) + ((3 - Number(model.latencyTier ?? 1)) * 4)
    + ((3 - Number(model.costTier ?? 1)) * 3) + (model.available === false ? -1000 : 10);
}
