export const MEMORY_GATE_SOURCES = Object.freeze([
  'USER_EXPLICIT', 'USER_CONFIGURED_AGENT', 'OTHER_AGENT_FINDING', 'CURRENT_ANALYSIS', 'NONE'
]);

const EXPLICIT_SIGNALS = [
  [/\bout[ -]?of[ -]?memory\b|\boom\b|javascript heap out of memory/i, 'oom'],
  [/memory leak|内存泄漏|内存溢出|内存不断上涨|内存持续增长|内存暴涨/, 'memory-leak-or-growth'],
  [/heap (?:memory )?(?:issue|growth|overflow)|heap 持续增长|堆内存/, 'heap'],
  [/chrome.*(?:aw snap|crash)|浏览器.*(?:崩溃|内存)|renderer.*(?:crash|memory)/i, 'browser-memory-crash']
];
const ANALYSIS_SIGNALS = [
  [/retained objects?|detached dom|gc (?:cannot|unable|无法).*(?:recover|回收)/i, 'retention-or-gc'],
  [/allocation rate|allocation storm|large (?:json|dataset|data).*(?:memory|heap|oom)/i, 'allocation-or-large-data'],
  [/渲染.*(?:崩溃|内存)|大(?:数据|JSON).*(?:内存|峰值|溢出)|无法回收/, 'analysis-memory-symptom']
];
const MEMORY_CATEGORIES = new Set([
  'MEMORY_RELATED', 'MEMORY_LEAK', 'MEMORY_BLOAT', 'MEMORY_PEAK',
  'MEMORY_ALLOCATION', 'MEMORY_RENDERING', 'MEMORY_NATIVE'
]);

/**
 * The only entry point for memory diagnosis. It deliberately treats a bare
 * "memory" mention as insufficient: memory cache/address/optimization are not
 * evidence of an OOM investigation.
 */
export function evaluateMemoryOOMGate(input = {}) {
  const normalized = normalize(input);
  const explicit = matches(normalized.prompt, EXPLICIT_SIGNALS);
  if (explicit.length) return decision(true, 'USER_EXPLICIT', 'HIGH', explicit, 'user explicitly requested memory/OOM diagnosis', normalized);

  if (normalized.customAgentRequested) {
    return decision(true, 'USER_CONFIGURED_AGENT', 'HIGH', ['custom-memory-agent-request'], 'user explicitly requested a custom memory agent', normalized);
  }

  const findingSignals = findings(normalized.findings);
  if (findingSignals.length) {
    const confidence = Math.max(...findingSignals.map((item) => item.confidence));
    return decision(true, 'OTHER_AGENT_FINDING', confidence >= 0.8 ? 'HIGH' : 'MEDIUM', findingSignals.map((item) => item.signal), 'another agent reported a memory-related finding', normalized);
  }

  const analysis = matches(normalized.currentAnalysis, ANALYSIS_SIGNALS);
  if (analysis.length) return decision(true, 'CURRENT_ANALYSIS', 'MEDIUM', analysis, 'current analysis identified memory-related evidence', normalized);

  return decision(false, 'NONE', 'LOW', [], 'no memory/OOM activation signal was established', normalized);
}

export function isMemoryOOMEnabled(input) {
  return evaluateMemoryOOMGate(input).activated;
}

function normalize(input) {
  const request = input?.request ?? input;
  return {
    prompt: String(input?.prompt ?? request?.prompt ?? request ?? ''),
    currentAnalysis: String(input?.currentAnalysis ?? request?.currentAnalysis ?? ''),
    findings: input?.findings ?? request?.findings ?? [],
    customAgentRequested: Boolean(input?.customAgentRequested ?? request?.customAgentRequested),
    agent: input?.agent ?? request?.agent ?? null
  };
}

function findings(value) {
  return (Array.isArray(value) ? value : []).flatMap((finding) => {
    const category = String(finding?.category ?? '').toUpperCase();
    if (!MEMORY_CATEGORIES.has(category) && finding?.activation !== true) return [];
    const confidence = Number.isFinite(finding?.confidence) ? finding.confidence : 0.5;
    return [{ signal: `finding:${category || 'MEMORY_RELATED'}`, confidence }];
  });
}

function matches(text, rules) {
  return rules.filter(([pattern]) => pattern.test(text)).map(([, signal]) => signal);
}

function decision(activated, source, confidence, signals, reason, normalized) {
  return {
    activated,
    source,
    confidence,
    signals: [...new Set(signals)],
    reason,
    agent: activated && source === 'USER_CONFIGURED_AGENT' ? normalized.agent : null
  };
}
