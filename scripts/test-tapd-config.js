import assert from 'node:assert/strict';
import { storySubmitTransitionPath, parseStatusChain } from '../src/cli/tapdConfig.js';

assert.deepEqual(parseStatusChain('developing,status_7'), ['developing', 'status_7']);

const existingPath = storySubmitTransitionPath({
  status_todo: 'todo',
  status_doing: 'developing,status_7',
  status_done: 'for_test'
}, { isNewStory: false });
assert.deepEqual(existingPath, ['todo', 'developing', 'status_7', 'for_test']);

const newPath = storySubmitTransitionPath({
  status_backlog: 'backlog',
  status_todo: 'todo',
  status_doing: 'developing,status_7',
  status_done: 'for_test'
}, { isNewStory: true });
assert.deepEqual(newPath, ['backlog', 'todo', 'developing', 'status_7', 'for_test']);

console.log('tapd config tests passed');
