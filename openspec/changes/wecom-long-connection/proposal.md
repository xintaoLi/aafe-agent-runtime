<!--
  Tencent is pleased to support the open source community by making
  蓝鲸智云PaaS平台 (BlueKing PaaS) available.
  Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
  蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
  License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
  ---------------------------------------------------
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of
  the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
  CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  IN THE SOFTWARE.
-->

# Proposal: WeCom long-connection bot

## Why

AAFE already owns isolated Cursor Cloud tasks. WeCom users need an intranet-friendly
entry that does not expose a public webhook URL. The official intelligent-robot
long-connection API lets a resident process subscribe with BotID and Secret, ACK a
Task ID immediately, and push completion later.

## What Changes

Add a resident WeCom bot under `ai-bots/wecom` that:

- connects to `wss://openws.work.weixin.qq.com` via `@wecom/aibot-node-sdk`
- parses `@AAFE` commands and calls `TaskManager` only
- ACKs with a Task ID through stream reply, then starts the task in the background
- notifies the same conversation through `aibot_send_msg` when the task ends
- recovers unfinished Cloud runs on process start
