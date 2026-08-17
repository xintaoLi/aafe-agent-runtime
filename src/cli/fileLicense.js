import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import {
  LICENSE_TEMPLATE_FINGERPRINT,
  fileLicenseMemoryPath,
  normalizeMemoryPath,
  resolveLicenseCommentStyle,
  inspectFileLicense,
  applyLicenseUpdateOnModify,
  isLicenseOkInMemoryJsonl,
  formatLicenseOkMemoryLine,
  parseFileLicenseMemory,
  isLicenseOkInMemory
} from './fileLicenseRules.js';

/**
 * Local (non-AI) license check / ensure against memory + file head.
 * Agent must call this via Shell and must NOT Read/Grep the memory file into context.
 */
export async function runFileLicenseCommand(root, args) {
  const action = args[0] ?? 'help';
  const options = parseLicenseOptions(args.slice(1));
  const files = options.rest;

  if (action === 'help' || action === '--help' || action === '-h') {
    printLicenseHelp();
    return;
  }

  if (!['check', 'ensure', 'mark'].includes(action)) {
    printLicenseHelp();
    throw new Error(`Unknown license action: ${action}`);
  }

  if (files.length === 0) {
    throw new Error(`Missing file path. Usage: aafe license ${action} <file> [file...]`);
  }

  const agentPrefix = options.agentPrefix || '.ai-agent';
  const memoryAbs = path.join(root, fileLicenseMemoryPath(agentPrefix));
  let memoryText = await readMemoryText(memoryAbs);

  const results = [];
  for (const fileArg of files) {
    const relativePath = toProjectRelative(root, fileArg);
    const absPath = path.resolve(root, relativePath);
    results.push(await runOne(action, {
      root,
      absPath,
      relativePath,
      memoryAbs,
      memoryText,
      write: options.write !== false,
      year: options.year
    }));
    // refresh local cache after mark/ensure appends (still never printed to AI)
    if (action === 'ensure' || action === 'mark') {
      memoryText = await readMemoryText(memoryAbs);
    }
  }

  // One short line per file — never dump memory JSON to stdout
  for (const result of results) {
    console.log(formatResultLine(result));
  }

  if (results.some((item) => item.action === 'need-update' || item.action === 'error')) {
    process.exitCode = 2;
  }
}

