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

# Delta for WeCom Bot

## ADDED Requirements

### Requirement: Long-connection subscribe
The bot MUST connect with BotID and Secret over the official WeCom long-connection
channel and MUST NOT require a public webhook URL.

#### Scenario: Authenticated resident process
- GIVEN valid WECOM_BOT_ID and WECOM_BOT_SECRET
- WHEN the bot process starts
- THEN it subscribes once and keeps a single active connection with heartbeat

### Requirement: Immediate task ACK
A create command MUST acknowledge a Task ID through stream reply before Cloud
execution finishes, and MUST keep that stream open for progress updates.

#### Scenario: Create command
- GIVEN a text message `做：增加手机号搜索`
- WHEN the bot handles the message
- THEN it creates a TaskManager task, replies the Task ID with finish=false, and starts the task asynchronously

### Requirement: Explicit continue
Continue with an explicit Task ID MUST target that task if it belongs to
the same conversation or the same owner. Implicit continue MUST bind only
to the speaker's own tasks in the current conversation. In a group chat,
another member's follow-up MUST NOT continue a task they do not own unless
they reference it, by quoting one of its messages or including its Task ID.
When the speaker has no unfinished task, the bot MUST say so and name what
can be referenced instead of continuing something at random.

#### Scenario: Continue without id and multiple open tasks
- GIVEN a conversation that already has two unfinished tasks
- WHEN the user sends `继续`
- THEN the bot asks for a Task ID and does not create or continue a task

#### Scenario: Continue without id and one open task
- GIVEN a conversation that has exactly one unfinished task T001
- WHEN the user sends `继续`
- THEN the bot asks for supplement text using T001 and does not create a task

#### Scenario: Group implicit continue stays on the speaker
- GIVEN group chat G where user A owns running task T-A and user B owns none
- WHEN user B sends `@Bot 加上单测`
- THEN the bot does not continue T-A and tells B to quote that task's message or include its Task ID

#### Scenario: Group explicit continue can target another member's task
- GIVEN group chat G where user A owns running task T-A
- WHEN user B sends `继续 T-A：补测试`
- THEN the bot continues T-A and appends B's supplement to that task context
- AND records B as a participant, not as the task's author

### Requirement: Implicit intent routing
Unprefixed text MUST be classified before ACK. TAPD links and new-work
signals MUST create a task. Follow-up text MUST continue the only open
task owned by the speaker in the current conversation. Greetings MUST stay on help.

A new-work verb MUST be recognised when it opens the message and when it
follows a pasted link, because stating the request under the link is a common
shape. It MUST NOT be recognised anywhere in the message, so that `再帮我看看`
stays an addendum.

Only unfinished work MAY absorb an implicit follow-up. A task that has
completed, failed or been cancelled MUST NOT be continued unless it is
referenced, however recently it was touched. When neither the wording nor the
classifier commits to a side, the message MUST go to the speaker's last active
task, and the reply MUST name that task together with the way to retarget it.
With nothing unfinished, weak input MUST create its own task, and an explicit
`继续` MUST name the last finished task so it can be resumed by copying one
line.

#### Scenario: TAPD paste creates a task
- GIVEN no unfinished task in the conversation
- WHEN the user sends a TAPD story title and URL without `做：`
- THEN the bot creates a TaskManager task, replies the Task ID, and starts it asynchronously

#### Scenario: Follow-up continues the only open task
- GIVEN the conversation has exactly one unfinished task
- WHEN the user sends `加上单测`
- THEN the bot continues that task and does not create a new one

#### Scenario: A finished task does not absorb a later message
- GIVEN a stale running task T-old and a just-completed task T-new in the same conversation
- WHEN the user sends text without a Task ID and without a follow-up word
- THEN the bot appends it to T-old, not to the more recently touched T-new
- AND the reply says which task it went to and how to retarget it
- AND `继续 T-new：<补充>` still resumes T-new

#### Scenario: Explicit continue names the last finished task
- GIVEN the speaker has no unfinished task and one completed task T-done
- WHEN the user sends `继续：加上单测`
- THEN the bot answers with `继续 T-done：<补充>` instead of a dead end

#### Scenario: The request may follow a pasted link
- WHEN the user sends a PR URL and `分析一下这个 PR是否会产生副作用` on the next line
- THEN the bot creates a task for it even while another task is open

#### Scenario: Continue while the target is still running
- GIVEN task T001 is already running
- WHEN the user continues T001 with supplement text
- THEN the bot acknowledges the follow-up, keeps T001 running, and starts the supplement as the next Run after the current scheduler slot finishes

#### Scenario: New TAPD during an open task
- GIVEN the conversation has one unfinished task
- WHEN the user pastes another TAPD URL
- THEN the bot creates a new task instead of continuing the old one

