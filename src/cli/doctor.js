import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  '.ai-agent/runtime/engine.md',
  '.ai-agent/runtime/router.yaml',
  '.ai-agent/runtime/gates.yaml',
  '.ai-agent/runtime/memory.md',
  '.ai-agent/pipelines/feature.yaml',
  '.ai-agent/pipelines/domain-feature.yaml',
  '.ai-agent/pipelines/pattern-feature.yaml',
  '.ai-agent/skills/architect.md',
  '.ai-agent/skills/ddd-discovery.md',
  '.ai-agent/skills/bounded-context-mapper.md',
  '.ai-agent/skills/aggregate-designer.md',
  '.ai-agent/skills/domain-event-designer.md',
  '.ai-agent/skills/ddd-implementation-planner.md',
  '.ai-agent/skills/pattern-interviewer.md',
  '.ai-agent/skills/pattern-selector.md',
  '.ai-agent/skills/pattern-implementation-planner.md',
  '.ai-agent/scenarios/ddd.md',
  '.ai-agent/scenarios/patterns.md',
  '.ai-agent/skills/memory-recaller.md',
  '.ai-agent/skills/memory-writer.md',
  '.ai-agent/memory/index.md',
  '.ai-agent/memory/learnings.jsonl',
  '.aafe.config.json'
];

export async function doctorProject(root) {
  const missing = [];
  const config = await safeRead(path.join(root, '.aafe.config.json'));
  const projectConfig = parseJson(config);
  const files = [...requiredFiles];
  if (projectConfig.editors?.includes('cursor')) {
    files.push('.cursor/hooks.json', '.cursor/hooks/run-hook.cmd', '.cursor/hooks/aafe-session-start');
  }

  for (const rel of files) {
    if (!(await exists(path.join(root, rel)))) missing.push(rel);
  }

  const warnings = [];
  const gates = await safeRead(path.join(root, '.ai-agent/runtime/gates.yaml'));
  const router = await safeRead(path.join(root, '.ai-agent/runtime/router.yaml'));
  const featurePipeline = await safeRead(path.join(root, '.ai-agent/pipelines/feature.yaml'));
  const domainPipeline = await safeRead(path.join(root, '.ai-agent/pipelines/domain-feature.yaml'));

  if (gates && !gates.includes('ddd_gate')) warnings.push('ddd_gate is not configured');
  if (gates && !gates.includes('architecture_gate')) warnings.push('architecture_gate is not configured');
  if (gates && !gates.includes('pattern_gate')) warnings.push('pattern_gate is not configured');
  if (gates && !gates.includes('merge_gate')) warnings.push('merge_gate is not configured');
  if (router && !router.includes('domainFeature')) warnings.push('domainFeature route is not configured');
  if (featurePipeline && !featurePipeline.includes('ddd-discovery')) warnings.push('feature pipeline does not run DDD discovery');
  if (featurePipeline && !featurePipeline.includes('memory-recaller')) warnings.push('feature pipeline does not recall project memory');
  if (featurePipeline && !featurePipeline.includes('pattern-interviewer')) warnings.push('feature pipeline does not interview design pattern constraints');
  if (featurePipeline && !featurePipeline.includes('pattern-selector')) warnings.push('feature pipeline does not select design patterns');
  if (featurePipeline && !featurePipeline.includes('memory-writer')) warnings.push('feature pipeline does not write project memory');
  if (domainPipeline && !domainPipeline.includes('bounded-context-mapper')) warnings.push('domain pipeline does not map bounded contexts');
  if (domainPipeline && !domainPipeline.includes('aggregate-designer')) warnings.push('domain pipeline does not design aggregates');
  if (config && !config.includes('"memory"')) warnings.push('memory config is not enabled');
  if (projectConfig.editors?.includes('cursor') && !projectConfig.hooks?.enabled) warnings.push('Cursor hooks are not enabled in .aafe.config.json');

  return {
    status: missing.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    missing,
    warnings
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
