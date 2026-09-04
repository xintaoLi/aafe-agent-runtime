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