### Requirement: A message is anchored to a task before it is routed
Every free-form message MUST be resolved to a task, or to none, before the bot
decides what to do with it, and the anchor MUST be chosen by strength of
evidence: a Task ID in the text, then the tail of one, then a quoted message,
then the speaker's last active task. A referenced task MAY be finished; the
implicit anchor MUST see unfinished work only. The anchor MUST carry the
evidence that produced it — how it was found and how far it is worth trusting —
into the turn's log, so a wrong target is explainable without replaying the
conversation.

The 8-hex tail of a Task ID is what people retype after reading a footer, and
it MUST count as a reference while exactly one task ends in it. An all-digit run
MUST NOT, because a date is indistinguishable from one, and a tail shared by two
tasks MUST fall through to the remaining evidence rather than pick by coin flip.

Naming two tasks in one message is as deliberate as naming one, and a tail
shared by two tasks is not the same thing as two tails naming two tasks. Where a
message references more than one task the bot MUST run the instruction against
neither: one instruction cannot drive two branches, and picking either would
apply it to a branch the user did not mean. It MUST name what it found and ask
for the messages to be sent separately.

WeCom delivers a quote as a content snapshot without the quoted message's id,
so a quote MUST be followed by reading its text: the Task ID the bot prints in
every task reply, then a tail of one, then a task whose requirement text the
quote contains in full, and finally a task created from the same TAPD ticket,
which survives any rewording around the link. A Task ID found in a quote MUST be
resolved the same way one typed into the text is, including outside the
conversation's recent tasks: a reference must not depend on which of the two
ways the user chose to point at it. A quote that resolves to nothing MUST
degrade to ordinary routing rather than bind to a task by guess. A Task ID that
resolves to nothing MUST be reported as a miss rather than fall through to live
work.

The implicit anchor is the only one nobody confirmed, so it MUST decline in the
two cases where it would be guessing. With more than one live task owned by the
speaker and nothing choosing between them, the bot MUST list them and ask,
because an agent sent to the wrong branch is expensive to undo.

Asking is not an excuse for a bad question. The candidates MUST be ranked by how
well the message fits each one — the wording it shares with the requirement, and
how recently the task was touched — and each choice MUST carry enough of its
requirement to be told apart from the others. Where the wording clearly favours
one task, and only then, that one MAY be marked as the likely answer; marking a
near-tie would teach the user to accept whichever the bot listed first, which is
the mistake the question exists to prevent. Ranking MUST NOT decide: the bot
still asks.

With one live
task that has gone untouched beyond a staleness window (12 hours by default),
the bot MUST NOT append to it and MUST name it so resuming costs one copied
line. Neither gate applies to a message that is new work in its own right, nor
to any referenced anchor, however long the task has been quiet.

Instructions that cannot be taken back MUST be held to a higher bar than ones
that can. Appending a sentence to yesterday's task is corrected by sending
another sentence; pushing a branch, opening a PR or writing back to TAPD against
the wrong task is not. So a submit instruction MUST claim a task implicitly only
while that task is still visibly warm — a much shorter window than an ordinary
follow-up gets — and MUST otherwise ask to be pointed at one, saying why.

An anchor MUST outrank wording: naming or quoting a task is deliberate, and
starting separate work is what `做：<需求>` is for.

In a group chat only the speaker's own tasks MAY be anchored implicitly, so two
members' work cannot merge. A non-owner MUST be able to contribute through an
explicit anchor, and that contribution MUST be recorded as a participant's,
with the task's author kept as its owner; the merged follow-up prompt MUST say
so, so a bystander's remark does not read as the owner changing the
requirement. Group messages that do not mention the bot MUST be logged as
dropped, and MAY be refused outright under configuration.

#### Scenario: Quoting a finished task revives it
- GIVEN completed task T-done and running task T-live owned by the speaker
- WHEN the user quotes a T-done reply and sends `这里还要加上单测`
- THEN the bot continues T-done, not T-live

#### Scenario: Quoting the original requirement finds the task
- GIVEN task T-x created from `【日志检索结果复制按钮失效】`
- WHEN the user quotes that requirement message and adds a supplement
- THEN the bot continues T-x and says it matched by the quoted content

#### Scenario: An unrelated quote changes nothing
- GIVEN running task T-live owned by the speaker
- WHEN the user quotes a colleague's unrelated sentence and adds a supplement
- THEN the bot routes as if nothing was quoted and appends to T-live

#### Scenario: A mistyped Task ID is reported
- WHEN the user sends a Task ID that does not exist plus a supplement
- THEN the bot answers `找不到任务 <id>` and continues nothing

#### Scenario: The tail of an id is enough
- GIVEN one task in the conversation ending in `cccc3333`
- WHEN the user sends `#cccc3333 这里还要加上单测`
- THEN the bot continues that task and says it matched by the id's tail
- AND with two tasks ending in `cccc3333` the tail is ignored instead

