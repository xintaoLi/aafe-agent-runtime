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
then `finish=false`. The same stream id refreshes (WeCom replaces content) from
an Agent UI state: Stream is content (thinking / progress / result) and the
Template Card is control (terminate). Status labels follow the protocol
(准备任务, ⌛ 思考中, ⚙️ 执行中, ✅ 已完成, ⏹ 正在终止, ⛔ 已终止, ❌ 执行失败).
Thinking defaults to the last three progress summaries, older steps sit behind
▼ 查看完整思考过程, and a finished view collapses thinking to
「已完成 N 个分析步骤」 plus a separate ✅ 最终结论. Raw chain-of-thought is
not shown; tool calls become summaries such as 正在读取文件. A cancel click
first paints ⏹ 正在终止, then ⛔ 已终止 with the steps that did run.
Assistant drafts are not dumped into the process window. A finished view
without 最终结论 is synthesised from status/error so a hung Agent cannot leave
a dead "仍在后台运行" as the last word. After the stream TTL, push keepalives
continue even when the Agent is silent; a stall timeout then concludes and
cancels rather than freezing.
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

The SDK does support a combined message, `stream_with_template_card`, so the
终止 button lives on a Template Card under the running bubble rather than as
markdown in the stream. Stream text cannot be a callback. If classification
already opened the stream, or the combo is rejected, the same buttons are sent
as a standalone card. WeCom markdown cannot host a callback link, so the
footer only names the copyable `终止 <TaskID>` command. WeCom accepts the card
only once per message, so the combo is attached on the opening frame. A click
arrives as `event.template_card_event`: the bot updates the card within 5
seconds using the callback `task_id`, then calls `TaskManager.cancel`. Sending
`终止` without an id still cancels the speaker's only open task.

Agent startup is five events the user cannot act on — queued, scheduled, agent
created or resumed, run bound — and listing them under `过程` made booting look
like the work. They now only move the one-line status, which reads `准备任务`
then `⌛ 思考中` until the first tool call moves it to `⚙️ 执行中`; the process
list is reserved for tool steps and for events worth acting on (a queued
follow-up, a block, a failure).

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
pastes, a leading code or analysis verb, plain questions, text that opens
with a follow-up word while a task is active, and any message that quotes
another while a task is active resolve in ~1ms. A verb also counts
after a pasted link, since stating the request under the link is how people
actually write it and the parser collapses that newline; it does not count
mid-message, or `再帮我看看` would stop being an addendum.

The fast path used to end with "an open task plus unrecognised text means
addendum", which was wrong in the way that matters: it is a default dressed as
a signal. With one task left stuck in `running`, everything the user typed for
the next day — `我想下班`, `夏天会下雪真好`, a PR analysis request — became a
follow-up to a TAPD story, re-ran it, and reported that story's requirement
back as the answer. Weak input is now exactly what it looks like: weak, and
the model's call. Only text with no such signal reaches a model: an OpenAI-compatible endpoint (`intent.endpoint` +
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

Not every message is work. `classifyFreeform` separates an explicit request for
the manual (`帮助` / `help` / `菜单`) from a greeting, an identity question, or
gibberish, which used to share one regex and all produced the command list —
that is what made the bot feel like a vending machine. Thanks, praise, casual remarks and farewells go to `smalltalk.js`, twenty lines
in four groups picked at random: the reply carries no information, so a model
would buy nothing but latency and tokens, while a single canned line per case
would read as a robot. These patterns are anchored to the whole message,
because unanchored ones would swallow "天气组件不对" and "谢谢按钮点击没反应".
Greetings, identity questions and junk are answered from `help.js` in under a
millisecond, because
the bot knows its own job better than a model does and these are the messages
where latency is most obvious. Everything else that is not work goes through
classification, and a `question` with `needs_code: false` is answered directly
by `chat.js` (~4.5s warm, ~14s on the first call of a process) instead of
becoming a task; if that backend is unavailable the turn falls back to creating
one. The full manual is sent on first `enter_chat` per user and never again.

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
text is `help` / `ack` / new-work / follow-up / generic work. In a group,
`chatid::userid` keys pending workspace prompts so one member cannot answer
another's ask.

Before any of that routing runs, the message is anchored: `context.js` answers
"which task is this about?" and everything downstream follows from the answer.
The order is by strength of evidence — a Task ID in the text, then a quoted
message, then the speaker's last active task — because those are three
different degrees of the user having said what they meant. The first two may
reach a finished task; the implicit one sees live work only.

