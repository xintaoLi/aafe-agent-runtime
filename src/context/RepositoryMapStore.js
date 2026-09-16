import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class RepositoryMapStore {
  constructor({ root = process.cwd(), output = '.aafe' } = {}) { this.file = path.join(root, output, 'cache', 'repository-map.json'); }
  async get(commit) { const data = await this.#read(); return data.commit === commit ? data : null; }
  async put(commit, entries = []) {
    const data = { version: 1, commit: commit ?? 'working-tree', generatedAt: new Date().toISOString(),
      entries: entries.map((entry) => ({ path: String(entry.path), kind: entry.kind ?? 'file', exports: [...new Set(entry.exports ?? [])], summary: entry.summary ?? null })) };
    await mkdir(path.dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(data, null, 2) + '\n'); return data;
  }
  async getOrCreate(commit, build) { return (await this.get(commit)) ?? this.put(commit, await build()); }
  async #read() { try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; } }
}