#### Scenario: One message cannot drive two tasks
- GIVEN live tasks T-a and T-b
- WHEN the user sends both ids with `都提 PR`
- THEN the bot runs neither, names both, and asks for them to be sent separately
- AND repeating one id in a message is still a single reference

#### Scenario: The question names the likely task first
- GIVEN live tasks `修复登录接口 timeout` and `首页性能优化`
- WHEN the user sends `timeout 改成 10 秒`
- THEN the bot still asks which task is meant
- AND the login task is listed first, marked as the closest match, with its requirement shown
- AND a message favouring neither is listed without any such mark

#### Scenario: A quoted id outside the recent list still resolves
- GIVEN a task that no longer appears among the conversation's recent tasks
- WHEN the user quotes one of its replies and adds a supplement
- THEN the bot resolves the quoted Task ID through lookup and continues it

#### Scenario: A quoted TAPD link finds the task it created
- GIVEN task T-x created from a TAPD story URL
- WHEN the user quotes a message carrying that same URL and adds a supplement
- THEN the bot continues T-x and says it matched by the quoted ticket

#### Scenario: Two live tasks stop the guess
- GIVEN the speaker owns two unfinished tasks in the conversation
- WHEN they send `这个也顺便处理下`, which points at neither
- THEN the bot lists both ids and asks which one, and continues nothing
- AND a TAPD paste in the same state still creates its own task

#### Scenario: A task that has gone quiet is not resumed by accident
- GIVEN the speaker's only unfinished task was last touched 30 hours ago
- WHEN they send text that points nowhere
- THEN the bot answers with `继续 <TaskID>：<补充>` instead of appending
- AND `继续 <TaskID>：<补充>` still resumes it

#### Scenario: A submit instruction will not claim a task that has gone quiet
- GIVEN the speaker's only unfinished task was last touched three hours ago
- WHEN they send `提 PR`
- THEN the bot says submit actions do not claim old tasks, names it, and asks for `继续 <TaskID>：<指令>`
- AND an ordinary supplement to that same task still appends without asking
- AND the same `提 PR` against a task touched minutes ago appends without asking

#### Scenario: A group bystander contributes by quoting
- GIVEN group chat G where user A owns running task T-A
- WHEN user B quotes a T-A message and sends `这里还要考虑灰度`
- THEN the bot appends it to T-A, records B as a participant of A's task, and says so in the reply

### Requirement: Staged intent analysis before routing
Free-form input MUST be classified before the bot decides what to do with it,
and the user MUST see the stages on one stream: the classification result and
then the routing outcome. `正在理解分析中…` MUST be sent first whenever the
classification does not resolve within a short grace period, and MUST be
skipped when it resolves instantly so the user is not shown an unreadable
flash. Classification MUST cover text, links, and attachments alike.

Unmistakable input MUST be classified without a model: TAPD pastes and
bracketed defect titles, a leading code or analysis verb, plain questions, text
opening with a follow-up word while the speaker has an active task, and any
message that quotes another while the speaker has an active task. What was
quoted MUST be given to the model as context when one is called. An open
task alone MUST NOT make unrecognised text an addendum; without a follow-up
word the signal is weak by definition and belongs to the model. Control words (`状态` / `终止` / `列表` / `帮助` /
`仓库`), digits-only junk, and answers to a pending question MUST also stay off
the model path, so a stop is never delayed by a round trip.

A Task ID, whether typed into the message or sitting in the footer of what was
quoted, MUST resolve without a model and regardless of whether anything is
running: it is the strongest reference the bot has, and nothing a model could
say would improve on a target the user wrote down.

Ship instructions — commit, PR, merge, push, TAPD backfill, rerun the tests —
MUST classify as follow-up rather than as new work, because read as new work
they create a task whose requirement is literally `提交 PR`. A message that is
nothing but the instruction MUST resolve this way wherever it lands, including
with nothing running, where the reply says there is nothing to submit. The same
verb mid-sentence MUST require live work or a quote behind it, so
`购物车合并逻辑有问题` is still routed as the defect report it is.

Classification MUST NOT be able to break a turn: on failure, timeout, an
unparsable answer, or a throwing classifier the bot MUST fall back to keyword
routing and continue.

#### Scenario: Unmistakable input skips the model
- WHEN the user pastes a TAPD story title and URL
- THEN the bot classifies it as code work without calling a model
- AND the reply goes out in the same turn

#### Scenario: A worded addendum skips the model
- GIVEN the speaker has exactly one open task
- WHEN the user sends `再补充一点：加上单测`
- THEN the bot treats it as a follow-up without calling a model

#### Scenario: A quote skips the model
- GIVEN the speaker has an active task
- WHEN the user quotes one of its messages and sends `这个也要`
- THEN the bot treats it as a follow-up without calling a model

#### Scenario: A named task skips the model even when it has finished
- GIVEN the speaker has no unfinished task
- WHEN they quote a completed task's reply and send `提交 PR 回填`
- THEN the bot classifies it as a follow-up without calling a model and resumes that task

