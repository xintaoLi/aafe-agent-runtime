/** Template id for memory cache invalidation when license design changes. */
export const LICENSE_TEMPLATE_FINGERPRINT = 'blueking-mit-v1';

export const FILE_LICENSE_MEMORY_RELATIVE = 'memory/file-license-ok.jsonl';

const LICENSE_BODY_LINES = [
  'Tencent is pleased to support the open source community by making',
  '蓝鲸智云PaaS平台 (BlueKing PaaS) available.',
  'Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.',
  '蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.',
  'License for 蓝鲸智云PaaS平台 (BlueKing PaaS):',
  '---------------------------------------------------',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
  'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
  'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
  'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of',
  'the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
  'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF',
  'CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS',
  'IN THE SOFTWARE.'
];

const LICENSE_LIKE_RE = /copyright|all rights reserved|licensed under|permission is hereby granted|mit license|blueking paas|蓝鲸智云/i;

const BLUEKING_REQUIRED_MARKERS = [
  'Tencent is pleased to support the open source community by making',
  '蓝鲸智云PaaS平台 (BlueKing PaaS) available.',
  'THL A29 Limited',
  'BlueKing PaaS',
  'Permission is hereby granted, free of charge',
  'THE SOFTWARE IS PROVIDED "AS IS"'
];

export function blueKingLicenseBodyLines() {
  return [...LICENSE_BODY_LINES];
}

export function fileLicenseMemoryPath(agentPrefix = '.ai-agent') {
  return `${agentPrefix.replace(/\/$/, '')}/${FILE_LICENSE_MEMORY_RELATIVE}`;
}

/** @typedef {'block-star' | 'line-hash' | 'html' | 'line-dash' | 'skip'} LicenseCommentStyle */

/**
 * Resolve license comment style by file path / extension.
 * @param {string} filePath
 * @returns {LicenseCommentStyle}
 */
export function resolveLicenseCommentStyle(filePath = '') {
  const base = String(filePath).split(/[\\/]/).pop() ?? '';
  const lower = base.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';

  if (
    lower.endsWith('.min.js')
    || lower.endsWith('.min.css')
    || lower === 'package-lock.json'
    || lower === 'yarn.lock'
    || lower === 'pnpm-lock.yaml'
  ) {
    return 'skip';
  }

  if ([
    'json', 'jsonc', 'json5', 'lock', 'map',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
    'woff', 'woff2', 'ttf', 'eot',
    'zip', 'gz', 'tgz', 'bin', 'wasm', 'pdf', 'mp4', 'mp3'
  ].includes(ext)) {
    return 'skip';
  }

  if ([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'cts', 'mts',
    'css', 'scss', 'sass', 'less', 'styl',
    'java', 'go', 'rs', 'kt', 'kts', 'scala',
    'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh',
    'swift', 'm', 'mm'
  ].includes(ext)) {
    return 'block-star';
  }

  if ([
    'html', 'htm', 'xml', 'xhtml', 'vue', 'svelte', 'mdx', 'svg', 'md', 'markdown'
  ].includes(ext)) {
    return 'html';
  }

  if ([
    'py', 'pyi', 'sh', 'bash', 'zsh', 'fish',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
    'rb', 'rake', 'pl', 'pm', 'ps1', 'r',
    'dockerfile', 'makefile', 'mk', 'env', 'gitignore', 'dockerignore'
  ].includes(ext)
    || lower === 'dockerfile'
    || lower === 'makefile'
    || lower.startsWith('dockerfile.')
  ) {
    return 'line-hash';
  }

  if (['sql', 'psql'].includes(ext)) {
    return 'line-dash';
  }

  // Unknown text-like sources: prefer block comment
  return 'block-star';
}

/**
 * Wrap license body with comment tags for a file path.
 * @param {string} filePath
 * @param {{ year?: number }} [options]
 */
export function formatLicenseHeader(filePath, options = {}) {
  const style = resolveLicenseCommentStyle(filePath);
  if (style === 'skip') return '';

  const lines = blueKingLicenseBodyLines().map((line) => {
    if (options.year && line.includes('Copyright (C) 2021')) {
      return line.replace('Copyright (C) 2021', `Copyright (C) ${options.year}`);
    }
    return line;
  });

  if (style === 'block-star') {
    return [
      '/*',
      ...lines.map((line) => ` * ${line}`),
      ' */',
      ''
    ].join('\n');
  }

  if (style === 'html') {
    return [
      '<!--',
      ...lines.map((line) => `  ${line}`),
      '-->',
      ''
    ].join('\n');
  }

  if (style === 'line-hash') {
    return `${lines.map((line) => `# ${line}`).join('\n')}\n\n`;
  }

  if (style === 'line-dash') {
    return `${lines.map((line) => `-- ${line}`).join('\n')}\n\n`;
  }

  return '';
}

