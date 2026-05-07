import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class MemoryStore {
  constructor(root, options = {}) {
    this.root = root;
    this.memoryDir = options.memoryDir ?? path.join(root, '.ai-agent/memory');
    this.recordsFile = path.join(this.memoryDir, 'learnings.jsonl');
  }

  async init() {
    await mkdir(this.memoryDir, { recursive: true });
    await writeIfMissing(path.join(this.memoryDir, 'index.md'), memoryIndex());
    await writeIfMissing(path.join(this.memoryDir, 'project-design.md'), projectDesign());
    await writeIfMissing(path.join(this.memoryDir, 'components.md'), components());
    await writeIfMissing(path.join(this.memoryDir, 'development-habits.md'), developmentHabits());
    await writeIfMissing(path.join(this.memoryDir, 'conventions.md'), conventions());
    await writeIfMissing(path.join(this.memoryDir, 'decisions.md'), decisions());
    await writeIfMissing(this.recordsFile, '');
  }

  async add(entry) {
    await this.init();
    const record = normalizeEntry(entry);
    const previous = await safeRead(this.recordsFile);
    await writeFile(this.recordsFile, `${previous}${JSON.stringify(record)}\n`);
    await this.appendToTopic(record);
    return record;
  }

  async list(filter = {}) {
    const records = await this.readRecords();
    return records.filter((record) => {
      if (filter.type && record.type !== filter.type) return false;
      if (filter.tag && !record.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async search(query) {
    const q = String(query ?? '').toLowerCase();
    if (!q) return [];
    const records = await this.readRecords();
    return records.filter((record) => {
      const text = [record.type, record.title, record.content, ...record.tags].join('\n').toLowerCase();
      return text.includes(q);
    });
  }

  async context(query, limit = 8) {
    const records = query ? await this.search(query) : await this.list();
    return records.slice(-limit).map(formatRecord).join('\n\n');
  }

  async readRecords() {
    const content = await safeRead(this.recordsFile);
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async appendToTopic(record) {
    const filePath = path.join(this.memoryDir, `${topicFile(record.type)}.md`);
    const previous = await safeRead(filePath) || `# ${topicTitle(record.type)}\n`;
    const next = `${previous.trimEnd()}\n\n## ${record.title}\n\n- Type: ${record.type}\n- Tags: ${record.tags.join(', ') || 'none'}\n- Created: ${record.createdAt}\n\n${record.content}\n`;
    await writeFile(filePath, next);
  }
}

function normalizeEntry(entry) {
  const type = entry.type ?? 'learning';
  const title = entry.title ?? inferTitle(entry.content, type);
  return {
    id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    content: String(entry.content ?? '').trim(),
    tags: Array.isArray(entry.tags) ? entry.tags : parseTags(entry.tags),
    source: entry.source ?? 'manual',
    createdAt: entry.createdAt ?? new Date().toISOString()
  };
}

function parseTags(tags) {
  if (!tags) return [];
  return String(tags).split(',').map((tag) => tag.trim()).filter(Boolean);
}

function inferTitle(content, type) {
  const text = String(content ?? '').trim().split('\n')[0] ?? '';
  return text.slice(0, 48) || `${type} memory`;
}

function formatRecord(record) {
  return `### ${record.title}\nType: ${record.type}\nTags: ${record.tags.join(', ') || 'none'}\n${record.content}`;
}

function topicFile(type) {
  const map = {
    design: 'project-design',
    component: 'components',
    habit: 'development-habits',
    convention: 'conventions',
    decision: 'decisions'
  };
  return map[type] ?? 'index';
}

function topicTitle(type) {
  const map = {
    design: 'Project Design Memory',
    component: 'Component Memory',
    habit: 'Development Habits Memory',
    convention: 'Conventions Memory',
    decision: 'Architecture Decisions Memory'
  };
  return map[type] ?? 'Project Learning Memory';
}

async function writeIfMissing(filePath, content) {
  if (await exists(filePath)) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function exists(filePath) {
  try {
    await readFile(filePath, 'utf8');
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

function memoryIndex() {
  return `# Project Memory

This directory stores project-specific learning for AI agents.

Memory categories:
- project-design: architecture, module boundaries and domain concepts
- components: reusable components, props contracts and composition rules
- development-habits: team preferences and recurring implementation habits
- conventions: naming, file layout, coding rules and review standards
- decisions: architecture decisions and tradeoffs
- learnings.jsonl: append-only structured memory log
`;
}

function projectDesign() {
  return `# Project Design Memory

Record architecture, domain boundaries, module ownership, state ownership and long-term design constraints here.
`;
}

function components() {
  return `# Component Memory

Record component contracts, composition rules, reusable patterns, anti-patterns and usage examples here.
`;
}

function developmentHabits() {
  return `# Development Habits Memory

Record team habits, preferred implementation style, review preferences and recurring workflow choices here.
`;
}

function conventions() {
  return `# Conventions Memory

Record naming rules, folder layout, import rules, testing expectations and style conventions here.
`;
}

function decisions() {
  return `# Architecture Decisions Memory

Record durable decisions, alternatives, tradeoffs and consequences here.
`;
}
