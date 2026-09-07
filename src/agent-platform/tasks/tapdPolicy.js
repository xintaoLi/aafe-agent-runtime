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

const TAPD_URL_RE = /https?:\/\/\S*?\/(?:tapd_fe\/(\d+)\/)?(story|bug|task)\/detail\/(\d+)/i;
const TAPD_ASSOCIATED_BRANCH_RE = /^(feat|feature|bug|fix)\/[a-z0-9._-]+\/#\d{6,}$/i;
const PLATFORM_TASK_BRANCH_RE = /^aafe\/task\//i;

/**
 * Pull a TAPD story/bug out of free-form text. short_id is the last 9 digits
 * of the URL's detail id, matching AAFE branch association.
 */
export function parseTapdAssociation(text) {
  const raw = String(text ?? '');
  const match = raw.match(TAPD_URL_RE);
  if (!match) return null;
  const workspaceId = match[1] ?? null;
  const entryType = normalizeEntryType(match[2]);
  const entryId = match[3];
  return {
    url: match[0].replace(/[)\].,;]+$/, ''),
    workspaceId,
    entryType,
    entryId,
    shortId: entryId.slice(-9),
    branchType: entryType === 'bug' ? 'bug' : 'feat'
  };
}

export function isTapdAssociatedBranch(name) {
  return TAPD_ASSOCIATED_BRANCH_RE.test(String(name ?? '').trim());
}

export function isPlatformTaskIdBranch(name) {
  return PLATFORM_TASK_BRANCH_RE.test(String(name ?? '').trim());
}

/**
 * WeCom TAPD config wins over the target project's tapd.enabled.
 * A TAPD ticket in the requirement still turns association on unless WeCom
 * explicitly set enabled=false.
 */
export function resolveEffectiveTapd({ requirement, context = {}, source = null } = {}) {
  const association = context.tapd?.association ?? parseTapdAssociation(requirement);
  if (context.tapd?.enabled === false) {
    return { enabled: false, association, overrideProject: false, config: context.tapd?.config ?? null };
  }
  const wecomOn = context.tapd?.enabled === true || source?.type === 'wecom';
  if (association && (wecomOn || context.tapd?.enabled === true)) {
    return {
      enabled: true,
      association,
      overrideProject: true,
      config: context.tapd?.config ?? null
    };
  }
  return {
    enabled: false,
    association,
    overrideProject: false,
    config: context.tapd?.config ?? null
  };
}

export function buildTapdPromptSection(task, context = {}) {
  const requirement = task?.requirement ?? task?.goal ?? context.userRequest ?? '';
  const policy = resolveEffectiveTapd({
    requirement,
    context,
    source: task?.source
  });
  const lines = [
    'Follow AAFE GitHub branch association before analysis or code.',
    'Do not create or stay on aafe/task/<taskId>. That name is not a confirmed development branch.',
    'A platform task id is never "user confirmed current branch".'
  ];

  if (task?.taskBranch && isTapdAssociatedBranch(task.taskBranch)) {
    lines.push(`Candidate TAPD branch (still verify T1): ${task.taskBranch}`);
  }

  if (policy.association) {
    const { entryType, entryId, shortId, url, branchType } = policy.association;
    lines.push(
      `TAPD association: ${entryType} ${entryId} (short_id=${shortId}).`,
      url ? `TAPD URL: ${url}` : null,
      `Required branch: {${branchType}|bug}/<slug>/#${shortId} from upstream/master (origin/master if upstream is missing).`,
      'If the current branch does not match that short_id, switch/create it. Existing related commits or dirty files do not count as confirmation.'
    );
  } else {
    lines.push(
      'No TAPD ticket in this requirement. Follow AAFE non-TAPD branch rules: stay only if the current branch is clearly this task; otherwise create/switch a development branch from the remote trunk.'
    );
  }

  if (policy.enabled && policy.association) {
    lines.push(
      'WeCom TAPD is enabled for this run and overrides the target project .aafe.config.json tapd.enabled.',
      'Even if the project has tapd.enabled=false or no tapd section, treat TAPD as enabled:',
      '- After code + self-test (or skip), follow tapd-submit-backfill: Commit → PR → TAPD comment backfill.',
      `- Commit message must include --${policy.association.entryType === 'bug' ? 'bug' : 'story'}=${policy.association.shortId}.`
    );
  }

  return lines.filter(Boolean);
}

function normalizeEntryType(value) {
  const text = String(value ?? '').toLowerCase();
  if (text === 'bug') return 'bug';
  if (text === 'task') return 'story';
  return 'story';
}
