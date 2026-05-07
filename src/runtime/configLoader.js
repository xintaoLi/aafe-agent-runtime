import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentRuntime } from './AgentRuntime.js';
import { defaultGates, defaultPipelines, defaultRouter, defaultSkills } from './defaults.js';

export async function loadRuntimeConfig(root, options = {}) {
  const runtimeDir = options.runtimeDir ?? path.join(root, '.ai-agent');
  const [router, gates, pipelines] = await Promise.all([
    loadRouter(path.join(runtimeDir, 'runtime/router.yaml')),
    loadGates(path.join(runtimeDir, 'runtime/gates.yaml')),
    loadPipelines(path.join(runtimeDir, 'pipelines'))
  ]);

  return {
    router: Object.keys(router.routes ?? {}).length ? router : defaultRouter,
    gates: Object.keys(gates).length ? gates : defaultGates,
    pipelines: Object.keys(pipelines).length ? pipelines : defaultPipelines
  };
}

export async function createRuntimeFromProject(root, options = {}) {
  const config = await loadRuntimeConfig(root, options);
  return new AgentRuntime({
    ...config,
    root,
    skills: { ...defaultSkills, ...(options.skills ?? {}) },
    memory: options.memory,
    maxReruns: options.maxReruns
  });
}

async function loadRouter(filePath) {
  const text = await safeRead(filePath);
  const routes = {};
  let current;
  for (const line of text.split('\n')) {
    const route = line.match(/^\s{2}([\w-]+):\s*$/);
    if (route) {
      current = route[1];
      routes[current] = {};
    }
    const pipeline = line.match(/^\s{4}pipeline:\s*([\w-]+)\s*$/);
    if (current && pipeline) routes[current].pipeline = pipeline[1];
  }
  return { routes };
}

async function loadGates(filePath) {
  const text = await safeRead(filePath);
  const gates = {};
  let current;
  let inRequires = false;
  for (const line of text.split('\n')) {
    const gate = line.match(/^\s{2}([\w-]+):\s*$/);
    if (gate) {
      current = gate[1];
      gates[current] = { requires: [] };
      inRequires = false;
      continue;
    }
    if (/^\s{4}requires:\s*$/.test(line)) inRequires = true;
    const item = line.match(/^\s{6}-\s*([\w-]+)\s*$/);
    if (current && inRequires && item) gates[current].requires.push(item[1]);
  }
  return gates;
}

async function loadPipelines(dir) {
  const names = ['feature', 'refactor', 'bugfix', 'performance', 'graph-feature'];
  const entries = await Promise.all(names.map(async (name) => [name, await loadPipeline(path.join(dir, `${name}.yaml`))]));
  return Object.fromEntries(entries.filter(([, pipeline]) => pipeline.steps.length));
}

async function loadPipeline(filePath) {
  const text = await safeRead(filePath);
  const steps = [];
  for (const line of text.split('\n')) {
    const skill = line.match(/^\s*-\s*skill:\s*([\w-]+)\s*$/);
    const gate = line.match(/^\s*-\s*gate:\s*([\w-]+)\s*$/);
    if (skill) steps.push({ skill: skill[1] });
    if (gate) steps.push({ gate: gate[1] });
  }
  return { steps };
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
