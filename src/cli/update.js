import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bootstrapProject } from './bootstrap.js';
import { detectProject } from './detect.js';
import { doctorProject } from './doctor.js';

const execFileAsync = promisify(execFile);
const packageJsonUrl = new URL('../../package.json', import.meta.url);

export async function runUpdateCommand(args = []) {
  const options = parseUpdateOptions(args);
  const manifest = JSON.parse(await readFile(packageJsonUrl, 'utf8'));
  const packageName = options.packageName ?? manifest.name;
  const currentVersion = manifest.version;

  if (options.upgradePackage) {
    await runPackageUpgradeUpdate({ ...options, packageName, currentVersion });
    return;
  }

  await updateCurrentProjectFromInstalledRuntime({ ...options, packageName, currentVersion });
}

async function updateCurrentProjectFromInstalledRuntime(options) {
  const updateOptions = {
    yes: true,
    sync: true,
    force: true,
    preserveMemory: true
  };

  if (options.dryRun) {
    console.log(JSON.stringify({
      status: 'pass',
      updated: false,
      dryRun: true,
      mode: 'project-runtime',
      package: options.packageName,
      currentVersion: options.currentVersion,
      command: 'aafe update',
      planned: {
        refreshGeneratedRuntime: true,
        forceGeneratedFiles: true,
        preserveMemory: true,
        idempotentWrites: true
      },
      summary: 'Would refresh .ai-agent capabilities from the currently installed aafe package without reinstalling the package. Existing generated files with identical content would not be rewritten.'
    }, null, 2));
    return;
  }

  const detection = await detectProject(process.cwd());
  await bootstrapProject(process.cwd(), detection, updateOptions);
  const doctor = await doctorProject(process.cwd());

  console.log(JSON.stringify({
    status: doctor.status === 'fail' ? 'fail' : 'pass',
    updated: true,
    mode: 'project-runtime',
    package: options.packageName,
    currentVersion: options.currentVersion,
    preserved: ['.ai-agent/memory/*'],
    doctor,
    summary: 'Refreshed .ai-agent capabilities from the currently installed aafe package. Identical generated files were left unchanged.'
  }, null, 2));

  if (doctor.status === 'fail') process.exitCode = 1;
}

async function runPackageUpgradeUpdate(options) {
  const latestVersion = options.latestVersion ?? await fetchLatestVersion(options.packageName, options);
  const installTarget = `${options.packageName}@${latestVersion}`;
  const needsUpdate = compareVersions(latestVersion, options.currentVersion) > 0;
  const syncCommand = buildSyncCommand(options);

  if (!needsUpdate && !options.force) {
    const synced = options.dryRun ? false : await syncCurrentProject(options);
    console.log(JSON.stringify({
      status: 'pass',
      updated: false,
      dryRun: options.dryRun,
      synced,
      package: options.packageName,
      currentVersion: options.currentVersion,
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
      mode: 'package-upgrade',
      package: options.packageName,
      currentVersion: options.currentVersion,
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
    mode: 'package-upgrade',
    package: options.packageName,
    previousVersion: options.currentVersion,
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
    syncForce: args.includes('--sync-force'),
    upgradePackage: args.includes('--upgrade-package') || args.includes('--global')
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
    const args = ['update'];
    await runCommand('aafe', args);
    return true;
  }
  const detection = await detectProject(process.cwd());
  await bootstrapProject(process.cwd(), detection, {
    yes: true,
    sync: true,
    force: true,
    preserveMemory: true
  });
  return true;
}

function buildSyncCommand(options) {
  if (!options.sync) return '';
  return options.syncForce ? 'aafe update --force' : 'aafe update';
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
    return value.replace(/^[']|[']$/g, '').replace(/^["]|["]$/g, '');
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
