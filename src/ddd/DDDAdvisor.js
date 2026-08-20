/**
 * DDD Advisor — proposes a domain model for a request, grounded in what the
 * project actually contains.
 *
 * Every concept it emits is tagged `observed` or `inferred`. That distinction is
 * the whole point: a bounded context read off a real module with real files is
 * a different kind of claim from one guessed out of the words in a requirement,
 * and presenting them identically is how a plausible-sounding model gets built
 * on nothing. Inferred concepts carry low confidence and are labelled
 * hypotheses (DDD.md R-STRATEGIC-010/011/012).
 */

/** Suffixes that say what a symbol is, in descending specificity. */
const SYMBOL_ROLES = [
  { suffix: /(?:Repository|Repo|Dao)$/, role: 'repositories' },
  { suffix: /(?:Event|EventHandler)$/, role: 'domainEvents' },
  { suffix: /(?:Service|Manager|Coordinator)$/, role: 'domainServices' },
  { suffix: /(?:Vo|ValueObject|Dto)$/, role: 'valueObjects' },
  { suffix: /(?:Entity|Model|Po)$/, role: 'entities' },
  { suffix: /(?:Aggregate|AggregateRoot)$/, role: 'aggregates' }
];

/** Prompt-level domain vocabulary, used only when the project offers nothing. */
const DOMAIN_SIGNALS = [
  { pattern: /权限|permission|rbac|abac/i, term: '权限', context: 'AccessControlContext', aggregate: 'PermissionPolicy' },
  { pattern: /租户|tenant/i, term: '租户', context: 'TenantContext', aggregate: 'Tenant' },
  { pattern: /组织|organization/i, term: '组织', context: 'OrganizationContext', aggregate: 'Organization' },
  { pattern: /订单|order/i, term: '订单', context: 'OrderContext', aggregate: 'Order' },
  { pattern: /支付|payment/i, term: '支付', context: 'PaymentContext', aggregate: 'Payment' },
  { pattern: /库存|inventory|stock/i, term: '库存', context: 'InventoryContext', aggregate: 'Inventory' },
  { pattern: /审批|approval|workflow/i, term: '审批', context: 'ApprovalContext', aggregate: 'ApprovalFlow' },
  { pattern: /用户|user|account/i, term: '用户', context: 'UserContext', aggregate: 'User' },
  { pattern: /角色|role/i, term: '角色', context: 'AccessControlContext', aggregate: 'Role' },
  { pattern: /商品|product|goods/i, term: '商品', context: 'CatalogContext', aggregate: 'Product' }
];

const VALUE_OBJECT_SIGNALS = [
  { pattern: /金额|价格|price|money|amount/i, name: 'Money' },
  { pattern: /时间|日期|date|period|range/i, name: 'DateRange' },
  { pattern: /权限|permission/i, name: 'PermissionScope' },
  { pattern: /地址|address/i, name: 'Address' },
  { pattern: /手机|电话|phone|mobile/i, name: 'PhoneNumber' }
];

const OBSERVED_CONFIDENCE = 0.8;
const INFERRED_CONFIDENCE = 0.3;

/**
 * @typedef {object} DDDConcept
 * @property {string} name
 * @property {'observed'|'inferred'} kind
 * @property {number} confidence
 * @property {string} rationale
 * @property {object[]} evidence
 */

/**
 * @param {{prompt?:string, request?:string, knowledge?:object}} input
 * @returns {Promise<object>}
 */
export async function analyzeDDD(input = {}) {
  const prompt = String(input?.prompt ?? input?.request ?? input ?? '');
  const knowledge = input?.knowledge ?? null;

  const observed = await collectObserved(knowledge, prompt);
  const inferred = inferFromPrompt(prompt);
  const model = mergeModel(observed, inferred);

  const observedCount = countByKind(model, 'observed');
  const inferredCount = countByKind(model, 'inferred');
  const hasLanguage = model.ubiquitousLanguage.length > 0;

  return {
    // Warn while the model rests entirely on prompt wording: it is a hypothesis
    // set, not a reading of the project.
    status: hasLanguage && observedCount > 0 ? 'pass' : 'warn',
    evidenceBased: observedCount > 0,
    observedCount,
    inferredCount,
    ...model,
    questions: buildDDDQuestions(prompt, model, observedCount)
  };
}

