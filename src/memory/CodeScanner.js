import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const sourceExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);
const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', 'output', '.session_tmps']);

export async function scanProjectMemory(root, options = {}) {
  const files = await collectFiles(options.target ?? path.join(root, 'src'), options.limit ?? 300);
  const memories = [];

  for (const file of files) {
    const content = await safeRead(file);
    memories.push(...scanComponents(root, file, content));
    memories.push(...scanConventions(root, file, content));
  }

  return dedupe(memories);
}

async function collectFiles(target, limit, acc = []) {
  if (acc.length >= limit) return acc;
  const info = await safeStat(target);
  if (!info) return acc;
  if (info.isFile()) {
    if (sourceExts.has(path.extname(target))) acc.push(target);
    return acc;
  }
  if (!info.isDirectory()) return acc;
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= limit) break;
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    await collectFiles(path.join(target, entry.name), limit, acc);
  }
  return acc;
}

function scanComponents(root, file, content) {
  const rel = path.relative(root, file);
  const entries = [];
  const componentNames = new Set();
  for (const match of content.matchAll(/(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)/g)) componentNames.add(match[1]);
  for (const match of content.matchAll(/<script[^>]*setup[^>]*>/g)) componentNames.add(path.basename(file, path.extname(file)));

  for (const name of componentNames) {
    entries.push({
      type: 'component',
      title: `Component ${name}`,
      content: `${name} is defined in ${rel}. Preserve its public contract and composition style when modifying related code.`,
      tags: ['component', path.extname(file).slice(1)].filter(Boolean),
      source: 'scanner'
    });
  }
  return entries;
}

function scanConventions(root, file, content) {
  const rel = path.relative(root, file);
  const entries = [];
  if (/\.module\.(css|scss|less)/.test(content) || /styles\s+from\s+['"].*\.module\./.test(content)) {
    entries.push({ type: 'convention', title: 'CSS Module convention', content: `CSS Modules are used around ${rel}; prefer scoped styles over global selectors.`, tags: ['style', 'css-module'], source: 'scanner' });
  }
  if (/from\s+['"]@\//.test(content)) {
    entries.push({ type: 'convention', title: 'Alias import convention', content: `Path alias @/ is used in ${rel}; prefer configured aliases over deep relative imports when consistent.`, tags: ['import', 'alias'], source: 'scanner' });
  }
  if (/use[A-Z][A-Za-z0-9]*\s*\(/.test(content)) {
    entries.push({ type: 'habit', title: 'Hooks composition habit', content: `Hooks composition appears in ${rel}; keep stateful logic in hooks when extending related behavior.`, tags: ['hooks', 'composition'], source: 'scanner' });
  }
  if (/describe\(|it\(|test\(/.test(content)) {
    entries.push({ type: 'convention', title: 'Test colocating convention', content: `Tests are present around ${rel}; preserve or add regression coverage for behavior changes.`, tags: ['test'], source: 'scanner' });
  }
  return entries;
}

function dedupe(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.title}:${entry.content}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function safeRead(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function safeStat(file) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}
