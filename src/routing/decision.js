export const RELATIONS = Object.freeze(['new', 'continue', 'supplement', 'clarify', 'cancel']);
export const DOMAINS = Object.freeze(['chat', 'coding', 'analysis', 'research', 'testing', 'document', 'operation']);
export const ACTIONS = Object.freeze(['answer', 'inspect', 'plan', 'implement', 'fix', 'review', 'test', 'deploy', 'cancel']);
export const COMPLEXITIES = Object.freeze(['L0', 'L1', 'L2', 'L3']);

export function normalizeRouteDecision(value = {}) {
  const relation = RELATIONS.includes(value.relation) ? value.relation : 'clarify';
  return {
    relation,
    domain: DOMAINS.includes(value.domain) ? value.domain : 'chat',
    action: ACTIONS.includes(value.action) ? value.action : 'answer',
    complexity: COMPLEXITIES.includes(value.complexity) ? value.complexity : 'L0',
    risk: ['low', 'medium', 'high'].includes(value.risk) ? value.risk : 'low',
    targetTaskId: typeof value.targetTaskId === 'string' ? value.targetTaskId : null,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    reasons: [...new Set((value.reasons ?? []).map(String).filter(Boolean))],
    requiredCapabilities: [...new Set((value.requiredCapabilities ?? []).map(String).filter(Boolean))],
    stage: value.stage ?? null,
    candidates: Array.isArray(value.candidates) ? value.candidates : []
  };
}
