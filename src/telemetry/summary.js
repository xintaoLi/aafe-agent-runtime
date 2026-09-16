/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Licensed under the MIT License.
 */

export function summarizeInvocations(metrics = []) {
  const records = metrics.filter(Boolean);
  const knownTokens = records.map((item) => item.totalTokens).filter(isNumber);
  const knownCost = records.map((item) => item.estimatedCost).filter(isNumber);
  const latencies = records.map((item) => item.latencyMs).filter(isNumber).sort((a, b) => a - b);
  return {
    requests: records.length,
    successes: records.filter((item) => item.success).length,
    failures: records.filter((item) => !item.success).length,
    successRate: records.length ? records.filter((item) => item.success).length / records.length : null,
    totalTokens: knownTokens.length ? sum(knownTokens) : null,
    averageTokens: knownTokens.length ? sum(knownTokens) / knownTokens.length : null,
    totalEstimatedCost: knownCost.length ? sum(knownCost) : null,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    byProvider: countBy(records, 'provider'),
    byModel: countBy(records, 'model'),
    byRoute: countBy(records, 'route'),
    errors: countBy(records.filter((item) => !item.success), 'errorCode')
  };
}

function countBy(records, key) {
  const counts = {};
  for (const item of records) {
    const value = item[key] ?? 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
