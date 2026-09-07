# Task workspace isolation

## ADDED Requirements

### Requirement: One task, one checkout
Two agents pointed at the same working tree corrupt each other long before they
touch the same source line: the git index, the branch HEAD, build output and
generated files are all single-writer. A task that runs against a local git
repository MUST therefore be given a git worktree of its own, cut from the
branch the task says it starts from, and MUST run there rather than in the
repository the workspace was configured with.

The base ref MUST prefer the remote copy of that branch over a local branch of
the same name, because a local one may be days behind and a task cut from a
stale base produces a PR full of other people's reverts.

A task's first worktree MUST be created detached. AAFE's branch rules forbid
`aafe/task/<id>` as a development branch and require the agent to create the
real one, so a branch invented at provisioning time would be exactly the name
the rules tell it to abandon. The prompt MUST say that the detachment is
deliberate and that the branch is the agent's to create, or the agent will read
it as damage to repair.

Once the task has a branch, a re-created worktree MUST resume it rather than
detach again, which would strand every commit the task has already made. Git
refuses the same branch in two worktrees, so this is also what binds a task to
its branch one-to-one. A branch the repository does not have MUST NOT fail
provisioning; the task starts detached as usual.

The checkouts MUST NOT appear in the main tree's `git status`, and a worktree
MUST NOT appear permanently dirty, or nothing can tell real work from
scaffolding.

#### Scenario: Two tasks on one repository do not share a directory
- GIVEN two tasks whose workspace is the same local git repository
- WHEN both are started
- THEN each runs in its own worktree with its own path
- AND `git worktree list` shows both
- AND the main checkout reports no untracked files

#### Scenario: The agent is told the checkout is its own
- WHEN a task starts in a worktree
- THEN the prompt names the directory, says the worktree belongs to this task alone, and says HEAD is detached on purpose

#### Scenario: Recovery addresses the same checkout
- GIVEN a task that already holds a worktree
- WHEN it is recovered, continued or cancelled
- THEN every one of those reaches the leased directory, not the configured workspace

#### Scenario: A re-created checkout resumes the task's branch
- GIVEN a task whose worktree was reclaimed after the agent committed to a branch
- WHEN the task is started again
- THEN the new worktree is checked out on that branch with the commits intact
- AND the prompt says the task is already on its branch rather than telling it to create one

### Requirement: A checkout that cannot be isolated is held exclusively
Isolation MUST degrade rather than disappear. A directory that is not a git
repository, a repository that cannot host a worktree, and a configuration with
worktrees turned off MUST all fall back to a lock on the shared path, so those
runs queue instead of overlapping. A repository that fails to provide a
worktree MUST NOT fail the task.

A task whose code lives on Cursor's side is cloned there and MUST NOT be
serialised against anything local.

#### Scenario: A shared directory is handed to one task at a time
- GIVEN two tasks whose workspace is the same directory, which is not a git repository
- WHEN both are started
- THEN the second waits until the first releases the directory

#### Scenario: A repository that cannot host a worktree still runs
- GIVEN a repository where `git worktree add` fails
- WHEN a task starts against it
- THEN the task runs in the shared checkout under a lock, and the failure is logged rather than raised

### Requirement: Parallel tasks do not collide over ports or dependencies
A live task MUST be given a port no other live task holds, and the prompt MUST
tell the agent to bind any dev server, preview or test server to it. A released
port MUST return to the pool. Running out of ports MUST NOT refuse the work.

A fresh worktree has the tracked files and nothing else, so anything the
repository needs but does not commit MUST be borrowed from the main checkout —
otherwise the agent's first move is to install dependencies and the self-test
gate never runs. Only paths the repository already ignores MAY be borrowed;
tracked content MUST be left as the worktree checked it out. Borrowing MUST NOT
leave the worktree dirty, because an untracked absolute-path symlink is one
`git add -A` away from being committed.

Dependencies are read-only in practice and safe to share. The build caches that
live among them are not: two tasks writing one cache is how a task ships another
task's output. A borrowed path MUST therefore be able to declare names that stay
this task's own, and the caches inside `node_modules` MUST be among them. A task
MUST NOT write its build cache into the main checkout.

#### Scenario: Each live task holds its own port
- WHEN two tasks run at once
- THEN they are given different ports, and each prompt names its own
- AND a port returns to the pool once its task releases the workspace

#### Scenario: A worktree can run the tests
- GIVEN a repository with installed dependencies it does not track
- WHEN a task is given a worktree
- THEN those dependencies are visible from the worktree
- AND the worktree reports no untracked files

#### Scenario: Two tasks build without overwriting each other
- GIVEN two tasks that borrowed the same installed dependencies
- WHEN both write a build cache
- THEN each reads back its own
- AND the main checkout's cache is untouched

### Requirement: The workspace and the pull request are facts about the task
Where a task ran MUST be recorded on the task itself, not only in a log line,
so later runs, recovery and cancellation address the same checkout. The pull
request a run produced MUST be lifted out of the run result onto the task, so
readers stop digging through the nested git payload, and a later run that
reports no pull request MUST NOT erase the one already recorded.

A finished task's worktree MUST be kept while it still holds uncommitted work,
which is the only copy of it; a clean one MAY be reclaimed.

#### Scenario: The lease is written before the run starts
- WHEN a task starts
- THEN the task records the mode, directory, base ref and port it was given, and the event log says so

#### Scenario: The pull request is readable from the task
- GIVEN a run that reported a pull request URL
- WHEN the task finishes
- THEN the task carries the provider, number and URL

#### Scenario: Unfinished work is not reclaimed
- GIVEN a released worktree with uncommitted changes
- WHEN it is asked to be removed
- THEN it is kept and reported as dirty, and only a forced removal discards it

### Requirement: Candidates are narrowed before tasks are read
Answering a chat message MUST NOT mean reading every task file on disk to throw
almost all of them away. The store MUST maintain an index of what a caller can
filter on — status, conversation, user, source — and MUST use it to decide
which tasks are worth opening.

The index is a cache and MUST NOT become the truth: the directory listing still
drives the result, a task the index has not seen MUST be read anyway and
repaired into it, and an entry pointing at a task that no longer exists MUST NOT
resurrect it.

#### Scenario: A conversation's tasks are found without reading the rest
- GIVEN tasks belonging to several conversations and users
- WHEN one conversation's tasks are listed
- THEN only that conversation's tasks are returned

#### Scenario: A missing index rebuilds itself
- GIVEN the index file has been deleted
- WHEN tasks are listed
- THEN the same tasks are returned and the index is repaired
