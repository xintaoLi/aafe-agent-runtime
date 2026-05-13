export class HookBus {
  constructor(hooks = {}, options = {}) {
    this.failOnError = options.failOnError === true;
    this.hooks = new Map();
    for (const [event, handlers] of Object.entries(hooks)) {
      const list = Array.isArray(handlers) ? handlers : [handlers];
      for (const handler of list) this.register(event, handler);
    }
  }

  register(event, handler) {
    if (!event || typeof handler !== 'function') {
      throw new Error(`Invalid hook registration: ${event}`);
    }
    const handlers = this.hooks.get(event) ?? [];
    handlers.push(handler);
    this.hooks.set(event, handlers);
  }

  async emit(event, payload = {}) {
    const handlers = this.hooks.get(event) ?? [];
    const outputs = [];
    for (const handler of handlers) {
      try {
        outputs.push(normalizeHookOutput(event, await handler(payload), handler.name));
      } catch (error) {
        if (this.failOnError) throw error;
        outputs.push({
          status: 'fail',
          summary: error?.message ?? `Hook ${event} failed`,
          artifacts: {},
          risks: [`Hook ${event} failed`],
          nextHints: []
        });
      }
    }
    return outputs;
  }
}

function normalizeHookOutput(event, result = {}, handlerName = '') {
  if (result === undefined || result === null) {
    return { status: 'pass', summary: `${event} hook completed`, artifacts: {}, risks: [], nextHints: [] };
  }
  const status = result.status ?? 'pass';
  if (!['pass', 'warn', 'fail'].includes(status)) {
    throw new Error(`Invalid status from hook ${event}: ${status}`);
  }
  return {
    status,
    summary: result.summary ?? `${handlerName || event} hook completed`,
    artifacts: result.artifacts ?? {},
    risks: result.risks ?? [],
    nextHints: result.nextHints ?? []
  };
}
