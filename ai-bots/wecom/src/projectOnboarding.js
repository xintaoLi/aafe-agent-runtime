import { createHash } from 'node:crypto';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isE2eDevInitialized } from '../../../src/cli/e2eDevSetup.js';
import { initializeWeComProject } from './project.js';

export function createProjectOnboarding({ config, workspaces, initialize = initializeWeComProject }) {
  const running = new Map();
  async function identity(workspace) {
    if (!workspace?.cwd || workspace.repository) return null;
    const registered = workspaces.list().find((item) => item.id === workspace.id && item.cwd === workspace.cwd);
    if (!registered || registered.repository) return null;
    const cwd = await realpath(registered.cwd);
    return { ...registered, cwd, key: createHash('sha256').update(cwd).digest('hex') };
  }
  const statePath = (item) => path.join(config.root, '.aafe/wecom/e2e-onboarding', item.key + '.json');
  return {
    async suggest(workspace, sessionKey) {
      // Project selection and task creation must never become an E2E setup
      // approval gate. The execution agent discovers the existing setup and
      // initializes safe templates only when UI verification is applicable.
      // Explicit `初始化 E2E <id>` remains available for operators.
      void workspace;
      void sessionKey;
      return '';
    },
    async handle(text) {
      const match = /^\s*(初始化|暂不初始化)\s*E2E\s+(\S+)\s*$/i.exec(text);
      if (!match) return null;
      try {
        const registered = workspaces.list().find((item) => item.id === match[2]);
        const item = await identity(registered);
        if (!item) return '未找到可初始化的本地项目，请使用已配置的工作区 ID。';
        if (await isE2eDevInitialized(item.cwd)) return `项目 ${item.id} 已初始化，直接使用现有 E2E 配置，不重复初始化。`;
        if (match[1] === '暂不初始化') {
          if (running.has(item.key)) return `项目 ${item.id} 正在执行已确认的初始化。`;
          await mkdir(path.dirname(statePath(item)), { recursive: true });
          await writeFile(statePath(item), JSON.stringify({ deferred: true }) + '\n');
          return `已暂不初始化 ${item.id}，后续不再自动询问；需要时回复「初始化 E2E ${item.id}」。`;
        }
        if (!running.has(item.key)) {
          const job = (async () => {
            const args = ['--workspace=' + item.id];
            if (config.localConfigPath) args.push('--config=' + config.localConfigPath);
            const result = await initialize(config.root, args, { expectedCwd: item.cwd });
            return `项目 ${item.id} E2E 配置已初始化，后续直接复用。未启动服务或测试。` +
              (result.warnings?.length ? '\n自定义构建或配置存在适配项，请检查 project init 输出与项目配置。' : '') +
              '\n启用测试前仍需确认代理目标及登录验证条件。';
          })();
          running.set(item.key, job);
          void job.finally(() => running.delete(item.key)).catch(() => {});
        }
        return await running.get(item.key);
      } catch {
        return '项目 E2E 初始化未完成，未记为初始化成功。请检查项目权限和构建配置后重试；不会自动重复初始化。';
      }
    }
  };
}
