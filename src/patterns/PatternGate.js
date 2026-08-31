/**
 * Frontend Pattern Enablement Gate.
 *
 * Same principle as the DDD gate, and the same failure it prevents: a codebase
 * full of `factory`, `adapter`, `observer` and `strategy` says nothing about
 * whether the user wants a design-pattern exercise. The previous router matched
 * those words bare, so "把这个 adapter 改一下" became a pattern-composition
 * analysis.
 *
 * Architecture analysis must not silently become pattern analysis, performance
 * work must not become performance-pattern work, and state management must not
 * activate the state-pattern skills.
 */

export const GATE_ENABLED = 'enabled';
export const GATE_DISABLED = 'disabled';
export const GATE_AMBIGUOUS = 'ambiguous';

/** Phrases that establish design-pattern intent on their own. */
const EXPLICIT_INTENT = [
  { pattern: /设计模式/, label: '设计模式' },
  { pattern: /模式组合/, label: '模式组合' },
  { pattern: /模式重构|重构成.{0,6}模式/, label: '模式重构' },
  { pattern: /架构模式/, label: '架构模式' },
  { pattern: /design\s+patterns?/i, label: 'design pattern' },
  { pattern: /pattern[-\s](?:based|composition|refactoring|optimi[sz]ation|analysis|engineering)/i, label: 'pattern work' },
  { pattern: /(?:composition|refactor(?:ing)?|analysis|catalog)\s+of\s+patterns/i, label: 'pattern work' },
  { pattern: /反模式|anti[-\s]?pattern/i, label: 'anti-pattern' }
];

/**
 * Named patterns. On their own these are just vocabulary; combined with a
 * design verb they are a request. "重构这个 adapter" is maintenance,
 * "用 adapter 模式重构" is pattern work — but the latter already carries 模式,
 * so the bar here is deliberately high.
 */
const PATTERN_NOUNS = [
  /\bstrategy\s+pattern\b/i, /策略模式/,
  /\bfactory\s+pattern\b/i, /工厂模式/,
  /\bobserver\s+pattern\b/i, /观察者模式/,
  /\bstate\s+machine\s+pattern\b/i, /状态机模式/,
  /\bcommand\s+pattern\b/i, /命令模式/,
  /\badapter\s+pattern\b/i, /适配器模式/,
  /\bfacade\s+pattern\b/i, /门面模式/,
  /\brepository\s+pattern\b/i, /仓储模式/,
  /\bsingleton\s+pattern\b/i, /单例模式/,
  /\bdecorator\s+pattern\b/i, /装饰器模式/
];

/**
 * Reads like pattern work but never says so. Answering these with a pattern
 * composition when the user wanted a code review is the failure mode.
 */
const AMBIGUOUS_TERMS = [
  { pattern: /架构设计|architecture\s+design/i, label: '架构设计' },
  { pattern: /怎么(?:设计|组织|拆)|如何(?:设计|组织|拆)/, label: '设计咨询' },
  { pattern: /最佳实践|best\s+practices?/i, label: '最佳实践' },
  { pattern: /代码结构|code\s+structure/i, label: '代码结构' }
];

/**
 * Implementation vocabulary that must never move the decision. Recorded so the
 * gate can show it saw the terms and ignored them on purpose.
 */
const BARE_TERMINOLOGY = [
  /\bclass\b/i, /\binterfaces?\b/i, /\bfactor(?:y|ies)\b/i, /\bservices?\b/i,
  /\bobservers?\b/i, /\bevents?\b/i, /\bstores?\b/i, /\breducers?\b/i,
  /\bhooks?\b/i, /\bcomponents?\b/i, /\badapters?\b/i, /\bstrateg(?:y|ies)\b/i,
  /\bsingletons?\b/i, /\bfacades?\b/i, /\bcommands?\b/i, /\bmiddlewares?\b/i,
  /组件/, /服务/, /事件/, /仓库/, /适配器/
];

/** Explicit non-activation signals from the spec. */
const NON_ACTIVATION = [
  /普通(?:代码)?重构/, /性能优化/, /bug\s*修复/i, /修复/, /组件开发/, /api\s*开发/i,
  /状态管理/, /react\s*开发/i, /vue\s*开发/i, /typescript\s*开发/i, /css\s*优化/i, /构建优化/
];

