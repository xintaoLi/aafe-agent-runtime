import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FileSummaryCache {
  constructor({ root = process.cwd(), output = '.aafe', summarizerVersion = '1', schemaVersion = '1' } = {}) {
    this.file = path.join(root, output, 'cache', 'file-summaries.json');
    this.summarizerVersion = summarizerVersion; this.schemaVersion = schemaVersion;
  }
  key(file, content) { return createHash('sha256').update(`${this.schemaVersion}\0${this.summarizerVersion}\0${file}\0${content}`).digest('hex'); }
  async get(file, content) { const data = await this.#read(); return data.entries?.[this.key(file, content)] ?? null; }
  async put(file, content, summary) {
    const data = await this.#read(); data.entries ??= {};
    data.entries[this.key(file, content)] = { file, summary, contentHash: createHash('sha256').update(content).digest('hex'), updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(data, null, 2) + '\n');
    return data.entries[this.key(file, content)];
  }
  async getOrCreate(file, content, summarize) { return (await this.get(file, content)) ?? this.put(file, content, await summarize(content, file)); }
  async #read() { try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return { version: 1, entries: {} }; } }
}
