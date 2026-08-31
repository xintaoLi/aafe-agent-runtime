/**
 * Project migrations for `.ai-agent/` and the AAFE config files.
 *
 * Upgrading the npm package cannot move anything on its own: `.ai-agent/`,
 * `.aafe.config.json` and `.aafe.agents.json` live in the user's repository, so
 * whatever an older version wrote stays exactly where that version put it.
 * Regenerating files does not fix this either — `bootstrapProject` writes the
 * new layout but never touches paths the current version no longer knows about,
 * which is how a superseded file outlives the release that created it.
 *
 * Every migration here is idempotent *by detection*: it inspects what is on
 * disk rather than a recorded version number. A project that skipped several
 * releases, one that already migrated by hand, and one that is fully up to date
 * all converge on the same result, and nothing has to be un-done if a migration
 * is interrupted halfway.
 *
 * To add one, append an entry whose `detect` returns `null` when there is
 * nothing to do and a plan otherwise. Prefer `relocate` over ad-hoc `rename`
 * calls so directory merges and cross-device moves stay consistent.
 */

import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AGENTS_CONFIG_FILE } from '../agent-platform/config/agentsConfig.js';
import { FILE_LICENSE_MEMORY_RELATIVE } from './fileLicenseRules.js';

const CONFIG_FILE = '.aafe.config.json';
const RUNTIME_DIR = '.ai-agent';

/**
 * Flat skill files that shipped up to 0.1.x and are superseded by the packaged
 * `.ai-agent/ddd/` tree.
 *
 * Leaving them behind is not merely untidy. The Skill Index router still finds
 * them, so a stale `ddd-discovery.md` makes an agent start bounded-context
 * analysis on a request that never asked for domain modelling — precisely what
 * the DDD gate exists to prevent. They are AAFE-generated (every `aafe update`
 * rewrites `.ai-agent/skills/**` wholesale), so removing them cannot discard
 * anything the project was expected to keep.
 */
const SUPERSEDED_FLAT_DDD_SKILLS = [
  'ddd-discovery.md',
  'ddd-implementation-planner.md',
  'bounded-context-mapper.md',
  'aggregate-designer.md',
  'domain-event-designer.md'
];

