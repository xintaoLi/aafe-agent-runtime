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
then `finish=false`. The same stream id refreshes (WeCom replaces content) with a
Cursor-like compact view: last 3–5 tool/status lines, older steps collapsed,
and a one-line current activity. Assistant drafts are not dumped into the
process window; the final summary is a separate result block on finish.
Intermediate frames use `replyStreamNonBlocking` so a slow ack does not queue
token-level updates. The stream is finished on terminal status.
`sendMessage` (`aibot_send_msg`) is the fallback when no live stream exists.

Gateway never calls `Agent.create`. It only uses `TaskManager.create / start /
continue / cancel / get / list / subscribe / initialize`.

A local Cursor Agent belongs to the store of the cwd it was created in, so
`Agent.resume`, `Agent.getRun` and `Agent.cancelRun` all pass that workspace
cwd again; the task's own `workspace.cwd` is the source, not the bot process
cwd. When the Agent is gone anyway, the runtime creates a replacement and
replays the durable AAFE context instead of failing the task, because task
state and conversation live in `.aafe/tasks/<id>/`, not in the Agent.

WeCom long-connection does not support stream-plus-card combo messages, so a
terminate button cannot live in the running bubble. Terminating is therefore a
copyable `终止 <TaskID>` line at the bottom of the running view itself, next to
the conversation id; no separate card is sent. Cards remain only for workspace
picking. Clicks on terminate cards sent before this change still arrive as
`event.template_card_event`: the bot updates the card within 5 seconds using
the callback `task_id`, then calls `TaskManager.cancel`. Sending `终止` without
an id still cancels the speaker's only open task.

Each WeCom callback has exactly one response command: a message callback takes
`aibot_respond_msg` (stream), `enter_chat` takes `aibot_respond_welcome_msg`,
and a card click takes `aibot_respond_update_msg`. Answering a card click with
a stream reply fails with errcode 846605 (`invalid req_id`), so card clicks
only update the card and push any text with `aibot_send_msg`. A task created
from a card click therefore has no live stream and reports through the terminal
notify. The click payload itself is nested under `event.template_card_event`,
not on the event envelope. Every gateway handler runs behind a catch, because
an unhandled rejection would take the bot process down.

A task carries the error of its latest attempt only. Starting a run clears the
stored error and a successful finish writes `null`, so a retry that worked no
longer reports the previous failure; the notify view also suppresses errors on
`completed` for tasks persisted before that fix.

Free-form input is classified before the bot decides anything. The turn is
staged on one stream: `正在理解分析中…` goes out before the classifier is even
called, the classification result replaces it, and the routing outcome replaces
that. Stage refreshes go out blocking, unlike the animation frames, because a
dropped stage would leave the user reading the wrong state.

The classifier has three layers and always answers. An OpenAI-compatible
endpoint (`intent.endpoint` + `intent.model`, via the shared `LlmClient`) is
used when configured. Otherwise the Cursor key the bot already holds drives a
single `Agent.prompt` in `plan` mode; that runs in an empty scratch directory
under the system temp dir, because classification reads nothing and indexing a
workspace would only cost time. Measured latency of that path is roughly 7–14
seconds, which is why the acknowledgement is sent first. Underneath both sits a
keyword classifier that takes over on failure, timeout, or an unparsable
answer, so the model is never on the critical path for correctness. Control
words and answers to a pending question skip classification entirely: a stop
must not wait on a model.

Classification decides how far the bot goes before asking anything. Only `code`
work with no configured workspace asks for a repository; `analysis`, `question`
and `followup` start immediately in the bot runtime directory, which is a
checkout too. When the question is asked, the classification travels with the
pending entry and is reused for the answer rather than paid for twice.

Code tasks carry `task.workspace`. Configured `workspaces[]` / `repository`
are used immediately. Otherwise the conversation waits for `本地`, a local
path, or a remote git URL. Runtime `cwd`/`repository`/`mode` come from that
workspace so local dirs stay local and remotes follow AAFE git / Cloud clone.

`切换 <id>` and workspace cards change the conversation's current workspace
and persist `currentWorkspace` to the local JSON when possible.

Inbound text is classified without an LLM. Explicit commands win. Remaining
text is `help` / `ack` / new-work / follow-up / generic work. Session binding
is owner-scoped: unfinished tasks owned by the speaker in the current
conversation absorb follow-up and generic work. In a group, `chatid::userid`
keys pending workspace prompts so one member cannot answer another's ask.
TAPD / `【标题】` / work verbs always create; two or more of the speaker's
open tasks still require an explicit Task ID. Explicit `继续 <TaskID>` in
the same group may continue another member's task.

Credentials stay in `WECOM_BOT_ID` and `WECOM_BOT_SECRET`. The published
`@aafe/agent-runtime` package does not take a hard dependency on the WeCom SDK.

Local analysis logs are opt-in. `createWeComLogger` writes daily JSONL under
`ai-bots/wecom/logs/` only when `WECOM_LOG` or `log.enabled` is on. Console
behavior stays unchanged. Secrets (`secret`, `apiKey`, tokens) are redacted.

Media uses the official SDK: `downloadFile(url, aeskey)` for inbound
image/file/video (and mixed image items), voice transcript as text, then the
existing intent/resolver path. Uploads go through `uploadMedia`; replies use
`replyMedia` / `sendMediaMessage`. Saved files live under `.aafe/wecom-media/`.
