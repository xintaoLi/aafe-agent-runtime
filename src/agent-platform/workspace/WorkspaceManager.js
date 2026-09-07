/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Worktrees live under the repository's own AAFE output directory: it is
 * guaranteed writable wherever the repository is, it disappears with the
 * repository, and a `.gitignore` of `*` keeps every checkout out of the main
 * tree's `git status`.
 */
export const DEFAULT_WORKTREE_DIR = path.join('.aafe', 'worktrees');
export const DEFAULT_PORT_RANGE = Object.freeze({ from: 41001, to: 41999 });

/**
 * A fresh worktree has the tracked files and nothing else, so anything the
 * repository needs but does not commit has to be borrowed from the main
 * checkout — otherwise the first thing the agent tries to do is install
 * dependencies, and the self-test gate never runs.
 *
 * `shadow` names what must not be borrowed even so. Dependencies are read-only
 * in practice and safe to share; the build caches sitting among them are not,
 * and two tasks writing one cache produce each other's output.
 */
export const DEFAULT_SHARED_PATHS = Object.freeze([
  Object.freeze({
    path: 'node_modules',
    shadow: Object.freeze(['.cache', '.vite', '.turbo', '.parcel-cache'])
  })
]);

const EXCLUDE_HEADER = '# AAFE task worktrees borrow these from the main checkout';

/**
 * One task, one checkout.
 *
 * Two agents pointed at the same working tree corrupt each other long before
 * they touch the same source line: the git index, the branch HEAD, build
 * output and generated files are all single-writer. So a task that is going to
 * change code gets a git worktree of its own, cut from its base branch, plus a
 * port no other live task was given.
 *
 * Where a worktree is impossible the isolation degrades rather than disappears.
 * A directory that is not a repository, or a task whose checkout lives on
 * Cursor's side, falls back to a lock on the shared path, so those runs queue
 * instead of overlapping.
 *
 * The lease is deliberately per-run while the worktree is per-task: a follow-up
 * has to land in the same checkout as the work it follows, but only one run of
 * it may be in flight.
 */
export class WorkspaceManager {
  constructor({
    worktrees = true,
    worktreeDir = DEFAULT_WORKTREE_DIR,
    portRange = DEFAULT_PORT_RANGE,
    share = DEFAULT_SHARED_PATHS,
    runGit = defaultRunGit,
    logger = console
  } = {}) {
    this.worktrees = worktrees !== false;
    this.worktreeDir = worktreeDir;
    this.share = normalizeShare(share);
    this.portRange = normalizeRange(portRange);
    this.runGit = runGit;
    this.logger = logger;
    this.leases = new Map();
    this.locks = new Map();
    this.ports = new Map();
  }

  /**
   * @returns {Promise<{taskId: string, mode: string, cwd: string|null,
   *   repoRoot: string|null, baseRef: string|null, port: number|null,
   *   acquiredAt: string}>}
   */
  async acquire(task) {
    const taskId = String(task?.id ?? '').trim();
    if (!taskId) throw new Error('workspace-acquire-requires-task-id');
    const held = this.leases.get(taskId);
    // A recovery path may acquire twice for one run. Handing back the same
    // lease is right, and re-locking would deadlock against itself.
    if (held) return lease(held);

    const plan = await this.#plan(task);
    const unlock = await this.#lock(plan.lockKey);
    const held2 = {
      ...plan,
      taskId,
      port: plan.mode === 'cloud' ? null : this.#takePort(taskId),
      acquiredAt: new Date().toISOString(),
      unlock
    };
    this.leases.set(taskId, held2);
    return lease(held2);
  }

  release(taskId) {
    const held = this.leases.get(String(taskId ?? ''));
    if (!held) return null;
    this.leases.delete(held.taskId);
    if (held.port) this.ports.delete(held.port);
    held.unlock?.();
    return lease(held);
  }

  get(taskId) {
    const held = this.leases.get(String(taskId ?? ''));
    return held ? lease(held) : null;
  }

