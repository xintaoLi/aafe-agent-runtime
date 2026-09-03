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
execution finishes.

#### Scenario: Create command
- GIVEN a text message `做：增加手机号搜索`
- WHEN the bot handles the message
- THEN it creates a TaskManager task, replies the Task ID with finish=true, and starts the task asynchronously

### Requirement: Explicit continue
Continue MUST require an explicit Task ID and MUST NOT guess the latest task.

#### Scenario: Continue without id
- GIVEN a conversation that already has unfinished tasks
- WHEN the user sends `继续`
- THEN the bot asks for a Task ID and does not create or continue a task

### Requirement: Async completion notify
Task completion MUST be pushed with aibot_send_msg and MUST NOT keep the original
stream open until Cloud finishes.

#### Scenario: Finished task
- GIVEN a WeCom-sourced task reaches a terminal status
- WHEN TaskManager publishes the finished event
- THEN the bot sends one markdown notify containing Task ID, status, and any files, PR, or error
