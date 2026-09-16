import { COMPLEXITIES } from '../routing/decision.js';

export function evaluateComplexity(features = {}) {
  let score = 0;
  score += Math.min(nonnegative(features.estimatedFiles), 10);
  score += Math.min(nonnegative(features.estimatedModules) * 2, 10);
  for (const [key, weight] of Object.entries({ requiresRepositorySearch: 2, requiresPlanning: 3, requiresTools: 2,
    requiresCodeExecution: 2, requiresExternalResearch: 2, crossModule: 4, crossRepository: 6, destructiveRisk: 8 })) {
    if (features[key] === true) score += weight;
  }
  score += Math.round(Math.max(0, Math.min(1, Number(features.ambiguity) || 0)) * 4);
  const level = score <= 3 ? 'L0' : score <= 8 ? 'L1' : score <= 16 ? 'L2' : 'L3';
  return { level, score, features: normalizeFeatures(features) };
}

export function complexityAtMost(actual, maximum) {
  return COMPLEXITIES.indexOf(actual) <= COMPLEXITIES.indexOf(maximum);
}

function normalizeFeatures(value) {
  return { estimatedFiles: nonnegative(value.estimatedFiles), estimatedModules: nonnegative(value.estimatedModules),
    requiresRepositorySearch: value.requiresRepositorySearch === true, requiresPlanning: value.requiresPlanning === true,
    requiresTools: value.requiresTools === true, requiresCodeExecution: value.requiresCodeExecution === true,
    requiresExternalResearch: value.requiresExternalResearch === true, crossModule: value.crossModule === true,
    crossRepository: value.crossRepository === true, contextTokenEstimate: nonnegative(value.contextTokenEstimate),
    ambiguity: Math.max(0, Math.min(1, Number(value.ambiguity) || 0)), destructiveRisk: value.destructiveRisk === true };
}
function nonnegative(value) { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
