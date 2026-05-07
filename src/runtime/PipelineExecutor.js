export class PipelineExecutor {
  constructor({ registry, gateValidator, maxReruns = 1 }) {
    this.registry = registry;
    this.gateValidator = gateValidator;
    this.maxReruns = maxReruns;
  }

  async execute(pipeline, input) {
    let lastContext;
    for (let attempt = 0; attempt <= this.maxReruns; attempt += 1) {
      const context = await this.runOnce(pipeline, input, attempt);
      lastContext = context;
      if (!shouldRerun(context)) return context;
      context.trace.push({ type: 'rerun', name: 'critique-loop', status: 'warn', attempt });
      input = { ...input, rerun: { attempt: attempt + 1, previous: summarizeFailure(context) } };
    }
    return lastContext;
  }

  async runOnce(pipeline, input, attempt) {
    const context = {
      input,
      attempt,
      results: {},
      trace: []
    };

    for (const step of pipeline.steps) {
      if (step.skill) {
        const result = await this.registry.execute(step.skill, context);
        context.results[step.skill] = result;
        context.trace.push({ type: 'skill', name: step.skill, status: result.status, attempt });
        if (result.status === 'fail' && step.blocking !== false) break;
      }

      if (step.gate) {
        const result = this.gateValidator.validate(step.gate, context);
        context.results[step.gate] = result;
        context.trace.push({ type: 'gate', name: step.gate, status: result.status, attempt });
        if (result.status === 'fail') break;
      }
    }

    return context;
  }
}

function shouldRerun(context) {
  const critic = context.results['refactor-critic'];
  const mergeGate = context.results.merge_gate;
  return critic?.status === 'fail' || mergeGate?.status === 'fail';
}

function summarizeFailure(context) {
  return Object.entries(context.results)
    .filter(([, result]) => result.status === 'fail')
    .map(([name, result]) => ({ name, summary: result.summary, risks: result.risks }))
    .slice(0, 5);
}
