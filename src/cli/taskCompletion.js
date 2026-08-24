import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadMemoryConfig } from '../memory/config.js';

export async function runTaskCompletion(root, options = {}) {
  const steps = [
    ['knowledge-update', 'knowledge', ['update']],
    ['knowledge-web', 'knowledge-web', []],
    ['runtime-update', 'update', []],
    ['doctor', 'doctor', []]
  ];
  const results = [];
  for (const [name, command, args] of steps) {
    if (options.dryRun) {
      results.push({ name, command: `aafe ${command} ${args.join(' ')}`.trim(), status: 'planned' });
      continue;
    }
    const result = await runAafe(root, command, args);
    results.push({ name, command: `aafe ${command} ${args.join(' ')}`.trim(), ...result });
    if (result.status === 'fail' && options.failFast !== false) break;
  }
  if (!options.dryRun) await writeCompletionLog(root, results);
  return results;
}

function runAafe(root, command, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], command, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: 'fail', error: error.message }));
    child.on('close', (code) => resolve({ status: code === 0 ? 'pass' : 'fail', exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function writeCompletionLog(root, results) {
  const { memoryDir: directory } = await loadMemoryConfig(root);
  await mkdir(directory, { recursive: true });
  const entry = JSON.stringify({ type: 'task-completion-sync', generatedAt: new Date().toISOString(), results });
  await appendFile(path.join(directory, 'knowledge-sync.jsonl'), `${entry}\n`);
}

export async function hasCompletionHook(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, '.aafe.config.json'), 'utf8'));
    return config.taskCompletion?.enabled === true;
  } catch {
    return false;
  }
}
