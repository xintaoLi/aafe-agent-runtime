import { estimateTokens } from '../ide-bridge/context/tokens.js';

const DEFAULT_SHARES = Object.freeze({ system: 0.12, snapshot: 0.18, recent: 0.18, code: 0.30, tools: 0.12, reserve: 0.10 });

export class ContextBudgetAllocator {
  constructor({ maxTokens = 12000, shares = {} } = {}) {
    this.maxTokens = maxTokens;
    this.shares = normalizeShares({ ...DEFAULT_SHARES, ...shares });
  }

  allocate(groups = {}) {
    const selected = {}, usage = {}, trimmed = [];
    for (const [category, share] of Object.entries(this.shares)) {
      const budget = Math.floor(this.maxTokens * share);
      const items = Array.isArray(groups[category]) ? groups[category] : groups[category] == null ? [] : [groups[category]];
      const mandatory = items.filter((item) => item?.mandatory === true);
      const optional = items.filter((item) => item?.mandatory !== true);
      let spent = 0; selected[category] = [];
      for (const item of [...mandatory, ...optional]) {
        const tokens = estimateTokens(item?.content ?? item);
        if (spent + tokens <= budget || item?.mandatory === true) { selected[category].push(item); spent += tokens; }
        else trimmed.push({ category, id: item?.id ?? null, reason: 'category-budget', tokens });
      }
      usage[category] = { budget, tokens: spent, count: selected[category].length };
    }
    return { selected, usage, trimmed, totalTokens: Object.values(usage).reduce((sum, value) => sum + value.tokens, 0), maxTokens: this.maxTokens };
  }
}

function normalizeShares(shares) {
  const values = Object.fromEntries(Object.entries(shares).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / total]));
}
