import { createHash } from 'node:crypto';

export const MISSING_INFORMATION_KINDS = Object.freeze(['discoverable', 'defaultable', 'deferrable', 'blocking']);
export const AUTONOMY_ACTIONS = Object.freeze([
  'continue', 'continue_with_assumption', 'execute_independent_steps', 'request_input', 'request_approval'
]);

export class AutonomyPolicy {
  constructor({ level = 'balanced' } = {}) { this.level = level; }

  assess(input = {}) {
    const missing = classifyMissingInformation(input.missingInformation);
    const executable = unique([
      ...(input.currentStep?.safeNextSteps ?? []),
      ...(input.currentStep?.independentSteps ?? [])
    ]);
    if (missing.discoverable.length) return decision('continue', {
      executableSteps: unique([...missing.discoverable.map(discoveryStep), ...executable]),
      reasonCode: 'INFORMATION_DISCOVERABLE'
    });
    if (missing.defaultable.length && input.risk?.level !== 'high') return decision('continue_with_assumption', {
      executableSteps: executable,
      assumptions: missing.defaultable.map(safeAssumption),
      deferredQuestions: missing.deferrable.map(deferredQuestion),
      reasonCode: 'SAFE_DEFAULT_AVAILABLE'
    });
    if (executable.length) return decision('execute_independent_steps', {
      executableSteps: executable,
      blockedSteps: unique(input.currentStep?.dependentSteps ?? []),
      deferredQuestions: [...missing.deferrable, ...missing.blocking].map(deferredQuestion),
      reasonCode: 'PARTIAL_PROGRESS_AVAILABLE'
    });
    if (input.risk?.requiresApproval === true || input.confirmationType === 'security_approval'
      || input.confirmationType === 'external_side_effect') {
      return decision('request_approval', { blockedSteps: [input.currentStep?.id].filter(Boolean),
        blockingQuestion: singleQuestion(missing.blocking, '请确认是否允许执行下一项敏感或外部写入操作。'), reasonCode: 'APPROVAL_REQUIRED' });
    }
    return decision('request_input', { blockedSteps: [input.currentStep?.id].filter(Boolean),
      blockingQuestion: singleQuestion(missing.blocking, '请补充继续执行所必需的信息。'), reasonCode: 'NO_EXECUTABLE_PATH' });
  }
}

export function classifyMissingInformation(items = []) {
  const groups = Object.fromEntries(MISSING_INFORMATION_KINDS.map((kind) => [kind, []]));
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = typeof item === 'string' ? { id: stableId(item), description: item, kind: 'blocking' } : { ...item };
    const kind = MISSING_INFORMATION_KINDS.includes(normalized.kind) ? normalized.kind : 'blocking';
    groups[kind].push({ ...normalized, id: normalized.id ?? stableId(normalized.description ?? normalized.question ?? kind), kind });
  }
  return groups;
}

export function createBlocker({ taskId, stepId = 'task', type = 'input', requirement = '', question = '', kind = 'blocking' } = {}) {
  const normalized = String(requirement || question).trim().toLowerCase().replace(/\s+/g, ' ');
  const key = createHash('sha256').update([taskId, stepId, type, normalized].join('\0')).digest('hex').slice(0, 24);
  return { id: `blocker-${key}`, key, taskId, stepId, type, kind, requirement: requirement || question,
    question: question || requirement, createdAt: new Date().toISOString(), resolvedAt: null };
}

export const AUTONOMOUS_EXECUTION_POLICY_PROMPT = `AUTONOMOUS EXECUTION POLICY
You are expected to make progress, not merely identify missing information.
Before asking the user, inspect the Task Snapshot, recent conversation, repository and project configuration, Git/runtime state, saved project knowledge, and current tool results. Use safe reversible defaults and execute every independent step first.
Discoverable information must be found locally. Defaultable information must use a safe default. Deferrable information must be recorded without stopping current work. Do not block the whole task because a later step needs input.
Ask only when no executable path remains, the information cannot be discovered, a wrong choice materially changes the business result, or the next action is destructive, external, privileged, or irreversible. When asking, state completed work, the exact blocker, and one concrete question. Never expose routing confidence, slot filling, merged prompts, raw internal commands, or state-machine internals.`;

function decision(action, partial) { return { action, assumptions: [], deferredQuestions: [], executableSteps: [], blockedSteps: [], blockingQuestion: null, ...partial }; }
function discoveryStep(item) { return `discover:${item.id}`; }
function safeAssumption(item) { return { id: item.id, value: item.default ?? null, reason: item.description ?? 'safe-default' }; }
function deferredQuestion(item) { return { id: item.id, question: item.question ?? item.description ?? String(item.id) }; }
function singleQuestion(items, fallback) { const item = items[0]; return { id: item?.id ?? stableId(fallback), question: item?.question ?? item?.description ?? fallback }; }
function stableId(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function unique(values) { return [...new Set(values.filter(Boolean).map(String))]; }
