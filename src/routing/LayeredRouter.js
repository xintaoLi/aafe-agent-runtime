import { scoreOverlap, tokenize } from '../agents/impact-analyzer/tokenize.js';
import { normalizeRouteDecision } from './decision.js';

const TASK_ID = /\btask-[A-Za-z0-9._-]+\b/i;
const CONTROL_RULES = [
  { id: 'task.cancel', pattern: /^(?:停止|终止|取消)(?:\s|任务|task-)/i,
    result: { relation: 'cancel', domain: 'operation', action: 'cancel', complexity: 'L0', risk: 'low' } },
  { id: 'task.status', pattern: /^(?:状态|进度|查看状态)(?:\s|task-)/i,
    result: { relation: 'continue', domain: 'operation', action: 'inspect', complexity: 'L0', risk: 'low' } }
];

export class LayeredRouter {
  constructor({ routes = [], modelFallback = null, semanticAccept = 0.72, semanticMargin = 0.08, minimumConfidence = 0.6 } = {}) {
    this.routes = routes.map(compileRoute);
    this.modelFallback = modelFallback;
    this.semanticAccept = semanticAccept;
    this.semanticMargin = semanticMargin;
    this.minimumConfidence = minimumConfidence;
  }

  async route(request = {}, context = {}) {
    const message = String(request.message ?? request.text ?? '').trim();
    const explicit = explicitRelation(request, message, context);
    const rule = CONTROL_RULES.find((item) => item.pattern.test(message));
    if (rule) return normalizeRouteDecision({ ...rule.result, ...explicit, confidence: 1, reasons: [rule.id], stage: 'deterministic-rule' });
    const candidates = this.routes.map((route) => ({ route, score: semanticScore(message, route) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    const best = candidates[0];
    const margin = best ? best.score - (candidates[1]?.score ?? 0) : 0;
    if (best && best.score >= (best.route.threshold ?? this.semanticAccept) && margin >= this.semanticMargin) {
      return normalizeRouteDecision({ ...best.route.result, ...explicit, confidence: best.score,
        reasons: [`semantic:${best.route.id}`], stage: 'semantic-router',
        candidates: candidates.map(({ route, score }) => ({ route: route.id, score })) });
    }
    if (this.modelFallback) {
      const modeled = await this.modelFallback({ message, explicit, tasks: compactTasks(context.tasks),
        candidates: candidates.map(({ route, score }) => ({ route: route.id, score })) });
      const decision = normalizeRouteDecision({ ...modeled, ...explicit,
        reasons: [...(modeled?.reasons ?? []), 'small-model-fallback'], stage: 'small-model' });
      if (decision.confidence >= this.minimumConfidence && (decision.relation !== 'continue' || decision.targetTaskId)) return decision;
    }
    return normalizeRouteDecision({ ...explicit, relation: explicit?.relation ?? 'clarify', domain: best?.route.result.domain ?? 'chat',
      action: best?.route.result.action ?? 'answer', complexity: best?.route.result.complexity ?? 'L0',
      confidence: best?.score ?? 0, reasons: ['route-confidence-insufficient'], stage: 'clarification',
      candidates: candidates.map(({ route, score }) => ({ route: route.id, score })) });
  }
}

export function explicitRelation(request, message, context = {}) {
  const taskId = request.replyTo?.taskId ?? message.match(TASK_ID)?.[0] ?? null;
  if (taskId) return { relation: 'continue', targetTaskId: taskId };
  if (/^\/(?:new|new-task)\b/i.test(message)) return { relation: 'new' };
  if (/^\/(?:cancel|stop)\b/i.test(message)) return { relation: 'cancel' };
  const active = (context.tasks ?? []).filter((task) => ['created', 'queued', 'running', 'waiting', 'blocked'].includes(task.status));
  if (active.length === 1) return { relation: 'continue', targetTaskId: active[0].id };
  return null;
}

function compileRoute(route) {
  return { id: String(route.id), threshold: route.threshold, result: route.result ?? {},
    samples: (route.utterances ?? []).map((text) => tokenize(text)) };
}
function semanticScore(message, route) {
  const input = tokenize(message);
  return route.samples.reduce((best, sample) => Math.max(best, scoreOverlap(input, sample).score ?? 0), 0);
}
function compactTasks(tasks = []) {
  return tasks.slice(0, 20).map((task) => ({ id: task.id, status: task.status,
    goal: String(task.goal ?? task.requirement ?? '').slice(0, 300), updatedAt: task.updatedAt }));
}