#### Scenario: A ship instruction with nothing to ship
- GIVEN the conversation has no task at all
- WHEN the user sends `提交 PR 回填`
- THEN the bot says there is nothing to continue and creates no task

#### Scenario: A ship verb mid-sentence is not an instruction
- GIVEN the speaker has no unfinished task
- WHEN they send `购物车合并逻辑有问题`
- THEN the fast path declines to classify it and the model decides

#### Scenario: An open task does not make every sentence an addendum
- GIVEN the speaker has exactly one open task
- WHEN the user sends `我想下班`
- THEN the fast path declines to classify it and the model decides

#### Scenario: Ambiguous new work waits for the model
- GIVEN no open task and text with no leading verb
- WHEN the user sends `登录页按钮颜色需要改成品牌色`
- THEN the bot refreshes the stream with `正在理解分析中…`
- AND then refreshes the same stream with the classification result
- AND finally refreshes it with the routing outcome

#### Scenario: Digits alone are not a requirement
- WHEN the user sends `1233`
- THEN the bot answers with help, creates no task, and calls no model

#### Scenario: Classification failure keeps the turn alive
- GIVEN the configured backend is unreachable
- WHEN the user sends a requirement
- THEN the bot routes by keyword rules, records the fallback reason, and still creates the task

#### Scenario: Control words skip classification
- WHEN the user sends `列表`
- THEN the bot answers without calling the analyzer

#### Scenario: Attachment carries into classification
- WHEN the user sends an image with a caption
- THEN the attachment type and filename are part of the classification input

### Requirement: The bot converses instead of reciting its manual
The full command list MUST be sent on first contact with a user and whenever
someone explicitly asks for it (`帮助` / `help` / `菜单` / `怎么用`). Re-entering
the conversation MUST NOT repeat it.

Chit-chat — thanks, praise, casual remarks, farewells — MUST be answered from a
local reply pool of at least 20 lines picked at random, without calling a model
and without creating a task. Chit-chat patterns MUST match the whole message
only, so a requirement or defect that happens to contain one of these words is
still routed as work. Acknowledging with nothing in flight MUST also answer
from the pool rather than printing the manual.

A greeting, an identity question, or unreadable input MUST get a real reply and
MUST NOT create a task. These are answered from local text rather than a model:
the bot already knows what it is, and a model round trip would make the
cheapest messages the slowest. A greeting SHOULD report what is currently in
flight.

An open question that needs no repository MUST be answered in the same turn
through the `chat` stage model, without creating a task, a branch or a task
record. A question that needs the repository MUST still become a task, and when
the chat backend is unavailable the turn MUST fall back to creating one.

#### Scenario: Chit-chat costs nothing
- WHEN a user sends 你好厉害 or 今天天气不错
- THEN a random line from the local pool is returned with no model call
- AND repeating the message does not always return the same line

#### Scenario: A defect containing a chit-chat word is still a defect
- WHEN a user sends 天气组件不对，改一下
- THEN the message is routed as work, not as chit-chat

#### Scenario: Greeting is answered, not answered with a manual
- WHEN a user sends 你好
- THEN the bot replies conversationally, mentions any open task, creates nothing

#### Scenario: Identity question is answered from what the bot knows
- WHEN a user sends 你是谁
- THEN the bot describes its own job without calling a model

#### Scenario: Manual appears once
- WHEN the same user opens the conversation twice
- THEN the first entry gets the command list and the second gets one short line

#### Scenario: Open question is answered in place
- GIVEN classification returns kind `question` with `needs_code` false
- WHEN the chat backend answers
- THEN the answer is streamed into the same message and no task exists

#### Scenario: Repository question still becomes a task
- GIVEN classification returns kind `question` with `needs_code` true
- THEN a task is created as before

### Requirement: Model selection is a validated rule table
Which model runs a stage MUST be decided by an ordered rule table, not by
branches in code, and the shipped behaviour MUST be expressed as default rules
in that same table. A rule MAY match on stage (`intent` / `task`), intent kind,
a regex over the text and attachment names, a negative regex, and a minimum
confidence. The first matching rule wins; with no match the configured default
applies. Project rules MUST be evaluated before the defaults, and a project
rule reusing a default rule's id MUST replace it in place.

The model MUST be pinned on the task when it is created and reused by every
later run of that task, so a follow-up cannot switch models mid-conversation.
Tasks created before model routing MUST keep working on the runtime default.

A rule MUST be validated before it is trusted. Structural validation covers a
unique non-empty id, a model name, a known stage, known intent kinds,
compilable regexes, and a confidence within 0..1. A rule that fails MUST be
dropped with a logged error, never crash the bot. Model names MUST also be
checked against the account's own model list: once at boot as an advisory
check, and on demand through `aafe wecom --check-models`, which MUST exit
non-zero when any rule is invalid and MUST be able to dry-run a sample message
against the table without calling a model.