  stats() {
    return {
      worktrees: this.worktrees,
      active: [...this.leases.values()].map((held) => lease(held)),
      ports: [...this.ports.entries()].map(([port, taskId]) => ({ port, taskId }))
    };
  }

  /**
   * A finished task's worktree is kept while it still holds work: uncommitted
   * changes there are the only copy. Reclaiming a clean one costs nothing and
   * stops the directory growing without bound.
   */
  async remove(taskId, { repoRoot = null, force = false } = {}) {
    const id = String(taskId ?? '').trim();
    if (this.leases.has(id)) return { removed: false, reason: 'in-use' };
    const root = repoRoot ? path.resolve(repoRoot) : null;
    if (!root) return { removed: false, reason: 'unknown-repo' };
    const dir = path.join(root, this.worktreeDir, id);
    try {
      await access(dir);
    } catch {
      return { removed: false, reason: 'missing' };
    }
    if (!force) {
      const dirty = await this.#git(['status', '--porcelain'], dir).catch(() => '');
      if (dirty.trim()) return { removed: false, reason: 'dirty', path: dir };
    }
    try {
      await this.#git(['worktree', 'remove', ...(force ? ['--force'] : []), dir], root);
      return { removed: true, path: dir };
    } catch (error) {
      return { removed: false, reason: describe(error), path: dir };
    }
  }

