function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMigrationRewriteContext(moduleName, moduleRelativePath) {
  const layered = Boolean(moduleRelativePath && moduleRelativePath !== '.');
  const modulePrefix = layered ? `${moduleRelativePath}/` : '';

  return {
    moduleName,
    moduleRelativePath: layered ? moduleRelativePath : '.',
    layered,
    agentPrefix: layered ? `${moduleRelativePath}/.ai-agent` : '.ai-agent',
    configPath: layered ? `${moduleRelativePath}/.aafe.config.json` : '.aafe.config.json',
    docsPath: layered ? `${moduleRelativePath}/.docs` : '.docs',
    cursorRulesPrefix: `.cursor/rules/${moduleName}`,
    cursorSkillsPrefix: `.cursor/skills/${moduleName}`,
    cursorHooksPrefix: `.cursor/hooks/${moduleName}`,
    cursorContextPrefix: `.cursor/context/${moduleName}`,
    codebuddyPrefix: `.codebuddy/${moduleName}`,
    codebuddySkillsPrefix: `.codebuddy/${moduleName}/skills`,
    codexPrefix: `.codex/${moduleName}`,
    tracePrefix: `.trace/${moduleName}`,
    vscodePrefix: `.vscode/${moduleName}`,
    moduleGlob: layered ? `${moduleRelativePath}/**` : '**'
  };
}

export function rewriteMigratedContent(content, ctx, fileRelPath = '') {
  if (!ctx.layered) return content;

  const normalizedRelPath = String(fileRelPath).replace(/\\/g, '/');
  if (normalizedRelPath === 'hooks.json' || normalizedRelPath.endsWith('/hooks.json')) {
    return rewriteHooksJsonContent(content, ctx);
  }

  let next = content;

  next = rewriteRelativeInstallPaths(next, ctx);
  next = rewriteConfigPaths(next, ctx);
  next = rewriteDocsPaths(next, ctx);
  next = rewriteCursorLayerPaths(next, ctx);
  next = rewriteRelativeCursorPaths(next, ctx);
  next = rewriteEditorLayerPaths(next, ctx);
  next = rewriteAgentPaths(next, ctx);

  return next;
}

