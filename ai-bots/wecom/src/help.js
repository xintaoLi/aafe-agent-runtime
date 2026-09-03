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

export const WELCOME_TEXT = [
  '您好！我是 AAFE 助手。',
  '直接发需求或 TAPD 链接即可创建任务。'
].join('\n');

export const HELP_TEXT = [
  'AAFE 企微助手（长连接）',
  '直接发需求、缺陷描述或 TAPD 链接，会自动创建任务。',
  '当前会话只有一个未结束任务时，下一条补充会自动继续。',
  '也可以用显式命令：',
  '- 做：<需求>  创建任务并立刻返回 Task ID',
  '- 继续 <TaskID>：<补充>  在同一 Agent 上继续',
  '- 状态 <TaskID>  查看任务',
  '- 取消 <TaskID>  取消任务',
  '- 列表  查看我的未结束任务',
  '多个未结束任务时，继续 / 状态 / 取消需要带显式 Task ID。'
].join('\n');

export const MEDIA_UNSUPPORTED_TEXT = '目前只支持文本。直接发需求或 TAPD 链接即可创建任务。';
