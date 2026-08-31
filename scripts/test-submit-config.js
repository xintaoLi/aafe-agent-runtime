import assert from 'node:assert/strict';
import {
  normalizeSubmitCli,
  resolveSubmitConfig,
  buildSubmitConfigFromAnswers,
  isGtmSubmitCli,
  defaultSubmitConfig,
  parseGtmBranchName,
  parseTapdBranchName,
  tapdShortIdFromFullId,
  extractTapdIdFromUrl
} from '../src/cli/submitConfig.js';

assert.equal(normalizeSubmitCli(undefined), 'git');
assert.equal(normalizeSubmitCli('GIT'), 'git');
assert.equal(normalizeSubmitCli('git-cli'), 'git');
assert.equal(normalizeSubmitCli('gtm'), 'gtm');
assert.equal(normalizeSubmitCli('gtm-cli'), 'gtm');
assert.equal(normalizeSubmitCli('unknown'), 'git');

assert.deepEqual(defaultSubmitConfig(), { cli: 'git' });
assert.deepEqual(resolveSubmitConfig({}), { cli: 'git' });
assert.deepEqual(resolveSubmitConfig({ submit: { cli: 'gtm' } }), { cli: 'gtm' });
assert.deepEqual(resolveSubmitConfig({ submit: { cli: 'git' } }, { cli: 'gtm' }), { cli: 'gtm' });
assert.deepEqual(resolveSubmitConfig({}, { submitCli: 'gtm-cli' }), { cli: 'gtm' });

assert.equal(isGtmSubmitCli('gtm'), true);
assert.equal(isGtmSubmitCli({ cli: 'git' }), false);

assert.deepEqual(buildSubmitConfigFromAnswers({ cli: 'gtm' }), { cli: 'gtm' });

// Branch name uses short_id (last 9 digits) in the # segment
const parsed = parseTapdBranchName('feat/search-tag/#137629063');
assert.equal(parsed.associated, true);
assert.equal(parsed.entryType, 'story');
assert.equal(parsed.slug, 'search-tag');
assert.equal(parsed.entryId, '137629063');
assert.equal(parsed.shortId, '137629063');
assert.equal(parseTapdBranchName('master'), null);

// Backward-compatible alias still works
assert.equal(parseGtmBranchName('feat/search-tag/#137629063').shortId, '137629063');

// Bug branch
const bugParsed = parseTapdBranchName('bug/login-fix/#137629063');
assert.equal(bugParsed.entryType, 'bug');
assert.equal(bugParsed.prefix, 'bug');

assert.equal(
  tapdShortIdFromFullId('https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137629063'),
  '137629063'
);
assert.equal(
  extractTapdIdFromUrl('https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081137629063'),
  '1010158081137629063'
);

console.log('submit config tests passed');
