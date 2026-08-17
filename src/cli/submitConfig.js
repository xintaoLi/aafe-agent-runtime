export const SUBMIT_CLI_GIT = 'git';
export const SUBMIT_CLI_GTM = 'gtm';

export function defaultSubmitConfig() {
  return {
    cli: SUBMIT_CLI_GIT
  };
}

/**
 * Normalize submit CLI provider.
 * Accepts: git | git-cli | gtm | gtm-cli
 * Default: git
 */
export function normalizeSubmitCli(value) {
  const normalized = String(value ?? SUBMIT_CLI_GIT).trim().toLowerCase().replace(/[_]/g, '-');
  if (normalized === 'gtm' || normalized === 'gtm-cli' || normalized === 'gtmcli') {
    return SUBMIT_CLI_GTM;
  }
  if (normalized === 'git' || normalized === 'git-cli' || normalized === 'gitcli') {
    return SUBMIT_CLI_GIT;
  }
  return SUBMIT_CLI_GIT;
}

export function resolveSubmitConfig(projectConfig = {}, overrides = {}) {
  const fromConfig = projectConfig.submit && typeof projectConfig.submit === 'object'
    ? projectConfig.submit
    : {};
  const cli = normalizeSubmitCli(
    overrides.cli
      ?? overrides.submitCli
      ?? fromConfig.cli
      ?? projectConfig.submitCli
      ?? SUBMIT_CLI_GIT
  );
  return {
    ...defaultSubmitConfig(),
    ...fromConfig,
    cli
  };
}

export function buildSubmitConfigFromAnswers(answers = {}, existing = null) {
  const base = {
    ...defaultSubmitConfig(),
    ...(existing && typeof existing === 'object' ? existing : {})
  };
  if (answers.cli != null || answers.submitCli != null) {
    base.cli = normalizeSubmitCli(answers.cli ?? answers.submitCli);
  }
  return base;
}

export function isGtmSubmitCli(submitConfigOrCli) {
  if (typeof submitConfigOrCli === 'string') {
    return normalizeSubmitCli(submitConfigOrCli) === SUBMIT_CLI_GTM;
  }
  return normalizeSubmitCli(submitConfigOrCli?.cli) === SUBMIT_CLI_GTM;
}

/**
 * Parse GTM-associated develop branch names.
 * Example: feat/search-tag/#1010158081136674445
 */
export function parseGtmBranchName(branchName) {
  const raw = String(branchName ?? '').trim();
  const match = raw.match(/^(feat|feature|bug|fix|hotfix)\/([^/#]+)\/#(\d+)$/i);
  if (!match) return null;

  const prefix = match[1].toLowerCase();
  const entryId = match[3];
  const isBug = prefix === 'bug' || prefix === 'fix';
  return {
    associated: true,
    branch: raw,
    prefix,
    slug: match[2],
    entryType: isBug ? 'bug' : 'story',
    entryId,
    shortId: tapdShortIdFromFullId(entryId)
  };
}

/** TAPD URL/ID → GTM short id (last 9 digits). */
export function tapdShortIdFromFullId(urlOrId) {
  const digits = String(urlOrId ?? '').match(/(\d{9,})/g);
  if (!digits?.length) {
    const only = String(urlOrId ?? '').replace(/\D/g, '');
    return only.length >= 9 ? only.slice(-9) : only;
  }
  return digits[digits.length - 1].slice(-9);
}

export function extractTapdIdFromUrl(url) {
  const text = String(url ?? '').trim();
  const match = text.match(/\/(?:story|bug|task)\/detail\/(\d+)/i)
    ?? text.match(/#(\d{9,})/)
    ?? text.match(/(\d{15,})/);
  return match?.[1] ?? null;
}