#### Scenario: Classification takes the fast model
- WHEN any text is classified
- THEN the `intent` stage rule selects `gemini-3.8-flash`

#### Scenario: Architecture work takes the reasoning model
- WHEN the requirement mentions 架构 and the intent is analysis
- THEN `complex-code` wins over `simple-analysis` and selects `grok-4.6`

#### Scenario: A project rule overrides a default
- GIVEN a project rule matching `样式` with a different model
- WHEN a code task mentions 样式
- THEN that rule wins over the built-in code rule

#### Scenario: An invalid rule is dropped, not fatal
- GIVEN a rule whose regex does not compile
- WHEN the bot starts
- THEN the rule is dropped with a logged error and the remaining rules route

#### Scenario: A fake model name is caught before a task runs
- GIVEN a rule naming a model the account cannot run
- WHEN the bot boots and the model list is reachable
- THEN the rule is dropped with a logged error

#### Scenario: Validation command gates a new rule
- WHEN `aafe wecom --check-models --probe="<text>"` runs
- THEN it prints the effective table, rejects invalid rules, exits non-zero
- AND shows the model each stage and intent kind would pick for the probe

### Requirement: Repository is only asked for code work
The repository question MUST be limited to tasks classified as code work with
no workspace configured. Analysis and Q&A MUST start immediately in the bot
runtime directory. When the question is asked, the classification MUST be kept
with the pending question and reused for the answer instead of reclassifying.

#### Scenario: Analysis starts without a repository question
- GIVEN the bot has no workspaces and no repository
- WHEN the user sends an analysis request
- THEN the bot creates the task on the bot runtime directory and starts it

#### Scenario: Code work still asks
- GIVEN the bot has no workspaces and no repository
- WHEN the user sends a fix request
- THEN the bot asks for a workspace and stores the classification with the pending question

#### Scenario: Answer reuses the stored classification
- GIVEN a pending workspace question that stored a code classification
- WHEN the user answers `本地`
- THEN the bot creates the task without classifying again

### Requirement: An interrupted run does not stay running
A local Cursor run exists only inside the process that started it, so a run
still marked running after a restart MUST be treated as gone rather than
reattached. Reattaching MUST NOT be attempted by streaming it, because that
stream never ends and leaves the task in `running` forever, where it keeps
counting as live work and shadows every later message.

Such a task MUST be parked in a terminal state carrying an interrupted reason,
and MUST NOT be re-run unasked: restarting yesterday's requirement on boot is
work the user did not order. Parking MUST cancel the leftover Cursor run so the
Agent is free; otherwise `继续` fails with "already has active run". Resuming
it MUST take an explicit start or `继续 <TaskID>`, and that send MUST cancel or
replace a leftover active run instead of failing. A run that finished while the
process was away MUST still be collected normally, and a cloud run MUST still
be reattached.

#### Scenario: A killed local run is parked at startup
- GIVEN a task left in `running` with an agent and run id after the process was killed
- WHEN the bot starts and recovery reattaches
- THEN the task ends in a terminal state with an interrupted reason
- AND no new run is started for it
- AND it no longer counts as unfinished work for follow-up routing

#### Scenario: Parking is not losing
- GIVEN a task parked as interrupted
- WHEN the user starts it again by name
- THEN the leftover Cursor run is cancelled
- AND it runs and completes normally

#### Scenario: Continue after a leftover active run
- GIVEN an Agent that still has an active run from a hung attempt
- WHEN the user sends 继续
- THEN the leftover run is cancelled and a new run starts
- AND the task does not fail with "already has active run"

### Requirement: Live progress on the ACK stream
While a WeCom-sourced task is running, the original reply stream MUST refresh
from an Agent UI state: Stream is the content layer and the Template Card is
the control layer. Status labels MUST follow the protocol
(`准备任务` / `⌛ 思考中` / `🧠 制定方案` / `⚙️ 执行中` / `✅ 已完成` /
`⏹ 正在终止` / `⛔ 已终止` / `❌ 执行失败`). Thinking and the final result
MUST be separate sections. The thinking preview MUST show the last three
progress summaries, not raw chain-of-thought, and MUST offer ▼ 查看完整思考过程
so the rest can be opened. Tool steps in the preview MUST be summarised
(e.g. 正在读取文件) rather than dumped as model reasoning. The stream MUST
finish when the task reaches a terminal status and MUST show a `✅ 最终结论`
block instead of dumping the full transcript, except a cancelled view which
lists completed steps under `⛔ 已终止` without a result block. A finished
success, failure, stall, interrupt or process-exit view without a 最终结论 is
forbidden and MUST synthesise one when the Agent left no text.

Bringing an agent up MUST read as a single `准备任务` then `⌛ 思考中` status
rather than a list of lifecycle steps: queueing, scheduling, agent creation,
agent resume and run binding MUST move the status line only and MUST NOT be
written into the process list, which is reserved for tool steps and for events
worth acting on such as a queued follow-up, a block or a failure. While the
process list is empty the view MUST NOT add a placeholder line, because the
status already says it. Tool calls MUST move the status to `⚙️ 执行中`.

