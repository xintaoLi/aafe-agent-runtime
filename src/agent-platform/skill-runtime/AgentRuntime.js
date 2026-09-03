import { SkillRegistry } from './SkillRegistry.js';
import { PipelineExecutor } from './PipelineExecutor.js';
import { GateValidator } from './GateValidator.js';
import { HookBus } from './HookBus.js';
import { MemoryRuntime } from '../../memory/MemoryRuntime.js';
import { KnowledgeStore } from '../../knowledge/store/KnowledgeStore.js';
import { evaluateDDDGate } from '../../ddd/DDDGate.js';
import { evaluatePatternGate } from '../../patterns/PatternGate.js';
import { evaluateMemoryOOMGate } from '../../memory-diagnosis/MemoryOOMGate.js';

export class AgentRuntime {
  constructor({ router, pipelines, gates, skills, hooks, memory, knowledge, sdd = { enabled: true }, projectContext = null, root = process.cwd(), maxReruns = 1 }) {
    this.router = router;
    this.root = root;
    this.projectContext = projectContext;
    this.sdd = { enabled: true, ...(sdd ?? {}) };
    // Shared so the per-instance slice cache survives across skills in one run.
    this.knowledge = knowledge === false ? null : knowledge ?? new KnowledgeStore({ root });
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

    // Checked first, and only via the enablement gate. Explicit DDD intent has
    // to outrank the generic verbs, or "用 DDD 重构这个项目" lands in the plain
    // refactor pipeline on the strength of the word 重构 alone.
    //
    // The gate replaces a keyword scan that matched bare `repository`,
    // `aggregate` and `值对象`, which rerouted any task touching a repository
    // class into domain modelling.
    if (routes.domainFeature && evaluateDDDGate(text).enabled) return 'domainFeature';
    // Same reasoning for patterns, and the same bug: the old keyword scan
    // matched bare `strategy`, `factory`, `adapter`, `command` and `observer`,
    // so touching any of those turned the task into pattern analysis.
    if (routes.patternFeature && evaluatePatternGate(text).enabled) return 'patternFeature';
    // Memory diagnosis is opt-in through its own gate. It must outrank generic
    // bug/performance routing so explicit OOM requests never run a normal scan.
    if (routes.memoryDiagnosis && evaluateMemoryOOMGate(request).activated) return 'memoryDiagnosis';
    if (/bug|fix|error|crash|修复|报错|问题/.test(text) && routes.bugfix) return 'bugfix';
    if (/perf|performance|slow|optimi[sz]e|性能|优化|卡顿/.test(text) && routes.performance) return 'performance';
    if (/refactor|重构|腐化|拆分/.test(text) && routes.refactor) return 'refactor';
    if (/graph|dag|canvas|layout|node editor|画布|节点|布局/.test(text) && routes.graphFeature) return 'graphFeature';
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
      const context = await this.executor.execute(pipeline, {
        request,
        taskType,
        memoryContext,
        knowledge: this.knowledge,
        sdd: this.sdd,
        projectContext: request?.projectContext ?? this.projectContext
      });
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
