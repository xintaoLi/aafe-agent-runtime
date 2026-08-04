#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPortablePackFiles } from '../src/cli/portableCompletionTapdPack.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'temp');

async function main() {
  const files = getPortablePackFiles();
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(outDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  console.log(`Exported ${Object.keys(files).length} files to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
