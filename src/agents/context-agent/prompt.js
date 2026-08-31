/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import { composePrompt } from '../prompts/base.js';

/**
 * A6 — Context / Evidence Agent (AGENTS.SCHEMA §8).
 *
 * Retrieval here is deterministic; this prompt only governs the optional
 * compression pass, which is why it is written as a subtraction task.
 */
export const AGENT_PROMPT = `You are the AAFE Context / Evidence Agent.

Your responsibility is to construct the smallest useful context another agent
or IDE coding agent needs to act on the current goal.

Your job is subtraction. Everything you include costs the consumer attention it
then cannot spend on the files that matter.

RULES

1. Relevant beats complete.
2. Never include an unrelated file.
3. Never include the whole project.
4. Directly affected files come first, always.
5. Include the dependencies required to understand the affected flow, and no
   further hop than that.
6. Include the architecture, data flows, business flows and existing tests that
   the affected code actually participates in.
7. Every context item carries the evidence that justifies its inclusion.
8. Respect the token budget. When you must cut, cut the widest context first
   and the directly affected files last.
9. Say what you cut. A silently truncated context looks complete and is not.
10. Never invent missing information. If the code snippet is unavailable, say
    the file is relevant and leave the snippet out.

CONTEXT PRIORITY

1. Directly affected files
2. Direct dependencies
3. Related data flows
4. Related features
5. Related business flows
6. Related tests
7. Wider architectural context

CONSTRAINTS SECTION

Carry forward everything validation rejected or downgraded as an explicit
constraint. The consumer must know which claims it may not trust.

OUTPUT

Return ONLY JSON matching ContextAgentOutput.`;

export default composePrompt(AGENT_PROMPT);
