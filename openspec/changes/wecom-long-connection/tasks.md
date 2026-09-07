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

# Tasks

- [x] W0 long-connection gateway, welcome, help, msgid dedup
- [x] W1 create command with stream ACK and async TaskManager.start
- [x] W2 continue/status/cancel/list and aibot_send_msg notify
- [x] W3 resident initialize/recover, single-connection kick, aafe wecom
- [x] Unit tests for commands, resolver, notify, dedup
- [x] W4 implicit intent routing for TAPD / freeform / single-task continue
- [x] W5 live progress on the create/continue ACK stream
- [x] W6 terminate button, workspace ask/switch, per-task cwd/repository
- [x] W7 Cursor-like compact progress (3–5 process lines + separate summary)
- [x] W8 standalone terminate card (no stream+card combo) and text 终止
- [x] Optional local JSONL analysis log (default off, `WECOM_LOG` / `log.enabled`)
- [x] Image/file/voice/video/mixed receive, decrypt, attach, and media send/upload
- [x] Continue while running queues follow-up instead of task-already-active
- [x] Implicit follow-up prefers a just-completed conversation task over a stale running one
- [x] Group implicit continue/pending bind by speaker (chatid::userid); explicit Task ID can cross members
- [x] Unique card task_id per send (WeCom 42014) and readable SDK error logs
- [x] Local Agent resume/getRun/cancelRun scoped to the task workspace cwd; lost Agent replaced with context replay
- [x] Dancing kaomoji loading frame on the stream title while a task runs
- [x] Stale error from a failed attempt no longer shows on a later successful run
- [x] Copyable 对话 ID footer on ACK / live view / notify
- [x] Terminate moved into the running view; no standalone cancel card
- [x] Card clicks parse the nested `template_card_event` payload
- [x] Card clicks answer with the card update only; text goes out as an active push
- [x] Workspace picker `local` button resolves to the bot run directory
- [x] Gateway handlers catch their own rejections so the bot survives them
- [x] Staged turn: `正在理解分析中…` → classification result → routing outcome on one stream
- [x] Intent analyzer with an OpenAI-compatible endpoint, a Cursor one-shot fallback, and keyword rules underneath
- [x] Repository question narrowed to code work; analysis runs in the bot directory
- [x] Classification stored with the pending workspace question and reused for the answer
- [x] Rules-first classification: TAPD / leading verb / question / addendum resolve in ~1ms, model only for ambiguous new work
- [x] `正在理解分析中…` only when classification loses a 150ms race
- [x] Classifier model defaults to `gemini-3.8-flash` instead of the task model
- [x] Digits-only junk answers help instead of creating a task
- [x] Model routing as an ordered rule table; shipped behaviour is default rules, not code branches
- [x] Model pinned on the task at creation and reused by resume / follow-up runs
- [x] Rule validation: structure everywhere, model names against the account list at boot (advisory)
- [x] `aafe wecom --check-models [--probe=...] [--offline]` gates a new rule and exits non-zero on invalid
- [x] Greeting / identity / junk answered conversationally, not with the command list
- [x] Full manual only on first contact per user, or when explicitly asked
- [x] Repository-free questions answered in place via the `chat` stage instead of becoming tasks
- [x] 20-line local chit-chat pool picked at random; whole-message patterns keep defects out
- [x] 终止 button attached to the live message via `stream_with_template_card`, text fallback kept
- [x] Agent startup collapsed to a single `准备任务` / `⌛ 思考中`; process list reserved for real steps
- [x] A finished task is never continued implicitly; explicit `继续` names the last one for copying
- [x] An open task no longer turns unrecognised text into an addendum; weak input asks instead of guessing
- [x] New-work verbs recognised after a pasted link, still not mid-message
- [x] Killed local runs parked as interrupted at startup instead of hanging in `running` or re-running unasked
- [x] Context anchor before routing: Task ID in text → quoted message → last active task; a reference may revive a finished task
- [x] Quotes followed by reading their text (printed Task ID, else full requirement match), since WeCom omits the quoted msgid
- [x] Weak input appends to the last active task and the reply names the target plus how to retarget it
- [x] Group bystanders contribute only through a reference, recorded as participants with the owner kept in the follow-up prompt
- [x] Group @ guard as second-line defence: logged by default, enforced by `requireGroupMention`
- [x] Task ID tails (`#cccc3333`) count as references while exactly one task ends in one
- [x] Quoted Task IDs go through the same lookup typed ones do, so a reference survives leaving the recent list
- [x] A quoted TAPD link matches the task created from that ticket, whatever the wording around it
- [x] Two live tasks with nothing choosing between them ask instead of taking the newest
- [x] A task untouched beyond 12h is named rather than appended to; a reference still resumes it
- [x] Anchor evidence (kind / via / confidence) travels into the turn's log
- [x] Task ID in text or quote classifies without a model, running task or not
- [x] Ship instructions (commit / PR / merge / 回填 / rerun) route to the anchor instead of creating `提交 PR` tasks
- [x] One git worktree per task, detached from the base ref, so parallel tasks stop sharing a git index
- [x] Remote base ref preferred over a same-named local branch, so a task is not cut from a stale trunk
- [x] Non-repository / worktree-less / worktrees-off checkouts fall back to a directory lock instead of overlapping
- [x] A port per live task, named in the prompt and returned to the pool on release
- [x] Ignored-but-required paths (`node_modules`) borrowed into the worktree, without leaving it dirty
- [x] Lease (`execution`) written on the task, so recovery, follow-up and cancel address the same checkout
- [x] `pullRequest` lifted onto the task instead of being dug out of `result.execution.git`
- [x] Task index narrows candidates by conversation / user / status before any task file is read
- [x] Only the task owner may terminate, on the typed command and on the card button alike
- [x] Submit instructions hold a much shorter staleness window than ordinary follow-ups
- [x] Task card names the requirement, the owner, the isolated workspace and the port
- [x] Build caches inside borrowed `node_modules` stay per-task, so parallel builds stop overwriting each other
- [x] A re-created worktree resumes the task's own branch instead of detaching and stranding its commits
- [x] Ambiguity is still a question, but a ranked one: candidates ordered by wording and recency, requirement shown, clear favourite marked
- [x] A message naming two tasks runs against neither and asks for them to be sent separately
- [x] Task card carries 查看状态 ahead of 终止, open to anyone in the room
- [x] Process box shows three lines by default; 查看完整过程 pushes the hierarchical remainder
- [x] Stream markdown does not fake tappable 查看完整思考过程 / 点击终止; buttons live on the Template Card
- [x] Finished views always carry a ✅ 最终结论, including stall, interrupt and process exit
- [x] Push keepalives continue while silent; a stall window cancels instead of freezing
- [x] Continue after a hung run cancels the leftover Cursor run instead of failing on “already has active run”
- [x] Failed 最终结论 names the actual error, not “未返回详细原因”
- [x] Agent UI protocol: status labels, last-3 thinking preview, thinking/result split, canceling then canceled
- [x] Local runs inject workspace `repo.githubAccessToken` into `GITHUB_TOKEN` and git extraheader
- [x] GitHub token degrades WeCom overlay → current AAFE `.aafe.config.json` → workspace project config