  async #plan(task) {
    const workspace = task?.workspace ?? {};
    const base = workspace.cwd ? path.resolve(workspace.cwd) : null;
    if (workspace.repository) {
      // Cursor Cloud clones the repository on its own side, so the local cwd is
      // only where the SDK call is made from and two of those cannot collide.
      return {
        mode: 'cloud',
        cwd: base,
        repoRoot: null,
        baseRef: task?.baseBranch ?? null,
        lockKey: `cloud:${task.id}`
      };
    }
    if (!base) {
      return { mode: 'inherit', cwd: null, repoRoot: null, baseRef: null, lockKey: 'inherit' };
    }
    const repoRoot = this.worktrees ? await this.#repoRoot(base) : null;
    if (!repoRoot) return shared(base, repoRoot);
    try {
      const worktree = await this.#ensureWorktree(task, repoRoot);
      return {
        mode: 'worktree',
        cwd: worktree.cwd,
        repoRoot,
        baseRef: worktree.baseRef,
        branch: worktree.branch ?? null,
        lockKey: worktree.cwd
      };
    } catch (error) {
      // A repository that cannot host a worktree — a shallow clone, a busy
      // index, no disk — must not stop the task. It runs shared and locked,
      // which is what it did before worktrees existed.
      this.logger?.warn?.(`workspace-worktree-failed:${task.id}:${describe(error)}`);
      return shared(base, repoRoot);
    }
  }

  async #ensureWorktree(task, repoRoot) {
    const dir = path.join(repoRoot, this.worktreeDir, task.id);
    // A registration whose directory was deleted by hand still answers "yes,
    // that worktree exists", and the task would then run in a path that is not
    // there. Pruning first makes the listing mean what it says.
    await this.#git(['worktree', 'prune'], repoRoot).catch(() => {});
    const known = await this.#worktreePaths(repoRoot);
    if (known.has(dir)) {
      return {
        cwd: dir,
        baseRef: task?.execution?.baseRef ?? null,
        branch: task?.taskBranch ?? null
      };
    }
    await mkdir(path.dirname(dir), { recursive: true });
    await this.#hide(path.dirname(dir));
    // A task that already produced a branch keeps it. Git refuses the same
    // branch in two worktrees, which is the one-to-one binding this wants for
    // free, and a re-created checkout that detached instead would strand every
    // commit the task has already made.
    const branch = await this.#localBranch(repoRoot, task?.taskBranch);
    if (branch) {
      await this.#git(['worktree', 'add', dir, branch], repoRoot);
      await this.#shareInto(dir, repoRoot);
      return { cwd: dir, baseRef: branch, branch };
    }
    const baseRef = await this.#resolveBaseRef(repoRoot, task?.baseBranch);
    // Detached on purpose. AAFE's branch rules forbid `aafe/task/<id>` as a
    // development branch, so the agent still creates the real one in here; a
    // branch invented at provisioning time would be exactly the name the rules
    // tell it not to keep.
    await this.#git(['worktree', 'add', '--detach', dir, baseRef], repoRoot);
    await this.#shareInto(dir, repoRoot);
    return { cwd: dir, baseRef, branch: null };
  }

  async #localBranch(repoRoot, taskBranch) {
    const branch = String(taskBranch ?? '').trim();
    if (!branch) return null;
    const found = await this.#git(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      repoRoot
    ).catch(() => '');
    return found.trim() ? branch : null;
  }

  /**
   * Symlinked rather than copied: the point is that the worktree sees the same
   * installed dependencies the main checkout has, and a copy would go stale the
   * first time either side installed anything.
   *
   * Only paths the repository already refuses to track are borrowed. Anything
   * else is content the worktree checked out for itself, and replacing it with
   * a link to the main tree would put two tasks back in one directory.
   */
  async #shareInto(dir, repoRoot) {
    const linked = [];
    for (const entry of this.share) {
      const spec = typeof entry === 'string' ? { path: entry, shadow: [] } : (entry ?? {});
      const name = spec.path;
      if (!name) continue;
      const from = path.join(repoRoot, name);
      if (!(await exists(from))) continue;
      if (!(await this.#isIgnored(name, repoRoot))) continue;
      const to = path.join(dir, name);
      if (await exists(to)) continue;
      try {
        if (await borrow(from, to, spec.shadow ?? [])) linked.push(name);
      } catch (error) {
        this.logger?.warn?.(`workspace-share-failed:${name}:${describe(error)}`);
      }
    }
    if (linked.length) await this.#exclude(repoRoot, linked);
  }

  async #isIgnored(name, repoRoot) {
    try {
      await this.#git(['check-ignore', '-q', '--', name], repoRoot);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A `node_modules/` rule matches a directory, and what a worktree gets is a
   * symlink — so the borrowed path shows up untracked, which leaves every
   * worktree permanently dirty and puts an absolute-path symlink one `git add
   * -A` away from being committed.
   *
   * Git has no per-worktree exclude file, so the entry goes in the shared one.
   * That is safe precisely because only already-ignored paths get here: the
   * main checkout's view of itself does not change.
   */
  async #exclude(repoRoot, names) {
    const out = await this.#git(['rev-parse', '--git-common-dir'], repoRoot).catch(() => '');
    const gitDir = out.trim();
    if (!gitDir) return;
    const file = path.join(path.resolve(repoRoot, gitDir), 'info', 'exclude');
    const current = await readFile(file, 'utf8').catch(() => '');
    const missing = names.map((name) => `/${name}`).filter((line) => !current.split('\n').includes(line));
    if (!missing.length) return;
    const header = current.includes(EXCLUDE_HEADER) ? '' : `\n${EXCLUDE_HEADER}\n`;
    await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    await writeFile(file, `${current}${header}${missing.join('\n')}\n`, 'utf8').catch((error) => {
      this.logger?.warn?.(`workspace-exclude-failed:${describe(error)}`);
    });
  }

  /**
   * The trunk the task said it starts from, preferring the remote copy: a local
   * branch of the same name may be days behind, and cutting a task from a stale
   * base is how a PR arrives full of other people's reverts.
   */
  async #resolveBaseRef(repoRoot, baseBranch) {
    const branch = String(baseBranch ?? '').trim();
    const candidates = branch
      ? [`upstream/${branch}`, `origin/${branch}`, branch]
      : [];
    for (const candidate of candidates) {
      const found = await this.#git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], repoRoot)
        .catch(() => '');
      if (found.trim()) return candidate;
    }
    return 'HEAD';
  }

  async #worktreePaths(repoRoot) {
    const out = await this.#git(['worktree', 'list', '--porcelain'], repoRoot).catch(() => '');
    const paths = new Set();
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) paths.add(path.resolve(line.slice('worktree '.length).trim()));
    }
    return paths;
  }

  async #repoRoot(dir) {
    const out = await this.#git(['rev-parse', '--show-toplevel'], dir).catch(() => '');
    const root = out.trim();
    return root ? path.resolve(root) : null;
  }

  /**
   * `*` hides the directory and this file with it, so the checkouts never reach
   * the main tree's `git status` even in a repository that does not ignore
   * `.aafe/` yet.
   */
  async #hide(dir) {
    const file = path.join(dir, '.gitignore');
    if (await exists(file)) return;
    await writeFile(file, '*\n', 'utf8').catch(() => {});
  }

  #git(args, cwd) {
    return this.runGit(args, cwd);
  }

  #takePort(taskId) {
    for (let port = this.portRange.from; port <= this.portRange.to; port += 1) {
      if (this.ports.has(port)) continue;
      this.ports.set(port, taskId);
      return port;
    }
    // Out of ports is not a reason to refuse the work; the task simply runs
    // without one reserved.
    return null;
  }

  /**
   * A queue per path. Reading and replacing the tail happen in one synchronous
   * step, so a caller arriving mid-release still chains behind the holder.
   */
  async #lock(key) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => held);
    this.locks.set(key, chained);
    await previous;
    return () => {
      release();
      // Only the tail may drop the key; anyone who queued behind us has already
      // replaced it with their own.
      if (this.locks.get(key) === chained) this.locks.delete(key);
    };
  }
}