#### Scenario: Startup is one line
- GIVEN a created task whose agent has not emitted anything
- WHEN queueing, scheduling and agent resume events arrive
- THEN the view shows `准备任务` with no process list and no placeholder

#### Scenario: Progress refresh
- GIVEN an open stream for a created WeCom task
- WHEN TaskManager publishes `cursor.run.started` or `cursor.message`
- THEN the bot refreshes the same stream id with current progress and finish=false

#### Scenario: Process window collapses
- GIVEN an open stream that has recorded more than three tool or status steps
- WHEN the bot renders progress
- THEN only the latest three process summaries are visible
- AND older steps are collapsed behind ▼ 查看完整思考过程

#### Scenario: Expanded process is hierarchical
- GIVEN a transcript with several Shell calls then a Read
- WHEN the user taps 查看完整过程
- THEN the reply groups consecutive same-name tools under a parent line
- AND lists each call as a child

#### Scenario: Stream finish on completion
- GIVEN an open stream for a WeCom task
- WHEN the task reaches a terminal status
- THEN the bot refreshes the stream with a separate ✅ 最终结论 block and finish=true
- AND the thinking section collapses to 已完成 N 个分析步骤

#### Scenario: Finish without Agent text still concludes
- GIVEN a task that reaches a terminal status with no assistant summary
- WHEN the bot renders the finished view
- THEN a ✅ 最终结论 block is still present and states the outcome

#### Scenario: Failed conclusion names the error
- GIVEN a continue that fails with cursor-run-start-failed
- WHEN the bot renders the finished view
- THEN 最终结论 contains that error instead of “未返回详细原因”

#### Scenario: Cancel shows stopping then stopped
- GIVEN a running WeCom task
- WHEN the owner taps 终止
- THEN the stream first shows `⏹ 正在终止`
- AND the finished view shows `⛔ 已终止` with completed steps and no 最终结论

### Requirement: Animated title while running
A WeCom stream reply is plain markdown with no spinner element, so the loading
effect MUST come from cycling characters on the first header line. The bot MUST
cycle a four-frame dancing-animal kaomoji (index 0-3) and MUST advance it on its
own cadence so a silent Agent step still animates. The frame MUST disappear once
the stream finishes.

#### Scenario: Title animates during a silent step
- GIVEN an open stream whose Agent has emitted nothing for one cadence window
- WHEN the progress hub ticks
- THEN the stream refreshes with the next kaomoji frame on the title line

#### Scenario: Animation stops at terminal status
- GIVEN an animated title for a running task
- WHEN the task completes, fails or is cancelled
- THEN the final stream refresh renders the title without a kaomoji frame

### Requirement: Terminate inside the running view
Terminating MUST be one click on a Template Card button, not on Stream
markdown. WeCom markdown cannot host a callback (`[text](url)` only opens a
page; `feedback.id` is like/dislike), so Stream text such as ▼ 查看完整思考过程
or **点击终止** MUST NOT be presented as a control. A create or continue ACK
MUST attach a `button_interaction` card with 查看完整过程 and 终止 through
`stream_with_template_card` on the frame that opens the stream. If that frame
already went out without a card (classification opened the stream first) or
the combo is rejected, the bot MUST send the same buttons as a standalone
template card. The footer MAY name the copyable `终止 <TaskID>` command as
fallback, without pretending the words themselves are tappable. Clicking 终止
MUST cancel the task through the existing card-event path, and every outbound
card MUST carry a task_id that was never sent before, because WeCom rejects a
reused one with errcode 42014.

The card MUST name the task, not only its id: in a room with several tasks in
flight an id identifies nothing to a human. It MUST carry the requirement, the
owner, and whether the task holds an isolated checkout and a reserved port.

Checking on a task MUST also be one click. The card MUST carry a 查看状态 button
ahead of 查看完整过程 and 终止 — reading is the safer action, and
unlike terminating it is one anyone in the room may take. 查看完整过程 MUST push
the full hierarchical process without disturbing the running card. Clicking
查看状态 MUST answer with the same status reply the typed command produces.

#### Scenario: Terminate from the running view
- GIVEN a created or continued WeCom task T001
- WHEN the bot sends the ACK
- THEN a 终止 button keyed `cancel:T001` is attached as a Template Card
- AND the stream footer spells out the `终止 T001` command without a fake markdown button

#### Scenario: The card says which task it is
- GIVEN task T001 for 增加手机号搜索, started by ann, holding a worktree on port 41003
- WHEN the bot draws its card
- THEN the card shows the requirement, `发起人 ann`, `独立工作区` and `端口 41003`
- AND the buttons are 查看状态, 查看完整过程, then 终止

