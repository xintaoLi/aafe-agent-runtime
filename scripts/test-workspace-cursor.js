import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bootstrapProject } from '../src/cli/bootstrap.js';
import { rewriteCursorContent, createCursorPathContext } from '../src/cli/cursorLayer.js';
import { detectProject } from '../src/cli/detect.js';
import { doctorProject } from '../src/cli/doctor.js';
import { enrichWorkspaceLayout, resolveWorkspaceLayout } from '../src/cli/workspace.js';

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const execFileAsync = promisify(execFile);

async function createTempRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aafe-workspace-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await mkdir(path.join(root, 'bklog', 'web'), { recursive: true });
  await writeFile(path.join(root, 'bklog', 'web', 'package.json'), JSON.stringify({
    name: 'bklog-web',
    private: true,
    dependencies: { vue: '^3.0.0' }
  }, null, 2));
  return root;
}

async function testWorkspaceLayoutDetection() {
  const root = await createTempRepo();
  try {
    const installRoot = path.join(root, 'bklog', 'web');
    const layout = await resolveWorkspaceLayout(installRoot);
    assert.equal(layout.layeredCursor, true);
    assert.equal(layout.moduleRelativePath, 'bklog/web');
    assert.equal(layout.suggestedModuleName, 'web');
    assert.equal(layout.hasInstallDirCursor, false);
    assert.equal(layout.cursorOnlyAtWorkspaceRoot, true);
    assert.deepEqual(layout.retainInInstallDir, ['.ai-agent', '.docs', '.aafe.config.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPathRewrite() {
  const ctx = createCursorPathContext('web', 'bklog/web');

  const basic = rewriteCursorContent(
    'Read `.ai-agent/skill-index.md` via `.cursor/hooks/run-hook.cmd` and `.cursor/rules/aafe.mdc`',
    ctx,
    'rules/custom.mdc'
  );
  assert.match(basic, /bklog\/web\/\.ai-agent\/skill-index\.md/);
  assert.match(basic, /\.cursor\/hooks\/web\/run-hook\.cmd/);
  assert.match(basic, /\.cursor\/rules\/web\/aafe\.mdc/);

  const relative = rewriteCursorContent(
    'Load ../.ai-agent/project.md and ./hooks/aafe-session-start with .aafe.config.json',
    ctx,
    'hooks/aafe-session-start'
  );
  assert.match(relative, /bklog\/web\/\.ai-agent\/project\.md/);
  assert.match(relative, /\.cursor\/hooks\/web\/aafe-session-start/);
  assert.match(relative, /bklog\/web\/\.aafe\.config\.json/);

  const hooksJson = rewriteCursorContent(JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{ command: '.cursor/hooks/run-hook.cmd aafe-session-start' }]
    }
  }, null, 2), ctx, 'hooks.json');
  assert.match(hooksJson, /\.cursor\/hooks\/web\/run-hook\.cmd aafe-session-start/);

  const idempotent = rewriteCursorContent(
    'Already rewritten `bklog/web/.ai-agent/skill-index.md` and `.cursor/hooks/web/run-hook.cmd`',
    ctx,
    'rules/custom.mdc'
  );
  assert.doesNotMatch(idempotent, /bklog\/web\/bklog\/web/);
}