Following a quote has to be done by reading it. `body.quote` is a content
snapshot — `msgtype` plus `text`/`mixed`/`voice`/`image` — and carries no msgid,
so there is nothing to look up. What makes it work anyway is that the bot
prints `对话 ID：` with the Task ID in the footer of every task reply, so
quoting one of its messages yields the id verbatim, matched with a pattern
anchored to the generated shape (`task-` + 14 digits + 8 hex) rather than the
loose id the command parser accepts, which would match ordinary words in free
text. Quoting one's own original requirement carries no id, so the fallback is
a task whose requirement the quote contains in full; a partial overlap is a
coincidence and is ignored, leaving the message to ordinary routing.

An anchor outranks wording. Quoting a task and then typing something that
sounds like new work is not a contradiction to resolve — the quote is the more
deliberate act, and `做：<需求>` is how you start something separate while
pointing at an old task.

Only unfinished work can be anchored implicitly. A finished task used to
qualify while it was the most recently touched one, on the theory that "I just
watched it finish, let me add one more thing" — but with no time bound, a story
completed yesterday kept claiming today's messages, and each claim re-ran it
and refreshed its timestamp, so it stayed the freshest candidate. A finished
task is now out of the running unless referenced; when nothing is live, the bot
volunteers the last one's ID so resuming costs one copied line.

Weak input goes to the last active task rather than triggering a question. The
previous round asked instead, which was safe and tiring: in a running
conversation an addendum is what a plain reply almost always is, and the ask
spent a turn on it every time. What makes the guess acceptable is that the
reply names the task it went to and how to retarget it, so a wrong guess costs
one message instead of surfacing inside the agent's report. Two other things
have to hold for that trade to work, and both do: zombie `running` tasks are
collapsed at startup, so "active" means active, and finished tasks are no
longer candidates.

In a group, only the speaker's own tasks are anchored implicitly, so two
members' work cannot merge. A bystander can still contribute, but only through
a reference — a quote or a Task ID — and the contribution is recorded as
theirs: `TaskManager.#continue` takes an `author`, stamps it on the
conversation message, accumulates `context.participants`, and prefixes the
merged follow-up prompt with who wrote it and who owns the task. Without that
prefix a bystander's aside reads as the owner rewriting the requirement, and
the agent reprioritises the whole task around a side remark. The role is
derived from the task's own source rather than taken from the caller, so a
bystander cannot be promoted by mislabelling them.

WeCom only pushes group messages that mention the bot, so the in-process @
check is a second line of defence: it logs by default and enforces only under
`requireGroupMention`, because a mixed message can carry the mention outside
the text items and dropping a real request is worse than handling a stray one.

Recovery is the other half of the same bug. A local run only exists inside the
process that started it, so after Ctrl-C the server-side run is still labelled
`running` and `recover` reattached by streaming it — a stream that never yields
again. The task sat in `running` forever, which is what kept "there is an open
task" true and fed the routing bug above. Local runs are now treated as gone on
restart: the task is parked in a terminal state with an interrupted reason
instead of hanging, and it is not re-run unasked, because restarting yesterday's
requirement on boot is work nobody ordered. Cloud runs still reattach, and a run
that finished while the process was away is still collected.

Credentials stay in `WECOM_BOT_ID` and `WECOM_BOT_SECRET`. The published
`@aafe/agent-runtime` package does not take a hard dependency on the WeCom SDK.

`repo.githubAccessToken` is not consumed by `git` or by a local Cursor Agent on
its own. WeCom may overlay `wecom.local.json` → `repo` (or
`AAFE_WECOM_GITHUB_TOKEN`). If that overlay is empty, TaskManager degrades to
the current AAFE process `.aafe.config.json`, then to the task workspace
project config (install cwd, because the file is typically gitignored and a
worktree will not have a copy). The chosen token is injected as
`GITHUB_TOKEN` / `GH_TOKEN` plus `http.https://github.com/.extraheader` via
`GIT_CONFIG_*`. Cloud runs get the token env vars without the git-config keys.
The token is never written into the prompt or remote URL.

Local analysis logs are opt-in. `createWeComLogger` writes daily JSONL under
`ai-bots/wecom/logs/` only when `WECOM_LOG` or `log.enabled` is on. Console
behavior stays unchanged. Secrets (`secret`, `apiKey`, tokens) are redacted.

Media uses the official SDK: `downloadFile(url, aeskey)` for inbound
image/file/video (and mixed image items), voice transcript as text, then the
existing intent/resolver path. Uploads go through `uploadMedia`; replies use
`replyMedia` / `sendMediaMessage`. Saved files live under `.aafe/wecom-media/`.
