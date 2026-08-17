import assert from 'node:assert/strict';
import {
  storySubmitTransitionPath,
  storySubmitRemainingPath,
  parseStatusChain
} from '../src/cli/tapdConfig.js';

assert.deepEqual(parseStatusChain('developing,status_7'), ['developing', 'status_7']);

const path = storySubmitTransitionPath({
  status_backlog: 'backlog',
  status_todo: 'todo',
  status_doing: 'doing',
  status_done: 'for_test'
});
assert.deepEqual(path, ['backlog', 'todo', 'doing']);

// status_doing comma-chain: submit target is the first token only
assert.deepEqual(storySubmitTransitionPath({
  status_backlog: 'backlog',
  status_todo: 'todo',
  status_doing: 'developing,status_7',
  status_done: 'for_test'
}), ['backlog', 'todo', 'developing']);

const cfg = {
  status_backlog: 'backlog',
  status_todo: 'todo',
  status_doing: 'doing',
  status_done: 'for_test'
};

assert.deepEqual(storySubmitRemainingPath('backlog', cfg), ['todo', 'doing']);
assert.deepEqual(storySubmitRemainingPath('todo', cfg), ['doing']);
assert.deepEqual(storySubmitRemainingPath('doing', cfg), []);
assert.deepEqual(storySubmitRemainingPath('for_test', cfg), []);

assert.deepEqual(storySubmitRemainingPath('developing', {
  status_backlog: 'backlog',
  status_todo: 'todo',
  status_doing: 'developing,status_7',
  status_done: 'for_test'
}), []);

console.log('tapd config tests passed');
