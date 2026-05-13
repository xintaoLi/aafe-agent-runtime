const domainSignals = [
  '业务', '领域', '订单', '用户', '权限', '支付', '库存', '审批', '租户', '组织', '账户', '商品',
  'domain', 'order', 'user', 'permission', 'payment', 'inventory', 'approval', 'tenant', 'account'
];

export function analyzeDDD(input = {}) {
  const prompt = String(input.prompt ?? input.request ?? input).toLowerCase();
  const terms = extractDomainTerms(prompt);
  const boundedContexts = inferBoundedContexts(prompt, terms);
  const aggregates = inferAggregates(prompt, terms);
  const domainEvents = inferDomainEvents(prompt, aggregates);
  const repositories = aggregates.map((aggregate) => `${aggregate}Repository`);
  const services = inferDomainServices(prompt, aggregates);

  return {
    status: terms.length ? 'pass' : 'warn',
    ubiquitousLanguage: terms,
    boundedContexts,
    aggregates,
    entities: aggregates.flatMap((aggregate) => inferEntities(aggregate)),
    valueObjects: inferValueObjects(prompt),
    domainEvents,
    repositories,
    domainServices: services,
    questions: buildDDDQuestions(prompt, { boundedContexts, aggregates })
  };
}

export function buildDDDInterview(prompt = '') {
  return buildDDDQuestions(String(prompt).toLowerCase(), { boundedContexts: [], aggregates: [] });
}

function extractDomainTerms(prompt) {
  const terms = new Set();
  for (const signal of domainSignals) {
    if (prompt.includes(signal.toLowerCase())) terms.add(normalizeTerm(signal));
  }
  for (const match of prompt.matchAll(/[\u4e00-\u9fa5]{2,8}(?:模块|系统|能力|规则|流程|策略|权限|订单|用户|租户|组织|审批|支付|库存)/g)) {
    terms.add(match[0]);
  }
  return [...terms].slice(0, 12);
}

function inferBoundedContexts(prompt, terms) {
  const contexts = [];
  if (/权限|permission|rbac|abac/.test(prompt)) contexts.push('AccessControlContext');
  if (/租户|tenant|组织|organization/.test(prompt)) contexts.push('TenantContext');
  if (/订单|order/.test(prompt)) contexts.push('OrderContext');
  if (/支付|payment/.test(prompt)) contexts.push('PaymentContext');
  if (/库存|inventory/.test(prompt)) contexts.push('InventoryContext');
  if (/审批|workflow|approval/.test(prompt)) contexts.push('ApprovalContext');
  if (!contexts.length && terms.length) contexts.push(`${toPascal(terms[0])}Context`);
  return [...new Set(contexts)];
}

function inferAggregates(prompt, terms) {
  const aggregates = [];
  if (/权限|permission|rbac|abac/.test(prompt)) aggregates.push('PermissionPolicy');
  if (/角色|role/.test(prompt)) aggregates.push('Role');
  if (/用户|user/.test(prompt)) aggregates.push('User');
  if (/租户|tenant/.test(prompt)) aggregates.push('Tenant');
  if (/组织|organization/.test(prompt)) aggregates.push('Organization');
  if (/订单|order/.test(prompt)) aggregates.push('Order');
  if (/审批|approval/.test(prompt)) aggregates.push('ApprovalFlow');
  if (!aggregates.length && terms.length) aggregates.push(toPascal(terms[0]));
  return [...new Set(aggregates)];
}

function inferEntities(aggregate) {
  const map = {
    PermissionPolicy: ['PermissionRule', 'PermissionSubject'],
    Role: ['RoleBinding'],
    User: ['UserProfile'],
    Tenant: ['TenantMember'],
    Organization: ['Department'],
    Order: ['OrderItem'],
    ApprovalFlow: ['ApprovalNode', 'ApprovalTask']
  };
  return map[aggregate] ?? [];
}

function inferValueObjects(prompt) {
  const values = [];
  if (/权限|permission/.test(prompt)) values.push('PermissionScope', 'ResourceKey', 'ActionKey');
  if (/租户|tenant/.test(prompt)) values.push('TenantId');
  if (/组织|organization/.test(prompt)) values.push('OrganizationId');
  if (/金额|price|payment/.test(prompt)) values.push('Money');
  if (/时间|date|period/.test(prompt)) values.push('DateRange');
  return [...new Set(values)];
}

function inferDomainEvents(_prompt, aggregates) {
  return aggregates.flatMap((aggregate) => [
    `${aggregate}Created`,
    `${aggregate}Changed`
  ]).slice(0, 8);
}

function inferDomainServices(prompt, aggregates) {
  const services = [];
  if (aggregates.length > 1) services.push('DomainCoordinationService');
  if (/权限|permission/.test(prompt)) services.push('PermissionEvaluationService');
  if (/策略|policy|rule/.test(prompt)) services.push('PolicyResolutionService');
  return [...new Set(services)];
}

function buildDDDQuestions(prompt, result) {
  const questions = [];
  if (!result.boundedContexts?.length) questions.push('这个功能属于哪个业务子域？是否存在多个 bounded context？');
  if (!result.aggregates?.length) questions.push('哪个对象负责维护核心业务不变量，应作为聚合根？');
  if (!/规则|policy|rule|invariant|约束/.test(prompt)) questions.push('该领域中必须始终成立的业务规则/不变量是什么？');
  if (!/事件|event|通知|变更/.test(prompt)) questions.push('哪些领域变化需要作为 Domain Event 被其他模块感知？');
  if (!/repository|存储|查询|持久化/.test(prompt)) questions.push('聚合如何被加载和保存？查询模型是否需要与命令模型分离？');
  return questions.slice(0, 5);
}

function normalizeTerm(term) {
  const map = {
    domain: '领域', order: '订单', user: '用户', permission: '权限', payment: '支付', inventory: '库存', approval: '审批', tenant: '租户', account: '账户'
  };
  return map[term] ?? term;
}

function toPascal(text) {
  return String(text)
    .replace(/(?:模块|系统|能力|规则|流程|策略)$/g, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'Domain';
}
