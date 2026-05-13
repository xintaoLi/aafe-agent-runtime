const patternCatalog = [
  {
    name: 'Strategy',
    signals: ['multiple algorithms', '可替换算法', '多种策略', '多种', '算法', '布局', 'layout', 'format', 'sort', 'provider'],
    fit: '同一能力存在多种可替换实现，需要运行时选择或后续扩展。',
    tradeoff: '增加抽象层；简单 if/else 场景不应过早使用。'
  },
  {
    name: 'Factory',
    signals: ['create', 'instantiate', '创建不同类型', 'node type', 'component type'],
    fit: '对象创建逻辑复杂，且调用方不应关心具体类型构造细节。',
    tradeoff: '隐藏构造细节，但可能让简单对象创建变复杂。'
  },
  {
    name: 'Registry',
    signals: ['plugin', 'extension', '注册', '扩展', '扩展点', 'node runtime', 'component map'],
    fit: '需要开放扩展点，让外部能力可注册、查找、替换。',
    tradeoff: '可扩展性强，但需要治理 key、生命周期和冲突。'
  },
  {
    name: 'State Machine',
    signals: ['workflow', '状态流转', 'approval', 'wizard', '多步骤', 'lifecycle'],
    fit: '状态多、流转规则明确、非法状态需要被禁止。',
    tradeoff: '建模成本更高；简单 loading/error/success 可不用。'
  },
  {
    name: 'Command',
    signals: ['undo', 'redo', 'history', '撤销', '重做', '操作记录'],
    fit: '用户操作需要记录、回放、撤销、重做或审计。',
    tradeoff: '需要定义命令边界和副作用补偿。'
  },
  {
    name: 'Pipeline',
    signals: ['steps', '链路', '处理流程', '校验', 'transform', 'middleware'],
    fit: '任务由稳定的多个阶段串联，每阶段可插拔或可观测。',
    tradeoff: '链路过长会增加调试成本。'
  },
  {
    name: 'Observer',
    signals: ['subscribe', 'event', '监听', '通知', 'publish'],
    fit: '一处变化需要通知多个订阅方，且发布方不应依赖订阅方。',
    tradeoff: '易形成隐式依赖；需要事件命名和生命周期治理。'
  },
  {
    name: 'Adapter',
    signals: ['third-party', '第三方', '兼容', 'bridge', 'wrapper'],
    fit: '需要隔离外部 API 或兼容不同实现。',
    tradeoff: '多一层包装，但能降低外部变化影响。'
  },
  {
    name: 'Composition',
    signals: ['component', '组合', 'slot', 'children', 'headless'],
    fit: 'UI 能力需要通过组合而不是继承扩展。',
    tradeoff: '灵活但需要清晰的 props/slot 契约。'
  }
];

export function analyzePatternFit(input = {}) {
  const text = String(input.prompt ?? input.request ?? input).toLowerCase();
  const constraints = input.constraints ?? {};
  const scored = patternCatalog.map((pattern) => {
    let score = 0;
    const matchedSignals = [];
    for (const signal of pattern.signals) {
      if (text.includes(signal.toLowerCase())) {
        score += 2;
        matchedSignals.push(signal);
      }
    }
    if (constraints.extensible) score += ['Strategy', 'Registry', 'Adapter'].includes(pattern.name) ? 1 : 0;
    if (constraints.stateful) score += pattern.name === 'State Machine' ? 2 : 0;
    if (constraints.undoable) score += pattern.name === 'Command' ? 3 : 0;
    if (constraints.multiStep) score += pattern.name === 'Pipeline' ? 2 : 0;
    return { ...pattern, score, matchedSignals };
  }).sort((a, b) => b.score - a.score);

  const top = scored.filter((item) => item.score > 0).slice(0, 3);
  return {
    status: top.length ? 'pass' : 'warn',
    recommendation: top[0]?.name ?? 'Composition',
    candidates: top.length ? top : scored.slice(0, 3),
    questions: buildQuestions(text, constraints)
  };
}

export function buildPatternInterview(prompt = '') {
  return buildQuestions(String(prompt).toLowerCase(), {});
}

function buildQuestions(text, constraints) {
  const questions = [];
  if (!constraints.extensible && !/扩展|plugin|strategy|provider|多种/.test(text)) {
    questions.push('这个功能未来是否会出现多种实现、算法或供应商，需要可插拔扩展？');
  }
  if (!constraints.stateful && !/状态|workflow|流程|lifecycle/.test(text)) {
    questions.push('这个功能是否存在复杂状态流转、非法状态或多步骤生命周期？');
  }
  if (!constraints.undoable && !/undo|redo|撤销|重做|history/.test(text)) {
    questions.push('用户操作是否需要撤销/重做/回放/审计？');
  }
  if (!constraints.multiStep && !/pipeline|步骤|链路|校验/.test(text)) {
    questions.push('处理过程是否由多个固定阶段组成，且每个阶段可能插拔或复用？');
  }
  return questions.slice(0, 4);
}

export { patternCatalog };