/**
 * Lightweight probe: does the file head look like it already has a license header?
 * @param {string} content
 * @param {{ maxLines?: number }} [options]
 */
export function hasLicenseLikeHeader(content = '', options = {}) {
  const maxLines = options.maxLines ?? 40;
  const head = String(content).split(/\r?\n/).slice(0, maxLines).join('\n');
  return LICENSE_LIKE_RE.test(head);
}

/**
 * Strip comment wrappers / prefixes from a license-like head for marker checks.
 * @param {string} text
 */
export function normalizeLicenseProbeText(text = '') {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/^\s*\/\*\s?/, '')
      .replace(/^\s*\*\/\s*$/, '')
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*<!--\s?/, '')
      .replace(/^\s*-->\s*$/, '')
      .replace(/^\s*#\s?/, '')
      .replace(/^\s*--\s?/, '')
      .trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Check whether leading comment style matches the expected style for the path.
 * @param {string} content
 * @param {LicenseCommentStyle} style
 */
export function hasExpectedLicenseCommentStyle(content = '', style) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.startsWith('#!')) i = 1;
  while (lines[i] === '') i += 1;
  const first = lines[i] ?? '';

  if (style === 'block-star') return first.trimStart().startsWith('/*');
  if (style === 'html') return first.trimStart().startsWith('<!--');
  if (style === 'line-hash') return first.trimStart().startsWith('#');
  if (style === 'line-dash') return first.trimStart().startsWith('--');
  return false;
}

/**
 * @param {string} content
 * @param {string} filePath
 * @returns {{ skip: boolean, hasLicense: boolean, compliant: boolean, style: LicenseCommentStyle }}
 */
export function inspectFileLicense(content, filePath) {
  const style = resolveLicenseCommentStyle(filePath);
  if (style === 'skip') {
    return { skip: true, hasLicense: false, compliant: true, style };
  }

  const hasLicense = hasLicenseLikeHeader(content);
  if (!hasLicense) {
    return { skip: false, hasLicense: false, compliant: false, style };
  }

  const head = String(content).split(/\r?\n/).slice(0, 45).join('\n');
  const normalized = normalizeLicenseProbeText(head);
  const markersOk = BLUEKING_REQUIRED_MARKERS.every((marker) => softMarkerMatch(normalized, marker));
  // Year may differ: allow Copyright (C) YYYY
  const copyrightOk = /Copyright \(C\) \d{4} THL A29 Limited/i.test(normalized);
  const styleOk = hasExpectedLicenseCommentStyle(content, style);
  const compliant = Boolean(markersOk && copyrightOk && styleOk);

  return { skip: false, hasLicense: true, compliant, style };
}

function softMarkerMatch(normalized, marker) {
  // Allow minor whitespace collapse on long legal lines
  const compact = (s) => s.replace(/\s+/g, ' ').trim();
  return compact(normalized).includes(compact(marker));
}

/**
 * For **modify** flows: if file already has a license and it is non-compliant, rewrite header.
 * If no license → leave unchanged. If compliant → leave unchanged.
 * @param {string} content
 * @param {string} filePath
 * @param {{ year?: number }} [options]
 * @returns {{ content: string, action: 'skip-type' | 'no-license' | 'ok' | 'updated' }}
 */
export function applyLicenseUpdateOnModify(content, filePath, options = {}) {
  const inspection = inspectFileLicense(content, filePath);
  if (inspection.skip) return { content, action: 'skip-type' };
  if (!inspection.hasLicense) return { content, action: 'no-license' };
  if (inspection.compliant) return { content, action: 'ok' };

  const next = replaceLeadingLicenseHeader(content, filePath, options);
  return { content: next, action: 'updated' };
}

/**
 * Replace leading license-like header with the standard BlueKing header (keeps shebang).
 * @param {string} content
 * @param {string} filePath
 * @param {{ year?: number }} [options]
 */
export function replaceLeadingLicenseHeader(content, filePath, options = {}) {
  const style = resolveLicenseCommentStyle(filePath);
  if (style === 'skip') return content;

  const header = formatLicenseHeader(filePath, options);
  const { shebang, body } = splitShebangAndBody(content);
  const withoutOld = stripLeadingLicenseLikeBlock(body, style);
  const parts = [];
  if (shebang) parts.push(shebang);
  parts.push(header.replace(/\n$/, ''));
  const rest = withoutOld.replace(/^\n+/, '');
  if (rest) {
    parts.push('');
    parts.push(rest);
  } else {
    parts.push('');
  }
  return `${parts.join('\n').replace(/\n+$/, '\n')}`;
}

