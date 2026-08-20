export class GateValidator {
  constructor(gates = {}) {
    this.gates = gates;
  }

  validate(gateName, context) {
    const gate = this.gates[gateName];
    if (!gate) {
      throw new Error(`Gate not found: ${gateName}`);
    }

    const missing = [];
    for (const requirement of gate.requires ?? []) {
      if (!hasArtifact(context, requirement)) {
        missing.push(requirement);
      }
    }

    const failed = Object.entries(context.results ?? {})
      .filter(([, result]) => result.status === 'fail')
      .map(([name]) => name);

    const passed = missing.length === 0 && failed.length === 0;
    return {
      status: passed ? 'pass' : 'fail',
      summary: passed ? `${gateName} passed` : `${gateName} failed`,
      artifacts: { gate: gateName, missing, failed },
      risks: passed ? [] : [`Gate ${gateName} blocked by missing or failed outputs`],
      nextHints: passed ? [] : ['Complete required architecture outputs before implementation']
    };
  }
}

function hasArtifact(context, key) {
  return Object.values(context.results ?? {}).some((result) => {
    if (result.artifacts?.[key] !== undefined) return true;
    if (Array.isArray(result.artifacts?.provided)) return result.artifacts.provided.includes(key);
    return false;
  });
}
