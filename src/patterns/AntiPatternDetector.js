/**
 * Anti-pattern detection.
 *
 * Two distinct jobs share this module, and conflating them would be a mistake.
 *
 * Descriptive detection looks at the project as it is and names what has gone
 * wrong — God Component, Prop Drilling, Event Spaghetti. It needs evidence
 * from the codebase or an explicit description; guessing from a feature
 * request produces accusations, not findings.
 *
 * Prescriptive detection looks at a composition this system is about to
 * recommend and asks whether the recommendation is itself the anti-pattern.
 * That is the check ANTI-PATTERN-003 and 004 exist for, and skipping it is how
 * a pattern advisor turns into an abstraction generator.
 */

import { PATTERN_BY_ID } from './catalog.js';

export const ANTI_PATTERN_RULES = Object.freeze([
  { id: 'ANTI-PATTERN-001', text: 'A pattern used outside its problem domain is a potential anti-pattern.' },
  { id: 'ANTI-PATTERN-002', text: 'Multiple patterns with overlapping responsibility MUST be reviewed.' },
  { id: 'ANTI-PATTERN-003', text: 'A pattern that increases complexity without reducing meaningful change cost MUST be rejected.' },
  { id: 'ANTI-PATTERN-004', text: 'Pattern count MUST NOT justify architecture quality.' },
  { id: 'ANTI-PATTERN-005', text: 'Generic abstractions MUST NOT hide business semantics.' },
  { id: 'ANTI-PATTERN-006', text: 'Global state MUST NOT become the default integration mechanism.' },
  { id: 'ANTI-PATTERN-007', text: 'Event Bus MUST NOT replace normal function calls without architectural justification.' }
]);

/**
 * The 24 anti-patterns from the spec, each tied to the rule it violates and
 * the direction that resolves it.
 */
