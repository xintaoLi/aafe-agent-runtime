/**
 * The entry point agents and the CLI call for design-pattern work.
 *
 * The previous version answered "which pattern?" with a single name. That is
 * the exact shape PATTERN-SYSTEM-001 rules out — a frontend is not designed by
 * choosing one pattern and applying it globally — so the result is now a
 * composition: several patterns, each tied to a problem and a responsibility,
 * wired into a graph, with the rejected candidates and the reasons kept.
 *
 * Evidence comes from the analyzed project when a KnowledgeStore is available.
 * Without it the advisor still works, but every finding is marked as inferred
 * from the request so nobody mistakes a keyword match for a codebase fact.
 */

import { composePatterns } from './PatternComposer.js';
import { detectProblems, assessComplexity, variationPoints } from './PatternProblems.js';
import { detectAntiPatterns } from './AntiPatternDetector.js';
import { PATTERN_INDEX, PATTERN_DOMAINS, PATTERN_BY_ID } from './catalog.js';

/**
 * Full pattern analysis: discovery, selection, composition and anti-pattern audit.
 *
 * @param {object} input
 * @param {string|object} input.prompt
 * @param {import('../knowledge/store/KnowledgeStore.js').KnowledgeStore} [input.knowledge]
 * @param {number} [input.declaredComplexity]
 * @returns {Promise<object>}
 */
export async function analyzePatternComposition(input = {}) {
  const prompt = promptText(input);
  const projectFacts = await collectProjectFacts(input.knowledge, prompt);

  const composition = composePatterns({
    prompt,
    name: input.name,
    projectFacts,
    declaredComplexity: input.declaredComplexity
  });

  const antiPatterns = detectAntiPatterns({ prompt, projectFacts, composition });

  return {
    status: composition.patterns.length > 0 ? 'pass' : 'warn',
    evidenceMode: projectFacts.length > 0 ? 'project' : 'request-only',
    composition,
    antiPatterns,
    questions: buildPatternInterview(prompt, composition),
    // Everything considered and dropped, so a reviewer can check the reasoning
    // rather than trusting the shortlist.
    rejected: composition.rejected
  };
}

/**
 * Discovery only: the problems, variation points and complexity, with no
 * pattern named. Selection before discovery is guessing, and §6 requires this
 * step to describe problems rather than assign solutions.
 */
export async function analyzePatternProblems(input = {}) {
  const prompt = promptText(input);
  const projectFacts = await collectProjectFacts(input.knowledge, prompt);
  const problems = detectProblems(prompt, { projectFacts });
  const complexity = assessComplexity(problems, { declaredComplexity: input.declaredComplexity });

  return {
    status: problems.length > 0 ? 'pass' : 'warn',
    evidenceMode: projectFacts.length > 0 ? 'project' : 'request-only',
    problems,
    variationPoints: variationPoints(problems),
    complexity,
    domains: [...new Set(problems.flatMap((problem) => problem.domains))],
    questions: buildPatternInterview(prompt)
  };
}

/**
 * Anti-pattern audit against the project as it stands, independent of any
 * proposed composition.
 */
export async function auditAntiPatterns(input = {}) {
  const prompt = promptText(input);
  const projectFacts = await collectProjectFacts(input.knowledge, prompt);
  const result = detectAntiPatterns({ prompt, projectFacts });
  return { ...result, evidenceMode: projectFacts.length > 0 ? 'project' : 'request-only' };
}

/**
 * Per-module compositions, for requests that span several modules. Each module
 * gets its own problem set, because applying one composition across all of them
 * is the global-single-pattern mistake at a larger scale.
 */
export async function analyzeModulePatternFit(input = {}) {
  const prompt = promptText(input);
  const knowledge = input.knowledge;
  const modules = await detectModules(prompt, knowledge);

  const results = [];
  for (const module of modules) {
    const composition = composePatterns({
      prompt: `${module.name} ${module.responsibility} ${module.signals ?? ''} ${prompt}`,
      name: module.name
    });
    results.push({
      module: module.name,
      responsibility: module.responsibility,
      source: module.source,
      patterns: composition.patterns.map((pattern) => ({
        id: pattern.id,
        name: pattern.name,
        role: pattern.role,
        score: pattern.score
      })),
      relations: composition.relations,
      complexity: composition.complexity
    });
  }

  return { status: 'pass', modules: results };
}

/**
 * Questions worth asking before committing to a composition.
 *
 * Only dimensions the request left open are asked about. Asking whether the
 * feature needs undo when the user already said "撤销重做" wastes a turn and
 * signals the analysis did not read the request.
 */
export function buildPatternInterview(prompt = '', composition = null) {
  const text = promptText(prompt);
  const detected = new Set(detectProblems(text).map((problem) => problem.id));
  const questions = [];

  const probes = [
    { id: 'algorithm-variation', question: '这个能力未来是否会出现多种实现、算法或供应商，需要可插拔扩展？' },
    { id: 'workflow-state', question: '是否存在复杂状态流转、非法状态或多步骤生命周期需要被约束？' },
    { id: 'undo-redo', question: '用户操作是否需要撤销、重做、回放或审计？' },
    { id: 'extension-surface', question: '是否需要开放给外部注册与替换的扩展点？' },
    { id: 'unreliable-dependency', question: '依赖不可用时期望的降级行为是什么？' },
    { id: 'large-list-rendering', question: '预期的数据量级是多少，是否会出现渲染或滚动压力？' },
    { id: 'legacy-replacement', question: '这是新建还是替换既有实现？是否需要新旧共存与灰度？' }
  ];

  for (const probe of probes) {
    if (detected.has(probe.id)) continue;
    questions.push(probe.question);
  }

  if (composition && composition.patterns.length === 0 && detected.size === 0) {
    questions.unshift('当前描述里没有识别到需要设计模式解决的问题，能否说明具体卡在哪里（变化频繁、耦合、性能还是可测试性）？');
  }

  return questions.slice(0, 4);
}