function splitShebangAndBody(content = '') {
  const text = String(content).replace(/\r\n/g, '\n');
  if (text.startsWith('#!')) {
    const idx = text.indexOf('\n');
    if (idx === -1) return { shebang: text, body: '' };
    return { shebang: text.slice(0, idx), body: text.slice(idx + 1) };
  }
  return { shebang: '', body: text };
}

/**
 * Remove a leading license-like comment block so a new header can be inserted.
 * @param {string} body
 * @param {LicenseCommentStyle} style
 */
export function stripLeadingLicenseLikeBlock(body = '', style) {
  const text = String(body).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let i = 0;
  while (lines[i] === '') i += 1;

  if (style === 'block-star' && lines[i]?.trimStart().startsWith('/*')) {
    i += 1;
    while (i < lines.length && !lines[i].includes('*/')) i += 1;
    if (i < lines.length) i += 1;
    while (lines[i] === '') i += 1;
    return lines.slice(i).join('\n');
  }

  if (style === 'html' && lines[i]?.trimStart().startsWith('<!--')) {
    if (lines[i].includes('-->') && !lines[i].trim().endsWith('<!--')) {
      i += 1;
    } else {
      i += 1;
      while (i < lines.length && !lines[i].includes('-->')) i += 1;
      if (i < lines.length) i += 1;
    }
    while (lines[i] === '') i += 1;
    return lines.slice(i).join('\n');
  }

  if (style === 'line-hash' || style === 'line-dash') {
    const prefix = style === 'line-hash' ? '#' : '--';
    const start = i;
    while (i < lines.length && (lines[i].trimStart().startsWith(prefix) || lines[i] === '')) {
      if (lines[i] === '' && i > start) {
        // blank line after consecutive comment lines ends the header
        const prev = lines[i - 1] ?? '';
        if (prev.trimStart().startsWith(prefix)) {
          i += 1;
          break;
        }
      }
      if (!lines[i].trimStart().startsWith(prefix) && lines[i] !== '') break;
      i += 1;
      // safety: license headers are long but finite
      if (i - start > 60) break;
    }
    while (lines[i] === '') i += 1;
    // Only strip if the removed region looked license-like
    const removed = lines.slice(start, i).join('\n');
    if (!LICENSE_LIKE_RE.test(removed)) return text;
    return lines.slice(i).join('\n');
  }

  // Fallback: if unexpected style wrapper, try strip first block-star or html
  if (LICENSE_LIKE_RE.test(lines.slice(0, 40).join('\n'))) {
    if (lines[i]?.trimStart().startsWith('/*')) {
      return stripLeadingLicenseLikeBlock(body, 'block-star');
    }
    if (lines[i]?.trimStart().startsWith('<!--')) {
      return stripLeadingLicenseLikeBlock(body, 'html');
    }
  }

  return text;
}

/**
 * @typedef {{ fingerprint: string, files: Record<string, { ok: boolean, style?: string, at?: string }> }} FileLicenseMemory
 */

export function emptyFileLicenseMemory() {
  return {
    fingerprint: LICENSE_TEMPLATE_FINGERPRINT,
    files: {}
  };
}

/**
 * @param {unknown} raw
 * @returns {FileLicenseMemory}
 */
export function parseFileLicenseMemory(raw) {
  if (!raw || typeof raw !== 'object') return emptyFileLicenseMemory();
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const files = obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)
    ? /** @type {FileLicenseMemory['files']} */ (obj.files)
    : {};
  return {
    fingerprint: typeof obj.fingerprint === 'string' ? obj.fingerprint : '',
    files
  };
}

/**
 * Memory hit: fingerprint matches current template and path marked ok.
 * @param {FileLicenseMemory | null | undefined} memory
 * @param {string} relativePath
 */
export function isLicenseOkInMemory(memory, relativePath) {
  if (!memory || memory.fingerprint !== LICENSE_TEMPLATE_FINGERPRINT) return false;
  const key = normalizeMemoryPath(relativePath);
  return memory.files?.[key]?.ok === true;
}

/**
 * @param {FileLicenseMemory | null | undefined} memory
 * @param {string} relativePath
 * @param {{ style?: string, at?: string }} [meta]
 * @returns {FileLicenseMemory}
 */
