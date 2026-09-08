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



import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { workspaceConfigDirs } from '../tasks/workspaceRepoEnv.js';
import { resolveWorkflowModeConfig } from '../../cli/workflowMode.js';
import { resolveSubmitConfig, parseTapdBranchName } from '../../cli/submitConfig.js';
import { resolveEffectiveTapd } from '../tasks/tapdPolicy.js';
import { parseGitRemote } from '../../cli/repoSubmit.js';
import { storySubmitRemainingPath, defaultTapdStoryStatus, defaultTapdBugStatus, parseStatusChain } from '../../cli/tapdConfig.js';

const exec = promisify(execFile);
const DOCUMENTS = [
  'rules/workflow-mode.mdc', 'rules/task-completion-impact.mdc', 'rules/tapd-submit-backfill.mdc',
  'skills/workflow-mode.md', 'skills/repo-submit.md', 'skills/tapd-submit-backfill.md',
  'skills/architecture-impact-test-forecast.md', 'skills/minimal-convergent-self-test.md'
];

/** Re-resolve trusted install-root policy on EVERY run, including a resumed thread. */
export async function resolveCodexWorkflow(task, context, lease, { enabled = true, workflowOverride } = {}) {
  let config = {}, configRoot = null;
  // A worker must not authorize its own submission by editing its checkout's config.
  const policyDirs = task.workspace?.cwd ? [path.resolve(task.workspace.cwd)] : workspaceConfigDirs(task, lease);
  for (const dir of policyDirs) {
    try {
      config = JSON.parse(await readFile(path.join(dir, '.aafe.config.json'), 'utf8'));
      configRoot = dir;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('codex-workflow-config-invalid');
    }
  }
  const readOnly = ['analysis', 'question'].includes(context.intent?.kind ?? task.kind);
  const dirs = [...new Set([configRoot, ...policyDirs].filter(Boolean))];
  let skillRoot = null;
  for (const dir of dirs) {
    try { await access(path.join(dir, '.ai-agent/skills/workflow-mode.md')); skillRoot = path.join(dir, '.ai-agent'); break; }
    catch { /* try the next explicit task root, never an unrelated bot project's rules */ }
  }
  const documents = [];
  if (skillRoot) for (const relative of DOCUMENTS) {
    const file = path.join(skillRoot, relative);
    try {
      const content = await readFile(file, 'utf8');
      documents.push({ file, sha256: createHash('sha256').update(content).digest('hex') });
    } catch { /* Missing required skills are reported below, not invented. */ }
  }
  const ownerMessages = [task.requirement ?? task.goal ?? '', ...(context.conversation?.messages ?? [])
    .filter((message) => message.role === 'user' && message.author?.role !== 'participant')
    .map((message) => message.content)];
  let mode = resolveWorkflowModeConfig(config, {
    workflow: workflowOverride === 'project' ? undefined : workflowOverride
  }).workflow;
  for (const text of ownerMessages) {
    if (/按自主判断继续|用自主模式|你自己决定/.test(text)) mode = 'autonomous';
    if (/用询问模式|先问我|不要自动提交|不要提交|先别提交|等我确认/.test(text)) mode = 'ask';
  }
  const tapd = resolveEffectiveTapd({ requirement: task.requirement ?? task.goal,
    context: { ...context, tapd: { ...context.tapd,
      enabled: context.tapd?.enabled ?? (task.source?.type === 'wecom' ? undefined : config.tapd?.enabled),
      config: { ...config.tapd, ...context.tapd?.config } } }, source: task.source });
  const required = ['workflow-mode.md', 'repo-submit.md', 'tapd-submit-backfill.md'];
  const policyHash = createHash('sha256').update(JSON.stringify({ documents, mode, submit: config.submit, tapd: {
    enabled: tapd.enabled, story: tapd.config?.tapd_story, bug: tapd.config?.tapd_bug
  } })).digest('hex');
  let initialHead = null;
  if (!readOnly && lease?.cwd) {
    try { initialHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: lease.cwd, timeout: 10000 })).stdout.trim(); }
    catch { /* non-Git tasks retain the normal runtime failure path */ }
  }
  return {
    enabled: enabled !== false && !readOnly, readOnly, mode, submitCli: resolveSubmitConfig(config).cli,
    configRoot, skillRoot, documents, ownerMessages, tapd,
    taskId: task.id, repoPrCommand: [process.execPath, fileURLToPath(new URL('../../../bin/aafe.js', import.meta.url)), 'repo', 'pr'],
    ready: required.every((name) => documents.some((doc) => doc.file.endsWith('/skills/' + name))),
    repoMeta: { reviewers: config.repo?.reviewers ?? [], labels: config.repo?.labels ?? [] },
    pendingGate: task.delivery?.pendingGate ?? null, initialHead, policyHash,
    policyUnchanged: task.delivery?.policyHash === policyHash,
    previous: task.delivery?.gates ?? [], existingReceipts: (task.delivery?.receipts ?? []).slice(-24)
  };
}

