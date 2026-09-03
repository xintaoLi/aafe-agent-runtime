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
 * Process-local bounded scheduler. Durable queue state belongs to TaskStore;
 * recover() re-enqueues persisted work after a process restart.
 */
export class TaskScheduler {
  constructor({ maxConcurrentTasks = 4, onEvent = () => {} } = {}) {
    this.maxConcurrentTasks = positiveInteger(maxConcurrentTasks, 4);
    this.onEvent = onEvent;
    this.queue = [];
    this.running = new Map();
    this.known = new Set();
  }

  schedule(taskId, worker) {
    if (this.known.has(taskId)) throw new Error(`task-already-scheduled:${taskId}`);
    this.known.add(taskId);

    const promise = new Promise((resolve, reject) => {
      this.queue.push({ taskId, worker, resolve, reject });
      this.onEvent({ type: 'scheduler.queued', taskId, stats: this.stats() });
      this.#drain();
    });
    return promise;
  }

  cancelQueued(taskId) {
    const index = this.queue.findIndex((entry) => entry.taskId === taskId);
    if (index < 0) return false;
    const [entry] = this.queue.splice(index, 1);
    this.known.delete(taskId);
    entry.resolve({ cancelled: true, reason: 'cancelled-while-queued' });
    this.onEvent({ type: 'scheduler.cancelled', taskId, stats: this.stats() });
    return true;
  }

  has(taskId) {
    return this.known.has(taskId);
  }

  stats() {
    return {
      maxConcurrentTasks: this.maxConcurrentTasks,
      running: this.running.size,
      queued: this.queue.length,
      runningTaskIds: [...this.running.keys()],
      queuedTaskIds: this.queue.map((entry) => entry.taskId)
    };
  }

  #drain() {
    while (this.running.size < this.maxConcurrentTasks && this.queue.length > 0) {
      const entry = this.queue.shift();
      const run = Promise.resolve().then(() => entry.worker());
      this.running.set(entry.taskId, run);
      this.onEvent({ type: 'scheduler.started', taskId: entry.taskId, stats: this.stats() });
      run.then(entry.resolve, entry.reject).finally(() => {
        this.running.delete(entry.taskId);
        this.known.delete(entry.taskId);
        this.onEvent({ type: 'scheduler.finished', taskId: entry.taskId, stats: this.stats() });
        this.#drain();
      });
    }
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
