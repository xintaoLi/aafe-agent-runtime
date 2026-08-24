const RULES = [
  ['memory-gate', 'Memory OOM Activation Gate', 'Memory rules MUST NOT load by default. Activate only for explicit OOM/leak requests, a memory-related current-analysis signal, a MEMORY_* AgentFinding, or an explicit custom memory-agent request.'],
  ['memory-diagnosis', 'Memory Diagnosis', 'Classify the established evidence before loading additional rules. Distinguish leak, bloat, peak, allocation, rendering, cache, worker and browser-limit cases.'],
  ['memory-leak', 'Memory Leak Rules', 'Require a retention path or lifecycle evidence. Inspect listeners, timers, detached DOM and subscriptions only after leak classification.'],
  ['memory-bloat', 'Memory Bloat Rules', 'Focus on unnecessary retained data, cache growth and duplicate object graphs.'],
  ['memory-peak', 'Peak Memory Rules', 'Focus on transient allocation peaks, parsing, serialization and batch processing.'],
  ['memory-rendering', 'Rendering Memory Rules', 'Focus on DOM volume, virtualized rendering, Canvas/WebGL buffers and renderer pressure.'],
  ['memory-worker', 'Worker Memory Rules', 'Focus on Worker/WASM ownership, transferables and termination lifecycle.'],
  ['memory-cache', 'Cache Memory Rules', 'Focus on cache limits, eviction and IndexedDB/in-memory duplication.'],
  ['memory-data-pipeline', 'Data Pipeline Memory Rules', 'Focus on large JSON, streaming, chunking, cloning and transformation peaks.'],
  ['memory-browser', 'Browser Memory Rules', 'Focus on renderer limits and reproducible browser-level evidence.'],
  ['memory-verification', 'Memory Verification Rules', 'Every diagnosis must define a reproducible measurement and post-fix verification.']
];

export function memoryDiagnosisRuntimePaths(agentPrefix = '.ai-agent') {
  return Object.keys(memoryDiagnosisRuntimeFiles(agentPrefix));
}

export function memoryDiagnosisRuntimeFiles(agentPrefix = '.ai-agent') {
  const base = `${agentPrefix}/frontend-memory`;
  const files = {
    [`${base}/SKILL.md`]: `# Frontend Memory Diagnosis\n\nConditional capability pack. **Do not load this pack by default.**\n\n\`Problem Router → Memory OOM Gate → Classification → selective rules → default/custom agent → verification\`\n\nRead \`rules/memory-gate.md\` first. A disabled gate means no memory scan, no heap analysis, and no memory subagent.\n`,
    [`${base}/agents/agent-finding.schema.json`]: `${JSON.stringify(agentFindingSchema(), null, 2)}\n`,
    [`${base}/agents/memory-agent.schema.json`]: `${JSON.stringify(memoryAgentSchema(), null, 2)}\n`,
    [`${base}/references/chrome-devtools.md`]: '# Chrome DevTools\n\nCapture allocation/retention evidence before claiming a leak.\n',
    [`${base}/references/heap-analysis.md`]: '# Heap Analysis\n\nCompare reproducible snapshots and identify retaining paths.\n',
    [`${base}/references/memory-patterns.md`]: '# Memory Patterns\n\nClassify leak, bloat, peak allocation, rendering, worker, cache and browser-limit symptoms.\n'
  };
  for (const [file, title, body] of RULES) files[`${base}/rules/${file}.md`] = `# ${title}\n\n${body}\n`;
  return files;
}

function agentFindingSchema() { return { type: 'object', required: ['category', 'severity', 'confidence', 'summary'], properties: { category: { type: 'string' }, severity: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, summary: { type: 'string' }, evidence: { type: 'array' }, affectedFiles: { type: 'array' }, activation: { type: 'boolean' } } }; }
function memoryAgentSchema() { return { type: 'object', required: ['problemType', 'confidence', 'evidence', 'rootCause', 'solutions', 'verification'], properties: { problemType: { type: 'array' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'array' }, rootCause: { type: 'array' }, solutions: { type: 'array' }, verification: { type: 'array' } } }; }
