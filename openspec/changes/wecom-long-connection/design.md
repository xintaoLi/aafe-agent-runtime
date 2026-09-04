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
staged on one stream: the classification result, then the routing outcome.
`正在理解分析中…` is only sent when the classification loses a 150ms race,
because most messages are classified in under 2ms and two frames in the same
millisecond just flash. Stage refreshes go out blocking, unlike the animation
frames, because a dropped stage would leave the user reading the wrong state.

Classification is rules-first, and that ordering is the whole latency story.
Cursor has no HTTP inference channel: `api.cursor.com` exposes only `/v1/agents`
(cloud agents, which need a repo and boot a VM), `/v1/me`, `/v1/models` and
`/v1/repositories`, and `api2.cursor.sh` is the binary's own internal protocol.
So the Cursor path is a local agent run, and it is slow for structural reasons
rather than fixable ones: measured on this repo, `Agent.create` costs 3s while
each subsequent `agent.send` still costs 4–11s, so keeping a warm classifier
agent buys nothing — the cost is the agent turn, not process boot. `grok-4.6`
spends ~13s on a one-line label, `gemini-3.8-flash` ~8s at higher confidence,
and `gpt-5.4-nano` still needs 5.5s and got the label wrong. Replaying this
bot's real message log showed the model earning nothing on 5 of 6 messages.

The keyword layer therefore answers first and the model is the exception. TAPD
pastes, a leading code or analysis verb, plain questions, and text that adds to
the speaker's only open task resolve in ~1ms. Only text with no such signal
reaches a model: an OpenAI-compatible endpoint (`intent.endpoint` +
`intent.model` via the shared `LlmClient`) when configured — that wire format is
just what nearly every gateway speaks, including local runtimes — otherwise a
single `Agent.prompt` in `plan` mode on the Cursor key the bot already holds,
run in an empty scratch directory under the system temp dir because
classification reads nothing and indexing a workspace would only cost time.
The classifier model is deliberately not the task model. Underneath everything
sits the same keyword classifier as a fallback, so a failure, timeout, or
unparsable answer costs latency but never correctness.

Classification decides how far the bot goes before asking anything. Only `code`
work with no configured workspace asks for a repository; `analysis`, `question`
and `followup` start immediately in the bot runtime directory, which is a
checkout too. When the question is asked, the classification travels with the
pending entry and is reused for the answer rather than paid for twice.

Which model runs a stage is a rule table in `models.rules`, and the shipped
behaviour is four default rules in that same table rather than branches in
code: `intent-classify` (stage `intent`) → the fast model, `complex-code`
(regex over 架构/重构/性能/…) → the reasoning model, `simple-analysis` (intent
`analysis`/`question`) → the fast model, `code-work` (intent `code`) → the
reasoning model, then the configured default. Order is priority, which is why
`complex-code` sits above `simple-analysis`: "分析一下架构" is analysis by intent
but needs the reasoning model. Project rules are evaluated before the defaults
and replace a default in place when they reuse its id.

The chosen model is pinned on the task at creation (`task.model`, persisted by
`TaskStore`) and re-applied by `runtimeOptionsFromWorkspace` on every later
run, so resume and follow-ups cannot switch models inside one agent session.
Tasks written before this existed have no `model` and fall back to the
manager's runtime default.

Rules are validated before they are trusted, in two tiers. Structure — unique
id, model present, known stage and intent kinds, compilable regexes,
confidence in 0..1 — is checked wherever rules are loaded, and a failing rule
is dropped with a logged error rather than taking the bot down. Model names
cannot be checked structurally, so they are matched against the account's own
`Cursor.models.list`: once at boot, advisory, so a network failure leaves the
rules standing on structure alone, and on demand through
`aafe wecom --check-models`, which prints the effective table, reports rejected
rules, exits non-zero, and can dry-run a probe against every stage and intent
kind without spending a model call.

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