async function runOne(action, ctx) {
  const { absPath, relativePath, memoryAbs, memoryText, write, year } = ctx;
  const style = resolveLicenseCommentStyle(relativePath);

  if (style === 'skip') {
    return { path: relativePath, action: 'skip-type', style };
  }

  if (isLicenseRememberedOk(memoryText, relativePath)) {
    return { path: relativePath, action: 'memory-ok', style };
  }

  if (action === 'mark') {
    if (write) {
      await appendMemoryOk(memoryAbs, relativePath, { style });
    }
    return { path: relativePath, action: 'marked', style };
  }

  let content;
  try {
    content = await readFile(absPath, 'utf8');
  } catch (error) {
    return {
      path: relativePath,
      action: 'error',
      style,
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  // New-file flow: empty/new file without license — ensure can add when --add-missing
  // Default modify policy: only touch when license-like header exists
  if (action === 'check') {
    const inspection = inspectFileLicense(content, relativePath);
    if (!inspection.hasLicense) {
      return { path: relativePath, action: 'no-license', style };
    }
    if (inspection.compliant) {
      if (write) await appendMemoryOk(memoryAbs, relativePath, { style });
      return { path: relativePath, action: 'ok', style };
    }
    return { path: relativePath, action: 'need-update', style };
  }

  // ensure
  const result = applyLicenseUpdateOnModify(content, relativePath, year ? { year } : {});
  if (result.action === 'no-license') {
    return { path: relativePath, action: 'no-license', style };
  }
  if (result.action === 'ok') {
    if (write) await appendMemoryOk(memoryAbs, relativePath, { style });
    return { path: relativePath, action: 'ok', style };
  }
  if (result.action === 'updated') {
    if (write) {
      await writeFile(absPath, result.content, 'utf8');
      await appendMemoryOk(memoryAbs, relativePath, { style });
    }
    return { path: relativePath, action: 'updated', style };
  }
  return { path: relativePath, action: result.action, style };
}

function isLicenseRememberedOk(memoryText, relativePath) {
  if (isLicenseOkInMemoryJsonl(memoryText, relativePath)) return true;
  // Legacy single JSON blob (migrate-friendly read)
  const trimmed = String(memoryText || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      return isLicenseOkInMemory(parseFileLicenseMemory(JSON.parse(trimmed)), relativePath);
    } catch {
      return false;
    }
  }
  return false;
}

async function readMemoryText(memoryAbs) {
  try {
    return await readFile(memoryAbs, 'utf8');
  } catch {
    // try legacy .json next to jsonl
    if (memoryAbs.endsWith('.jsonl')) {
      try {
        return await readFile(memoryAbs.replace(/\.jsonl$/, '.json'), 'utf8');
      } catch {
        return '';
      }
    }
    return '';
  }
}

async function appendMemoryOk(memoryAbs, relativePath, meta) {
  await mkdir(path.dirname(memoryAbs), { recursive: true });
  const line = `${formatLicenseOkMemoryLine(relativePath, meta)}\n`;
  // Prefer jsonl append; if legacy .json path was configured, still append jsonl sibling when using jsonl path
  await appendFile(memoryAbs, line, 'utf8');
}

function formatResultLine(result) {
  const parts = [`action=${result.action}`, `path=${result.path}`];
  if (result.style) parts.push(`style=${result.style}`);
  if (result.detail) parts.push(`detail=${JSON.stringify(result.detail)}`);
  return parts.join(' ');
}

function toProjectRelative(root, fileArg) {
  const abs = path.resolve(root, fileArg);
  let rel = path.relative(root, abs);
  if (rel.startsWith('..')) {
    // outside root: keep as given normalized
    rel = normalizeMemoryPath(fileArg);
  }
  return normalizeMemoryPath(rel);
}

function parseLicenseOptions(args) {
  const options = { rest: [], write: true };
  for (const arg of args) {
    if (arg === '--no-write' || arg === '--dry-run') options.write = false;
    else if (arg.startsWith('--agent-prefix=')) options.agentPrefix = arg.slice('--agent-prefix='.length);
    else if (arg.startsWith('--year=')) options.year = Number(arg.slice('--year='.length));
    else if (!arg.startsWith('-')) options.rest.push(arg);
  }
  return options;
}

function printLicenseHelp() {
  console.log(`aafe license <action> <file> [file...]

Local fast License + memory check (no AI). Do not Read memory JSON/JSONL into the model.

Actions:
  check   Read-only status (may mark memory when compliant)
  ensure  If file already has a License and it is non-compliant, rewrite header + mark memory
  mark    Mark path as ok in memory (after creating a new file with a valid header)

Output: one short line per file, e.g.
  action=memory-ok path=src/a.ts style=block-star
  action=updated path=src/b.ts style=block-star
  action=no-license path=src/c.ts style=block-star

Options:
  --no-write / --dry-run   Do not write file or memory
  --agent-prefix=.ai-agent
  --year=2026              Optional copyright year when rewriting

Memory file: ${fileLicenseMemoryPath()} (append-only jsonl; fingerprint=${LICENSE_TEMPLATE_FINGERPRINT})
`);
}

/** Used by tests / programmatic callers */
export async function ensureFileLicenseLocal(root, relativePath, options = {}) {
  const agentPrefix = options.agentPrefix || '.ai-agent';
  const memoryAbs = path.join(root, fileLicenseMemoryPath(agentPrefix));
  const memoryText = await readMemoryText(memoryAbs);
  const absPath = path.resolve(root, relativePath);
  return runOne(options.action || 'ensure', {
    root,
    absPath,
    relativePath: normalizeMemoryPath(relativePath),
    memoryAbs,
    memoryText,
    write: options.write !== false,
    year: options.year
  });
}
