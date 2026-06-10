import https from 'node:https';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_REPOSITORY = 'xintaoLi/aafe-agent-runtime';
const DEFAULT_BRANCH = 'main';

export async function runSkillsCommand(args = []) {
  const subCommand = args[0] ?? 'help';
  const options = parseSkillsOptions(args.slice(1));

  if (subCommand === 'list') {
    const manifest = await loadManifest(options);
    console.log(JSON.stringify({
      status: 'pass',
      manifest: options.manifestUrl ?? buildManifestUrl(options),
      skills: manifest.skills ?? []
    }, null, 2));
    return;
  }

  if (subCommand === 'install') {
    const skillName = args[1];
    if (!skillName || skillName.startsWith('--')) {
      throw new Error('Missing skill name. Usage: aafe skills install <skill-name> --github');
    }
    await installSkill(skillName, parseSkillsOptions(args.slice(2)));
    return;
  }

  printSkillsHelp();
}

async function installSkill(skillName, options) {
  const manifest = await loadManifest(options);
  const skill = (manifest.skills ?? []).find((item) => item.name === skillName);
  if (!skill) {
    throw new Error(`Skill not found in manifest: ${skillName}`);
  }

  const sourceUrl = skill.rawUrl ?? buildRawUrl(skill.source, options);
  const targetRoot = resolveTargetRoot(options);
  const targetDir = path.join(targetRoot, skill.targetDirName ?? skill.name);
  const targetFile = path.join(targetDir, skill.targetFile ?? 'SKILL.md');

  if (options.dryRun) {
    console.log(JSON.stringify({
      status: 'pass',
      installed: false,
      dryRun: true,
      skill: skill.name,
      sourceUrl,
      targetFile,
      summary: 'Would download the skill from GitHub and install it into the target agent skills directory.'
    }, null, 2));
    return;
  }

  const content = await fetchText(sourceUrl);
  const previous = await safeRead(targetFile);
  if (previous === content && !options.force) {
    console.log(JSON.stringify({
      status: 'pass',
      installed: false,
      unchanged: true,
      skill: skill.name,
      targetFile,
      summary: 'Target SKILL.md already has the latest content.'
    }, null, 2));
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetFile, content);

  console.log(JSON.stringify({
    status: 'pass',
    installed: true,
    skill: skill.name,
    sourceUrl,
    targetFile,
    summary: 'Downloaded and installed the skill into the target agent skills directory.'
  }, null, 2));
}

async function loadManifest(options) {
  const manifestUrl = options.manifestUrl ?? buildManifestUrl(options);
  const text = await fetchText(manifestUrl);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid skills manifest JSON from ${manifestUrl}: ${error.message}`);
  }
}

function parseSkillsOptions(args) {
  const options = {
    github: args.includes('--github'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    repository: DEFAULT_REPOSITORY,
    branch: DEFAULT_BRANCH
  };

  for (const arg of args) {
    if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    if (arg.startsWith('--manifest-url=')) options.manifestUrl = arg.slice('--manifest-url='.length);
    if (arg.startsWith('--repo=')) options.repository = arg.slice('--repo='.length);
    if (arg.startsWith('--branch=')) options.branch = arg.slice('--branch='.length);
  }

  return options;
}

function buildManifestUrl(options) {
  return `https://raw.githubusercontent.com/${options.repository ?? DEFAULT_REPOSITORY}/${options.branch ?? DEFAULT_BRANCH}/skills/manifest.json`;
}

function buildRawUrl(source, options) {
  return `https://raw.githubusercontent.com/${options.repository ?? DEFAULT_REPOSITORY}/${options.branch ?? DEFAULT_BRANCH}/${source}`;
}

function resolveTargetRoot(options) {
  if (options.target) return expandEnv(options.target);
  if (process.env.SIBOOT_WORKSPACE_PATH) return path.join(process.env.SIBOOT_WORKSPACE_PATH, 'skills');
  return path.join(process.cwd(), 'skills');
}

function expandEnv(value) {
  return value.replace(/\$([A-Z0-9_]+)/gi, (_, name) => process.env[name] ?? `$${name}`);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'aafe-agent-runtime' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        fetchText(response.headers.location).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`GET ${url} failed with status ${response.statusCode}`));
        return;
      }

      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function printSkillsHelp() {
  console.log(`aafe skills <command>

Commands:
  list                         List downloadable Agent SKILLS from the GitHub manifest
  install <skill-name>         Download and install a skill into the target Agent Skills directory

Boundary:
  This command is only for GitHub Agent SKILLS download.
  For project .ai-agent runtime initialization or update, use aafe init/update/analyze/doctor.

Options:
  --github                     Use the GitHub raw manifest, enabled by default
  --target=<dir>               Target skills directory, defaults to $SIBOOT_WORKSPACE_PATH/skills when available
  --manifest-url=<url>         Custom skills manifest URL
  --repo=<owner/repo>          GitHub repository, default xintaoLi/aafe-agent-runtime
  --branch=<branch>            GitHub branch, default main
  --dry-run                    Preview install target without writing
  --force                      Rewrite target SKILL.md even when content differs
`);
}
