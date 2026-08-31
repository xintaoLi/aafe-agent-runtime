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

/**
 * Deterministic failure classification (RFC §16).
 *
 * The categories exist because they lead to different fixes: an assertion
 * failure means the code is wrong, a timeout usually means the test waits for
 * the wrong thing, and an environment failure means nothing about the code is
 * known yet. Guessing between them wastes the most expensive part of the loop,
 * so patterns are ordered by specificity and the first confident match wins.
 */
const RULES = [
  {
    classification: 'environment',
    // Checked first: a missing module or failed boot makes every later signal meaningless.
    patterns: [
      /cannot find module/i,
      /module not found/i,
      /ERR_MODULE_NOT_FOUND/,
      /EADDRINUSE/,
      /ENOENT.*(?:node_modules|package\.json)/i,
      /browserType\.launch/i,
      /Executable doesn't exist/i,
      /please (?:run|install).*(?:npm|yarn|pnpm|playwright install)/i
    ],
    hint: 'the suite could not start in this environment'
  },
  {
    classification: 'timeout',
    patterns: [
      /timeout .*exceeded/i,
      /timed? ?out/i,
      /exceeded timeout of \d+/i,
      /waiting for (?:selector|locator|element|navigation)/i,
      /Test timeout of \d+ms exceeded/i
    ],
    hint: 'the test waited for something that never happened'
  },
  {
    classification: 'network',
    patterns: [
      /ECONNREFUSED/,
      /ECONNRESET/,
      /ETIMEDOUT/,
      /ENOTFOUND/,
      /net::ERR_/,
      /fetch failed/i,
      /request failed with status code [45]\d\d/i,
      /\b(?:status|statusCode)[":\s]+[45]\d\d\b/
    ],
    hint: 'a dependency the test calls did not answer as expected'
  },
  {
    classification: 'assertion',
    patterns: [
      /expect\(/,
      /AssertionError/i,
      /expected .* (?:to|but) /i,
      /toBe(?:Truthy|Falsy|Defined|Visible|Null|Close|Greater|Less)?\b/,
      /toEqual|toMatch|toHaveBeenCalled|toHaveText|toContain/,
      /Received:\s|Expected:\s/,
      /assert(?:ion)? failed/i
    ],
    hint: 'the code produced a different result than the test requires'
  },
  {
    classification: 'runtime',
    patterns: [
      /TypeError/,
      /ReferenceError/,
      /RangeError/,
      /SyntaxError/,
      /is not a function/i,
      /cannot read propert(?:y|ies)/i,
      /of (?:undefined|null)/i,
      /undefined is not an object/i,
      /Unhandled(?:Promise)?Rejection/i
    ],
    hint: 'the code threw before it could produce a result'
  }
];

/**
 * @param {{message?:string, stack?:string, title?:string}} failure
 * @returns {{classification:string, hint:string, matched:string|null, confidence:number}}
 */
export function classifyFailure(failure) {
  const text = [failure?.message, failure?.stack, failure?.title].filter(Boolean).join('\n');
  if (!text.trim()) {
    return { classification: 'unknown', hint: 'no failure text was captured', matched: null, confidence: 0 };
  }

  for (const rule of RULES) {
    const matched = rule.patterns.find((pattern) => pattern.test(text));
    if (!matched) continue;
    return {
      classification: rule.classification,
      hint: rule.hint,
      matched: String(matched),
      confidence: 0.8
    };
  }

  return {
    classification: 'unknown',
    hint: 'the failure text matched no known signature',
    matched: null,
    confidence: 0.2
  };
}

/**
 * A run can fail for several reasons at once. The dominant class decides how
 * the whole run should be approached, and environment beats everything: if the
 * suite never started, the assertion counts below it mean nothing.
 */
export function dominantClassification(classifications) {
  if (classifications.length === 0) return 'unknown';
  if (classifications.includes('environment')) return 'environment';

  const tally = new Map();
  for (const item of classifications) tally.set(item, (tally.get(item) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] === 1 && ranked.length > 1 ? 'mixed' : ranked[0][0];
}

/**
 * Fix directions per class. Deliberately about *where to look* rather than
 * what to type: AAFE does not edit code, and a confident-sounding wrong patch
 * costs more than a precise pointer.
 */
export function fixSuggestions(classification, { files = [], changedFiles = [], classifications = [] } = {}) {
  const suspect = files[0] ?? null;
  const overlap = files.filter((file) => changedFiles.includes(file));

  // A run that failed several different ways was still fully classified; it
  // must not fall through to the "no recognizable signature" advice below.
  if (classification === 'mixed') {
    const distinct = [...new Set(classifications)].filter((item) => item !== 'unknown');
    return [
      `This run failed in ${distinct.length} different ways (${distinct.join(', ')}); treat them as separate problems.`,
      ...distinct.map((item) => `${item}: ${fixSuggestions(item, { files, changedFiles })[0]}`)
    ];
  }

  switch (classification) {
    case 'assertion':
      return [
        suspect
          ? `Compare the expected and received values against the logic in ${suspect}.`
          : 'Compare the expected and received values in the assertion output.',
        overlap.length > 0
          ? `${overlap.join(', ')} changed in this diff and is on the failing path — review that change first.`
          : 'The failing path is not in the diff; check whether the expectation itself is now out of date.'
      ];
    case 'runtime':
      return [
        suspect ? `Guard or fix the value dereferenced in ${suspect}.` : 'Locate the value that was undefined at the throw site.',
        'Check whether a recent signature or shape change left a caller passing the old form.'
      ];
    case 'timeout':
      return [
        'Confirm the awaited condition can actually occur; a renamed selector or a state that never settles is the usual cause.',
        overlap.length > 0
          ? `${overlap.join(', ')} changed and is on the awaited path.`
          : 'Raise the timeout only after ruling out a genuinely stuck condition.'
      ];
    case 'network':
      return [
        'Verify the dependency is reachable and returns the expected status in the test environment.',
        'If this is an external service, decide whether the test should stub it instead.'
      ];
    case 'environment':
      return [
        'Install or repair the missing dependency, then re-run; the suite never reached the code under test.',
        'No conclusion about the change can be drawn from this run.'
      ];
    default:
      return [
        'Capture the full runner output; the current artifact has no recognizable failure signature.',
        'Re-run with a JSON reporter so the failure can be classified precisely.'
      ];
  }
}

export const CLASSIFICATIONS = Object.freeze(RULES.map((rule) => rule.classification).concat('unknown'));
