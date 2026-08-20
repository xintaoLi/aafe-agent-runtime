/**
 * Problem discovery: the step that must happen before any pattern is named.
 *
 * The catalog is indexed by solution, so asking it "which pattern?" first will
 * always return an answer. Starting from the problem is what makes it possible
 * to return *no* pattern, which PATTERN-SYSTEM-002 requires to be a valid
 * outcome.
 *
 * Each signature describes a problem in the project's terms and records which
 * pattern domains could answer it. It deliberately does not name a winner —
 * that is the scorer's job, and several signatures point at competing options.
 */

/**
 * @typedef {object} DetectedProblem
 * @property {string} id
 * @property {string} kind        feeds benefit relevance in PatternScore
 * @property {string} text        the problem in plain language
 * @property {'request'|'project'} source
 * @property {string[]} domains   pattern domains that could answer it
 * @property {string[]} patterns  specific patterns that directly answer it
 * @property {string[]} evidence
 */

const SIGNATURES = [
  {
    id: 'algorithm-variation',
    kind: 'variation',
    text: '同一能力存在多种可替换实现，需要运行时选择或后续扩展',
    pattern: /多种(?:算法|实现|策略|方式|规则|计价|布局|模式|来源|数据源)|可替换|不同(?:的)?[\u4e00-\u9fa5]{0,3}(?:算法|策略|规则|计价|渠道|供应商|模式|方式|来源|数据源|实现)|multiple\s+(?:algorithms?|implementations?|strategies|modes)|switch\s+between/i,
    domains: ['behavioral'],
    patterns: ['strategy', 'chain-of-responsibility', 'specification'],
    complexity: 2
  },
  {
    id: 'workflow-state',
    kind: 'state',
    text: '状态多、流转规则明确、非法状态必须被禁止',
    pattern: /状态(?:流转|机|复杂|多)|流程|审批|工作流|多步骤|分步|向导|wizard|workflow|lifecycle|生命周期|state\s+transition/i,
    domains: ['state', 'behavioral'],
    patterns: ['state-machine', 'reducer'],
    complexity: 2
  },
  {
    id: 'undo-redo',
    kind: 'state',
    text: '用户操作需要撤销与重做',
    pattern: /撤销|重做|回退一步|undo|redo/i,
    domains: ['behavioral', 'state'],
    patterns: ['undo-redo', 'command'],
    complexity: 2
  },
  {
    id: 'operation-audit',
    kind: 'state',
    text: '用户操作需要被记录、回放或审计',
    pattern: /回放|操作记录|历史记录|操作日志|审计|replay|audit\s+trail/i,
    domains: ['behavioral', 'state'],
    patterns: ['command', 'event-sourcing'],
    complexity: 2
  },
  {
    id: 'extension-surface',
    kind: 'extension',
    text: '需要开放扩展点，让外部能力可注册、查找、替换',
    pattern: /插件|扩展点|可扩展|注册机制|开放能力|二次开发|plugin|extension\s+point|extensible/i,
    domains: ['creational', 'architecture', 'module'],
    patterns: ['registry', 'plugin-architecture', 'factory'],
    complexity: 2
  },
  {
    id: 'external-dependency',
    kind: 'integration',
    text: '外部 API 或第三方 SDK 的形状与内部模型不一致',
    pattern: /第三方|外部(?:接口|api|系统|服务)|third[-\s]?party|sdk|对接|集成|遗留系统|legacy/i,
    domains: ['structural', 'integration'],
    patterns: ['adapter', 'anti-corruption-layer', 'bff'],
    complexity: 2
  },
  {
    id: 'data-access-scatter',
    kind: 'coupling',
    text: '数据访问细节散落在组件与业务代码中',
    pattern: /接口调用(?:散|到处)|数据访问|请求逻辑|直接调接口|axios|fetch\s+散|数据源|持久化/i,
    domains: ['data'],
    patterns: ['repository', 'data-mapper']
  },
  {
    id: 'server-data-sync',
    kind: 'consistency',
    text: '服务端数据被当作本地状态手工同步，容易过期与不一致',
    pattern: /接口数据|服务端数据|数据同步|缓存失效|刷新数据|数据不一致|stale|refetch/i,
    domains: ['state', 'data'],
    patterns: ['server-state', 'cache-aside', 'stale-while-revalidate']
  },
  {
    id: 'cross-module-notification',
    kind: 'coupling',
    text: '一处变化需要通知多个互不相识的模块',
    pattern: /通知(?:多个|其他)|广播|订阅|发布|解耦通信|跨模块通信|事件总线|pub\/?sub|broadcast|notify/i,
    domains: ['event', 'behavioral', 'integration'],
    patterns: ['observer', 'domain-event', 'event-bus']
  },
  {
    id: 'staged-processing',
    kind: 'complexity',
    text: '任务由多个阶段串联，每阶段可能插拔、复用或需要可观测',
    pattern: /多个步骤|处理流程|校验链|链路|流水线|前置处理|拦截器|pipeline|middleware|interceptor/i,
    domains: ['behavioral'],
    patterns: ['pipeline', 'chain-of-responsibility']
  },
  {
    id: 'large-list-rendering',
    kind: 'performance',
    text: '大量数据一次性渲染导致卡顿',
    pattern: /长列表|大量数据|万级|十万|渲染卡顿|列表卡|滚动卡|虚拟(?:列表|滚动)|large\s+list|virtual\s+scroll/i,
    domains: ['rendering', 'performance'],
    patterns: ['virtualization', 'pagination'],
    complexity: 2
  },
  {
    id: 'repeated-computation',
    kind: 'performance',
    text: '相同输入被反复计算或重复渲染',
    pattern: /重复(?:计算|渲染|请求)|反复计算|重新渲染|性能瓶颈|卡顿|re-?render|recompute/i,
    domains: ['performance'],
    patterns: ['memoization', 'derived-state', 'batching']
  },
  {
    id: 'bundle-size',
    kind: 'performance',
    text: '首包体积过大，首屏加载慢',
    pattern: /首包|包体积|首屏|加载慢|bundle|code\s*split|按需加载|懒加载|lazy\s*load/i,
    domains: ['performance', 'module', 'rendering'],
    patterns: ['code-splitting', 'dynamic-import', 'ssr']
  },
  {
    id: 'high-frequency-events',
    kind: 'performance',
    text: '高频输入或事件触发过多请求与计算',
    pattern: /高频|频繁(?:触发|请求|调用|输入|变化)|(?:输入|点击|滚动|搜索|拖拽).{0,3}频繁|请求(?:打爆|过多|太多)|搜索联想|滚动事件|resize|防抖|节流|debounce|throttle/i,
    domains: ['async', 'performance'],
    patterns: ['debounce', 'throttle', 'request-deduplication']
  },
  {
    id: 'race-condition',
    kind: 'consistency',
    text: '并发请求返回顺序不确定，过期响应覆盖最新结果',
    pattern: /竞态|race|请求顺序|旧数据覆盖|过期响应|取消请求|abort|并发请求/i,
    domains: ['async'],
    patterns: ['cancellation', 'request-deduplication', 'concurrency-limit'],
    complexity: 2
  },
  {
    id: 'unreliable-dependency',
    kind: 'integration',
    text: '下游不稳定导致功能不可用或整页失败',
    pattern: /不稳定|失败重试|超时|降级|兜底|容错|熔断|白屏|接口报错|retry|timeout|fallback|circuit/i,
    domains: ['resilience', 'async'],
    patterns: ['retry', 'timeout', 'fallback', 'error-boundary', 'circuit-breaker'],
    complexity: 2
  },
  {
    id: 'ui-logic-entanglement',
    kind: 'coupling',
    text: '数据获取与渲染逻辑纠缠，组件无法复用与测试',
    pattern: /组件(?:太大|臃肿|耦合|复杂)|逻辑(?:纠缠|混在)|难以复用|无法测试|巨型组件|god\s+component/i,
    domains: ['component'],
    patterns: ['container-presentational', 'custom-hook', 'headless-component']
  },
  {
    id: 'logic-duplication',
    kind: 'duplication',
    text: '同一段有状态逻辑或业务判定在多处重复',
    pattern: /重复代码|复制粘贴|多处(?:重复|相同)|逻辑重复|copy\s*paste|duplicat/i,
    domains: ['component', 'behavioral'],
    patterns: ['custom-hook', 'specification', 'strategy']
  },
  {
    id: 'prop-drilling',
    kind: 'coupling',
    text: '依赖逐层透传，中间组件被迫感知它不关心的数据',
    pattern: /逐层传递|层层传递|prop\s*drilling|透传|传好几层/i,
    domains: ['component'],
    patterns: ['provider', 'lifted-state']
  },
  {
    id: 'global-state-abuse',
    kind: 'coupling',
    text: '全局状态被当作默认集成方式，来源与写入方不可控',
    pattern: /全局状态|global\s+state|全局变量|store\s+太大|谁改的|状态来源不明/i,
    domains: ['state'],
    patterns: ['lifted-state', 'server-state', 'derived-state']
  },
  {
    id: 'module-boundary',
    kind: 'coupling',
    text: '模块边界不清，一个需求要改多个不相关目录',
    pattern: /目录结构|模块划分|边界不清|改十个|循环依赖|circular|模块耦合|文件组织/i,
    domains: ['module', 'architecture'],
    patterns: ['feature-module', 'public-api', 'layered-architecture'],
    complexity: 2
  },
  {
    id: 'complex-construction',
    kind: 'complexity',
    text: '对象或配置的构造过程复杂，调用方被迫了解细节',
    pattern: /创建(?:复杂|不同类型)|构造复杂|初始化复杂|配置项(?:多|爆炸)|实例化/i,
    domains: ['creational'],
    patterns: ['factory', 'builder']
  },
  {
    id: 'entry-surface',
    kind: 'complexity',
    text: '调用方需要面对过多子系统细节',
    pattern: /统一入口|简化接口|调用复杂|封装(?:一层|接口)|对外(?:接口|api)|门面/i,
    domains: ['structural'],
    patterns: ['facade', 'bff']
  },
  {
    id: 'realtime-push',
    kind: 'latency',
    text: '需要服务端主动推送或近实时更新',
    pattern: /实时|推送|长连接|websocket|sse|轮询|polling|realtime/i,
    domains: ['integration'],
    patterns: ['websocket', 'polling'],
    complexity: 2
  },
  {
    id: 'perceived-latency',
    kind: 'latency',
    text: '交互等待服务端确认，反馈不及时',
    pattern: /立即反馈|乐观更新|optimistic|等待(?:接口|响应)|交互卡|加载态|骨架屏|skeleton/i,
    domains: ['state', 'rendering'],
    patterns: ['optimistic-state', 'skeleton']
  },
  {
    id: 'legacy-replacement',
    kind: 'migration',
    text: '旧实现无法一次性替换，需要渐进迁移',
    pattern: /迁移|重构(?:老|旧|历史)|遗留|老代码|渐进|灰度|新旧共存|migration|strangler|legacy/i,
    domains: ['migration'],
    patterns: ['strangler-fig', 'branch-by-abstraction', 'feature-toggle', 'characterization-test'],
    complexity: 2
  },
  {
    id: 'testability',
    kind: 'duplication',
    text: '依赖真实外部系统导致测试缓慢、不稳定或无法编写',
    pattern: /难以测试|不好测|测试不稳定|mock|打桩|测试覆盖|contract\s+test|契约/i,
    domains: ['testing'],
    patterns: ['test-double', 'contract-test', 'dependency-injection']
  },
  {
    id: 'scale-pressure',
    kind: 'scale',
    text: '数据量或并发规模超出当前实现的承载能力',
    pattern: /数据量大|并发高|扛不住|压力|吞吐|scale|throughput|限流/i,
    domains: ['performance', 'async'],
    patterns: ['concurrency-limit', 'batching', 'worker-offloading'],
    complexity: 2
  }
];

