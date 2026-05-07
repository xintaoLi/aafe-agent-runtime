export class PipelineExecutor {
  constructor({ registry, gateValidator }) {
    this.registry = registry;
    this.gateValidator = gateValidator;
  }

  async execute(pipeline, input) {
    const context = {
      input,
      results: {},
      trace: []
    };

    for (const step of pipeline.steps) {
      if (step.skill) {
        const result = await this.registry.execute(step.skill, context);
        context.results[step.skill] = result;
        context.trace.push({ type: 'skill', name: step.skill, status: result.status });
        if (result.status === 'fail' && step.blocking !== false) break;
      }

      if (step.gate) {
        const result = this.gateValidator.validate(step.gate, context);
        context.results[step.gate] = result;
        context.trace.push({ type: 'gate', name: step.gate, status: result.status });
        if (result.status === 'fail') break;
      }
    }

    return context;
  }
}
