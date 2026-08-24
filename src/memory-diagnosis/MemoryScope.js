import { evaluateMemoryOOMGate } from './MemoryOOMGate.js';

export const MEMORY_RULE_ORDER = Object.freeze([
  'memory-gate', 'memory-diagnosis', 'memory-leak', 'memory-bloat',
  'memory-peak', 'memory-rendering', 'memory-worker', 'memory-cache',
  'memory-data-pipeline', 'memory-browser', 'memory-verification'
]);

const CATEGORY_RULES = Object.freeze({
  MEMORY_LEAK: ['memory-leak', 'memory-verification'],
  MEMORY_BLOAT: ['memory-bloat', 'memory-verification'],
  MEMORY_PEAK: ['memory-peak', 'memory-data-pipeline', 'memory-verification'],
  MEMORY_ALLOCATION: ['memory-peak', 'memory-data-pipeline', 'memory-verification'],
  MEMORY_RENDERING: ['memory-rendering', 'memory-verification'],
  MEMORY_NATIVE: ['memory-browser', 'memory-verification'],
  MEMORY_RELATED: ['memory-verification']
});

export function resolveMemoryScope(input = {}, { gate = null } = {}) {
  const decision = gate ?? evaluateMemoryOOMGate(input);
  if (!decision.activated) {
    return {
      enabled: false, source: decision.source, reason: decision.reason,
      categories: [], rules: [], skipped: MEMORY_RULE_ORDER.slice(1), agent: null
    };
  }

  const categories = categoriesFor(input, decision);
  const needed = new Set(['memory-gate', 'memory-diagnosis']);
  for (const category of categories) for (const rule of CATEGORY_RULES[category] ?? CATEGORY_RULES.MEMORY_RELATED) needed.add(rule);

  return {
    enabled: true,
    source: decision.source,
    reason: decision.reason,
    categories,
    rules: MEMORY_RULE_ORDER.filter((rule) => needed.has(rule)),
    skipped: MEMORY_RULE_ORDER.filter((rule) => !needed.has(rule)),
    agent: decision.agent ?? null
  };
}

function categoriesFor(input, decision) {
  const text = [input?.prompt, input?.request?.prompt, input?.currentAnalysis].filter(Boolean).join(' ').toLowerCase();
  const result = new Set();
  for (const finding of input?.findings ?? input?.request?.findings ?? []) {
    const category = String(finding?.category ?? '').toUpperCase();
    if (CATEGORY_RULES[category]) result.add(category);
  }
  if (/leak|泄漏|retained|detached dom|生命周期/.test(text)) result.add('MEMORY_LEAK');
  if (/json|dataset|大数据|峰值|peak|allocation|分配/.test(text)) result.add('MEMORY_PEAK');
  if (/render|渲染|virtual list|虚拟列表|canvas|webgl/.test(text)) result.add('MEMORY_RENDERING');
  if (/worker|web worker|wasm/.test(text)) result.add('MEMORY_ALLOCATION');
  if (/cache|缓存|map|set|indexeddb/.test(text)) result.add('MEMORY_BLOAT');
  if (/chrome|browser|renderer|aw snap|浏览器/.test(text)) result.add('MEMORY_NATIVE');
  if (result.size === 0) result.add('MEMORY_RELATED');
  return [...result];
}