/** Requests for the whole catalog rather than one problem. */
const FULL_SCOPE_ADVERB = /完整|全量|全面|端到端|系统性|整体|end[-\s]?to[-\s]?end|\bfull\b|\bcomplete\b/i;

/**
 * Maps an activated request onto the capability asked for. First match wins.
 */
const CAPABILITY_SIGNALS = [
  { capability: 'anti-pattern-audit', pattern: /反模式|anti[-\s]?pattern|过度设计|over[-\s]?engineer|滥用|审计|audit/i },
  { capability: 'migration', pattern: /迁移|migration|渐进替换|strangler|重构成|改造/i },
  { capability: 'composition', pattern: /组合|composition|搭配|协作|整体架构/i },
  { capability: 'validation', pattern: /验证|校验|检查|validate|review|评估/i },
  { capability: 'selection', pattern: /选型|选择|该用|适合|selection|choose|which/i },
  { capability: 'discovery', pattern: /分析|识别|梳理|discovery|analy[sz]|identify/i }
];

/**
 * @typedef {object} PatternGateDecision
 * @property {boolean} enabled
 * @property {'enabled'|'disabled'|'ambiguous'} decision
 * @property {string} reason
 * @property {'full'|'partial'|'none'} scope
 * @property {string[]} requestedCapabilities
 * @property {string|null} clarification
 * @property {{explicit:string[], patternNouns:string[], ambiguous:string[], ignoredTerminology:string[]}} signals
 */

/**
 * @param {string|{prompt?:string, request?:string}} input
 * @returns {PatternGateDecision}
 */
export function evaluatePatternGate(input = {}) {
  const text = String(input?.prompt ?? input?.request ?? input ?? '').trim();
  const empty = { explicit: [], patternNouns: [], ambiguous: [], ignoredTerminology: [] };
  if (!text) return disabled('empty-request', empty);

  const signals = {
    explicit: unique(EXPLICIT_INTENT.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label)),
    patternNouns: PATTERN_NOUNS.filter((pattern) => pattern.test(text)).map(String),
    ambiguous: unique(AMBIGUOUS_TERMS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label)),
    ignoredTerminology: BARE_TERMINOLOGY.filter((pattern) => pattern.test(text)).map(String)
  };

  if (signals.explicit.length > 0) {
    return enable(text, signals, `explicit design-pattern intent: ${signals.explicit.join(', ')}`);
  }

  // "Strategy Pattern" / "策略模式" names a pattern outright, which is a request
  // even without the generic word 设计模式.
  if (signals.patternNouns.length > 0) {
    return enable(text, signals, 'request names a specific design pattern');
  }

  if (NON_ACTIVATION.some((pattern) => pattern.test(text))) {
    return disabled('request is ordinary development work, not pattern work', signals);
  }

  if (signals.ambiguous.length > 0) {
    return {
      enabled: false,
      decision: GATE_AMBIGUOUS,
      reason: `request mentions ${signals.ambiguous.join(', ')} without establishing design-pattern intent`,
      scope: 'none',
      requestedCapabilities: [],
      clarification: '这个需求要做设计模式分析吗？（识别问题与变化点，给出模式组合与取舍）还是只需要按现有结构直接实现？',
      signals
    };
  }

  return disabled('no explicit design-pattern intent in the request', signals);
}

/** Convenience predicate for callers that only need the yes/no. */
export function isPatternEnabled(input) {
  return evaluatePatternGate(input).enabled;
}

function enable(text, signals, reason) {
  const scope = FULL_SCOPE_ADVERB.test(text) ? 'full' : 'partial';
  const found = CAPABILITY_SIGNALS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.capability);
  return {
    enabled: true,
    decision: GATE_ENABLED,
    reason,
    scope,
    // Selection without discovery is guessing, so a bare request gets the
    // discovery-through-composition path rather than a naked recommendation.
    requestedCapabilities: scope === 'full' ? ['full'] : (found.length > 0 ? unique(found) : ['composition']),
    clarification: null,
    signals
  };
}

function disabled(reason, signals) {
  return {
    enabled: false,
    decision: GATE_DISABLED,
    reason,
    scope: 'none',
    requestedCapabilities: [],
    clarification: null,
    signals
  };
}

function unique(values) {
  return [...new Set(values)];
}
