/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Licensed under the MIT License.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInvocationMetric, validateInvocationMetric } from './invocation.js';

export class InvocationMetricStore {
  constructor({ root = process.cwd(), output = '.aafe', file = null } = {}) {
    this.file = file ?? path.join(root, output, 'telemetry', 'invocations.jsonl');
    this.queue = Promise.resolve();
  }

  async append(input) {
    const metric = createInvocationMetric(input);
    if (!validateInvocationMetric(metric)) throw new Error('invocation-metric-invalid');
    const write = this.queue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, `${JSON.stringify(metric)}\n`, { encoding: 'utf8', mode: 0o600 });
    });
    this.queue = write.catch(() => {});
    await write;
    return metric;
  }

  async list() {
    await this.queue;
    let content;
    try { content = await readFile(this.file, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return content.split('\n').filter(Boolean).map((line, index) => {
      let metric;
      try { metric = JSON.parse(line); }
      catch { throw new Error(`invocation-metric-json-invalid:${index + 1}`); }
      if (!validateInvocationMetric(metric)) throw new Error(`invocation-metric-invalid:${index + 1}`);
      return metric;
    });
  }
}

/** Observability must never turn a successful model call into a failed task. */
export async function recordInvocationSafely(store, metric, onError = () => {}) {
  if (!store?.append) return null;
  try { return await store.append(metric); }
  catch (error) {
    try { onError(error); } catch { /* observers are isolated */ }
    return null;
  }
}