#### Scenario: A bystander checks on a task from the card
- GIVEN running task T001 started by ann in a group
- WHEN bob taps 查看状态
- THEN the bot replies with T001's status and the task keeps running

#### Scenario: Anyone may expand the process
- GIVEN running task T001 with more than three process steps
- WHEN bob taps 查看完整过程
- THEN the bot pushes the full hierarchical process
- AND the running card is left in place

#### Scenario: Combo missed still has buttons
- GIVEN classification already opened the reply stream without a card
- WHEN the bot acknowledges a created task
- THEN it sends a standalone Template Card with 查看完整过程 and 终止

### Requirement: A silent run still concludes
A WeCom view MUST NOT freeze on "任务仍在后台运行" with no further word.
After the stream TTL, push keepalives MUST continue even when the Agent is
silent, carrying the current activity rather than a fake 最终结论. If no Agent
event arrives for the stall window, the view MUST finish with a 最终结论 that the
wait ended, and the task MUST be cancelled rather than left running forever.
Parking an interrupted local run at recovery MUST publish a terminal event so
the conversation still gets that 最终结论.

#### Scenario: Push keepalives while silent
- GIVEN a task whose stream has expired onto the push channel
- AND the Agent has emitted nothing since the last push
- WHEN the push interval elapses
- THEN the bot still sends a running update with current activity and no 最终结论

#### Scenario: Stall concludes and stops the wait
- GIVEN a running WeCom task with no Agent events for the stall window
- WHEN the progress hub ticks
- THEN the stream or push finishes with a 最终结论 that waiting stopped
- AND the task is cancelled

#### Scenario: Interrupted recovery still notifies
- GIVEN a local run parked as interrupted at startup
- WHEN recovery finishes parking it
- THEN the conversation receives a terminal 最终结论

### Requirement: Only the owner may end a run
Reading a task and stopping it are different rights. Anyone in the conversation
MUST be able to see a task's status, because that is how a group follows work.
Ending a run MUST be restricted to the person who started it: a cancellation
discards work that may be halfway written, and it costs the owner everything
and a bystander nothing. The restriction MUST apply equally to the typed
command and to the card button, which the whole group can see. A task with no
recorded owner MUST stay controllable, or it could never be stopped.

#### Scenario: A bystander cannot stop someone else's task
- GIVEN running task T001 started by ann in a group
- WHEN bob sends `终止 T001` or taps its 终止 button
- THEN the task keeps running
- AND the bot replies that only the person who started it can terminate it

#### Scenario: Watching is still open to the group
- GIVEN running task T001 started by ann in a group
- WHEN bob sends `状态 T001`
- THEN the bot reports the status

#### Scenario: Combined message unsupported
- GIVEN a client without `stream_with_template_card`
- WHEN the bot sends the ACK
- THEN the text is delivered on a plain stream frame without the button

#### Scenario: Finished turn carries no button
- WHEN a turn ends immediately, such as an answer or the help text
- THEN no terminate card is attached

#### Scenario: Second card for the same task
- GIVEN task T001 already sent a card at create time
- WHEN the bot sends another card for T001
- THEN the new card carries a different task_id and WeCom accepts it

#### Scenario: Terminate from a legacy card
- GIVEN a terminate card sent to the chat before terminating moved inline
- WHEN the user clicks the card button `cancel:T001`
- THEN the bot updates the card to terminated within the callback window and cancels T001

### Requirement: Card clicks use the card response channel
The click payload lives under `event.template_card_event`, and a card-click
`req_id` accepts only `aibot_respond_update_msg` — a stream reply on it fails
with errcode 846605. The bot MUST parse the nested payload, MUST answer a click
with a card update only, and MUST push any accompanying text with
`aibot_send_msg`. A failed card update MUST NOT abort the work the click
started, and no handler rejection may reach the process.

#### Scenario: Workspace chosen from the picker card
- GIVEN a pending workspace prompt and a picker card
- WHEN the user clicks 当前目录 (`ws:local`)
- THEN the card updates, the ACK arrives as an active message, and the task starts

#### Scenario: Card update rejected by WeCom
- GIVEN a click that already created a task
- WHEN the card update fails
- THEN the bot logs the errcode, still pushes the ACK, and stays alive

#### Scenario: Unrecognised card event
- GIVEN a card event whose payload carries no event key
- WHEN the bot handles it
- THEN it logs and answers nothing, since a stream reply would be rejected

### Requirement: Copyable conversation id
Every task-scoped reply — ACK, live view and terminal notify — MUST end with
the Task ID rendered as inline code on its own line, so the user can copy it
for `继续 <TaskID>` or `终止 <TaskID>`.

#### Scenario: Id on a running view
- GIVEN a live view for task T001
- WHEN the bot refreshes it
- THEN the last block holds the id as inline code plus the terminate line