export const ANTI_PATTERN_CATALOG = Object.freeze([
  ap('god-component', 'God Component', 'component', 'ANTI-PATTERN-005',
    /巨型组件|组件太大|上千行|god\s+component|一个组件(?:干|做)了/i,
    '单个组件同时承担取数、业务规则、状态与渲染',
    '按 Container/Presentational 或 Custom Hook 拆出取数与逻辑'),
  ap('god-service', 'God Service', 'structural', 'ANTI-PATTERN-005',
    /万能\s*service|service\s*太大|god\s+service|service\s*里什么都有/i,
    '单个 service 聚合了不相关的业务能力',
    '按业务能力拆分，边界对齐 feature 或限界上下文'),
  ap('god-store', 'God Store', 'state', 'ANTI-PATTERN-006',
    /store\s*太大|全局\s*store|god\s+store|所有状态(?:都)?(?:放|在)/i,
    '所有状态塞进单一 store，写入方不可控',
    '区分服务端状态、UI 状态与真正的全局状态，就近管理'),
  ap('god-facade', 'God Facade', 'structural', 'ANTI-PATTERN-005',
    /facade\s*太大|门面.{0,4}什么都|god\s+facade/i,
    'Facade 从简化入口退化为无边界的转发层',
    'Facade 只暴露用例级操作，不做业务判断'),
  ap('god-event-bus', 'God Event Bus', 'event', 'ANTI-PATTERN-007',
    /事件总线.{0,6}(?:什么都|所有)|god\s+event\s*bus|全靠事件/i,
    '所有模块通信都走事件总线，调用关系不可追踪',
    '同层直接调用，仅跨边界的真实业务事件走总线'),
  ap('god-context', 'God Context', 'component', 'ANTI-PATTERN-006',
    /context\s*太大|一个\s*context.{0,6}(?:全部|所有)|god\s+context/i,
    '单个 Context 承载全部数据，任何变更触发全树重渲染',
    '按变更频率拆分 Context，或改用 selector 订阅'),
  ap('god-hook', 'God Hook', 'component', 'ANTI-PATTERN-005',
    /hook\s*太大|一个\s*hook.{0,6}(?:全部|所有|干了)|god\s+hook/i,
    '单个 Hook 内聚了多个无关关注点',
    '按关注点拆分 Hook，每个只回答一个问题'),
  ap('god-utility', 'God Utility', 'module', 'ANTI-PATTERN-005',
    /utils?\s*(?:太大|什么都)|工具(?:类|函数).{0,4}(?:什么都|大杂烩)|helper\s*里/i,
    'utils 成为无归属代码的垃圾桶',
    '把工具函数归还到它服务的业务模块'),
  ap('singleton-abuse', 'Singleton Abuse', 'creational', 'ANTI-PATTERN-006',
    /单例.{0,4}(?:滥用|到处)|全局(?:变量|实例).{0,4}(?:到处|滥用)|singleton\s+everywhere/i,
    '用单例做全局可变状态而非真正的唯一实例约束',
    '改为显式依赖注入，让依赖关系可见可测'),
  ap('factory-abuse', 'Factory Abuse', 'creational', 'ANTI-PATTERN-003',
    /工厂.{0,4}(?:滥用|套娃)|factory\s+(?:abuse|everywhere)|包了(?:一|好几)层工厂/i,
    'Factory 包装了没有变化的构造过程',
    '构造无变化时直接 new 或直接调用'),
  ap('observer-explosion', 'Observer Explosion', 'event', 'ANTI-PATTERN-007',
    /监听.{0,4}(?:太多|爆炸)|订阅.{0,4}(?:太多|满天飞)|observer\s+explosion/i,
    '订阅关系数量失控，无人知道谁在监听谁',
    '收敛订阅入口，建立事件命名与生命周期治理'),
  ap('event-spaghetti', 'Event Spaghetti', 'event', 'ANTI-PATTERN-007',
    /事件(?:满天飞|乱飞|链路乱)|event\s+spaghetti|事件.{0,4}追踪不了/i,
    '事件互相触发形成隐式控制流',
    '禁止事件链式触发，改为显式编排'),
  ap('state-explosion', 'State Explosion', 'state', 'ANTI-PATTERN-003',
    /状态(?:太多|爆炸)|useState.{0,6}(?:一堆|十几)|state\s+explosion/i,
    '布尔状态组合出大量非法状态',
    '用状态机或联合类型让非法状态不可表达'),
  ap('global-state-abuse', 'Global State Abuse', 'state', 'ANTI-PATTERN-006',
    /全局状态.{0,4}(?:滥用|到处)|什么都(?:放|塞)(?:进)?全局|global\s+state\s+abuse/i,
    '全局状态成为模块间默认集成方式',
    '就近管理状态，跨模块通过显式接口协作'),
  ap('prop-drilling', 'Prop Drilling', 'component', 'ANTI-PATTERN-005',
    /逐层传递|层层传递|prop\s*drilling|传了(?:好)?几层/i,
    '中间组件被迫感知它不使用的数据',
    '用 Provider 提供作用域依赖，或提升状态到共同祖先'),
  ap('circular-dependency', 'Circular Dependency', 'module', 'ANTI-PATTERN-002',
    /循环依赖|circular\s+dependenc|互相引用|相互\s*import/i,
    '模块互相依赖，无法独立理解与测试',
    '提取共享抽象或反转依赖方向'),
  ap('abstraction-explosion', 'Abstraction Explosion', 'architecture', 'ANTI-PATTERN-003',
    /抽象.{0,4}(?:过多|太多|层层)|(?:好几|多)层(?:包装|抽象)|abstraction\s+explosion/i,
    '抽象层数超过其隔离的变化数量',
    '删除没有对应变化点的抽象层'),
  ap('premature-abstraction', 'Premature Abstraction', 'architecture', 'ANTI-PATTERN-003',
    /过早(?:抽象|优化|设计)|premature\s+(?:abstraction|optimization)|为了(?:以后|将来)/i,
    '为尚未出现的变化预留扩展点',
    '等到第二个用例出现再抽象'),
  ap('pattern-overuse', 'Pattern Overuse', 'architecture', 'ANTI-PATTERN-004',
    /模式(?:滥用|用太多|堆砌)|过度设计|over[-\s]?engineer|pattern\s+overuse/i,
    '模式数量被当作架构质量的证明',
    '按 Rule 011 收敛到最小充分组合'),
  ap('pattern-mismatch', 'Pattern Mismatch', 'architecture', 'ANTI-PATTERN-001',
    /模式(?:用错|不合适|错配)|pattern\s+mismatch|生搬硬套/i,
    '模式被用在它不解决的问题上',
    '回到问题本身重新选型'),
  ap('leaky-abstraction', 'Leaky Abstraction', 'structural', 'ANTI-PATTERN-005',
    /抽象泄漏|leaky\s+abstraction|封装(?:了但|没封住)|还是要知道(?:内部|底层)/i,
    '调用方仍需了解被封装的实现细节',
    '让抽象以调用方的语言表达，而不是实现的语言'),
  ap('repository-everywhere', 'Repository Everywhere', 'data', 'ANTI-PATTERN-001',
    /每个.{0,6}都(?:有|加).{0,4}repository|repository\s+everywhere|仓储.{0,4}到处/i,
    '为没有数据访问变化的对象套上仓储层',
    '只在数据来源确实可能变化时引入 Repository'),
  ap('service-everywhere', 'Service Everywhere', 'structural', 'ANTI-PATTERN-001',
    /每个.{0,6}都(?:有|加).{0,4}service|service\s+everywhere|一个模型一个\s*service/i,
    'Service 成为默认落点而非职责划分结果',
    '让行为回到它所属的模型或用例中'),
  ap('adapter-everywhere', 'Adapter Everywhere', 'structural', 'ANTI-PATTERN-001',
    /到处.{0,4}adapter|adapter\s+everywhere|每个接口.{0,6}适配/i,
    '为内部稳定接口也加适配层',
    '只在跨越外部边界处适配'),
  ap('facade-everywhere', 'Facade Everywhere', 'structural', 'ANTI-PATTERN-001',
    /到处.{0,4}facade|facade\s+everywhere|每层都(?:有|加).{0,4}门面/i,
    '每一层都加门面，形成纯转发链',
    '只在子系统边界处提供门面')
]);