export const MIGRATIONS = [
  {
    id: 'superseded-flat-ddd-skills',
    title: '移除已被 .ai-agent/ddd/ 取代的扁平 DDD 技能文件',
    async detect({ root }) {
      // Only clean up once the replacement is actually installed, so a partial
      // or failed update never leaves the project with neither copy.
      if (!(await pathExists(path.join(root, RUNTIME_DIR, 'ddd', 'SKILL.md')))) return null;

      const changes = [];
      for (const name of SUPERSEDED_FLAT_DDD_SKILLS) {
        const rel = `${RUNTIME_DIR}/skills/${name}`;
        if (await pathExists(path.join(root, rel))) {
          changes.push({ action: 'remove', from: rel, to: null, detail: '由 .ai-agent/ddd/skills/ 取代' });
        }
      }
      return changes.length > 0 ? { changes } : null;
    },
    async apply({ root }, plan) {
      for (const change of plan.changes) {
        await rm(path.join(root, change.from), { force: true });
      }
    }
  },

  {
    id: 'file-license-memory-jsonl',
    title: '将 file-license 记忆从单个 .json 转换为追加式 .jsonl',
    async detect({ root }) {
      const legacyRel = `${RUNTIME_DIR}/${FILE_LICENSE_MEMORY_RELATIVE.replace(/\.jsonl$/, '.json')}`;
      if (!(await pathExists(path.join(root, legacyRel)))) return null;

      const entries = readLegacyLicenseEntries(await readJson(path.join(root, legacyRel)));
      return {
        changes: [{
          action: 'convert',
          from: legacyRel,
          to: `${RUNTIME_DIR}/${FILE_LICENSE_MEMORY_RELATIVE}`,
          detail: `迁移 ${entries.length} 条已校验记录`
        }],
        entries
      };
    },
    async apply({ root }, plan) {
      const [change] = plan.changes;
      const target = path.join(root, change.to);
      await mkdir(path.dirname(target), { recursive: true });

      // Carry the legacy blob's own fingerprint onto each line instead of the
      // current template's. If the template has since changed, these entries
      // must keep failing to match — re-validating a file is cheap, wrongly
      // trusting a stale header is not.
      const existing = await readText(target);
      const lines = plan.entries
        .filter((entry) => !existing.includes(`"path":${JSON.stringify(entry.path)},"ok":true,"fp":${JSON.stringify(entry.fp)}`))
        .map((entry) => JSON.stringify(entry));
      if (lines.length > 0) await appendFile(target, `${lines.join('\n')}\n`, 'utf8');
      await rm(path.join(root, change.from), { force: true });
    }
  },

  {
    id: 'analyze-output-key',
    title: '合并 analyze.docsOut → analyze.output（含产物目录）',
    /**
     * Two directory paths cannot be merged into one `analyze.output` string, so
     * the key itself is a pick-one. Which one is not a matter of taste: reads
     * resolve `output ?? docsOut`, and the config template has always written
     * `output`, so in any generated project `docsOut` was already inert.
     * Honouring it now would silently repoint analysis at a directory the
     * project may never have used.
     *
     * The artefacts on disk are a different question, and there merging is
     * exactly right — see `resolveAnalyzeOutputMerge`.
     */
    async detect({ root }) {
      const config = await readJson(path.join(root, CONFIG_FILE));
      const legacy = config?.analyze?.docsOut;
      if (typeof legacy !== 'string') return null;

      const merge = await resolveAnalyzeOutputMerge(root, legacy, config?.analyze?.output);
      const changes = [{
        action: 'rewrite-config',
        from: `${CONFIG_FILE} → analyze.docsOut`,
        to: `${CONFIG_FILE} → analyze.output`,
        detail: merge.detail
      }];
      if (merge.relocate) {
        changes.push({
          action: 'relocate',
          from: legacy,
          to: merge.effective,
          detail: '产物只存在于旧目录，迁移后配置与磁盘一致'
        });
      }
      return { changes, merge, legacy };
    },
    async apply({ root }, plan) {
      if (plan.merge.relocate) {
        await relocate(path.join(root, plan.legacy), path.join(root, plan.merge.effective));
      }

      const file = path.join(root, CONFIG_FILE);
      const config = await readJson(file);
      config.analyze.output = plan.merge.effective;
      delete config.analyze.docsOut;
      await writeJson(file, config);
    }
  },

  {
    id: 'analyze-llm-agents',
    title: '将废弃的 analyze.llm.agents 接线迁移到 .aafe.agents.json',
    async detect({ root }) {
      const config = await readJson(path.join(root, CONFIG_FILE));
      const legacy = config?.analyze?.llm?.agents;
      if (!legacy || typeof legacy !== 'object') return null;

      // The default template always writes this block with every domain false;
      // only an enabled domain represents a decision worth carrying over.
      const enabled = Object.entries(legacy).filter(([, value]) => value === true).map(([key]) => key);
      if (enabled.length === 0) return null;

      // `testing` is the only domain that ever changed runtime behaviour
      // (agentsConfig enables `test-agent` from it). The rest only produced a
      // deprecation warning, so they are reported and dropped rather than
      // silently reinterpreted as agent wiring they never were.
      const carried = enabled.filter((domain) => domain === 'testing');
      const dropped = enabled.filter((domain) => domain !== 'testing');

      // Never create the agents file here. `bootstrapProject` seeds it with the
      // full default wiring only when it is absent, so writing a stub first
      // would permanently rob the project of its planner and built-in agents.
      // Deferring costs nothing: the legacy key stays and migrates next run.
      if (carried.length > 0 && !(await pathExists(path.join(root, AGENTS_CONFIG_FILE)))) return null;

      return {
        changes: [{
          action: 'rewrite-config',
          from: `${CONFIG_FILE} → analyze.llm.agents`,
          to: AGENTS_CONFIG_FILE,
          detail: [
            carried.length > 0 ? `testing → ${AGENTS_CONFIG_FILE} agents["test-agent"].enabled` : null,
            dropped.length > 0 ? `仅告警、无行为的域已丢弃：${dropped.join(', ')}` : null
          ].filter(Boolean).join('；')
        }],
        carried
      };
    },
    async apply({ root }, plan) {
      if (plan.carried.includes('testing')) {
        const agentsFile = path.join(root, AGENTS_CONFIG_FILE);
        const agents = await readJson(agentsFile);
        if (agents) {
          agents.agents = agents.agents ?? {};
          agents.agents['test-agent'] = { ...agents.agents['test-agent'], enabled: true };
          await writeJson(agentsFile, agents);
        }
      }

      const file = path.join(root, CONFIG_FILE);
      const config = await readJson(file);
      delete config.analyze.llm.agents;
      await writeJson(file, config);
    }
  },

  {
    id: 'retire-uitest-cursor-adapters',
    title: '移除 .cursor 里的 uitest / ai-ui-test 适配层，改走 aafe test --pr',
    async detect({ root }) {
      const changes = await collectUitestAdapterChanges(root);
      return changes.length > 0 ? { changes } : null;
    },
    async apply({ root }, plan) {
      for (const change of plan.changes) {
        await rm(path.resolve(root, change.from), { recursive: true, force: true });
      }
    }
  }
];

