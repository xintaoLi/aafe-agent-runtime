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

import { TaskStore } from '../tasks/TaskStore.js';
import { OpenSpecAdapter } from './OpenSpecAdapter.js';
import { SDDStore } from './SDDStore.js';
import { assertSDDArtifactWritable } from './SDDState.js';
import { SDDValidator } from './SDDValidator.js';

export class SDDEngine {
  constructor({
    root = process.cwd(),
    output = '.aafe',
    openspecRoot = 'openspec',
    schema = 'spec-driven',
    approvalRequired = true,
    taskStore = null,
    store = null,
    adapter = null,
    validator = null
  } = {}) {
    if (schema !== 'spec-driven') throw new Error(`unsupported-sdd-schema:${schema}`);
    this.root = root;
    this.output = output;
    this.schema = schema;
    this.approvalRequired = approvalRequired;
    this.taskStore = taskStore ?? new TaskStore({ root, output });
    this.store = store ?? new SDDStore({ root, output });
    this.adapter = adapter ?? new OpenSpecAdapter({ root, openspecRoot });
    this.validator = validator ?? new SDDValidator();
  }

  async createChange({ taskId, changeId = null, slug = null, title = null } = {}) {
    const task = await this.#requireTask(taskId);
    if (task.sdd?.changeId) throw new Error(`task-sdd-already-bound:${task.id}:${task.sdd.changeId}`);
    const normalizedSlug = slugify(slug ?? title ?? task.goal ?? task.requirement ?? 'change');
    const id = changeId ?? buildChangeId(task.id, normalizedSlug);
    const owner = await this.store.findByChangeId(id);
    if (owner) throw new Error(`sdd-change-id-already-bound:${id}:${owner.taskId}`);
    let openspecCreated = false;
    let storeCreated = false;
    try {
      const publicChange = await this.adapter.createChange({
        taskId: task.id,
        changeId: id,
        slug: normalizedSlug,
        schema: this.schema,
        createdAt: new Date().toISOString()
      });
      openspecCreated = true;
      const change = await this.store.create(task.id, {
        changeId: id,
        slug: normalizedSlug,
        schema: this.schema,
        openspecPath: publicChange.path
      });
      storeCreated = true;
      await this.#mirror(task.id, change);
      await this.#event(task.id, 'sdd.change.created', {
        changeId: id,
        openspecPath: publicChange.path
      });
      return change;
    } catch (error) {
      if (storeCreated) await this.store.remove(task.id);
      if (openspecCreated) await this.adapter.removeChange(id);
      throw error;
    }
  }

  async get(taskId) {
    return this.store.get(taskId);
  }

  async writeArtifact(taskId, artifact, content, options = {}) {
    const change = await this.store.require(taskId);
    assertSDDArtifactWritable(artifact, change.artifacts);
    const capability = artifact === 'spec' ? requireCapability(options.capability) : null;
    const previous = await this.adapter.readArtifact(change.changeId, artifact, { capability });
    const written = await this.adapter.writeArtifact(change.changeId, artifact, content, { capability });
    try {
      const revised = await this.store.revise(taskId, {
        artifact,
        capability,
        artifactPath: written.path,
        content,
        reason: options.reason ?? null
      });
      await this.#mirror(taskId, revised.change);
      await this.#event(taskId, 'sdd.artifact.revised', {
        artifact,
        capability,
        revision: revised.change.revision,
        path: written.path
      });
      return revised;
    } catch (error) {
      if (previous == null) await this.adapter.deleteArtifact(change.changeId, artifact, { capability });
      else await this.adapter.writeArtifact(change.changeId, artifact, previous, { capability });
      throw error;
    }
  }

  async validate(taskId) {
    const change = await this.store.require(taskId);
    const [artifacts, traceability] = await Promise.all([
      this.adapter.readChange(change.changeId),
      this.store.getTraceability(taskId)
    ]);
    const result = this.validator.validate(change, artifacts, traceability);
    const hasCurrentApproval = change.approval?.revision === change.revision;
    const targetStatus = !result.valid
      ? 'draft'
      : hasCurrentApproval
        ? change.status
        : (this.approvalRequired ? 'waiting_approval' : 'ready');
    const updated = await this.store.update(taskId, {
      status: targetStatus,
      validation: {
        ...result,
        revision: change.revision,
        validatedAt: new Date().toISOString()
      },
      approval: hasCurrentApproval
        ? change.approval
        : result.valid && !this.approvalRequired
          ? { revision: change.revision, approvedAt: new Date().toISOString(), approvedBy: 'policy' }
          : null
    });
    await this.#mirror(taskId, updated);
    await this.#event(taskId, 'sdd.change.validated', {
      valid: result.valid,
      revision: change.revision,
      errors: result.errors.length,
      warnings: result.warnings.length
    });
    return { change: updated, ...result };
  }

  async approve(taskId, { approvedBy = 'user' } = {}) {
    const change = await this.store.require(taskId);
    if (!change.validation?.valid || change.validation.revision !== change.revision) {
      throw new Error(`sdd-approval-requires-current-validation:${taskId}`);
    }
    const updated = await this.store.update(taskId, {
      status: 'ready',
      approval: {
        revision: change.revision,
        approvedAt: new Date().toISOString(),
        approvedBy
      }
    });
    await this.#mirror(taskId, updated);
    await this.#event(taskId, 'sdd.change.approved', {
      revision: change.revision,
      approvedBy
    });
    return updated;
  }

  async getApplyContext(taskId, { markImplementing = false } = {}) {
    let change = await this.store.require(taskId);
    assertReady(change);
    if (markImplementing && change.status === 'ready') {
      change = await this.store.update(taskId, { status: 'implementing' });
      await this.#mirror(taskId, change);
      await this.#event(taskId, 'sdd.apply.started', { revision: change.revision });
    }
    const [task, context, artifacts, traceability] = await Promise.all([
      this.#requireTask(taskId),
      this.taskStore.getContext(taskId),
      this.adapter.readChange(change.changeId),
      this.store.getTraceability(taskId)
    ]);
    return {
      task: {
        id: task.id,
        goal: task.goal,
        requirement: task.requirement,
        repository: task.repository,
        baseBranch: task.baseBranch,
        taskBranch: task.taskBranch
      },
      taskContext: context,
      sdd: {
        changeId: change.changeId,
        revision: change.revision,
        schema: change.schema,
        artifacts,
        traceability
      },
      projectCapabilities: {
        discovery: 'repository-native',
        rules: '.ai-agent',
        skills: '.ai-agent',
        embedded: false
      }
    };
  }

  async setTraceability(taskId, traceability, options = {}) {
    const change = await this.store.require(taskId);
    const value = {
      ...structuredClone(traceability),
      taskId: change.taskId,
      changeId: change.changeId,
      revision: change.revision + 1
    };
    const revised = await this.store.setTraceability(taskId, value, options);
    await this.#mirror(taskId, revised.change);
    await this.#event(taskId, 'sdd.traceability.revised', { revision: revised.change.revision });
    return revised;
  }

  async recordVerification(taskId, verification) {
    let change = await this.store.require(taskId);
    if (!['implementing', 'verifying'].includes(change.status)) {
      throw new Error(`sdd-verification-not-allowed:${change.status}`);
    }
    if (change.status === 'implementing') {
      change = await this.store.update(taskId, { status: 'verifying' });
    }
    const status = verification?.status ?? (verification?.passed === true ? 'passed' : 'failed');
    if (!['passed', 'failed', 'partial'].includes(status)) {
      throw new Error(`invalid-sdd-verification-status:${status}`);
    }
    const updated = await this.store.update(taskId, {
      status: status === 'passed' ? 'verified' : (status === 'failed' ? 'failed' : 'verifying'),
      verification: {
        ...structuredClone(verification ?? {}),
        status,
        revision: change.revision,
        verifiedAt: new Date().toISOString()
      }
    });
    await this.#mirror(taskId, updated);
    await this.#event(taskId, 'sdd.verification.recorded', { status, revision: change.revision });
    return updated;
  }

  async sync(taskId, { dryRun = false } = {}) {
    const change = await this.store.require(taskId);
    if (!change.validation?.valid || change.validation.revision !== change.revision) {
      throw new Error(`sdd-sync-requires-current-validation:${taskId}`);
    }
    if (!change.approval || change.approval.revision !== change.revision) {
      throw new Error(`sdd-sync-requires-current-approval:${taskId}`);
    }
    const result = await this.adapter.sync(change.changeId, { dryRun });
    if (dryRun) return { change, ...result };
    const updated = await this.store.update(taskId, {
      status: 'synced',
      syncedAt: new Date().toISOString()
    });
    await this.#mirror(taskId, updated);
    await this.#event(taskId, 'sdd.change.synced', { specs: result.specs });
    return { change: updated, ...result };
  }

  async archive(taskId, { dryRun = false, allowUnverified = false, now = new Date() } = {}) {
    let change = await this.store.require(taskId);
    if (!change.validation?.valid || change.validation.revision !== change.revision) {
      throw new Error(`sdd-archive-requires-current-validation:${taskId}`);
    }
    if (!change.approval || change.approval.revision !== change.revision) {
      throw new Error(`sdd-archive-requires-current-approval:${taskId}`);
    }
    if (!allowUnverified && change.verification?.status !== 'passed') {
      throw new Error(`sdd-archive-requires-passed-verification:${taskId}`);
    }
    if (!change.syncedAt) {
      if (dryRun) {
        const sync = await this.adapter.sync(change.changeId, { dryRun: true });
        const archive = await this.adapter.archive(change.changeId, { dryRun: true, now });
        return { change, dryRun: true, sync, archive };
      }
      ({ change } = await this.sync(taskId));
    }
    const archived = await this.adapter.archive(change.changeId, { dryRun, now });
    if (dryRun) return { change, dryRun: true, archive: archived };
    let updated;
    try {
      updated = await this.store.update(taskId, {
        status: 'archived',
        archivedAt: new Date().toISOString(),
        archivePath: archived.to
      });
    } catch (error) {
      await this.adapter.restoreArchive(archived);
      throw error;
    }
    await this.#mirror(taskId, updated);
    await this.#event(taskId, 'sdd.change.archived', { archivePath: archived.to });
    return { change: updated, archive: archived };
  }

  async revisions(taskId) {
    return this.store.revisions(taskId);
  }

  async traceability(taskId) {
    return this.store.getTraceability(taskId);
  }

  async #requireTask(taskId) {
    const task = await this.taskStore.get(taskId);
    if (!task) throw new Error(`task-not-found:${taskId}`);
    return task;
  }

  async #mirror(taskId, change) {
    await this.taskStore.update(taskId, {
      sdd: {
        changeId: change.changeId,
        status: change.status,
        revision: change.revision,
        openspecPath: change.openspecPath,
        validation: change.validation
          ? { valid: change.validation.valid, revision: change.validation.revision }
          : null,
        approval: change.approval
          ? { revision: change.approval.revision, approvedAt: change.approval.approvedAt }
          : null
      }
    }, {
      eventType: null
    });
  }

  async #event(taskId, type, payload) {
    await this.taskStore.appendEvent(taskId, type, payload);
  }
}

function assertReady(change) {
  if (!['ready', 'implementing', 'verifying', 'verified', 'synced'].includes(change.status)) {
    throw new Error(`sdd-change-not-ready:${change.status}`);
  }
  if (!change.validation?.valid || change.validation.revision !== change.revision) {
    throw new Error('sdd-change-validation-stale');
  }
  if (!change.approval || change.approval.revision !== change.revision) {
    throw new Error('sdd-change-approval-stale');
  }
}

function requireCapability(value) {
  const capability = String(value ?? '').trim();
  if (!capability) throw new Error('sdd-spec-capability-required');
  return capability;
}

function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'change';
}

function buildChangeId(taskId, slug) {
  const suffix = `-${slug}`;
  const maxTaskLength = 159 - suffix.length;
  return `${String(taskId).slice(0, Math.max(1, maxTaskLength))}${suffix}`;
}
