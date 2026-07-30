export function defaultTapdStoryStatus() {
  return {
    status_backlog: 'backlog',
    status_todo: 'todo',
    status_doing: 'developing,status_7',
    status_done: 'for_test',
    status_release: 'status_3,status_9'
  };
}

export function defaultTapdBugStatus() {
  return {
    status_done: 'resolved',
    status_release: 'verified',
    status_doing: 'assigned,in_progress'
  };
}

export function defaultTapdConfigTemplate() {
  return {
    enabled: true,
    username: '',
    api_password: '',
    workspace_id: '',
    milestone_id: '',
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
  if (answers.milestone_id) config.milestone_id = String(answers.milestone_id);

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

export function storySubmitTransitionPath(statusConfig = {}, { isNewStory = false } = {}) {
  const done = statusConfig.status_done ?? 'for_test';
  if (isNewStory) {
    const backlog = statusConfig.status_backlog ?? 'backlog';
    const todo = statusConfig.status_todo ?? 'todo';
    const doingChain = parseStatusChain(statusConfig.status_doing);
    return [backlog, todo, ...doingChain, done].filter((status, index, arr) => arr.indexOf(status) === index);
  }
  const todo = statusConfig.status_todo ?? 'todo';
  const doingChain = parseStatusChain(statusConfig.status_doing);
  return [todo, ...doingChain, done].filter((status, index, arr) => arr.indexOf(status) === index);
}