/**
 * @param {string} text
 * @param {object} [options]
 * @param {Array<{text:string, evidence?:string[]}>} [options.projectFacts]
 *        problems observed in the codebase rather than stated by the user
 * @returns {DetectedProblem[]}
 */
export function detectProblems(text, options = {}) {
  const prompt = String(text ?? '');
  const problems = [];

  for (const signature of SIGNATURES) {
    if (!signature.pattern.test(prompt)) continue;
    problems.push({
      id: signature.id,
      kind: signature.kind,
      text: signature.text,
      source: 'request',
      domains: [...signature.domains],
      patterns: [...signature.patterns],
      complexity: signature.complexity ?? 1,
      evidence: [`请求中出现该问题的描述特征（${signature.id}）`]
    });
  }

  for (const fact of options.projectFacts ?? []) {
    const factText = String(fact?.text ?? fact ?? '');
    for (const signature of SIGNATURES) {
      if (!signature.pattern.test(factText)) continue;
      const existing = problems.find((problem) => problem.id === signature.id);
      const evidence = fact?.evidence ?? [factText];
      if (existing) {
        existing.evidence.push(...evidence);
        continue;
      }
      problems.push({
        id: signature.id,
        kind: signature.kind,
        text: signature.text,
        source: 'project',
        domains: [...signature.domains],
        patterns: [...signature.patterns],
        complexity: signature.complexity ?? 1,
        evidence: [...evidence]
      });
    }
  }

  return problems;
}