/**
 * Works out which migrations apply without touching the project.
 *
 * @param {string} root
 * @returns {Promise<Array<{ id: string, title: string, changes: Array<object> }>>}
 */
export async function planMigrations(root) {
  const ctx = { root };
  const pending = [];
  for (const migration of MIGRATIONS) {
    const plan = await migration.detect(ctx);
    if (plan) pending.push({ ...plan, id: migration.id, title: migration.title });
  }
  return pending;
}

/**
 * Applies every pending migration.
 *
 * Detection runs again for each migration right before it is applied, so a
 * migration that an earlier one made unnecessary is skipped rather than acting
 * on a stale plan.
 *
 * @param {string} root
 * @param {{ dryRun?: boolean }} [options]
 */
export async function runMigrations(root, options = {}) {
  const ctx = { root };
  const applied = [];

  for (const migration of MIGRATIONS) {
    const plan = await migration.detect(ctx);
    if (!plan) continue;
    if (!options.dryRun) await migration.apply(ctx, plan);
    applied.push({ id: migration.id, title: migration.title, changes: plan.changes });
  }

  return {
    status: 'pass',
    dryRun: Boolean(options.dryRun),
    migrated: applied.length,
    migrations: applied,
    summary: applied.length === 0
      ? '没有需要迁移的历史文件或配置。'
      : `${options.dryRun ? '将迁移' : '已迁移'} ${applied.length} 项历史文件/配置到新位置。`
  };
}

export async function runMigrateCommand(root, argv = []) {
  const report = await runMigrations(root, { dryRun: argv.includes('--dry-run') });
  console.log(JSON.stringify(report, null, 2));
}

/**
 * Moves a file or directory to a new location, merging into whatever is there.
 *
 * Anything already at the destination was written by the current version and
 * therefore wins: an upgrade must never let a stale copy overwrite freshly
 * generated content. The source is removed either way, so a second run finds
 * nothing to do instead of resurrecting the old path.
 *
 * @param {string} from absolute path
 * @param {string} to absolute path
 * @returns {Promise<string[]>} destination paths that received content
 */
