/**
 * Editor hook scripts.
 *
 * Shared by the flat and the layered (workspace-root) installers so the two
 * cannot drift — they had already diverged into two copies of the same bash.
 */

/**
 * Locates the CLI without assuming a global install.
 *
 * The documented setup is `npm install --save-dev @aafe/agent-runtime`, which
 * puts the binary in `node_modules/.bin` and nowhere on `PATH`. A hook that
 * only probes `command -v aafe` therefore finds nothing and exits silently, so
 * the whole post-task chain — knowledge refresh, runtime update, migrations,
 * doctor — never runs in exactly the setup the README recommends.
 *
 * Walking up covers monorepos that hoist the binary to the workspace root. A
 * global install is still honoured, but only as the last resort. When nothing
 * resolves the package genuinely is not installed here, and staying silent
 * beats having a hook pull something off the network.
 */
const RESOLVE_AAFE = `resolve_aafe() {
  dir="$PWD"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -x "$dir/node_modules/.bin/aafe" ]; then
      printf '%s' "$dir/node_modules/.bin/aafe"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  if command -v aafe >/dev/null 2>&1; then
    printf 'aafe'
    return 0
  fi
  return 1
}`;

/**
 * @param {{ moduleRelativePath?: string }} [ctx] set for layered installs, where
 *   the hook runs from the workspace root but the project lives in a subdirectory.
 */
export function taskCompletionHookScript(ctx = {}) {
  const moduleDir = ctx.moduleRelativePath && ctx.moduleRelativePath !== '.'
    ? [
        '',
        `MODULE_DIR="${ctx.moduleRelativePath}"`,
        'if [ -f "${MODULE_DIR}/.aafe.config.json" ]; then',
        '  cd "${MODULE_DIR}" || exit 0',
        'fi'
      ]
    : [];

  return [
    '#!/usr/bin/env bash',
    'set -u',
    '',
    'if [ "${AAFE_TASK_STATUS:-success}" != "success" ]; then',
    '  exit 0',
    'fi',
    ...moduleDir,
    '',
    RESOLVE_AAFE,
    '',
    'AAFE="$(resolve_aafe)" || exit 0',
    '"$AAFE" task-completion || true',
    ''
  ].join('\n');
}
