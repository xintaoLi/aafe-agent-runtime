export function defaultTapdStoryStatus() {
  return {
    status_backlog: 'backlog',
    status_todo: 'todo',
    status_doing: 'doing',
    status_done: 'for_test',
    status_release: 'status_3,status_9'
  };
}

export function defaultTapdBugStatus() {
  return {
    status_done: 'resolved',
    status_release: 'verified',
    status_doing: 'doing'
  };
}

export function defaultTapdConfigTemplate() {
  return {
    enabled: true,
    username: '',
    api_password: '',
    // workspace_id optional — auto-extracted from TAPD URL at backfill time
    workspace_id: '',
    default_entry_type: 'story',
    tapd_story: defaultTapdStoryStatus(),
    tapd_bug: defaultTapdBugStatus()
  };
}

export function buildTapdConfigFromAnswers(answers = {}) {
  const config = defaultTapdConfigTemplate();
  config.enabled = true;
  if (answers.username) config.username = answers.username;
  if (answers.api_password) config.api_password = answers.api_password;
  if (answers.workspace_id) config.workspace_id = String(answers.workspace_id);

  if (answers.story_status_done) config.tapd_story.status_done = answers.story_status_done;
  if (answers.story_status_release) config.tapd_story.status_release = answers.story_status_release;
  if (answers.story_status_doing) config.tapd_story.status_doing = answers.story_status_doing;
  if (answers.story_status_todo) config.tapd_story.status_todo = answers.story_status_todo;
  if (answers.story_status_backlog) config.tapd_story.status_backlog = answers.story_status_backlog;

  if (answers.bug_status_done) config.tapd_bug.status_done = answers.bug_status_done;
  if (answers.bug_status_release) config.tapd_bug.status_release = answers.bug_status_release;
  if (answers.bug_status_doing) config.tapd_bug.status_doing = answers.bug_status_doing;

  return config;
}

export function parseStatusChain(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Submit-backfill story chain (stops at doing; never advances to status_done/for_test):
 * backlog → todo → doing
 */
export function storySubmitTransitionPath(statusConfig = {}) {
  const backlog = statusConfig.status_backlog ?? 'backlog';
  const todo = statusConfig.status_todo ?? 'todo';
  const doing = resolveDoingTarget(statusConfig.status_doing);
  return [backlog, todo, doing].filter((status, index, arr) => arr.indexOf(status) === index);
}

/**
 * Remaining status steps from current story status for submit backfill.
 * - backlog → [todo, doing]
 * - todo → [doing]
 * - doing (or any later status in doing chain / done) → []
 */
export function storySubmitRemainingPath(currentStatus, statusConfig = {}) {
  const path = storySubmitTransitionPath(statusConfig);
  const backlog = path[0];
  const todo = path[1];
  const doing = path[path.length - 1];
  const doingChain = parseStatusChain(statusConfig.status_doing);
  const done = statusConfig.status_done ?? 'for_test';
  const current = String(currentStatus ?? '').trim();

  if (!current) return [];

  if (isAlreadyDoingOrBeyond(current, { doing, doingChain, done })) {
    return [];
  }

  if (current === backlog) return path.slice(1);
  if (current === todo) return doing && doing !== todo ? [doing] : [];

  const idx = path.indexOf(current);
  if (idx === -1) return [];
  return path.slice(idx + 1);
}

function resolveDoingTarget(statusDoing) {
  const chain = parseStatusChain(statusDoing);
  return chain[0] ?? 'doing';
}

function isAlreadyDoingOrBeyond(current, { doing, doingChain, done }) {
  if (current === doing) return true;
  if (doingChain.includes(current)) return true;
  if (current === done) return true;
  return false;
}
