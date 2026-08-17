import assert from 'node:assert/strict';
import {
  normalizeSubmitCli,
  resolveSubmitConfig,
  buildSubmitConfigFromAnswers,
  isGtmSubmitCli,
  defaultSubmitConfig,
  parseGtmBranchName,
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

const parsed = parseGtmBranchName('feat/search-tag/#1010158081136674445');
assert.equal(parsed.associated, true);
assert.equal(parsed.entryType, 'story');
assert.equal(parsed.slug, 'search-tag');
assert.equal(parsed.entryId, '1010158081136674445');
assert.equal(parsed.shortId, '136674445');
assert.equal(parseGtmBranchName('master'), null);
assert.equal(
  tapdShortIdFromFullId('https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081136674445'),
  '136674445'
);
assert.equal(
  extractTapdIdFromUrl('https://tapd.woa.com/tapd_fe/10158081/story/detail/1010158081136674445'),
  '1010158081136674445'
);

console.log('submit config tests passed');
