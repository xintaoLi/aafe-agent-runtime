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

# Design: WeCom long-connection bot

The bot is a resident process, not `aafe task`. `aafe task` closes `TaskManager`
when the command ends. The WeCom process calls `initialize()` on start and only
closes the runtime on SIGINT/SIGTERM or after being kicked.

Protocol transport is `@wecom/aibot-node-sdk`. This repo does not implement raw
WebSocket frames, webhook verification, or EncodingAESKey decrypt.

Immediate ACK uses `replyStream` with the callback `req_id` and a new `stream.id`,
then `finish=true`. Cloud execution is never awaited inside that stream. Completion
uses `sendMessage` (`aibot_send_msg`) to the conversation recorded on `task.source`.

Gateway never calls `Agent.create`. It only uses `TaskManager.create / start /
continue / cancel / get / list / subscribe / initialize`.

Inbound text is classified without an LLM. Explicit commands win. Remaining
text is `help` / `ack` / new-work / follow-up / generic work. Session binding
uses unfinished tasks in the current conversation: one task absorbs follow-up
and generic work; TAPD / `【标题】` / work verbs always create; two or more
open tasks still require an explicit Task ID.

Credentials stay in `WECOM_BOT_ID` and `WECOM_BOT_SECRET`. The published
`@aafe/agent-runtime` package does not take a hard dependency on the WeCom SDK.
