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
they include that Task ID. The bot MUST ask for a Task ID when the speaker
has zero or multiple unfinished tasks.

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
- THEN the bot does not continue T-A and asks B to create work or use an explicit Task ID

#### Scenario: Group explicit continue can target another member's task
- GIVEN group chat G where user A owns running task T-A
- WHEN user B sends `继续 T-A：补测试`
- THEN the bot continues T-A and appends B's supplement to that task context

### Requirement: Implicit intent routing
Unprefixed text MUST be classified before ACK. TAPD links and new-work
signals MUST create a task. Follow-up text MUST continue the only open
task owned by the speaker in the current conversation. Greetings MUST stay on help.

#### Scenario: TAPD paste creates a task
- GIVEN no unfinished task in the conversation
- WHEN the user sends a TAPD story title and URL without `做：`
- THEN the bot creates a TaskManager task, replies the Task ID, and starts it asynchronously

#### Scenario: Follow-up continues the only open task
- GIVEN the conversation has exactly one unfinished task
- WHEN the user sends `加上单测`
- THEN the bot continues that task and does not create a new one

#### Scenario: Reply after completion prefers the finished task
- GIVEN a stale running task T-old and a just-completed task T-new in the same conversation
- WHEN the user sends follow-up text without a Task ID
- THEN the bot continues T-new and does not continue T-old

#### Scenario: Continue while the target is still running
- GIVEN task T001 is already running
- WHEN the user continues T001 with supplement text
- THEN the bot acknowledges the follow-up, keeps T001 running, and starts the supplement as the next Run after the current scheduler slot finishes

#### Scenario: New TAPD during an open task
- GIVEN the conversation has one unfinished task
- WHEN the user pastes another TAPD URL
- THEN the bot creates a new task instead of continuing the old one

### Requirement: Staged intent analysis before routing
Free-form input MUST be classified before the bot decides what to do with it,
and the user MUST see the stages on one stream: the classification result and
then the routing outcome. `正在理解分析中…` MUST be sent first whenever the
classification does not resolve within a short grace period, and MUST be
skipped when it resolves instantly so the user is not shown an unreadable
flash. Classification MUST cover text, links, and attachments alike.

Unmistakable input MUST be classified without a model: TAPD pastes and
bracketed defect titles, a leading code or analysis verb, plain questions, and
text that adds to the speaker's only open task. A model MUST only be consulted
when no such signal is present. Control words (`状态` / `终止` / `列表` / `帮助` /
`仓库`), digits-only junk, and answers to a pending question MUST also stay off
the model path, so a stop is never delayed by a round trip.

Classification MUST NOT be able to break a turn: on failure, timeout, an
unparsable answer, or a throwing classifier the bot MUST fall back to keyword
routing and continue.

#### Scenario: Unmistakable input skips the model
- WHEN the user pastes a TAPD story title and URL
- THEN the bot classifies it as code work without calling a model
- AND the reply goes out in the same turn

#### Scenario: Addendum to the only open task skips the model
- GIVEN the speaker has exactly one open task
- WHEN the user sends text with no leading verb and no new-work marker
- THEN the bot treats it as a follow-up without calling a model

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

### Requirement: Live progress on the ACK stream
While a WeCom-sourced task is running, the original reply stream MUST refresh
with a Cursor-like compact view: at most five process lines, older steps
collapsed, and a one-line current activity. The stream MUST finish when the
task reaches a terminal status and MUST show the summary in a separate result
block instead of dumping the full transcript.

#### Scenario: Progress refresh
- GIVEN an open stream for a created WeCom task
- WHEN TaskManager publishes `cursor.run.started` or `cursor.message`
- THEN the bot refreshes the same stream id with current progress and finish=false

#### Scenario: Process window collapses
- GIVEN an open stream that has recorded more than five tool or status steps
- WHEN the bot renders progress
- THEN only the latest five process lines are visible and the rest are counted as collapsed

#### Scenario: Stream finish on completion
- GIVEN an open stream for a WeCom task
- WHEN the task reaches a terminal status
- THEN the bot refreshes the stream with a separate result block and finish=true

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
WeCom long-connection supports no stream-plus-card combo, so a create or
continue ACK MUST NOT send a separate terminate card. The terminate
affordance MUST live at the bottom of the running content itself, as a
`终止 <TaskID>` command the user can copy. Clicks on terminate cards sent
before this change MUST still cancel the task, and every outbound card MUST
carry a task_id that was never sent before, because WeCom rejects a reused
one with errcode 42014.

#### Scenario: Terminate from the running view
- GIVEN a created or continued WeCom task T001
- WHEN the bot sends the ACK and refreshes the live view
- THEN no terminate card is sent and both carry a `终止 T001` line at the bottom

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
