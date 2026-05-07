import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  '.ai-agent/runtime/engine.md',
  '.ai-agent/runtime/router.yaml',
  '.ai-agent/runtime/gates.yaml',
  '.ai-agent/runtime/memory.md',
  '.ai-agent/pipelines/feature.yaml',
  '.ai-agent/skills/architect.md',
  '.ai-agent/skills/memory-recaller.md',
  '.ai-agent/skills/memory-writer.md',
  '.ai-agent/memory/index.md',
  '.ai-agent/memory/learnings.jsonl',
  '.aafe.config.json'
];

export async function doctorProject(root) {
  const missing = [];
  for (const rel of requiredFiles) {
    if (!(await exists(path.join(root, rel)))) missing.push(rel);
  }

  const warnings = [];
  const gates = await safeRead(path.join(root, '.ai-agent/runtime/gates.yaml'));
  const featurePipeline = await safeRead(path.join(root, '.ai-agent/pipelines/feature.yaml'));
  const config = await safeRead(path.join(root, '.aafe.config.json'));

  if (gates && !gates.includes('architecture_gate')) warnings.push('architecture_gate is not configured');
  if (gates && !gates.includes('merge_gate')) warnings.push('merge_gate is not configured');
  if (featurePipeline && !featurePipeline.includes('memory-recaller')) warnings.push('feature pipeline does not recall project memory');
  if (featurePipeline && !featurePipeline.includes('memory-writer')) warnings.push('feature pipeline does not write project memory');
  if (config && !config.includes('"memory"')) warnings.push('memory config is not enabled');

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