#### Scenario: Id on a finished notify
- GIVEN task T001 reached a terminal status
- WHEN the bot renders the result
- THEN the id is the last line and no terminate line is shown

#### Scenario: Terminate from text
- GIVEN an open WeCom task in the conversation
- WHEN the user sends `终止`
- THEN the bot cancels that task

### Requirement: Workspace selection for code tasks
A code task MUST use a configured workspace repository or local cwd and follow
AAFE git flow. If no workspace is configured, the bot MUST ask for the Bot
runtime directory, a local path, or a remote repository before start.

#### Scenario: Unconfigured workspace asks first
- GIVEN the bot has no workspaces and no repository
- WHEN the user sends a TAPD requirement
- THEN the bot does not start an Agent and asks the user to choose a workspace

#### Scenario: Configured workspace starts immediately
- GIVEN the current workspace is `local` with cwd set
- WHEN the user sends a TAPD requirement
- THEN the bot creates and starts the task on that cwd

### Requirement: Switch among local workspaces
The bot MUST support multiple configured workspaces and allow switching from
WeCom by command or card.

#### Scenario: Switch workspace
- GIVEN workspaces `aafe` and `bklog`
- WHEN the user sends `切换 bklog`
- THEN later code tasks use the bklog workspace

### Requirement: Async completion notify
If no live stream exists for a finished WeCom task, completion MUST be pushed
with aibot_send_msg.

#### Scenario: Finished task without live stream
- GIVEN a WeCom-sourced task reaches a terminal status and has no open ACK stream
- WHEN TaskManager publishes the finished event
- THEN the bot sends one markdown notify containing Task ID, status, and any files, PR, or error

### Requirement: Optional local analysis log
Local file logging MUST stay off by default. When enabled by `log.enabled`
or `WECOM_LOG`, the bot MUST append structured JSONL under the WeCom
directory (or `log.dir`) and MUST redact secrets.

#### Scenario: Default off
- GIVEN no `WECOM_LOG` and no `log.enabled`
- WHEN the bot starts
- THEN it writes no local log files

#### Scenario: Enabled JSONL
- GIVEN `WECOM_LOG=1` or `log.enabled=true`
- WHEN the bot handles a text message
- THEN it appends a JSONL record with event, timestamp, and redacted payload

### Requirement: Media receive and send
The bot MUST accept image, file, voice, video, and mixed messages. Inbound
encrypted assets MUST be downloaded with the per-URL `aeskey` and attached
to the task. Voice MUST use the official transcribed text. The bot MUST be
able to upload temporary media and reply or send file/image/voice/video.

#### Scenario: Image creates a task
- GIVEN a single-chat image message
- WHEN the bot handles it
- THEN it decrypts the image, persists it, and creates or continues a task with the local path

#### Scenario: Voice uses transcript
- GIVEN a voice message whose `voice.content` is `做：增加搜索`
- WHEN the bot handles it
- THEN it creates a task with that requirement and does not reject the message

#### Scenario: Reply media uses media_id
- GIVEN a local file the bot wants to send
- WHEN it uploads via `aibot_upload_media_*` and replies
- THEN the reply uses `msgtype` file/image/voice/video with that `media_id`

### Requirement: Workspace GitHub token is injected into local Agent git
A local WeCom / TaskManager run MUST inject `GITHUB_TOKEN` / `GH_TOKEN` plus
github.com `http.extraheader` into the local Agent process environment before
`Agent.create` / `send`. Token lookup MUST degrade in this order, using the
first source that actually has a token:

1. WeCom overlay (`wecom.local.json` → `repo`, or `AAFE_WECOM_GITHUB_TOKEN`)
2. The current AAFE process `.aafe.config.json` (`TaskManager.root`)
3. The task workspace / project `.aafe.config.json` (install cwd, not only the
   worktree root)

The token MUST NOT appear in prompts, logs, or remote URLs. Existing shell
`GITHUB_TOKEN` / `GH_TOKEN` values MUST win over every config file.

#### Scenario: WeCom overlay wins
- GIVEN `wecom.local.json` has `repo.githubAccessToken`
- AND the AAFE root and workspace configs have different tokens
- WHEN the local Agent starts
- THEN the Agent shell uses the WeCom overlay token

#### Scenario: Degrade to current AAFE config
- GIVEN WeCom `repo` has no token
- AND the AAFE process `.aafe.config.json` has `repo.githubAccessToken`
- WHEN the local Agent starts
- THEN the Agent shell uses the AAFE process token

#### Scenario: Degrade to workspace project config
- GIVEN WeCom and the AAFE process config have no token
- AND workspace cwd `bklog/web` has a gitignored `.aafe.config.json` with `repo.githubAccessToken`
- AND the task lease is a worktree of the parent git root
- WHEN the local Agent starts
- THEN `GITHUB_TOKEN` is set from that workspace config
- AND `git push` to github.com uses `http.extraheader`
- AND the prompt names that GitHub auth is already in the environment without printing the token