export function markLicenseOkInMemory(memory, relativePath, meta = {}) {
  const next = memory && memory.fingerprint === LICENSE_TEMPLATE_FINGERPRINT
    ? {
        fingerprint: LICENSE_TEMPLATE_FINGERPRINT,
        files: { ...memory.files }
      }
    : emptyFileLicenseMemory();

  const key = normalizeMemoryPath(relativePath);
  next.files[key] = {
    ok: true,
    style: meta.style,
    at: meta.at ?? new Date().toISOString()
  };
  return next;
}

export function normalizeMemoryPath(filePath = '') {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Append-only jsonl memory: last matching path+fingerprint wins.
 * @param {string} content
 * @param {string} relativePath
 */
export function isLicenseOkInMemoryJsonl(content = '', relativePath) {
  const key = normalizeMemoryPath(relativePath);
  let ok = false;
  for (const line of String(content).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('{') === false) continue;
    // skip legacy whole-json blob lines that are multi-line; handled elsewhere
    try {
      const row = JSON.parse(trimmed);
      if (row && row.path === key && row.fp === LICENSE_TEMPLATE_FINGERPRINT) {
        ok = row.ok === true;
      }
    } catch {
      // ignore bad lines
    }
  }
  return ok;
}

/**
 * @param {string} relativePath
 * @param {{ style?: string, at?: string }} [meta]
 */
export function formatLicenseOkMemoryLine(relativePath, meta = {}) {
  return JSON.stringify({
    path: normalizeMemoryPath(relativePath),
    ok: true,
    fp: LICENSE_TEMPLATE_FINGERPRINT,
    style: meta.style,
    at: meta.at ?? new Date().toISOString()
  });
}

export function fileLicenseRuleMdc(ctx = {}) {
  return fileLicensePointerRuleMdc(ctx);
}

export function fileLicensePointerRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  const moduleName = ctx.moduleName ?? 'module';
  const moduleGlob = ctx.moduleGlob;
  const header = moduleGlob
    ? `---\ndescription: AAFE File License Header (${moduleName})\nalwaysApply: true\nglobs: ${moduleGlob}\n---`
    : '---\ndescription: AAFE File License Header\nalwaysApply: true\n---';

  return `${header}

# AAFE 文件 License（Pointer）

Source of truth:

1. Rule: \`${agentPrefix}/rules/new-file-license.mdc\`

**新增文件**加头；**修改且已有 License** 时用本地 CLI 校验/更新（禁止 AI 读 memory 文件）。Do not duplicate project knowledge here.
`;
}

export function fileLicenseProjectRuleMdc(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return `---
description: 新增文件加蓝鲸 License；修改时用 aafe license 本地检查/更新（禁止 AI 读 memory）。
alwaysApply: true
---

${fileLicenseProjectRuleBody(agentPrefix)}
`;
}

export function fileLicenseRuleSection(ctx = {}) {
  const agentPrefix = ctx.agentPrefix ?? '.ai-agent';
  return [
    '## AAFE 文件 License',
    '',
    '新增可文本源码文件时，文件顶部必须添加蓝鲸 / BlueKing MIT License 头。',
    '修改已有文件且已含 License 时：必须跑本地命令 `aafe license ensure <path>`（禁止 AI 读取 memory JSON/JSONL）。',
    '按扩展名选择注释标签：`/* */` / `#` / `<!-- -->` / `--`；json/图片/锁文件等跳过。',
    `Memory（仅 CLI 读写）：\`${fileLicenseMemoryPath(agentPrefix)}\`；详见 \`${agentPrefix}/rules/new-file-license.mdc\`。`,
    ''
  ].join('\n');
}

