export class SkillRegistry {
  constructor(skills = {}) {
    this.skills = new Map(Object.entries(skills));
  }

  register(name, skill) {
    if (!name || typeof skill?.run !== 'function') {
      throw new Error(`Invalid skill registration: ${name}`);
    }
    this.skills.set(name, skill);
  }

  has(name) {
    return this.skills.has(name);
  }

  async execute(name, context) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }
    const result = await skill.run(context);
    return normalizeSkillOutput(name, result);
  }
}

function normalizeSkillOutput(name, result = {}) {
  const status = result.status ?? 'pass';
  if (!['pass', 'warn', 'fail'].includes(status)) {
    throw new Error(`Invalid status from skill ${name}: ${status}`);
  }
  return {
    status,
    summary: result.summary ?? '',
    artifacts: result.artifacts ?? {},
    risks: result.risks ?? [],
    nextHints: result.nextHints ?? []
  };
}
