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
import {
  buildGithubPrCreateArgs,
  buildGithubPrEditArgs,
  buildGongfengMrMeta,
  normalizeRepoStringList,
  resolveRepoConfig,
  resolveRepoPrMeta,
  stripLegacyE2eRepoTokens,
  withRepoTokenEnv
} from '../src/cli/repoConfig.js';
import {
  ensureGithubPullRequest,
  githubApiBase,
  githubGitExtraHeader,
  parseGitRemote,
  parseRepoPrArgs,
  resolveGithubSubmitToken,
  runRepoPrCommand
} from '../src/cli/repoSubmit.js';
import { repoSubmitSkillContent } from '../src/cli/repoSubmitRules.js';

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

assert.deepEqual(resolveRepoConfig({
  e2e: { githubAccessToken: 'legacy-gh' }
}), {
  githubAccessToken: 'legacy-gh',
  gongfengAccessToken: null,
  reviewers: [],
  labels: []
});
assert.deepEqual(resolveRepoConfig({
  repo: { githubAccessToken: 'repo-gh' },
  e2e: { githubAccessToken: 'legacy-gh', gongfengAccessToken: 'legacy-gf' }
}), {
  githubAccessToken: 'repo-gh',
  gongfengAccessToken: 'legacy-gf',
  reviewers: [],
  labels: []
});
assert.deepEqual(normalizeRepoStringList('alice, bob\nbob;carol'), ['alice', 'bob', 'carol']);
assert.deepEqual(resolveRepoPrMeta({
  repo: { reviewers: ['alice', 'bob'], labels: 'frontend, bug' }
}), {
  reviewers: ['alice', 'bob'],
  labels: ['frontend', 'bug']
});
assert.deepEqual(
  buildGithubPrCreateArgs({ reviewers: ['alice', 'bob'], labels: ['frontend'] }),
  ['--reviewer', 'alice,bob', '--label', 'frontend']
);
assert.deepEqual(buildGithubPrCreateArgs({ reviewers: [], labels: [] }), []);
assert.deepEqual(
  buildGithubPrEditArgs({ reviewers: ['alice'], labels: ['bug'] }),
  ['--add-reviewer', 'alice', '--add-label', 'bug']
);
assert.deepEqual(buildGongfengMrMeta({
  reviewers: ['alice', '1024'],
  labels: ['frontend', 'bug']
}), {
  labels: 'frontend,bug',
  reviewerIds: ['1024'],
  reviewerUsernames: ['alice']
});
assert.deepEqual(stripLegacyE2eRepoTokens({
  enabled: true,
  githubAccessToken: 'x',
  gongfengAccessToken: 'y',
  baseUrl: null
}), {
  enabled: true,
  baseUrl: null
});
const injected = withRepoTokenEnv({
  repo: { githubAccessToken: 'ghp_repo', gongfengAccessToken: 'gf_repo' }
}, {});
assert.equal(injected.GITHUB_TOKEN, 'ghp_repo');
assert.equal(injected.GH_TOKEN, 'ghp_repo');
assert.equal(injected.GIT_PRIVATE_TOKEN, 'gf_repo');
assert.equal(withRepoTokenEnv({
  repo: { githubAccessToken: 'ghp_repo' }
}, { GITHUB_TOKEN: 'from-shell' }).GITHUB_TOKEN, 'from-shell');

assert.deepEqual(parseGitRemote('git@github.com:acme/app.git'), {
  host: 'github.com',
  owner: 'acme',
  repo: 'app',
  projectPath: 'acme/app',
  provider: 'github'
});
assert.equal(githubApiBase('github.com'), 'https://api.github.com');
assert.equal(githubGitExtraHeader('tok'), 'AUTHORIZATION: bearer tok');
assert.equal(resolveGithubSubmitToken({
  repo: { githubAccessToken: 'ghp_cfg' }
}, {}).source, 'repo.githubAccessToken');
assert.equal(resolveGithubSubmitToken({
  repo: { githubAccessToken: 'ghp_cfg' }
}, { GITHUB_TOKEN: 'from-env' }).source, 'env.GITHUB_TOKEN');
assert.equal(parseRepoPrArgs(['--title=Fix', '--base=main']).title, 'Fix');

const created = await ensureGithubPullRequest({
  token: 'ghp_test',
  owner: 'acme',
  repo: 'app',
  head: 'feat/x',
  base: 'master',
  title: 'Fix',
  body: 'body',
  reviewers: ['alice'],
  labels: ['frontend'],
  fetchImpl: async (url, init = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'GET' && String(url).includes('/pulls?')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (method === 'POST' && String(url).endsWith('/pulls')) {
      return { ok: true, status: 201, json: async () => ({ number: 7, html_url: 'https://github.com/acme/app/pull/7' }) };
    }
    if (String(url).includes('/requested_reviewers') || String(url).includes('/labels')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`unexpected ${method} ${url}`);
  }
});
assert.equal(created.htmlUrl, 'https://github.com/acme/app/pull/7');
assert.equal(created.created, true);
assert.equal(created.number, 7);

const planned = await runRepoPrCommand('/tmp', [
  '--title=Fix', '--head=feat/x', '--owner=acme', '--repo=app', '--dry-run'
], {
  env: {},
  readConfig: async () => ({ repo: { githubAccessToken: 'ghp_cfg', reviewers: ['bob'], labels: ['bug'] } }),
  resolveRemote: async () => null,
  resolveHead: async () => ''
});
assert.equal(planned.dryRun, true);
assert.equal(planned.source, 'repo.githubAccessToken');
assert.deepEqual(planned.reviewers, ['bob']);
assert.doesNotMatch(JSON.stringify(planned), /ghp_cfg/);

const fallbackPlan = await runRepoPrCommand('/tmp', [
  '--title=Fix', '--head=feat/x', '--owner=acme', '--repo=app', '--dry-run'
], {
  env: {},
  readConfig: async () => ({ repo: { reviewers: ['alice'], labels: ['frontend'] } }),
  resolveRemote: async () => null,
  resolveHead: async () => ''
});
assert.equal(fallbackPlan.mode, 'gh-fallback');
assert.match(fallbackPlan.warning, /降级使用 gh pr create/);
assert.deepEqual(fallbackPlan.reviewers, ['alice']);

const repoSkill = repoSubmitSkillContent('.ai-agent');
assert.match(repoSkill, /不依赖/);
assert.match(repoSkill, /aafe repo pr/);
assert.match(repoSkill, /githubAccessToken/);
assert.match(repoSkill, /AUTHORIZATION: bearer/);
assert.match(repoSkill, /降级/);

console.log('submit config tests passed');
