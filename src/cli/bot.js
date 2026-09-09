/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

// Register future Bot adapters here. Loading the dispatcher never loads a Bot.
const adapters = {
  wecom: async (root, args) => {
    const { runWeComCommand } = await import('./wecom.js');
    return runWeComCommand(root, args);
  }
};

const usage = 'Usage: aafe bot start --wecom [--root=<path>] [--config=<file>] [--no-recover]';

export function parseBotArgs(args = []) {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return { help: true };
  }
  if (args[0] !== 'start') throw new Error(usage);
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const selectors = args.slice(1).filter((arg) =>
    Object.hasOwn(adapters, arg.replace(/^--/, '')) && arg.startsWith('--'));
  if (selectors.length !== 1) throw new Error('请选择且仅选择一个 Bot。' + usage);
  const forwarded = args.slice(1).filter((arg) => arg !== selectors[0]);
  for (const arg of forwarded) {
    if (!/^--(?:root|config|probe)=.+$/.test(arg) &&
        !['--no-recover', '--check-models', '--offline'].includes(arg)) {
      throw new Error('Unknown Bot option: ' + arg + '. ' + usage);
    }
  }
  return { bot: selectors[0].slice(2), args: forwarded };
}

export async function runBotCommand(root, args = []) {
  const options = parseBotArgs(args);
  if (options.help) {
    console.log(usage + '\n可用 Bot：' + Object.keys(adapters).join(', ') +
      '\nBot 为独立可选服务；默认安装和 update 不安装、加载或启动 Bot。');
    return;
  }
  return adapters[options.bot](root, options.args);
}
