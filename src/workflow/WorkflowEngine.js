import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class WorkflowEngine {
  constructor({ root = process.cwd(), output = '.aafe', permissionPolicy = null, onEvent = () => {} } = {}) {
    this.dir = path.join(root, output, 'workflows'); this.permissionPolicy = permissionPolicy; this.onEvent = onEvent;
  }
  async run(definition, input = {}, { workflowId, authorizedLevels = [] } = {}) {
    if (!workflowId || !Array.isArray(definition?.nodes)) throw new Error('workflow-input-invalid');
    const state = await this.load(workflowId) ?? { version: 1, workflowId, workflow: definition.id, status: 'running', input, nodes: {}, receipts: [], createdAt: new Date().toISOString() };
    state.status = 'running';
    for (const node of definition.nodes) {
      if (state.nodes[node.id]?.status === 'completed') continue;
      state.nodes[node.id] = { status: 'running', startedAt: new Date().toISOString() }; await this.#save(state);
      await this.onEvent({ type: 'workflow.node.started', workflowId, nodeId: node.id });
      try {
        if (node.permission && this.permissionPolicy) this.permissionPolicy.assert(node.permission, { authorizedLevels });
        const result = await node.run({ input: state.input, state: clone(state), previous: previousOutput(definition.nodes, state, node.id) });
        const receipt = result?.receipt ? normalizeReceipt(node.id, result.receipt) : null;
        state.nodes[node.id] = { status: 'completed', output: clone(result?.output ?? result ?? null), completedAt: new Date().toISOString(), receipt };
        if (receipt && !state.receipts.some((item) => item.id === receipt.id)) state.receipts.push(receipt);
        await this.#save(state); await this.onEvent({ type: 'workflow.node.completed', workflowId, nodeId: node.id });
      } catch (error) {
        state.status = error?.name === 'PermissionDeniedError' ? 'blocked' : 'failed';
        state.nodes[node.id] = { ...state.nodes[node.id], status: state.status, error: error.message, completedAt: new Date().toISOString() };
        await this.#save(state); await this.onEvent({ type: `workflow.${state.status}`, workflowId, nodeId: node.id, error: error.message });
        return clone(state);
      }
    }
    state.status = 'completed'; state.completedAt = new Date().toISOString(); await this.#save(state); return clone(state);
  }
  async load(workflowId) { try { return JSON.parse(await readFile(this.#file(workflowId), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async #save(state) { await mkdir(this.dir, { recursive: true }); const file = this.#file(state.workflowId); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(state, null, 2) + '\n'); await rename(temp, file); }
  #file(id) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('workflow-id-invalid'); return path.join(this.dir, `${id}.json`); }
}

export function createDeliveryWorkflow({ analyze, implement, test, commit, pullRequest, tapdBackfill }) {
  return { id: 'code-delivery', nodes: [
    { id: 'analyze', run: analyze }, { id: 'implement', permission: { description: 'workspace write' }, run: implement },
    { id: 'test', permission: { command: 'npm test' }, run: test },
    { id: 'commit', permission: { command: 'git commit' }, run: commit },
    { id: 'pull-request', permission: { command: 'gh pr create' }, run: pullRequest },
    { id: 'tapd-backfill', permission: { command: 'tapd comment backfill' }, run: tapdBackfill }
  ].filter((node) => typeof node.run === 'function') };
}

function previousOutput(nodes, state, id) { const index = nodes.findIndex((node) => node.id === id); return index > 0 ? state.nodes[nodes[index - 1].id]?.output : null; }
function normalizeReceipt(nodeId, receipt) { return { id: String(receipt.id ?? `${nodeId}:${receipt.ref ?? 'done'}`), nodeId, type: receipt.type ?? nodeId, ref: receipt.ref ?? null, verified: receipt.verified === true, createdAt: receipt.createdAt ?? new Date().toISOString() }; }
function clone(value) { return value == null ? value : structuredClone(value); }