/**
 * Back-compat entry point.
 *
 * Older pipelines call this expecting `{ recommendation, candidates }`. It now
 * returns the composition instead, and deliberately does not synthesize a
 * single `recommendation` field — callers that want one are asking the question
 * the spec forbids.
 */
export function analyzePatternFit(input = {}) {
  const prompt = promptText(input);
  const composition = composePatterns({ prompt, declaredComplexity: input.declaredComplexity });
  return {
    status: composition.patterns.length > 0 ? 'pass' : 'warn',
    patterns: composition.patterns,
    composition,
    questions: buildPatternInterview(prompt, composition)
  };
}

/**
 * Pulls problem evidence out of the analyzed project.
 *
 * Feature names, business flows and module summaries are the places where a
 * problem is described in the project's own words. Everything returned carries
 * its source so scoring can weight observed facts above request keywords.
 */
async function collectProjectFacts(knowledge, prompt) {
  if (!knowledge) return [];

  try {
    if (!(await knowledge.exists())) return [];
  } catch {
    return [];
  }

  const hits = await safe(() => (prompt.trim() ? knowledge.search(prompt, { limit: 60 }) : []), []);
  if (hits.length === 0) return [];

  const [business, features] = await Promise.all([
    safe(() => knowledge.business(), []),
    safe(() => knowledge.features(), [])
  ]);
  const byId = new Map([...business, ...features].map((item) => [item.id, item]));

  const facts = [];
  const seen = new Set();

  for (const hit of hits) {
    if (hit.kind !== 'feature' && hit.kind !== 'business-flow' && hit.kind !== 'module') continue;
    const record = byId.get(hit.id);
    const text = [record?.name ?? hit.label, record?.description, record?.summary]
      .filter(Boolean)
      .join(' ');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    facts.push({
      text,
      evidence: (record?.evidence ?? []).map((item) =>
        typeof item === 'string' ? item : `${item.type ?? 'evidence'}:${item.file ?? item.id ?? ''}`
      ).filter(Boolean).slice(0, 3).concat(hit.file ? [`source:${hit.file}`] : [])
    });
  }

  return facts.slice(0, 40);
}

/**
 * Modules come from the analyzed project when it exists. The keyword fallback
 * covers unanalyzed projects, but a folder name is a weak boundary signal, so
 * it is marked as inferred.
 */
async function detectModules(prompt, knowledge) {
  if (knowledge) {
    const modules = await safe(async () => {
      if (!(await knowledge.exists())) return [];
      const hits = await knowledge.search(prompt, { limit: 40 });
      const ids = [...new Set(hits.map((hit) => hit.module).filter(Boolean))];
      const index = await knowledge.modulesIndex();
      return ids.slice(0, 6).map((id) => {
        const record = (Array.isArray(index) ? index : index?.modules ?? []).find((item) => item.id === id);
        return {
          name: id,
          responsibility: record?.summary ?? record?.description ?? `${id} 模块职责待确认`,
          source: 'observed'
        };
      });
    }, []);
    if (modules.length > 0) return modules;
  }

  const text = prompt.toLowerCase();
  const modules = [
    { name: 'domain', responsibility: '业务规则与不变量', signals: '状态流转 业务规则 校验', source: 'inferred' },
    { name: 'application', responsibility: '用例编排与命令流', signals: '流程 步骤 编排 命令', source: 'inferred' },
    { name: 'infrastructure', responsibility: '外部 API、适配与持久化', signals: '第三方 外部接口 数据访问', source: 'inferred' },
    { name: 'presentation', responsibility: 'UI 组合、交互状态与视图契约', signals: '组件 渲染 交互状态', source: 'inferred' }
  ];
  if (/graph|canvas|node|edge|layout|画布|图编辑器|节点|布局/.test(text)) {
    modules.push({ name: 'graph-runtime', responsibility: '节点、边、布局与命令运行时', signals: '插件扩展 撤销重做 大量节点渲染', source: 'inferred' });
  }
  if (/dashboard|chart|metric|analytics|报表|图表/.test(text)) {
    modules.push({ name: 'analytics-view', responsibility: '指标组合、查询状态与图表适配', signals: '第三方 图表 数据源 缓存', source: 'inferred' });
  }
  if (/admin|permission|rbac|abac|audit|权限|审计|后台/.test(text)) {
    modules.push({ name: 'access-control', responsibility: '权限策略、审计与受控操作', signals: '多种规则 操作记录 审计', source: 'inferred' });
  }
  return modules;
}

function promptText(input) {
  if (typeof input === 'string') return input;
  if (input?.prompt?.prompt) return String(input.prompt.prompt);
  if (input?.request?.prompt) return String(input.request.prompt);
  if (input?.prompt) return String(input.prompt);
  if (input?.request) return String(input.request);
  return String(input ?? '');
}

async function safe(fn, fallback) {
  try {
    return (await fn()) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Kept for callers that imported the old flat catalog. */
export const patternCatalog = PATTERN_INDEX;

export { PATTERN_INDEX, PATTERN_DOMAINS, PATTERN_BY_ID };