export async function relocate(from, to) {
  const info = await statOrNull(from);
  if (!info) return [];

  if (info.isDirectory()) {
    const moved = [];
    for (const entry of await readdir(from)) {
      moved.push(...await relocate(path.join(from, entry), path.join(to, entry)));
    }
    await rm(from, { recursive: true, force: true });
    return moved;
  }

  if (await pathExists(to)) {
    await rm(from, { force: true });
    return [];
  }

  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    // Crossing a device boundary (a bind-mounted repo, a container volume)
    // makes rename fail where a copy still succeeds.
    if (error?.code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
  return [to];
}

/**
 * Decides what happens to the analyze output when both keys are set.
 *
 * The config value stays whatever already wins at read time, but the artefacts
 * on disk get merged when — and only when — that cannot lose information:
 *
 * - target directory missing, legacy one present: the config points somewhere
 *   empty while every artefact sits at the old path. Moving them makes config
 *   and disk agree again, and nothing is overwritten.
 * - both present: the legacy directory holds output from an older analysis, and
 *   merging would file stale modules alongside current ones where nothing marks
 *   them as outdated. Analyze output is regenerable, so the honest move is to
 *   leave the old directory alone and say it is still there.
 *
 * Paths that escape the project are never touched.
 */
async function resolveAnalyzeOutputMerge(root, legacy, current) {
  if (typeof current !== 'string') {
    return { effective: legacy, relocate: false, detail: `analyze.output 设为 "${legacy}"` };
  }
  if (current === legacy) {
    return { effective: current, relocate: false, detail: '两个键指向同一目录，仅移除旧键' };
  }

  const legacyDir = withinRoot(root, legacy);
  const currentDir = withinRoot(root, current);
  const base = `analyze.output 保留生效值 "${current}"（旧键 "${legacy}" 从未生效）`;

  if (!legacyDir || !currentDir || !(await pathExists(legacyDir))) {
    return { effective: current, relocate: false, detail: `${base}，旧目录不存在` };
  }
  if (await pathExists(currentDir)) {
    return { effective: current, relocate: false, detail: `${base}；旧目录 "${legacy}" 仍有历史产物，确认后可自行删除` };
  }
  return { effective: current, relocate: true, detail: `${base}，旧目录产物一并迁移` };
}

/** @returns {string|null} absolute path, or null when it escapes the project. */
function withinRoot(root, relative) {
  const absolute = path.resolve(root, relative);
  const contained = absolute === root || absolute.startsWith(`${root}${path.sep}`);
  return contained ? absolute : null;
}

/**
 * Flattens the legacy `{ fingerprint, files: { path: { ok, style, at } } }`
 * blob into the append-only line format.
 */
function readLegacyLicenseEntries(blob) {
  if (!blob || typeof blob !== 'object') return [];
  const fingerprint = typeof blob.fingerprint === 'string' ? blob.fingerprint : '';
  const files = blob.files && typeof blob.files === 'object' ? blob.files : {};

  return Object.entries(files)
    .filter(([, value]) => value && typeof value === 'object' && value.ok === true)
    .map(([filePath, value]) => ({
      path: filePath,
      ok: true,
      fp: fingerprint,
      style: value.style,
      at: value.at ?? new Date().toISOString()
    }));
}

async function statOrNull(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

/**
 * Leftover `@aafe/ai-test` Cursor ads. Their descriptions steal「分析此PR」
 * and send the agent to `npx uitest from-pr`.
 */
export async function collectUitestAdapterChanges(root) {
  const cursorRoots = [path.join(root, '.cursor')];
  const config = await readJson(path.join(root, CONFIG_FILE));
  const workspaceRel = config?.workspace?.workspaceRoot;
  if (typeof workspaceRel === 'string' && workspaceRel !== '.') {
    cursorRoots.push(path.resolve(root, workspaceRel, '.cursor'));
  }
  const seen = new Set();
  const changes = [];
  for (const cursorRoot of cursorRoots) {
    for (const change of await walkUitestLeftovers(cursorRoot, root)) {
      if (seen.has(change.from)) continue;
      seen.add(change.from);
      changes.push(change);
    }
  }
  return changes;
}

async function walkUitestLeftovers(dir, root, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const from = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'ai-ui-test') {
        acc.push({ action: 'remove', from, to: null, detail: '由 aafe test --pr 取代，禁止残留 uitest 适配层' });
        continue;
      }
      await walkUitestLeftovers(full, root, acc);
      continue;
    }
    if (entry.name === 'uitest-from-pr.mdc') {
      acc.push({ action: 'remove', from, to: null, detail: '由 aafe test --pr 取代' });
    }
  }
  return acc;
}

async function pathExists(target) {
  return (await statOrNull(target)) !== null;
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