function shared(cwd, repoRoot) {
  return { mode: 'shared', cwd, repoRoot: repoRoot ?? null, baseRef: null, lockKey: cwd };
}

function lease(held) {
  return {
    taskId: held.taskId,
    mode: held.mode,
    cwd: held.cwd,
    repoRoot: held.repoRoot,
    baseRef: held.baseRef,
    branch: held.branch ?? null,
    port: held.port,
    acquiredAt: held.acquiredAt
  };
}

function normalizeRange(value) {
  const from = Number.parseInt(value?.from, 10);
  const to = Number.parseInt(value?.to, 10);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return DEFAULT_PORT_RANGE;
  return { from, to };
}

async function defaultRunGit(args, cwd) {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/**
 * Config may name a path as a bare string. Where that names something the
 * defaults already know about, it means the same thing the default does — a
 * project should not lose cache isolation for having spelled `node_modules` out.
 */
function normalizeShare(share) {
  if (!Array.isArray(share)) return [];
  const known = new Map(DEFAULT_SHARED_PATHS.map((entry) => [entry.path, entry]));
  return share.map((entry) => {
    if (typeof entry !== 'string') return entry;
    return known.get(entry) ?? { path: entry, shadow: [] };
  });
}

/**
 * A whole-directory symlink is one syscall, but then everything inside it is
 * shared — including the build caches two parallel tasks will both write to,
 * which is how one task's output ends up in another's bundle. Where a shadow
 * list is given the directory is rebuilt entry by entry instead, so those names
 * can be real, empty, and this task's alone.
 *
 * @returns {Promise<boolean>} whether the borrow left a bare symlink behind,
 *   which git sees as an untracked file rather than an ignored directory.
 */
async function borrow(from, to, shadow) {
  if (!shadow.length) {
    await symlink(from, to, 'dir');
    return true;
  }
  await mkdir(to, { recursive: true });
  const hidden = new Set(shadow);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (hidden.has(entry.name)) continue;
    await symlink(
      path.join(from, entry.name),
      path.join(to, entry.name),
      entry.isDirectory() ? 'dir' : 'file'
    ).catch(() => {});
  }
  // Created whether or not the main checkout has them yet: the point is that
  // this task writes its cache somewhere nobody else is reading.
  for (const entry of shadow) await mkdir(path.join(to, entry), { recursive: true });
  return false;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
