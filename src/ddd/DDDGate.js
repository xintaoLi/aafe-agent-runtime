/**
 * DDD Enablement Gate — the single entry point to the DDD skill system.
 *
 * The rule this enforces is easy to state and easy to get wrong: DDD is opt-in
 * on explicit user intent, never on code structure. A project full of
 * `Repository`, `Entity` and `Service` classes says nothing about whether the
 * user wants domain-driven design; treating that vocabulary as activation turns
 * every ordinary refactor into a modeling exercise the user never asked for.
 *
 * So the decision is made on the request text alone, and bare terminology is
 * explicitly a non-signal.
 */

export const GATE_ENABLED = 'enabled';
export const GATE_DISABLED = 'disabled';
export const GATE_AMBIGUOUS = 'ambiguous';

/**
 * Tokens that carry DDD intent on their own. Anything paired with one of these
 * is a DDD request, which is what makes "帮我按照 DDD 分析 Repository 层"
 * activate while "帮我分析 Repository 层" does not.
 */
const DDD_MARKERS = [
  { pattern: /\bddd\b/i, label: 'ddd' },
  { pattern: /domain[-\s]?driven/i, label: 'domain-driven' },
  { pattern: /领域驱动/, label: '领域驱动' }
];

/**
 * Artifacts specific enough to DDD that asking to design one is asking for DDD.
 *
 * Entity, Repository and Service are deliberately absent: they are ordinary
 * software vocabulary and DDD.md lists them as non-activation signals.
 */
const DDD_ARTIFACTS = [
  { pattern: /bounded[-\s]?context/i, label: 'bounded-context' },
  { pattern: /限界上下文/, label: 'bounded-context' },
  { pattern: /context[-\s]?map(?:ping)?/i, label: 'context-map' },
  { pattern: /上下文映射/, label: 'context-map' },
  { pattern: /\baggregates?\b/i, label: 'aggregate' },
  // Bare 聚合 is ordinary Chinese for grouping data, so it only counts when it
  // is unmistakably the DDD building block.
  { pattern: /聚合根|聚合(?:设计|建模|边界|划分)|(?:设计|建模|划分)聚合/, label: 'aggregate' },
  { pattern: /domain[-\s]?events?/i, label: 'domain-event' },
  { pattern: /领域事件/, label: 'domain-event' },
  { pattern: /domain[-\s]?model/i, label: 'domain-model' },
  { pattern: /领域模型/, label: 'domain-model' },
  { pattern: /ubiquitous[-\s]?language/i, label: 'ubiquitous-language' },
  { pattern: /通用语言|统一语言/, label: 'ubiquitous-language' }
];

/**
 * A design or modeling verb. An artifact alone ("这个聚合查询很慢") is not a
 * request to model it.
 *
 * 优化, 落地 and 拆分 are deliberately excluded even though DDD.md lists
 * "DDD 优化" and "DDD 落地" as activation signals: those carry the DDD marker
 * and are caught earlier, while "性能优化" and "模块拆分" are explicit
 * non-activation signals that these verbs would otherwise drag in.
 */
const DESIGN_VERB = /设计|建模|重构|映射|建立|梳理|划分|design|model(?:l?ing)?|refactor|map(?:ping)?|establish|migrat/i;

/**
 * Reads as domain work but never says DDD. Materially different answers depend
 * on which the user meant, so the gate asks instead of guessing.
 *
 * Only the gerund forms belong here. "领域建模" and "domain modeling" are vague
 * about method, while "领域模型重构" and "Domain Model 设计" name an artifact and
 * an action and are listed by DDD.md as activation signals.
 */
const AMBIGUOUS_TERMS = [
  { pattern: /领域建模/, label: '领域建模' },
  { pattern: /业务建模/, label: '业务建模' },
  { pattern: /领域设计/, label: '领域设计' },
  { pattern: /domain\s+modell?ing/i, label: 'domain modeling' },
  { pattern: /domain\s+design/i, label: 'domain design' }
];

/**
 * Artifacts that an ambiguous phrase can produce as a side effect: "domain
 * modeling" contains "domain model". Seeing only these alongside an ambiguous
 * term means the ambiguity stands.
 */
const AMBIGUITY_SHADOWED_ARTIFACTS = new Set(['domain-model']);

/**
 * Vocabulary whose presence must never move the decision. Tracked only so the
 * gate can explain that it saw the terms and deliberately ignored them.
 */
const BARE_TERMINOLOGY = [
  /\bentit(?:y|ies)\b/i, /实体/,
  /\brepositor(?:y|ies)\b/i, /仓储/,
  /\bservices?\b/i, /服务层/,
  /\bvalue[-\s]?objects?\b/i, /值对象/,
  /\buse[-\s]?cases?\b/i, /用例/,
  /\bcontrollers?\b/i,
  /clean\s+architecture/i, /整洁架构/,
  /hexagonal/i, /六边形/
];

