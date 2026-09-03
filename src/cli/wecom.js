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

import { startWeComBot } from '../../ai-bots/wecom/src/index.js';

/**
 * Thin resident entry. Unlike `aafe task`, this process keeps TaskManager open
 * until SIGINT/SIGTERM or a WeCom kick.
 */
export async function runWeComCommand(root, args = []) {
  const options = parseWeComArgs(args);
  await startWeComBot({
    root: options.root ?? root,
    recoverOnStart: options.recoverOnStart,
    localConfigPath: options.config
  });
}

export function parseWeComArgs(args = []) {
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--root=')) { options.root = arg.slice(7); continue; }
    if (arg.startsWith('--config=')) { options.config = arg.slice(9); continue; }
    if (arg === '--no-recover') { options.recoverOnStart = false; continue; }
  }
  return options;
}
