import { readFile, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { normalizeWorkspace } from './workspace.js';
import { detectE2eBuild } from '../../../src/cli/e2eBuildDetection.js';
import { initializeE2eDev } from '../../../src/cli/e2eDevSetup.js';

// Deliberately independent of Bot login/SDK/TaskManager: project setup starts no Bot.
export async function initializeWeComProject(root, args = [], { expectedCwd = null } = {}) {
  const values = {};
  for (const arg of args) {
    if (arg === '--dry-run') { values.dryRun = true; continue; }
    const match = /^--(root|config|workspace|tool|build-config)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(values, match[1])) throw new Error('Invalid project init option: ' + arg.split('=')[0]);
    values[match[1]] = match[2];
  }
  const botRoot = path.resolve(root, values.root ?? '.');
  if (!values.workspace) throw new Error('project-init-requires-workspace: --workspace=<id>');
  let configPath;
  if (values.config) configPath = path.resolve(botRoot, values.config);
  else {
    for (const candidate of ['ai-bots/wecom/wecom.local.json', 'wecom.local.json', '.aafe/wecom.local.json']) {
      try { await access(path.join(botRoot, candidate)); configPath = path.join(botRoot, candidate); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (!configPath) throw new Error('wecom-project-config-not-found: pass --config');
  const botConfig = JSON.parse(await readFile(configPath, 'utf8'));
  const matches = (botConfig.workspaces ?? []).map((raw, index) => ({
    raw, workspace: normalizeWorkspace(raw, { root: botRoot, index })
  })).filter(({ workspace }) => workspace?.id === values.workspace);
  if (matches.length !== 1) throw new Error('wecom-project-not-unique-or-not-found');
  const { raw, workspace } = matches[0];
  if (workspace.repository || !workspace.cwd) throw new Error('wecom-project-init-requires-local-checkout');
  if (expectedCwd && await realpath(workspace.cwd) !== expectedCwd) throw new Error('wecom-project-changed-since-confirmation');
  await access(path.join(workspace.cwd, 'package.json'));
  const init = raw.e2eInit ?? {};
  const build = await detectE2eBuild(workspace.cwd, {
    tool: values.tool ?? init.tool, configFile: values['build-config'] ?? init.configFile
  });
  if (!build.tool) throw new Error(build.reason + ': specify --tool=vite|webpack|custom');
  const defaults = {};
  for (const key of ['enabled', 'url', 'proxyTarget', 'proxyPaths', 'secure', 'timeoutMs', 'env', 'command']) {
    if (Object.hasOwn(init, key)) defaults[key] = init[key];
  }
  const result = await initializeE2eDev(workspace.cwd, { build, defaults, dryRun: values.dryRun === true });
  return { workspace: workspace.id, projectRoot: workspace.cwd, ...result,
    next: 'Configure project e2e.auth verification and proxy target, review generated adapter, then enable e2e.devServer. No build, login or Bot was started.' };
}

export async function runWeComProjectCommand(root, args) {
  const result = await initializeWeComProject(root, args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