async function testMigrateRichInstallCursor() {
  const root = await createTempRepo();
  try {
    const installRoot = path.join(root, 'bklog', 'web');
    await mkdir(path.join(installRoot, '.cursor', 'hooks'), { recursive: true });
    await writeFile(
      path.join(installRoot, '.cursor/hooks.json'),
      `${JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: '.cursor/hooks/run-hook.cmd aafe-session-start' }]
        }
      }, null, 2)}\n`
    );
    await writeFile(
      path.join(installRoot, '.cursor/hooks/custom-session-start'),
      '#!/usr/bin/env bash\necho ".ai-agent/skill-index.md ../.ai-agent/project.md .aafe.config.json"\n'
    );
    await mkdir(path.join(installRoot, '.cursor', 'rules'), { recursive: true });
    await writeFile(
      path.join(installRoot, '.cursor/rules/custom.mdc'),
      '---\nalwaysApply: true\n---\nSee `.cursor/skills/aafe-runtime/SKILL.md` and `.docs/guide.md`\n'
    );

    const layout = await enrichWorkspaceLayout(await resolveWorkspaceLayout(installRoot), {
      moduleName: 'web',
      migrateInstallCursor: true
    });
    const detection = await detectProject(installRoot);
    await bootstrapProject(installRoot, detection, {
      yes: true,
      force: true,
      editors: 'cursor',
      workspaceLayout: layout
    });

    const hooksJson = await readFile(path.join(root, '.cursor/hooks.json'), 'utf8');
    assert.match(hooksJson, /\.cursor\/hooks\/web\/run-hook\.cmd aafe-session-start/);

    const hookScript = await readFile(path.join(root, '.cursor/hooks/web/custom-session-start'), 'utf8');
    assert.match(hookScript, /bklog\/web\/\.ai-agent\/skill-index\.md/);
    assert.match(hookScript, /bklog\/web\/\.aafe\.config\.json/);

    const rule = await readFile(path.join(root, '.cursor/rules/web/custom.mdc'), 'utf8');
    assert.match(rule, /\.cursor\/skills\/web\/aafe-runtime\/SKILL\.md/);
    assert.match(rule, /bklog\/web\/\.docs\/guide\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testLayeredCodebuddyInit() {
  const root = await createTempRepo();
  try {
    const installRoot = path.join(root, 'bklog', 'web');
    const layout = await enrichWorkspaceLayout(await resolveWorkspaceLayout(installRoot, ['codebuddy']), {
      moduleName: 'web',
      migrateInstallEditors: false
    });
    const detection = await detectProject(installRoot);
    await bootstrapProject(installRoot, detection, {
      yes: true,
      force: true,
      editors: 'codebuddy',
      workspaceLayout: layout
    });

    const rule = await readFile(path.join(root, '.codebuddy/web/aafe.md'), 'utf8');
    assert.match(rule, /bklog\/web\/\.ai-agent\/skill-index\.md/);
    assert.match(rule, /\.codebuddy\/skills\/aafe-runtime\/SKILL\.md/);

    const nativeRule = await readFile(path.join(root, '.codebuddy/rules/aafe-web/RULE.mdc'), 'utf8');
    assert.match(nativeRule, /alwaysApply: true/);
    assert.match(nativeRule, /bklog\/web\/\.ai-agent\/skill-index\.md/);

    const nativeSkill = await readFile(path.join(root, '.codebuddy/skills/aafe-runtime/SKILL.md'), 'utf8');
    assert.match(nativeSkill, /requirement intake|impact analysis|TAPD backfill/i);
    assert.match(nativeSkill, /bklog\/web\/\.ai-agent/);

    const settings = JSON.parse(await readFile(path.join(root, '.codebuddy/settings.json'), 'utf8'));
    assert.equal(
      settings.hooks.SessionStart[0].hooks[0].command,
      '$CODEBUDDY_PROJECT_DIR/.codebuddy/web/hooks/run-hook.cmd aafe-session-start'
    );

    const hookPath = path.join(root, '.codebuddy/web/hooks/aafe-session-start');
    const hookStat = await stat(hookPath);
    assert.ok((hookStat.mode & 0o111) !== 0, 'aafe-session-start should be executable');

    const manifest = JSON.parse(await readFile(path.join(root, '.codebuddy/web/module.json'), 'utf8'));
    assert.equal(manifest.moduleRelativePath, 'bklog/web');
    assert.equal(manifest.nativeDiscovery.skills, '.codebuddy/skills/aafe-runtime/SKILL.md');

    // Hook resolves .ai-agent via module.json and emits real newlines in additionalContext.
    const { stdout } = await execFileAsync('bash', [hookPath], {
      env: { ...process.env, CODEBUDDY_PROJECT_DIR: root },
      cwd: root,
      timeout: 10000,
      input: ''
    });
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.continue, true);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.match(context, /<AAFE_RUNTIME>/);
    assert.match(context, /Engine:/);
    assert.doesNotMatch(context, /\\n/);
    assert.ok(context.includes('\n'), 'additionalContext should contain real newlines');

    assert.equal(await exists(path.join(installRoot, '.ai-agent')), true);
    assert.equal(await exists(path.join(root, '.ai-agent')), false);

    const doctor = await doctorProject(installRoot);
    assert.equal(doctor.missing.length, 0, `missing: ${doctor.missing.join(', ')}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPathRewriteCodebuddy() {
  const ctx = createCursorPathContext('web', 'bklog/web');
  const rewritten = rewriteCursorContent('Read `.codebuddy/skills/aafe-runtime/SKILL.md` and `.codex/aafe.md`', ctx);
  assert.match(rewritten, /\.codebuddy\/web\/skills\/aafe-runtime\/SKILL\.md/);
  assert.match(rewritten, /\.codex\/web\/aafe\.md/);
}

async function testLayeredInit() {
  const root = await createTempRepo();
  try {
    const installRoot = path.join(root, 'bklog', 'web');
    const layout = await enrichWorkspaceLayout(await resolveWorkspaceLayout(installRoot), {
      moduleName: 'web',
      migrateInstallCursor: false
    });
    const detection = await detectProject(installRoot);
    await bootstrapProject(installRoot, detection, {
      yes: true,
      force: true,
      editors: 'cursor',
      workspaceLayout: layout
    });

    const config = JSON.parse(await readFile(path.join(installRoot, '.aafe.config.json'), 'utf8'));
    assert.equal(config.workspace.layeredEditors, true);
    assert.equal(config.workspace.moduleName, 'web');

    const rule = await readFile(path.join(root, '.cursor/rules/web/aafe-skill-router.mdc'), 'utf8');
    assert.match(rule, /bklog\/web\/\.ai-agent\/skill-index\.md/);
    assert.match(rule, /globs: bklog\/web\/\*\*/);

    const manifest = JSON.parse(await readFile(path.join(root, '.cursor/context/web/module.json'), 'utf8'));
    assert.deepEqual(manifest.retainInInstallDir, ['.ai-agent', '.docs', '.aafe.config.json']);
    assert.equal(manifest.agentPrefix, 'bklog/web/.ai-agent');
    assert.equal(manifest.docsPrefix, 'bklog/web/.docs');

    assert.equal(await exists(path.join(installRoot, '.ai-agent')), true);
    assert.equal(await exists(path.join(root, '.ai-agent')), false);

    const fromPr = await readFile(path.join(root, '.cursor/skills/web/aafe-test-from-pr/SKILL.md'), 'utf8');
    assert.match(fromPr, /aafe test --pr/);
    assert.match(fromPr, /Do \*\*not\*\* install or run/);
    const fromPrRule = await readFile(path.join(root, '.cursor/rules/web/aafe-test-from-pr.mdc'), 'utf8');
    assert.match(fromPrRule, /alwaysApply: false/);
    assert.equal(await exists(path.join(installRoot, '.ai-agent/skills/aafe-test-from-pr.md')), true);

    const doctor = await doctorProject(installRoot);
    assert.equal(doctor.missing.length, 0, `missing: ${doctor.missing.join(', ')}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMigrateInstallCursor() {
  const root = await createTempRepo();
  try {
    const installRoot = path.join(root, 'bklog', 'web');
    await mkdir(path.join(installRoot, '.cursor', 'rules'), { recursive: true });
    await writeFile(
      path.join(installRoot, '.cursor/rules/custom.mdc'),
      '---\nalwaysApply: true\n---\nRead `.ai-agent/project.md`\n'
    );

    const layout = await enrichWorkspaceLayout(await resolveWorkspaceLayout(installRoot), {
      moduleName: 'web',
      migrateInstallCursor: true
    });
    const detection = await detectProject(installRoot);
    await bootstrapProject(installRoot, detection, {
      yes: true,
      force: true,
      editors: 'cursor',
      workspaceLayout: layout
    });

    const migrated = await readFile(path.join(root, '.cursor/rules/web/custom.mdc'), 'utf8');
    assert.match(migrated, /bklog\/web\/\.ai-agent\/project\.md/);

    const entries = await readdir(installRoot);
    assert.ok(!entries.includes('.cursor'), 'install-dir .cursor should be migrated away');
    assert.ok(entries.some((name) => name.startsWith('.cursor.aafe-migrated-')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readdir(dir) {
  const { readdir: rd } = await import('node:fs/promises');
  return rd(dir);
}

async function main() {
  await testWorkspaceLayoutDetection();
  await testPathRewrite();
  await testPathRewriteCodebuddy();
  await testLayeredInit();
  await testLayeredCodebuddyInit();
  await testMigrateInstallCursor();
  await testMigrateRichInstallCursor();
  console.log('workspace cursor layer tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