function fileLicenseProjectRuleBody(agentPrefix = '.ai-agent') {
  const memoryPath = fileLicenseMemoryPath(agentPrefix);
  return `# File License Header（BlueKing / 蓝鲸）

## 触发

### A. 新增文件

**Create / Write 新路径**时：必须按文件类型添加标准 License 头（\`skip\` 类型除外）。
写完后执行本地命令标记 memory（不要让 AI 手改 memory 文件）：

\`\`\`bash
aafe license mark <path>
\`\`\`

### B. 修改已有文件（更新策略）

仅当目标文件**已经包含 License 头**时，才检查/更新。**无 License 头**：不要为了补头而改历史文件（除非用户明确要求）。

二进制 / 生成物 / 锁文件：跳过。

## Memory + 本地快速检查（强制，禁止 AI 反馈）

合规 cache 在 \`${memoryPath}\`（append-only JSONL）。**随着文件变大，AI 读取会爆炸 tokens，因此：**

### Hard（必须遵守）

1. **禁止**用 Read / Grep / 把 \`${memoryPath}\` 内容读进模型上下文
2. **禁止**在对话里全文对比 License 正文与源文件
3. **必须**用本地 CLI 完成检查 / 更新 / 标记（Node 本地执行，只回一行短状态）

\`\`\`bash
# 修改文件前/中：本地 ensure（memory 命中则秒回；miss 则本地探针头并按需改文件）
aafe license ensure <path> [path...]

# 只检查不改文件
aafe license check <path> --no-write

# 新增文件写完标准头后标记
aafe license mark <path>
\`\`\`

### CLI 输出（唯一允许进入上下文的结果）

每文件一行，例如：

- \`action=memory-ok path=src/a.ts style=block-star\` → 已合规，直接改业务代码
- \`action=ok path=src/a.ts\` → 本地校验通过并已写入 memory
- \`action=updated path=src/a.ts\` → 已本地重写 License 头
- \`action=no-license path=src/a.ts\` → 无头，跳过（不补头）
- \`action=skip-type path=package.json\` → 跳过类型

### Memory 文件格式（仅供 CLI；AI 勿读）

JSONL，每行一条（last-write-wins）：

\`\`\`jsonl
{"path":"src/example.ts","ok":true,"fp":"${LICENSE_TEMPLATE_FINGERPRINT}","style":"block-star","at":"ISO-8601"}
\`\`\`

- \`fp\` 必须等于 \`${LICENSE_TEMPLATE_FINGERPRINT}\`；模板变更后旧行失效
- 路径为相对仓库根的 posix 路径

### 执行顺序（修改文件时）

1. **会话内**：本会话已对某 path 拿到过 CLI 结果 → 不再重复跑
2. 否则跑 \`aafe license ensure <path>\`，只根据一行 \`action=\` 决策
3. **禁止**打开 memory 文件或本 Rule 的 License 全文去做人工/AI 对比

## License 正文（固定）

\`\`\`text
Tencent is pleased to support the open source community by making
蓝鲸智云PaaS平台 (BlueKing PaaS) available.
Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
---------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
\`\`\`

## 按文件类型选择注释标签

| 风格 | 扩展名 / 文件 | 写法 |
| --- | --- | --- |
| \`block-star\` | \`.js\` \`.jsx\` \`.ts\` \`.tsx\` \`.mjs\` \`.cjs\` \`.css\` \`.scss\` \`.less\` \`.java\` \`.go\` \`.rs\` \`.kt\` \`.c\` \`.h\` \`.cpp\` \`.swift\` 等 | \`/*\` + 每行 \` * \` + \` */\` |
| \`html\` | \`.html\` \`.vue\` \`.svelte\` \`.xml\` \`.svg\` \`.md\` \`.mdx\` | \`<!--\` … \`-->\` |
| \`line-hash\` | \`.py\` \`.sh\` \`.yaml\` \`.yml\` \`.toml\` \`.rb\` \`Dockerfile\` \`Makefile\` 等 | 每行 \`# \` |
| \`line-dash\` | \`.sql\` | 每行 \`-- \` |
| \`skip\` | \`.json\` 锁文件、图片、字体、\`*.min.js\` 等 | **不添加** |

### 示例：\`block-star\`（TS/JS/CSS…）

\`\`\`ts
/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * ...
 */
\`\`\`

### 示例：\`html\`（Vue/HTML/MD…）

\`\`\`vue
<!--
  Tencent is pleased to support the open source community by making
  蓝鲸智云PaaS平台 (BlueKing PaaS) available.
  ...
-->
\`\`\`

### 示例：\`line-hash\`（Python/Shell/YAML…）

\`\`\`py
# Tencent is pleased to support the open source community by making
# 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
# ...
\`\`\`

## 放置位置

1. 文件最顶部（第 1 行起）
2. 若存在 shebang（\`#!/usr/bin/env ...\`）：License 放在 shebang **下一行**
3. Vue SFC：放在文件最顶部（\`<template>\` / \`<script>\` 之前）的 HTML 注释
4. License 头与正文之间空一行

## 禁止

- 新增源码文件却省略 License 头（\`skip\` 类型除外）
- 用错误注释语法导致语法错误（例如 JSON 内写 \`/* */\`）
- 改写 License 法律正文（年份替换除外，若项目约定可更新 Copyright 年份）
- **AI Read/Grep memory 文件或全文对比 License**（必须用 \`aafe license\`）
- 修改无 License 的历史文件时主动批量补头

规则详情与实现辅助见 AAFE runtime；项目约定以 \`${agentPrefix}/rules/new-file-license.mdc\` 为准。`;
}
