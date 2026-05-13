import { SkillRegistry } from './SkillRegistry.js';
import { PipelineExecutor } from './PipelineExecutor.js';
import { GateValidator } from './GateValidator.js';
import { HookBus } from './HookBus.js';
import { MemoryRuntime } from '../memory/MemoryRuntime.js';

export class AgentRuntime {
  constructor({ router, pipelines, gates, skills, hooks, memory, root = process.cwd(), maxReruns = 1 }) {
    this.router = router;
    this.pipelines = pipelines;
    this.registry = new SkillRegistry(skills);
    this.gateValidator = new GateValidator(gates);
    this.hookBus = hooks instanceof HookBus ? hooks : new HookBus(hooks);
    this.memory = memory === false ? null : memory ?? new MemoryRuntime(root);
    this.executor = new PipelineExecutor({ registry: this.registry, gateValidator: this.gateValidator, hookBus: this.hookBus, maxReruns });
  }

  classify(request) {
    const text = String(request?.prompt ?? request ?? '').toLowerCase();
    const routes = this.router.routes ?? {};

    if (/bug|fix|error|crash|修复|报错|问题/.test(text) && routes.bugfix) return 'bugfix';
    if (/perf|performance|slow|optimi[sz]e|性能|优化|卡顿/.test(text) && routes.performance) return 'performance';
    if (/refactor|重构|腐化|拆分/.test(text) && routes.refactor) return 'refactor';
    if (/graph|dag|canvas|layout|node editor|画布|节点|布局/.test(text) && routes.graphFeature) return 'graphFeature';
    if (/ddd|domain-driven|领域驱动|领域模型|聚合|限界上下文|bounded context|aggregate|domain event|repository|值对象/.test(text) && routes.domainFeature) return 'domainFeature';
    if (/pattern|设计模式|strategy|factory|registry|state machine|command|pipeline|observer|adapter/.test(text) && routes.patternFeature) return 'patternFeature';
    return routes.feature ? 'feature' : Object.keys(routes)[0];
  }

  async execute(request) {
    try {
      await this.hookBus.emit('beforeExecute', { request, runtime: this });
      await this.memory?.init();
      const taskType = this.classify(request);
      const pipelineName = this.router.routes?.[taskType]?.pipeline;
      const pipeline = this.pipelines[pipelineName];
      if (!pipeline) {
        throw new Error(`Pipeline not found for task type ${taskType}: ${pipelineName}`);
      }

      const memoryContext = await this.memory?.recall(String(request?.prompt ?? request ?? ''), { limit: 8 });
      const context = await this.executor.execute(pipeline, { request, taskType, memoryContext });
      context.memoryContext = memoryContext ?? '';
      await this.memory?.recordExecution(context);
      await this.hookBus.emit('afterExecute', { request, runtime: this, context });
      return context;
    } catch (error) {
      await this.hookBus.emit('onError', { request, runtime: this, error });
      throw error;
    }
  }

  async learn(entry) {
    return this.memory?.learn(entry);
  }

  async recall(query, options) {
    return this.memory?.recall(query, options) ?? '';
  }
}