/**
 * Discovery questions for a request that has not been modeled yet.
 */
export function buildDDDInterview(prompt = '') {
  return buildDDDQuestions(String(prompt), emptyModel(), 0);
}

/**
 * Names only, for callers that render a summary line rather than the model.
 * @param {DDDConcept[]} concepts
 * @returns {string[]}
 */
export function conceptNames(concepts = []) {
  return concepts.map((concept) => concept.name);
}

/**
 * Reads the analyzed project for domain vocabulary. Business flows and features
 * are the closest thing the knowledge base has to business language, modules
 * are candidate context boundaries, and symbols name the tactical building
 * blocks.
 */
async function collectObserved(knowledge, prompt) {
  const model = emptyModel();
  if (!knowledge) return model;

  let relevant = [];
  try {
    if (!(await knowledge.exists())) return model;
    relevant = prompt.trim() ? await knowledge.search(prompt, { limit: 60 }) : [];
  } catch {
    return model;
  }

  const [business, features] = await Promise.all([
    safe(() => knowledge.business(), []),
    safe(() => knowledge.features(), [])
  ]);
  const byId = new Map([...business, ...features].map((item) => [item.id, item]));

  // Scoped to what the request actually matched. Walking the full feature list
  // would hand back the entire project as its own ubiquitous language.
  for (const hit of relevant) {
    if (hit.kind !== 'feature' && hit.kind !== 'business-flow') continue;
    const record = byId.get(hit.id);
    const name = record?.name ?? hit.label;
    if (!isBusinessTerm(name)) continue;
    push(model.ubiquitousLanguage, observedConcept(
      name,
      hit.kind === 'feature' ? 'feature discovered by analysis' : 'business flow discovered by analysis',
      record?.evidence
    ));
  }

  // Modules are candidate boundaries, never automatic ones: R-STRATEGIC-004
  // forbids promoting a code module to a Bounded Context on structure alone.
  const relevantModules = [];
  for (const hit of relevant) {
    if (hit.module && !relevantModules.includes(hit.module)) relevantModules.push(hit.module);
  }
  for (const moduleId of relevantModules.slice(0, 6)) {
    push(model.boundedContexts, {
      name: toContextName(moduleId),
      kind: 'observed',
      confidence: 0.5,
      rationale: `module ${moduleId} matches the request; confirm it is a semantic boundary, not just a folder`,
      evidence: [{ type: 'module', id: moduleId, reason: 'module matched the request' }]
    });
  }

  const symbols = relevant.filter((hit) => hit.kind === 'symbol' || hit.kind === 'component');
  for (const hit of symbols) {
    const role = roleFor(hit.label);
    if (!role) continue;
    push(model[role], {
      name: hit.label,
      kind: 'observed',
      confidence: OBSERVED_CONFIDENCE,
      rationale: `${hit.kind} found in the analyzed project`,
      evidence: hit.file ? [{ type: 'source', file: hit.file, reason: `${hit.kind} declaration` }] : []
    });
  }

  return model;
}

/**
 * Prompt-only inference. Kept because a greenfield request has no project to
 * read, but every result is marked as a hypothesis.
 */
function inferFromPrompt(prompt) {
  const model = emptyModel();
  if (!prompt.trim()) return model;

  for (const signal of DOMAIN_SIGNALS) {
    if (!signal.pattern.test(prompt)) continue;
    push(model.ubiquitousLanguage, inferredConcept(signal.term, 'term appears in the request'));
    push(model.boundedContexts, inferredConcept(signal.context, 'candidate context suggested by request vocabulary'));
    push(model.aggregates, inferredConcept(signal.aggregate, 'candidate aggregate suggested by request vocabulary'));
  }

  for (const signal of VALUE_OBJECT_SIGNALS) {
    if (!signal.pattern.test(prompt)) continue;
    push(model.valueObjects, inferredConcept(signal.name, 'value object suggested by request vocabulary'));
  }

  for (const aggregate of model.aggregates) {
    push(model.repositories, inferredConcept(`${aggregate.name}Repository`, `persistence port for ${aggregate.name}`));
    push(model.domainEvents, inferredConcept(`${aggregate.name}Created`, `lifecycle event for ${aggregate.name}`));
    push(model.domainEvents, inferredConcept(`${aggregate.name}Changed`, `lifecycle event for ${aggregate.name}`));
  }

  if (model.aggregates.length > 1) {
    push(model.domainServices, inferredConcept('DomainCoordinationService', 'multiple aggregates may need coordination'));
  }

  return model;
}

