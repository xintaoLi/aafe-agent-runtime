import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCursorPathContext } from './pathRewrite.js';
import { requirementIntakeRuleSection } from './requirementAnalysisRules.js';
import { taskCompletionImpactRuleSection } from './completionImpactRules.js';
import { tapdSubmitRuleSection } from './tapdSubmitRules.js';
import { fileLicenseRuleSection } from './fileLicenseRules.js';

/**
 * OpenClaw adapter for AAFE.
 *
 * OpenClaw (also known as IMate / 腾讯数字同事平台) discovers project context
 * via `AGENTS.md` at the workspace root, similar to Hermes. The platform
 * provides a cloud-disk-based file delivery system and agent runtime that
 * injects AGENTS.md into the system prompt.
 *
 * This adapter generates:
 *   - AGENTS.md — always-on rules + skill router + runtime pipeline pointer
 *   - .openclaw/skills/aafe-runtime/SKILL.md — OpenClaw-native skill entry
 *
 * For layered (monorepo) installs, AGENTS.md is written at the workspace root
 * with module-relative paths. For flat installs, it lives at the install root.
 *
 * Note: When both Hermes and OpenClaw are detected, AGENTS.md content is
 * shared (both platforms read the same file). The separate skill directories
 * (.hermes/skills/ vs .openclaw/skills/) ensure each platform's native
 * skill discovery mechanism works independently.
 */

export async function writeLayeredOpenClawAdapters({
  workspaceRoot,
  moduleName,
  moduleRelativePath,
  options = {}
}) {
  const ctx = createCursorPathContext(moduleName, moduleRelativePath);
  const skill = buildOpenClawSkill(ctx, true);

  // AGENTS.md is shared with Hermes adapter — only write skill directory here.
  // The bootstrap layer ensures AGENTS.md is written once by whichever adapter
  // runs first (hermes or openclaw).
  await writeIfAllowed(
    path.join(workspaceRoot, '.openclaw', 'skills', 'aafe-runtime', 'SKILL.md'),
    skill,
    options
  );
  return { skillPath: path.join(workspaceRoot, '.openclaw', 'skills', 'aafe-runtime', 'SKILL.md') };
}

export async function writeFlatOpenClawAdapters(root, options = {}) {
  const ctx = createCursorPathContext('root', '.');
  const skill = buildOpenClawSkill(ctx, false);

  await writeIfAllowed(
    path.join(root, '.openclaw', 'skills', 'aafe-runtime', 'SKILL.md'),
    skill,
    options
  );
  return { skillPath: path.join(root, '.openclaw', 'skills', 'aafe-runtime', 'SKILL.md') };
}

/**
 * Build the OpenClaw-native skill file.
 * OpenClaw discovers skills from `.openclaw/skills/<name>/SKILL.md`.
 */
function buildOpenClawSkill(ctx, layered) {
  const moduleHint = layered
    ? `module \`${ctx.moduleName}\` (\`${ctx.moduleRelativePath}\`)`
    : 'this project';
  return [
    '---',
    'name: aafe-runtime',
    `description: Use the AAFE project runtime for architecture-aware frontend work in ${moduleHint}. Load this skill for ANY task that touches this module — components, routes, Vue/React/TS, requirement intake, impact analysis, self-test, or TAPD backfill. It routes to the module knowledge base at ${ctx.agentPrefix}.`,
    '---',
    '',
    `# AAFE Runtime (OpenClaw / ${ctx.moduleName})`,
    '',
    `模块：\`${ctx.moduleName}\`，物理路径：\`${ctx.moduleRelativePath}\`，知识库根：\`${ctx.agentPrefix}\`。`,
    '',
    '## 加载顺序',
    '',
    `1. Read \`${ctx.agentPrefix}/skill-index.md\` first —— 技能索引，决定要加载哪个 domain。`,
    `2. Read \`${ctx.agentPrefix}/project.md\` when present —— 项目地图与使用约束。`,
    `3. Read \`${ctx.agentPrefix}/runtime/engine.md\`、\`runtime/router.yaml\`、\`runtime/gates.yaml\` —— 执行引擎、任务分类、门禁。`,
    `4. 按需加载匹配的 \`${ctx.agentPrefix}/project-skills/<domain>/SKILL.md\`，不要一次性全量加载。`,
    '',
    '## 边界',
    '',
    `- 优先在 \`${ctx.moduleRelativePath}\` 范围内改动；跨模块需先确认。`,
    `- 运行时知识只存放在 \`${ctx.agentPrefix}/\`，不要写入 \`.openclaw/\`。`,
    `- 完整的常驻约束见项目根目录 \`AGENTS.md\`。`,
    ''
  ].join('\n');
}

async function writeIfAllowed(filePath, content, options) {
  if (options.dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const fileExists = await exists(filePath);

  if (!options.force && fileExists) return;
  if (fileExists) {
    const previous = await safeRead(filePath);
    if (previous === content) return;
  }
  await writeFile(filePath, content);
}

async function exists(filePath) {
  try {
    await stat(filePath);
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
