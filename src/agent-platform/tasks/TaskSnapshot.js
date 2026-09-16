export const TASK_SNAPSHOT_SCHEMA_VERSION = 1;

export function createTaskSnapshot(task = {}, context = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: TASK_SNAPSHOT_SCHEMA_VERSION,
    taskId: String(task.id ?? ''),
    version: 1,
    goal: String(task.goal ?? task.requirement ?? ''),
    status: String(task.status ?? 'created'),
    requirements: unique([task.requirement, ...(context.requirements ?? [])]),
    constraints: unique(context.constraints),
    acceptanceCriteria: unique(context.acceptanceCriteria),
    decisions: normalizeDecisions(context.decisions),
    completedSteps: unique(context.completedSteps),
    pendingSteps: unique(context.pendingSteps),
    blockers: unique(context.blockers),
    touchedFiles: unique(context.touchedFiles),
    relevantFiles: unique(context.relevantFiles),
    lastResult: nullableText(context.lastResult),
    updatedAt: now
  };
}

/** Apply only explicit operations; arbitrary object merge is intentionally forbidden. */
export function applyTaskSnapshotPatch(snapshot, patch = {}) {
  if (!snapshot || snapshot.schemaVersion !== TASK_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('task-snapshot-version-unsupported');
  }
  const next = structuredClone(snapshot);
  next.goal = patch.goal === undefined ? next.goal : String(patch.goal);
  next.status = patch.status === undefined ? next.status : String(patch.status);
  next.requirements = updateList(next.requirements, patch.appendRequirements, patch.removeRequirements);
  next.constraints = updateList(next.constraints, patch.appendConstraints, patch.removeConstraints);
  next.acceptanceCriteria = updateList(next.acceptanceCriteria, patch.appendAcceptanceCriteria, patch.removeAcceptanceCriteria);
  next.completedSteps = updateList(next.completedSteps, patch.appendCompletedSteps, patch.removeCompletedSteps);
  next.pendingSteps = updateList(next.pendingSteps, patch.appendPendingSteps, patch.removePendingSteps);
  next.blockers = updateList(next.blockers, patch.appendBlockers, patch.removeBlockers);
  next.touchedFiles = updateList(next.touchedFiles, patch.appendTouchedFiles, patch.removeTouchedFiles);
  next.relevantFiles = updateList(next.relevantFiles, patch.appendRelevantFiles, patch.removeRelevantFiles);
  next.decisions = mergeDecisions(next.decisions, patch.appendDecisions, patch.removeDecisions);
  if (patch.lastResult !== undefined) next.lastResult = nullableText(patch.lastResult);
  const changed = JSON.stringify({ ...next, version: 0, updatedAt: '' })
    !== JSON.stringify({ ...snapshot, version: 0, updatedAt: '' });
  if (!changed) return structuredClone(snapshot);
  next.version += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

function updateList(current, append, remove) {
  const removed = new Set(unique(remove));
  return unique([...(current ?? []), ...unique(append)]).filter((item) => !removed.has(item));
}
function normalizeDecisions(value) {
  return (Array.isArray(value) ? value : []).map((item) => typeof item === 'string'
    ? { decision: item, reason: null }
    : { decision: String(item?.decision ?? ''), reason: nullableText(item?.reason) })
    .filter((item) => item.decision);
}
function mergeDecisions(current, append, remove) {
  const removed = new Set(unique(remove));
  const merged = [...normalizeDecisions(current), ...normalizeDecisions(append)]
    .filter((item) => !removed.has(item.decision));
  return [...new Map(merged.map((item) => [item.decision, item])).values()];
}
function unique(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).map(nullableText).filter(Boolean))];
}
function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
