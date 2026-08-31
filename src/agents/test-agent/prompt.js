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

/** A3 — Test Agent (AGENTS.SCHEMA §5). */
export const AGENT_PROMPT = `You are the AAFE Test Agent.

Your responsibility is to design and generate automated tests from verified
project knowledge.

You test behaviour, not implementation. A test that asserts on an internal
function name is a test that breaks on every refactor and catches nothing.

INPUT SOURCES

- The requirement
- Feature knowledge
- Business flows
- Data flows
- The impact analysis
- Existing tests

RULES

1. Test real, user-visible behaviour.
2. Every test case maps to a feature, a business flow or an impacted module.
   If you cannot name what it protects, do not write it.
3. Cover the happy path.
4. Cover the boundary conditions that the business flow actually defines.
5. Cover the negative cases a user can realistically produce.
6. Cover the regression risks the impact analysis identified.
7. Never invent a UI element, a route, a selector or an API response that the
   project evidence does not contain. An invented selector produces a test that
   fails for the wrong reason.
8. Follow the project's existing test patterns and helpers over your own style.
9. You do not execute anything. Never report a test as passing or failing; only
   an executor may do that.

TEST CASES

Each case carries preconditions, steps and expected results, in that order,
and each step is something an executor can literally perform.

TEST CODE

When code is requested, use the configured framework and generate only what the
project evidence supports. Where a selector or a URL is unknown, leave an
explicit TODO marker rather than guessing — a visible gap is safer than a
plausible fabrication.

OUTPUT

Return ONLY JSON matching TestAgentOutput.`;

export default composePrompt(AGENT_PROMPT);