export function codexWorkflowPrompt(workflow) {
  if (!workflow) return '';
  return [
    'AAFE workflow for this run (replaces obsolete Bot restrictions on Commit/PR/backfill):',
    JSON.stringify({ enabled: workflow.enabled, mode: workflow.mode, submitCli: workflow.submitCli,
      configRoot: workflow.configRoot, documents: workflow.documents,
      tapd: { enabled: workflow.tapd.enabled, association: workflow.tapd.association,
        // Never put API credentials into the prompt.
        story: workflow.tapd.config?.tapd_story, bug: workflow.tapd.config?.tapd_bug,
        pr_field: workflow.tapd.config?.pr_field },
      repoMeta: workflow.repoMeta, pendingGate: workflow.pendingGate, previous: workflow.previous,
      taskId: workflow.taskId, repoPrCommand: workflow.repoPrCommand, existingReceipts: workflow.existingReceipts,
      policyUnchanged: workflow.policyUnchanged }),
    'Read the listed workflow-mode, repo-submit and tapd-submit-backfill skills and their hard rules before applicable gates. Read impact/self-test skills only when applicable. Files outside the worktree are read-only policy sources, never execution directories.',
    'The effective mode in this manifest includes the trusted Bot override and owner session overrides; use it instead of the project mode.workflow default. Never rewrite project configuration to apply this override. Owner prohibitions and all Hard Ask conditions still win.',
    'If policyUnchanged and the same native thread still retains the already-read rules, reuse them; reload after policy change or lost context. Do not repeatedly load unrelated skills.',
    'Execute in the TASK worktree. Choose git vs gtm, branch slug/base, Commit, PR/MR and TAPD gates from those skills; do not invent another submission protocol. Ask mode still requires owner confirmation; auto-review only reviews sandbox/MCP permissions and is NOT user consent.',
    'For each applicable gate emit a concise decision, then proceed/skip/ask under the skill. PR failure or skipped Commit does not suppress the TAPD gate. No TAPD association or tapd disabled means skip backfill without asking. Do not blindly force all gates to proceed.',
    'Use existing configured credentials only via environment. Token API before gh, preserve reviewers/labels. When running aafe repo pr from a worktree whose config is ignored, use --config-root with the exact configRoot above; do not cd to the original checkout.',
    'When a GitHub token is configured, Bot injects Git HTTPS authentication through host-scoped GIT_CONFIG_* using Basic base64(x-access-token:TOKEN). Run plain git fetch/pull/push, never add a Bearer extraheader even if an old project skill suggests it. Only REST API uses Bearer. Do not print raw or Base64 credentials, put them in argv/remote URLs, or persist them in Git config.',
    'Prefer the supplied repoPrCommand argv (the Bot bundled CLI supports --config-root), not a possibly older installed aafe. It still runs from the task checkout. For gtm follow the project skill and actual CLI help; missing noninteractive/auth support is blocked, never silently downgrade to git/gh.',
    'Backfill is comment-only plus the configured PR-link field and one-step-at-a-time status transitions up to doing; never overwrite description/test_focus or advance to for_test/done. Discover actual TAPD MCP schemas, never invent arguments. Read the entry before changes and read it again after transitions to verify the final status.',
    'Before retrying after interruption read actual git/PR/TAPD state. Reuse existing PR/comments; an ambiguous write timeout is blocked until read-back resolves it, never blindly replay.',
    'Put an AAFE task ID + commit SHA (or content fingerprint when Commit is skipped) marker in backfill comments; query for that marker before creating a comment so resuming the same delivery does not duplicate it. A later changed delivery may append its own new fingerprint, never overwrite the original ticket body.',
    'If sandboxed Git or network work needs permission, request on-demand approval through native Codex auto-review. Never disable sandbox, ignore rules, force push, skip hooks or evade a denial. If unavailable/denied, return blocked with the actual reason.',
    'Return delivery records for commit, pr and tapd_backfill (empty array for read-only work): gate, decision, status, reason, authorization (exact owner quote when needed), receipt (commit full SHA/PR URL/comment ID), evidence (actual commands/tools and read-back references; never invent event IDs). For TAPD keep the successful comments_create/comments_get tool receipt targeting the correct entry. For PR keep authenticated create/read output. Report skipped gates, partial failures and pending user choices honestly.',
    'When asking, include the actual concise question in summary and remainingSteps; stop this turn with blocked. On follow-up consume only the pending gate consent, not blanket consent for all later gates.'
  ].join('\n');
}