/**
 * Observed wins on collision: a concept the project actually contains outranks
 * the same name guessed from the request.
 */
function mergeModel(observed, inferred) {
  const merged = emptyModel();
  for (const role of Object.keys(merged)) {
    const byName = new Map();
    for (const concept of [...observed[role], ...inferred[role]]) {
      const existing = byName.get(concept.name);
      if (!existing || (existing.kind === 'inferred' && concept.kind === 'observed')) {
        byName.set(concept.name, concept);
      }
    }
    merged[role] = [...byName.values()]
      .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
      .slice(0, 20);
  }
  return merged;
}

function buildDDDQuestions(prompt, model, observedCount) {
  const questions = [];
  if (observedCount === 0) {
    questions.push('当前模型没有项目证据支撑，是否先运行 `aafe analyze` 让领域发现基于真实代码？');
  }
  if (model.boundedContexts.length === 0) {
    questions.push('这个功能属于哪个业务子域？是否存在多个 bounded context？');
  }
  if (model.aggregates.length === 0) {
    questions.push('哪个对象负责维护核心业务不变量，应作为聚合根？');
  }
  if (!/规则|policy|rule|invariant|约束/i.test(prompt)) {
    questions.push('该领域中必须始终成立的业务规则/不变量是什么？');
  }
  if (!/事件|event|通知|变更/i.test(prompt)) {
    questions.push('哪些领域变化需要作为 Domain Event 被其他模块感知？');
  }
  if (!/repository|存储|查询|持久化/i.test(prompt)) {
    questions.push('聚合如何被加载和保存？查询模型是否需要与命令模型分离？');
  }
  return questions.slice(0, 5);
}

function emptyModel() {
  return {
    ubiquitousLanguage: [],
    boundedContexts: [],
    aggregates: [],
    entities: [],
    valueObjects: [],
    domainEvents: [],
    repositories: [],
    domainServices: []
  };
}

function observedConcept(name, rationale, evidence) {
  return {
    name,
    kind: 'observed',
    confidence: OBSERVED_CONFIDENCE,
    rationale,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 3) : []
  };
}

function inferredConcept(name, rationale) {
  return { name, kind: 'inferred', confidence: INFERRED_CONFIDENCE, rationale, evidence: [] };
}

function push(list, concept) {
  if (!concept.name) return;
  if (list.some((existing) => existing.name === concept.name)) return;
  list.push(concept);
}

function countByKind(model, kind) {
  return Object.values(model).reduce(
    (sum, concepts) => sum + concepts.filter((concept) => concept.kind === kind).length,
    0
  );
}

/**
 * Feature extraction sometimes yields template-literal fragments and test file
 * stems. Those are analysis debris, not business vocabulary, and putting them
 * in the ubiquitous language discredits the whole model.
 */
function isBusinessTerm(name) {
  const value = String(name ?? '').trim();
  if (value.length < 2 || value.length > 40) return false;
  if (/[$`{}<>|\\]/.test(value)) return false;
  if (/\.(?:spec|test|e2e|js|ts|jsx|tsx|vue|json)\b/i.test(value)) return false;
  if (/^[^\p{L}]/u.test(value)) return false;
  return true;
}

function roleFor(name) {
  for (const entry of SYMBOL_ROLES) {
    if (entry.suffix.test(name)) return entry.role;
  }
  return null;
}

function toContextName(moduleId) {
  const pascal = String(moduleId)
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${pascal || 'Domain'}Context`;
}

async function safe(fn, fallback) {
  try {
    return (await fn()) ?? fallback;
  } catch {
    return fallback;
  }
}
