import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveLicenseCommentStyle,
  formatLicenseHeader,
  fileLicenseProjectRuleMdc,
  fileLicenseRuleMdc,
  hasLicenseLikeHeader,
  inspectFileLicense,
  applyLicenseUpdateOnModify,
  isLicenseOkInMemory,
  markLicenseOkInMemory,
  parseFileLicenseMemory,
  isLicenseOkInMemoryJsonl,
  formatLicenseOkMemoryLine,
  LICENSE_TEMPLATE_FINGERPRINT,
  fileLicenseMemoryPath
} from '../src/cli/fileLicenseRules.js';
import { ensureFileLicenseLocal } from '../src/cli/fileLicense.js';

assert.equal(resolveLicenseCommentStyle('src/a.ts'), 'block-star');
assert.equal(resolveLicenseCommentStyle('src/a.vue'), 'html');
assert.equal(resolveLicenseCommentStyle('scripts/run.sh'), 'line-hash');
assert.equal(resolveLicenseCommentStyle('db/query.sql'), 'line-dash');
assert.equal(resolveLicenseCommentStyle('package.json'), 'skip');
assert.equal(resolveLicenseCommentStyle('Dockerfile'), 'line-hash');

const tsHeader = formatLicenseHeader('src/a.ts');
assert.match(tsHeader, /^\/\*/);
assert.match(tsHeader, /\* Tencent is pleased/);
assert.match(tsHeader, /BlueKing PaaS/);
assert.match(tsHeader, /\*\/\n$/);

const vueHeader = formatLicenseHeader('x.vue');
assert.match(vueHeader, /^<!--/);
assert.match(vueHeader, /-->\n$/);

const pyHeader = formatLicenseHeader('a.py');
assert.match(pyHeader, /^# Tencent is pleased/);

assert.equal(formatLicenseHeader('a.json'), '');

const goodTs = `${tsHeader}export const x = 1;\n`;
assert.equal(hasLicenseLikeHeader(goodTs), true);
assert.equal(inspectFileLicense(goodTs, 'src/a.ts').compliant, true);
assert.equal(applyLicenseUpdateOnModify(goodTs, 'src/a.ts').action, 'ok');

const noLicense = 'export const x = 1;\n';
assert.equal(hasLicenseLikeHeader(noLicense), false);
assert.equal(applyLicenseUpdateOnModify(noLicense, 'src/a.ts').action, 'no-license');
assert.equal(applyLicenseUpdateOnModify(noLicense, 'src/a.ts').content, noLicense);

const wrongLicense = `/*
 * Copyright (C) 2020 Other Corp
 * Licensed under the Apache License.
 */
export const x = 1;\n`;
assert.equal(inspectFileLicense(wrongLicense, 'src/a.ts').hasLicense, true);
assert.equal(inspectFileLicense(wrongLicense, 'src/a.ts').compliant, false);
const updated = applyLicenseUpdateOnModify(wrongLicense, 'src/a.ts');
assert.equal(updated.action, 'updated');
assert.match(updated.content, /BlueKing PaaS/);
assert.match(updated.content, /export const x = 1/);
assert.equal(inspectFileLicense(updated.content, 'src/a.ts').compliant, true);

const shebangWrong = `#!/usr/bin/env node
/*
 * Some other license
 * Copyright (C) 2019 Foo
 */
console.log(1);\n`;
const shebangFixed = applyLicenseUpdateOnModify(shebangWrong, 'bin/run.js');
assert.equal(shebangFixed.action, 'updated');
assert.match(shebangFixed.content, /^#!\/usr\/bin\/env node\n\/\*/);
assert.match(shebangFixed.content, /console\.log\(1\)/);

let memory = parseFileLicenseMemory(null);
assert.equal(isLicenseOkInMemory(memory, 'src/a.ts'), false);
memory = markLicenseOkInMemory(memory, 'src/a.ts', { style: 'block-star' });
assert.equal(memory.fingerprint, LICENSE_TEMPLATE_FINGERPRINT);
assert.equal(isLicenseOkInMemory(memory, 'src/a.ts'), true);

const jsonl = [
  formatLicenseOkMemoryLine('src/old.ts', { style: 'block-star', at: 't1' }),
  formatLicenseOkMemoryLine('src/a.ts', { style: 'block-star', at: 't2' })
].join('\n');
assert.equal(isLicenseOkInMemoryJsonl(jsonl, 'src/a.ts'), true);
assert.equal(isLicenseOkInMemoryJsonl(jsonl, 'src/missing.ts'), false);
assert.equal(isLicenseOkInMemoryJsonl(`{"path":"src/a.ts","ok":true,"fp":"old"}\n`, 'src/a.ts'), false);
assert.equal(fileLicenseMemoryPath(), '.ai-agent/memory/file-license-ok.jsonl');

const rule = fileLicenseProjectRuleMdc({ agentPrefix: '.ai-agent' });
assert.match(rule, /alwaysApply: true/);
assert.match(rule, /block-star/);
assert.match(rule, /aafe license ensure/);
assert.match(rule, /禁止.*Read|AI Read/);
assert.match(rule, /file-license-ok\.jsonl/);

const pointer = fileLicenseRuleMdc();
assert.match(pointer, /new-file-license\.mdc/);
assert.match(pointer, /本地 CLI/);

// Local CLI ensure (temp project) — no AI involvement
const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-license-'));
await mkdir(path.join(tmp, 'src'), { recursive: true });
const sample = path.join(tmp, 'src/sample.ts');
await writeFile(sample, wrongLicense, 'utf8');
const first = await ensureFileLicenseLocal(tmp, 'src/sample.ts');
assert.equal(first.action, 'updated');
const body = await readFile(sample, 'utf8');
assert.match(body, /BlueKing PaaS/);
const second = await ensureFileLicenseLocal(tmp, 'src/sample.ts');
assert.equal(second.action, 'memory-ok');
const memFile = await readFile(path.join(tmp, '.ai-agent/memory/file-license-ok.jsonl'), 'utf8');
assert.match(memFile, /src\/sample\.ts/);

console.log('file license rules tests passed');
