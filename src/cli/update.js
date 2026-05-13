import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bootstrapProject } from './bootstrap.js';
import { detectProject } from './detect.js';

const execFileAsync = promisify(execFile);
const packageJsonUrl = new URL('../../package.json', import.meta.url);

export async function runUpdateCommand(args = []) {
  const options = parseUpdateOptions(args);
  const manifest = JSON.parse(await readFile(packageJsonUrl, 'utf8'));
  const packageName = options.packageName ?? manifest.name;
  const currentVersion = manifest.version;
  const latestVersion = options.latestVersion ?? await fetchLatestVersion(packageName, options);
  const installTarget = `${packageName}@${latestVersion}`;
  const needsUpdate = compareVersions(latestVersion, currentVersion) > 0;
  const syncCommand = buildSyncCommand(options);

  if (!needsUpdate && !options.force) {
    const synced = options.dryRun ? false : await syncCurrentProject(options);
    console.log(JSON.stringify({
      status: 'pass',
      updated: false,
      dryRun: options.dryRun,
      synced,
      package: packageName,
      currentVersion,
      latestVersion,
      syncCommand,
      summary: 'Already on the latest version'
    }, null, 2));
    return;
  }

  const installCommand = buildInstallCommand(installTarget, options);
  if (options.dryRun) {
    console.log(JSON.stringify({
      status: 'pass',
      updated: false,
      dryRun: true,
      package: packageName,
      currentVersion,
      latestVersion,
      command: [installCommand.bin, ...installCommand.args].join(' '),
      syncCommand
    }, null, 2));
    return;
  }

  await runCommand(installCommand.bin, installCommand.args);
  const synced = await syncCurrentProject(options, { useInstalledCli: true });
  console.log(JSON.stringify({
    status: 'pass',
    updated: true,
    synced,
    package: packageName,
    previousVersion: currentVersion,
    latestVersion,
    summary: `Installed ${installTarget}`
  }, null, 2));
}

function parseUpdateOptions(args) {
  const options = {
    packageManager: 'npm',
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run'),
    sync: !args.includes('--no-sync'),
    syncForce: args.includes('--sync-force')
  };

  for (const arg of args) {
    if (arg.startsWith('--package=')) options.packageName = arg.slice('--package='.length);
    if (arg.startsWith('--latest=')) options.latestVersion = arg.slice('--latest='.length);
    if (arg.startsWith('--package-manager=')) options.packageManager = arg.slice('--package-manager='.length);
    if (arg.startsWith('--registry=')) options.registry = arg.slice('--registry='.length);
  }

  return options;
}

async function syncCurrentProject(options, syncOptions = {}) {
  if (!options.sync) return false;
  if (syncOptions.useInstalledCli) {
    const args = ['sync', '--yes'];
    if (options.syncForce) args.push('--force');
    await runCommand('aafe', args);
    return true;
  }
  const detection = await detectProject(process.cwd());
  await bootstrapProject(process.cwd(), detection, {
    yes: true,
    sync: true,
    force: options.syncForce
  });
  return true;
}

function buildSyncCommand(options) {
  if (!options.sync) return '';
  return `aafe sync --yes${options.syncForce ? ' --force' : ''}`;
}

async function fetchLatestVersion(packageName, options) {
  const args = ['view', packageName, 'version', '--json'];
  if (options.registry) args.push('--registry', options.registry);
  const { stdout } = await execFileAsync(options.packageManager, args);
  const value = stdout.trim();
  if (!value) throw new Error(`Unable to resolve latest version for ${packageName}`);
  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/^['"]|['"]$/g, '');
  }
}

function buildInstallCommand(installTarget, options) {
  if (options.packageManager === 'pnpm') {
    const args = ['add', '-g', installTarget];
    if (options.registry) args.push('--registry', options.registry);
    return { bin: 'pnpm', args };
  }
  if (options.packageManager === 'yarn') {
    const args = ['global', 'add', installTarget];
    if (options.registry) args.push('--registry', options.registry);
    return { bin: 'yarn', args };
  }
  if (options.packageManager === 'bun') {
    const args = ['add', '-g', installTarget];
    if (options.registry) args.push('--registry', options.registry);
    return { bin: 'bun', args };
  }
  const args = ['install', '-g', installTarget];
  if (options.registry) args.push('--registry', options.registry);
  return { bin: 'npm', args };
}

function runCommand(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${bin} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function normalizeVersion(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}