/**
 * Problem complexity, which sets the over-engineering bar in scoring.
 *
 * Breadth is one input: a request surfacing five interacting concerns is
 * harder than one surfacing a single concern. But breadth alone would rate
 * "十万行表格滚动很卡" as trivial simply because it is one problem, so a
 * signature can also declare intrinsic difficulty and the two are combined by
 * taking whichever is higher.
 */
export function assessComplexity(problems, options = {}) {
  if (options.declaredComplexity) return clamp(options.declaredComplexity, 1, 3);
  if (problems.length === 0) return 1;

  const distinctKinds = new Set(problems.map((problem) => problem.kind)).size;
  let breadth = 1;
  if (problems.length >= 5 || distinctKinds >= 4) breadth = 3;
  else if (problems.length >= 2 || distinctKinds >= 2) breadth = 2;

  const intrinsic = Math.max(...problems.map((problem) => problem.complexity ?? 1));
  return clamp(Math.max(breadth, intrinsic), 1, 3);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Variation points are the subset of problems that justify abstraction at all. */
export function variationPoints(problems) {
  return problems
    .filter((problem) => ['variation', 'extension', 'migration'].includes(problem.kind))
    .map((problem) => ({ id: problem.id, description: problem.text, source: problem.source }));
}

export { SIGNATURES as PROBLEM_SIGNATURES };
