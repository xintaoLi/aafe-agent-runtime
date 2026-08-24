export const AGENT_FINDING_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'AgentFinding', type: 'object',
  required: ['category', 'severity', 'confidence', 'summary'],
  properties: {
    category: { type: 'string', enum: ['MEMORY_RELATED', 'MEMORY_LEAK', 'MEMORY_BLOAT', 'MEMORY_PEAK', 'MEMORY_ALLOCATION', 'MEMORY_RENDERING', 'MEMORY_NATIVE', 'PERFORMANCE', 'NETWORK', 'CPU', 'SECURITY', 'ARCHITECTURE', 'OTHER'] },
    severity: { type: 'string', enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    affectedFiles: { type: 'array', items: { type: 'string' } },
    activation: { type: 'boolean' }
  }
};

export const MEMORY_DIAGNOSIS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'MemoryDiagnosisAgent', type: 'object',
  required: ['problemType', 'confidence', 'evidence', 'rootCause', 'solutions', 'verification'],
  properties: {
    problemType: { type: 'array', items: { type: 'string', enum: ['MEMORY_LEAK', 'MEMORY_BLOAT', 'PEAK_MEMORY', 'ALLOCATION_STORM', 'DOM_MEMORY', 'RENDERER_MEMORY', 'WORKER_MEMORY', 'WASM_MEMORY', 'GPU_MEMORY', 'CACHE_GROWTH', 'DATA_DUPLICATION', 'BROWSER_LIMIT'] } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', items: { type: 'object' } },
    rootCause: { type: 'array', items: { type: 'object' } },
    solutions: { type: 'array', items: { type: 'object' } },
    verification: { type: 'array', items: { type: 'object' } }
  }
};