function rewriteRelativeInstallPaths(content, ctx) {
  let next = content;

  next = next.replace(/(?:\.\.\/|\.\/)+\.ai-agent/g, ctx.agentPrefix);
  next = next.replace(/(?:\.\.\/|\.\/)+\.aafe\.config\.json/g, ctx.configPath);
  next = next.replace(/(?:\.\.\/|\.\/)+\.docs(?=\/|[`'"\s]|$)/g, ctx.docsPath);

  return next;
}

function rewriteConfigPaths(content, ctx) {
  return replaceBareToken(content, '.aafe.config.json', ctx.configPath, ctx);
}

function rewriteDocsPaths(content, ctx) {
  // Only rewrite install-relative `.docs` references, not prose like "based on .docs".
  return content
    .replace(/(?<![A-Za-z0-9_./-])\.docs\//g, (match, offset, whole) => {
      if (isAlreadyModulePrefixed(whole, offset, ctx.moduleRelativePath)) return match;
      return `${ctx.docsPath}/`;
    })
    .replace(/(?<![A-Za-z0-9_./-])\.docs(?=`)/g, (match, offset, whole) => {
      if (isAlreadyModulePrefixed(whole, offset, ctx.moduleRelativePath)) return match;
      return ctx.docsPath;
    });
}

function rewriteCursorLayerPaths(content, ctx) {
  let next = content;
  const module = escapeRegExp(ctx.moduleName);
  const layers = [
    ['rules', ctx.cursorRulesPrefix],
    ['skills', ctx.cursorSkillsPrefix],
    ['hooks', ctx.cursorHooksPrefix],
    ['context', ctx.cursorContextPrefix]
  ];

  for (const [layer, prefix] of layers) {
    const alreadyLayered = new RegExp(`\\.cursor/${layer}/${module}/`, 'g');
    if (alreadyLayered.test(next)) {
      alreadyLayered.lastIndex = 0;
    }
    const bareLayer = new RegExp(`(?<![A-Za-z0-9_./-])\\.cursor/${layer}/(?!${module}/)`, 'g');
    next = next.replace(bareLayer, `${prefix}/`);
    const bareLayerNoSlash = new RegExp(`(?<![A-Za-z0-9_./-])\\.cursor/${layer}(?![/A-Za-z0-9_-])`, 'g');
    next = next.replace(bareLayerNoSlash, prefix);
  }

  return next;
}

function rewriteEditorLayerPaths(content, ctx) {
  let next = content;
  const module = escapeRegExp(ctx.moduleName);

  const dirEditors = [
    ['.codebuddy/', `.codebuddy/${ctx.moduleName}/`, `.codebuddy/${module}/`],
    ['.codex/', `.codex/${ctx.moduleName}/`, `.codex/${module}/`],
    ['.trace/', `.trace/${ctx.moduleName}/`, `.trace/${module}/`],
    ['.vscode/', `.vscode/${ctx.moduleName}/`, `.vscode/${module}/`]
  ];

  for (const [token, replacement, skipPattern] of dirEditors) {
    if (next.includes(skipPattern.slice(0, -1))) continue;
    next = next.replace(new RegExp(`(?<![A-Za-z0-9_./-])${escapeRegExp(token)}(?!${module}/)`, 'g'), replacement);
  }

  next = next.replace(/(?<![A-Za-z0-9_./-])\.codebuddy\/skills\//g, `${ctx.codebuddySkillsPrefix}/`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.codebuddy\/aafe\.md/g, `${ctx.codebuddyPrefix}/aafe.md`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.codex\/aafe\.md/g, `${ctx.codexPrefix}/aafe.md`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.trace\/aafe\.md/g, `${ctx.tracePrefix}/aafe.md`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.vscode\/aafe\.instructions\.md/g, `${ctx.vscodePrefix}/aafe.instructions.md`);

  return next;
}

function rewriteRelativeCursorPaths(content, ctx) {
  let next = content;
  next = next.replace(/(?<![A-Za-z0-9_./-])\.\/hooks\//g, `${ctx.cursorHooksPrefix}/`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.\/rules\//g, `${ctx.cursorRulesPrefix}/`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.\/skills\//g, `${ctx.cursorSkillsPrefix}/`);
  next = next.replace(/(?<![A-Za-z0-9_./-])\.\/context\//g, `${ctx.cursorContextPrefix}/`);
  next = next.replace(/(?<![A-Za-z0-9_./-])hooks\/run-hook\.cmd/g, `${ctx.cursorHooksPrefix}/run-hook.cmd`);
  return next;
}

function rewriteAgentPaths(content, ctx) {
  return replaceBareToken(content, '.ai-agent', ctx.agentPrefix, ctx);
}

function replaceBareToken(content, token, replacement, ctx) {
  const escapedToken = escapeRegExp(token);
  const re = new RegExp(`(?<![A-Za-z0-9_./-])${escapedToken}`, 'g');
  return content.replace(re, (match, offset, whole) => {
    if (isAlreadyModulePrefixed(whole, offset, ctx.moduleRelativePath)) return match;
    if (replacement.startsWith(`${ctx.moduleRelativePath}/`) && whole.slice(Math.max(0, offset - ctx.moduleRelativePath.length - 1), offset + match.length).includes(`${ctx.moduleRelativePath}/${token}`)) {
      return match;
    }
    return replacement;
  });
}

function isAlreadyModulePrefixed(content, offset, moduleRelativePath) {
  const before = content.slice(Math.max(0, offset - moduleRelativePath.length - 1), offset);
  return before.endsWith(`${moduleRelativePath}/`) || before.endsWith(`${moduleRelativePath}`);
}

function rewriteHooksJsonContent(content, ctx) {
  try {
    const parsed = JSON.parse(content);
    rewriteHookObject(parsed, ctx);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return rewriteMigratedContent(content, ctx, 'hooks.json.fallback');
  }
}

function rewriteHookObject(value, ctx) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.command === 'string') {
    value.command = rewriteHookCommand(value.command, ctx);
  }
  if (Array.isArray(value)) {
    for (const item of value) rewriteHookObject(item, ctx);
    return;
  }
  for (const nested of Object.values(value)) rewriteHookObject(nested, ctx);
}

function rewriteHookCommand(command, ctx) {
  let next = command;
  next = rewriteRelativeCursorPaths(next, ctx);
  next = rewriteCursorLayerPaths(next, ctx);
  next = rewriteEditorLayerPaths(next, ctx);
  next = rewriteAgentPaths(next, ctx);
  next = rewriteConfigPaths(next, ctx);
  return next;
}

export function createCursorPathContext(moduleName, moduleRelativePath) {
  return createMigrationRewriteContext(moduleName, moduleRelativePath);
}

export function rewriteCursorContent(content, ctx, fileRelPath = '') {
  return rewriteMigratedContent(content, ctx, fileRelPath);
}