/**
 * @typedef {object} AntiPatternFinding
 * @property {string} id
 * @property {string} name
 * @property {string} rule
 * @property {'observed'|'predicted'} kind
 * @property {'high'|'medium'|'low'} severity
 * @property {string} description
 * @property {string} remediation
 * @property {string[]} evidence
 */

/**
 * @param {object} input
 * @param {string} [input.prompt]
 * @param {Array<{text:string, evidence?:string[]}>} [input.projectFacts]
 * @param {import('./PatternComposer.js').PatternComposition} [input.composition]
 * @returns {{status:'pass'|'warn', findings:AntiPatternFinding[], checkedRules:string[]}}
 */
export function detectAntiPatterns(input = {}) {
  const findings = [
    ...detectFromDescription(input),
    ...detectFromComposition(input.composition)
  ];

  return {
    status: findings.some((finding) => finding.severity === 'high') ? 'warn' : 'pass',
    findings: dedupe(findings),
    checkedRules: ANTI_PATTERN_RULES.map((rule) => rule.id)
  };
}

/** Matches the catalog against what the user or the codebase actually says. */
function detectFromDescription({ prompt = '', projectFacts = [] }) {
  const findings = [];
  const sources = [
    { text: String(prompt), origin: 'request', label: '请求描述' },
    ...projectFacts.map((fact) => ({
      text: String(fact?.text ?? fact ?? ''),
      origin: 'project',
      label: '项目证据',
      evidence: fact?.evidence
    }))
  ];

  for (const source of sources) {
    if (!source.text) continue;
    for (const entry of ANTI_PATTERN_CATALOG) {
      if (!entry.pattern.test(source.text)) continue;
      findings.push({
        id: entry.id,
        name: entry.name,
        rule: entry.rule,
        kind: 'observed',
        // Something the project demonstrably does outranks something a request
        // merely mentions in passing.
        severity: source.origin === 'project' ? 'high' : 'medium',
        description: entry.description,
        remediation: entry.remediation,
        evidence: source.evidence ?? [`${source.label}中出现「${entry.name}」特征`]
      });
    }
  }

  return findings;
}