/**
 * Requests for the whole chain rather than one capability. Matched as a bare
 * adverb because it is only ever consulted once DDD intent is already
 * established, and Chinese puts it on either side of the noun ("完整落地 DDD"
 * and "DDD 全量落地" mean the same thing).
 */
const FULL_SCOPE_ADVERB = /完整|全量|全面|端到端|全流程|改造成|end[-\s]?to[-\s]?end|\bfull\b|\bcomplete\b/i;

/**
 * Maps an activated request onto the capability it asked for. Order matters:
 * the first match wins, so the more specific capabilities come first.
 */
const CAPABILITY_SIGNALS = [
  { capability: 'validation', pattern: /验证|校验|检查|validate|validation|check|audit/i },
  { capability: 'refactoring', pattern: /重构|改造|迁移|refactor|migrat|restructur/i },
  { capability: 'aggregate-design', pattern: /aggregate|聚合/i },
  { capability: 'context-mapping', pattern: /context[-\s]?map(?:ping)?|上下文映射/i },
  { capability: 'bounded-context', pattern: /bounded[-\s]?context|限界上下文/i },
  { capability: 'domain-event', pattern: /domain[-\s]?events?|领域事件/i },
  { capability: 'architecture', pattern: /架构|architecture|分层|layer/i },
  { capability: 'strategic-design', pattern: /战略|strategic|子域|subdomain/i },
  { capability: 'tactical-design', pattern: /战术|tactical/i },
  { capability: 'documentation', pattern: /文档|documentation|输出文档/i },
  { capability: 'analysis', pattern: /分析|analy[sz]/i }
];

/**
 * @typedef {object} DDDGateDecision
 * @property {boolean} enabled
 * @property {'enabled'|'disabled'|'ambiguous'} decision
 * @property {string} reason
 * @property {'full'|'partial'|'none'} scope
 * @property {string[]} requestedCapabilities
 * @property {string|null} clarification Question to ask when ambiguous.
 * @property {{explicit:string[], artifacts:string[], ambiguous:string[], ignoredTerminology:string[]}} signals
 */

/**
 * @param {string|{prompt?:string, request?:string}} input
 * @returns {DDDGateDecision}
 */
export function evaluateDDDGate(input = {}) {
  const text = String(input?.prompt ?? input?.request ?? input ?? '').trim();
  if (!text) return disabled('empty-request', { explicit: [], artifacts: [], ambiguous: [], ignoredTerminology: [] });

  const explicit = DDD_MARKERS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
  const artifacts = DDD_ARTIFACTS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
  const ambiguous = AMBIGUOUS_TERMS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
  const ignoredTerminology = BARE_TERMINOLOGY.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern));
  const signals = {
    explicit: unique(explicit),
    artifacts: unique(artifacts),
    ambiguous: unique(ambiguous),
    ignoredTerminology
  };

  if (signals.explicit.length > 0) {
    return enable(text, signals, `explicit DDD intent: ${signals.explicit.join(', ')}`);
  }

  const onlyShadowedArtifacts = signals.artifacts.every((label) => AMBIGUITY_SHADOWED_ARTIFACTS.has(label));
  if (signals.ambiguous.length > 0 && onlyShadowedArtifacts) {
    return {
      enabled: false,
      decision: GATE_AMBIGUOUS,
      reason: `request mentions ${signals.ambiguous.join(', ')} without establishing Domain-Driven Design`,
      scope: 'none',
      requestedCapabilities: [],
      clarification: '这个需求要按 Domain-Driven Design 来做吗？（涉及限界上下文、聚合与领域事件的建模）还是只需要常规的业务建模？',
      signals
    };
  }

  // A DDD-specific artifact plus a design verb is an explicit request even
  // without the letters "DDD": "设计 Aggregate" leaves no room for doubt.
  if (signals.artifacts.length > 0 && DESIGN_VERB.test(text)) {
    return enable(text, signals, `explicit DDD artifact design request: ${signals.artifacts.join(', ')}`);
  }

  if (signals.artifacts.length > 0) {
    return disabled(`DDD vocabulary present but no design intent: ${signals.artifacts.join(', ')}`, signals);
  }

  return disabled('no explicit DDD intent in the request', signals);
}

/**
 * Convenience predicate for callers that only need the yes/no.
 */
export function isDDDEnabled(input) {
  return evaluateDDDGate(input).enabled;
}

function enable(text, signals, reason) {
  const scope = FULL_SCOPE_ADVERB.test(text) ? 'full' : 'partial';
  return {
    enabled: true,
    decision: GATE_ENABLED,
    reason,
    scope,
    requestedCapabilities: scope === 'full' ? ['full'] : capabilitiesFor(text, signals),
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

function capabilitiesFor(text, signals) {
  const found = CAPABILITY_SIGNALS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.capability);
  if (found.length > 0) return unique(found);
  // Enabled with no narrower signal means the user asked for DDD in general.
  return signals.artifacts.length > 0 ? ['tactical-design'] : ['analysis'];
}

function unique(values) {
  return [...new Set(values)];
}
