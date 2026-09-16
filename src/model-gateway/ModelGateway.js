import { recordInvocationSafely } from '../telemetry/InvocationMetricStore.js';

export class ModelGateway {
  constructor({ providers = {}, policies = {}, metricStore = null, sleep = defaultSleep } = {}) {
    this.providers = new Map(Object.entries(providers));
    this.policies = policies;
    this.metricStore = metricStore;
    this.sleep = sleep;
  }

  register(id, client) {
    if (!id || typeof client?.chat !== 'function') throw new Error('model-gateway-provider-invalid');
    this.providers.set(id, client);
    return this;
  }

  async chat(messages, options = {}) {
    const policy = { retries: 1, retryDelayMs: 150, providers: [], ...this.policies[options.policy ?? 'default'], ...options.policyOverride };
    const candidates = unique([options.provider, ...(options.fallbackProviders ?? []), ...policy.providers].filter(Boolean));
    if (!candidates.length) throw new Error('model-gateway-provider-required');
    const attempts = [];
    for (const providerId of candidates) {
      const client = this.providers.get(providerId);
      if (!client) { attempts.push({ provider: providerId, status: 'skipped', reason: 'provider-not-registered' }); continue; }
      for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
        const startedAt = Date.now();
        const result = await client.chat(messages, { ...options, telemetry: { ...options.telemetry, provider: providerId } });
        attempts.push({ provider: providerId, attempt: attempt + 1, status: result.status, reason: result.reason ?? null });
        await recordInvocationSafely(this.metricStore, { ...options.telemetry, provider: providerId,
          model: client.model ?? 'unknown', operation: 'gateway.chat', latencyMs: Date.now() - startedAt,
          success: result.status === 'success', errorCode: result.reason, usage: result.usage });
        if (result.status === 'success') return { ...result, provider: providerId, attempts };
        if (!retryable(result.reason) || attempt >= policy.retries) break;
        await this.sleep(policy.retryDelayMs * (attempt + 1));
      }
    }
    return { status: 'failed', reason: attempts.at(-1)?.reason ?? 'model-gateway-exhausted', attempts };
  }

  async chatJson(messages, options = {}) {
    const result = await this.chat(messages, { ...options, responseFormat: options.responseFormat ?? { type: 'json_object' } });
    if (result.status !== 'success') return result;
    try { return { ...result, data: JSON.parse(result.content) }; }
    catch { return { ...result, status: 'failed', reason: 'model-gateway-invalid-json' }; }
  }
}

function retryable(reason = '') { return /timeout|request-failed|http-(408|409|425|429|5\d\d)/i.test(reason); }
function unique(values) { return [...new Set(values)]; }
function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