/**
 * Audits a proposed composition. These findings are predictions about what the
 * recommendation would cause, which is the only honest way to enforce
 * ANTI-PATTERN-003 and 004 against your own output.
 */
function detectFromComposition(composition) {
  if (!composition || composition.patterns.length === 0) return [];
  const findings = [];
  const patterns = composition.patterns;

  // ANTI-PATTERN-004: size without justification.
  const weakPatterns = patterns.filter((pattern) => pattern.score <= 2);
  if (patterns.length >= 8 && weakPatterns.length >= 3) {
    findings.push({
      id: 'pattern-overuse',
      name: 'Pattern Overuse',
      rule: 'ANTI-PATTERN-004',
      kind: 'predicted',
      severity: 'high',
      description: `组合包含 ${patterns.length} 个模式，其中 ${weakPatterns.length} 个净收益很低`,
      remediation: `先落地高分模式，暂缓 ${weakPatterns.map((pattern) => pattern.name).join('、')}`,
      evidence: weakPatterns.map((pattern) => `${pattern.name} score=${pattern.score}`)
    });
  }

  // ANTI-PATTERN-003: cost without payoff.
  for (const pattern of patterns) {
    if (pattern.score > 0) continue;
    findings.push({
      id: 'premature-abstraction',
      name: 'Premature Abstraction',
      rule: 'ANTI-PATTERN-003',
      kind: 'predicted',
      severity: 'medium',
      description: `${pattern.name} 的成本高于它带来的变更收益（score ${pattern.score}）`,
      remediation: `除非它是其他模式的必需配套，否则不要引入 ${pattern.name}`,
      evidence: [...pattern.cost, ...pattern.risk]
    });
  }

  // ANTI-PATTERN-002: the composer resolved these, but a reviewer should see them.
  for (const conflict of composition.conflicts ?? []) {
    findings.push({
      id: 'pattern-mismatch',
      name: 'Overlapping Responsibility',
      rule: 'ANTI-PATTERN-002',
      kind: 'predicted',
      severity: 'low',
      description: conflict.reason,
      remediation: conflict.resolution,
      evidence: conflict.between
    });
  }

  // ANTI-PATTERN-006 / 007: patterns that become the default integration path.
  for (const pattern of patterns) {
    const definition = PATTERN_BY_ID.get(pattern.id);
    if (!definition || definition.cost.coupling < 3) continue;
    findings.push({
      id: definition.id === 'event-bus' ? 'god-event-bus' : 'global-state-abuse',
      name: `${definition.name} 治理风险`,
      rule: definition.id === 'event-bus' ? 'ANTI-PATTERN-007' : 'ANTI-PATTERN-006',
      kind: 'predicted',
      severity: 'medium',
      description: `${definition.name} 会引入隐式依赖，容易退化为默认集成方式`,
      remediation: '限定使用范围并约定命名、生命周期与允许的调用方向',
      evidence: [`${definition.name} couplingRisk=${definition.cost.coupling}`]
    });
  }

  return findings;
}

function ap(id, name, domain, rule, pattern, description, remediation) {
  return Object.freeze({ id, name, domain, rule, pattern, description, remediation });
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.id}:${finding.kind}:${finding.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