/** Keep verifiable identifiers, never provider output bodies / headers / credentials. */
export function codexToolReceipt(item) {
  if (!item?.id) return null;
  if (item.type === 'command_execution') {
    if (item.exit_code !== 0 || item.status !== 'completed') return null;
    const command = String(item.command ?? '');
    const output = String(item.aggregated_output ?? '').slice(-64000);
    return { id: item.id, kind: 'command', operation: /gtm\s+pr|gh\s+pr\s+(create|view)|repo\s+pr/.test(command) ? 'pr' : 'command',
      identifiers: [...new Set(output.match(/https:\/\/[^\s"'<>]+\/(?:pull|merge_requests)\/\d+|\b[a-f0-9]{40,64}\b/g) ?? [])].slice(0, 32) };
  }
  if (item.type !== 'mcp_tool_call' || item.status !== 'completed' || item.error || item.result?.isError) return null;
  const args = flatten(item.arguments), facts = flatten(item.result);
  if (facts.some(([key, val]) => /^(isError|error|ret|errcode)$/.test(key) && !['', '0', 'false', 'null'].includes(val))) return null;
  const operation = [item.tool, ...args.filter(([key]) => /^(tool|tool_name|name|api)$/.test(key)).map(([, value]) => value)]
    .find((value) => /^(comments_create|comments_get|stories_get|bugs_get|stories_update|bugs_update)$/.test(value));
  if (!operation) return null;
  const value = (name) => args.find(([key]) => key === name)?.[1] ?? null;
  return { id: item.id, kind: 'mcp', operation, entryId: value('entry_id') ?? value('id'), workspaceId: value('workspace_id'),
    requestedStatus: value('status'), checkWorkflow: value('check_workflow'),
    // Field names only; never persist descriptions, credentials or comment bodies.
    fields: args.map(([key]) => key),
    prFields: args.filter(([, val]) => /^https:\/\/[^\s?#]+\/(?:pull|merge_requests)\/\d+$/.test(val)),
    statuses: [...new Set(entityStatuses(item.result, value('id') ?? value('entry_id')))],
    identifiers: facts.filter(([key, val]) => /^(id|ID|comment_id)$/.test(key) && /^\d+$/.test(val)).map(([, val]) => val).slice(0, 100) };
}

function entityStatuses(value, entryId, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') {
    try { return entityStatuses(JSON.parse(value), entryId, depth + 1); } catch { return []; }
  }
  if (typeof value !== 'object') return [];
  const own = entryId && String(value.id ?? value.ID) === entryId && typeof value.status === 'string'
    ? [value.status] : [];
  return [...own, ...Object.values(value).flatMap((item) => entityStatuses(item, entryId, depth + 1))].slice(0, 100);
}

function flatten(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') {
    try { return flatten(JSON.parse(value), depth + 1); } catch { return []; }
  }
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? [[key, String(item)]] : []),
    ...flatten(item, depth + 1)
  ]).slice(0, 2000);
}

/** Verify actual tool receipts + local Git, not just the model's final prose. */
export async function verifyCodexWorkflow(task, result, workflow, {
  runGit = async (args) => (await exec('git', args, { cwd: task.execution?.cwd, timeout: 10000 })).stdout.trim()
} = {}) {
  const gates = result.outcome?.delivery;
  if (!Array.isArray(gates) || gates.some((gate) => !gate || typeof gate !== 'object')) return { passed: false, error: 'codex-delivery-records-missing' };
  const receipts = [...new Map([...(task.delivery?.receipts ?? []), ...(result.receipts ?? [])].map((item) => [item.id, item])).values()];
  const errors = [], verified = [];
  if (new Set(gates.map((g) => g.gate)).size !== gates.length) errors.push('duplicate-gates');
  for (const name of ['commit', 'pr', 'tapd_backfill']) {
    const gate = gates.find((g) => g.gate === name);
    if (!gate) { errors.push('missing-gate:' + name); continue; }
    if (!['proceed', 'skip', 'ask'].includes(gate.decision) || !String(gate.reason ?? '').trim()) { errors.push('invalid-gate:' + name); continue; }
    if (gate.decision === 'ask' || gate.status === 'blocked') { errors.push('waiting-user:' + name); continue; }
    if (gate.decision === 'skip') {
      if (gate.status !== 'skipped') errors.push('invalid-skip:' + name);
      continue;
    }
    if (gate.status !== 'done') { errors.push('delivery-failed:' + name); continue; }
    const previouslyVerified = task.delivery?.verification?.verified?.some((item) => item.gate === name && item.receipt === gate.receipt);
    if (workflow.mode === 'ask' && name !== 'pr' && !gateConsent(gate, workflow) && !previouslyVerified) {
      errors.push('consent-unverified:' + name); continue;
    }
    if (name === 'tapd_backfill' && (!workflow.tapd.enabled || !workflow.tapd.association)) { errors.push('tapd-not-applicable'); continue; }
    const proof = receipts;
    if (name === 'commit') {
      if (!/^[a-f0-9]{40,64}$/.test(gate.receipt ?? '')) { errors.push('invalid-commit'); continue; }
      try {
        const head = await runGit(['rev-parse', 'HEAD']);
        const branch = await runGit(['branch', '--show-current']);
        const prior = task.delivery?.verification?.verified?.some((item) => item.gate === 'commit' && item.receipt === head);
        const association = workflow.tapd.association;
        if (association && parseTapdBranchName(branch)?.shortId !== association.shortId
          && !workflow.ownerMessages.some((text) => text.includes(branch) && /确认|可用|使用/.test(text))) errors.push('commit-tapd-branch-mismatch');
        if (head !== gate.receipt || !branch || /^(main|master)$/.test(branch)
          || (workflow.initialHead === head && !prior)) errors.push('commit-head-mismatch');
        else verified.push({ gate: name, receipt: head, branch });
      } catch { errors.push('git-readback-failed'); }
    } else if (name === 'pr') {
      if (!/^https:\/\/[^\s?#]+\/(?:pull|merge_requests)\/\d+$/.test(gate.receipt ?? '')
        || !proof.some((r) => r.kind === 'command' && r.operation === 'pr' && r.identifiers.includes(gate.receipt))) errors.push('pr-receipt-unverified');
      else {
        try {
          const remotes = (await runGit(['remote'])).split(/\s+/).filter(Boolean);
          const targets = await Promise.all(remotes.map(async (remote) => parseGitRemote(await runGit(['remote', 'get-url', remote]))));
          const url = new URL(gate.receipt);
          if (!targets.some((target) => target && url.hostname === target.host
            && [ `/${target.projectPath}/pull/`, `/${target.projectPath}/merge_requests/`, `/${target.projectPath}/-/merge_requests/` ].some((prefix) => url.pathname.startsWith(prefix)))) errors.push('pr-repository-mismatch');
          else verified.push({ gate: name, receipt: gate.receipt });
        } catch { errors.push('pr-repository-unverified'); }
      }
    } else {
      const association = workflow.tapd.association;
      if (!proof.some((r) => r.kind === 'mcp' && r.entryId === String(association.entryId)
        && r.workspaceId === String(association.workspaceId) && r.identifiers.includes(gate.receipt))) errors.push('tapd-comment-unverified');
      else {
        const stateError = verifyTapdState(receipts, workflow);
        if (stateError) errors.push(stateError);
        else verified.push({ gate: name, receipt: gate.receipt });
      }
    }
  }
  return { passed: errors.length === 0, error: errors.length ? 'codex-delivery-unverified:' + errors.join(',') : null, verified };
}

function verifyTapdState(receipts, workflow) {
  const association = workflow.tapd.association;
  const bug = association.entryType === 'bug';
  const config = { ...(bug ? defaultTapdBugStatus() : defaultTapdStoryStatus()),
    ...(bug ? workflow.tapd.config?.tapd_bug : workflow.tapd.config?.tapd_story) };
  const doing = parseStatusChain(config.status_doing)[0];
  const done = new Set([...parseStatusChain(config.status_done), ...parseStatusChain(config.status_release), ...parseStatusChain(config.status_doing)]);
  let current = null, readBack = false;
  for (const receipt of receipts) {
    if (receipt.kind !== 'mcp' || receipt.entryId !== String(association.entryId)
      || receipt.workspaceId !== String(association.workspaceId)) continue;
    if (receipt.operation === (bug ? 'bugs_get' : 'stories_get') && receipt.identifiers.includes(String(association.entryId))) {
      if (receipt.statuses?.length === 1) { current = receipt.statuses[0]; readBack = true; }
    }
    if (receipt.operation !== (bug ? 'bugs_update' : 'stories_update')) continue;
    if (receipt.fields?.some((field) => ['description', 'test_focus'].includes(field))) return 'tapd-protected-field-updated';
    const prField = (bug ? workflow.tapd.config?.tapd_bug?.pr_field : workflow.tapd.config?.tapd_story?.pr_field) ?? workflow.tapd.config?.pr_field;
    const structural = new Set(['tool', 'tool_name', 'name', 'api', 'params', 'parameters', 'arguments', 'tool_args', 'tool_params', 'data', 'workspace_id', 'id', 'entry_id', 'status', 'check_workflow']);
    for (const field of receipt.fields ?? []) {
      if (structural.has(field)) continue;
      if (field !== prField && !workflow.ownerMessages.some((text) => /字段|field/i.test(text) && text.includes(field))) return 'tapd-field-not-authorized';
      if (!receipt.prFields?.some(([key]) => key === field)) return 'tapd-field-not-pr-link';
    }
    if (!receipt.requestedStatus) continue;
    const next = bug ? (current && !done.has(current) ? doing : null) : storySubmitRemainingPath(current, config)[0];
    if (!next || next !== receipt.requestedStatus || receipt.checkWorkflow !== 'permission,condition') return 'tapd-status-transition-unverified';
    current = next;
    readBack = false;
  }
  return current && done.has(current) && readBack ? null : 'tapd-status-readback-missing';
}

function gateConsent(gate, workflow) {
  const quote = String(gate.authorization ?? '').trim();
  if (!quote || /不要|先别|暂不|do not|don't|拒绝/i.test(quote)) return false;
  if (!workflow.ownerMessages.some((text) => String(text).includes(quote))) return false;
  if (/^(是|同意|好的|好|可以|需要|yes|y|ok|okay)[。.!！]?$/i.test(quote)) {
    return workflow.pendingGate === gate.gate
      && workflow.ownerMessages.at(-1)?.trim().split(/\r?\n/).at(-1)?.trim() === quote;
  }
  return gate.gate === 'commit' ? /提交|commit/i.test(quote) : /回填|backfill/i.test(quote);
}
