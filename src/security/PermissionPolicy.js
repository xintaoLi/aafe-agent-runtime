export const PERMISSION_LEVELS = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4']);

const DEFAULT_RULES = Object.freeze([
  { id: 'destructive-system', level: 'P4', match: /(?:rm\s+-rf|mkfs|shutdown|reboot|drop\s+(?:database|table)|git\s+push\s+.*--force)/i },
  { id: 'production-write', level: 'P4', match: /(?:production|prod)[^\n]*(?:deploy|delete|write|restart)/i },
  { id: 'external-delivery', level: 'P3', match: /(?:git\s+push|gh\s+pr\s+create|tapd[^\n]*(?:comment|write|backfill)|deploy)/i },
  { id: 'workspace-write', level: 'P2', match: /(?:apply_patch|writeFile|git\s+(?:commit|add)|npm\s+(?:install|update))/i },
  { id: 'local-execution', level: 'P1', match: /(?:npm\s+test|npm\s+run|node\s+|git\s+(?:status|diff|log)|rg\s+)/i }
]);

export class PermissionPolicy {
  constructor({ maxAutoLevel = 'P2', rules = DEFAULT_RULES } = {}) { this.maxAutoLevel = maxAutoLevel; this.rules = rules; }
  classify(action = {}) {
    const text = [action.tool, action.command, action.target, action.description].filter(Boolean).join(' ');
    const rule = this.rules.find((candidate) => candidate.match.test(text));
    return { level: rule?.level ?? 'P0', ruleId: rule?.id ?? 'read-only', action };
  }
  decide(action, { authorizedLevels = [] } = {}) {
    const classification = this.classify(action);
    const allowed = rank(classification.level) <= rank(this.maxAutoLevel) || authorizedLevels.includes(classification.level);
    return { ...classification, allowed, decision: allowed ? 'allow' : 'approval-required', reason: allowed ? 'within-policy' : `permission-${classification.level}-required` };
  }
  assert(action, context) { const result = this.decide(action, context); if (!result.allowed) throw new PermissionDeniedError(result); return result; }
}

export class PermissionDeniedError extends Error {
  constructor(decision) { super(decision.reason); this.name = 'PermissionDeniedError'; this.decision = decision; }
}
function rank(level) { const value = PERMISSION_LEVELS.indexOf(level); return value < 0 ? Infinity : value; }
