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

import { agentFailed, normalizeAgentResponse } from '../protocol/response.js';
import { ContractLoader } from '../schema/loader.js';
import { buildRepairPrompt, coerceAndValidate } from '../schema/repair.js';
import { formatSchemaErrors, validateSchema } from '../schema/validate.js';
import { withTimeout } from '../policy/ExecutionPolicy.js';
import EVIDENCE_SCHEMA from './evidenceSchema.js';

/**
 * The single execution path every agent takes (AGENTS.SCHEMA §13), regardless
 * of whether it is deterministic local code, an HTTP service, a CLI, an MCP
 * tool or an IDE handoff:
 *
 *   load contract -> validate input -> build context -> invoke
 *   -> validate output -> repair loop -> validate evidence -> normalize
 *
 * The orchestrator deliberately does not know any of this. It decides *when* an
 * agent runs; the runtime decides what a valid run looks like.
 */
export class AgentRuntime {
  /**
   * @param {object} options
   * @param {Record<string, {invoke: Function}>} options.providers
   * @param {ContractLoader} [options.contracts]
   * @param {(event: object) => void} [options.onEvent]
   */
  constructor({ providers = {}, contracts = null, root = process.cwd(), onEvent = () => {} } = {}) {
    this.providers = providers;
    this.contracts = contracts ?? new ContractLoader({ root });
    this.onEvent = onEvent;
  }

  get warnings() {
    return this.contracts.warnings;
  }

  /**
   * @param {import('../registry/definition.js').AgentDefinition} definition
   * @param {object} request  AgentRequest
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<object>} AgentResponse with a `contract` diagnostic block.
   */
  async invoke(definition, request, { signal = null } = {}) {
    const provider = this.providers[definition.provider];
    if (!provider) {
      return agentFailed(`unknown-provider:${definition.provider}`);
    }

    const contract = await this.contracts.contractsFor(definition);
    const mode = definition.schemaMode ?? 'enforce';
    const diagnostics = { mode, repairs: [], attempts: 0 };

    const started = Date.now();
    const withDiagnostics = (response) => ({
      ...response,
      metrics: { ...response.metrics, duration: response.metrics?.duration ?? Date.now() - started },
      contract: diagnostics
    });

    const inputCheck = this.#checkInput(request.input, contract.inputSchema, mode, diagnostics);
    if (inputCheck) return withDiagnostics(inputCheck);

    const enriched = this.#buildRequest(definition, request, contract);

    let response = await this.#invokeOnce(provider, definition, enriched, signal, diagnostics);
    response = await this.#validateOutput(provider, definition, enriched, response, contract, mode, diagnostics, signal);
    response = this.#validateEvidence(response, mode, diagnostics);

    return withDiagnostics(response);
  }

  /**
   * The agent sees its own prompt and schemas on the request, so a remote
   * implementation never has to ship a copy of the contract it must satisfy.
   */
  #buildRequest(definition, request, contract) {
    return {
      ...request,
      agent: {
        id: definition.id,
        model: definition.model ?? null,
        endpoint: definition.endpoint ?? null,
        tools: definition.tools ?? []
      },
      contract: {
        prompt: contract.prompt,
        inputSchema: contract.inputSchema,
        outputSchema: contract.outputSchema
      },
      constraints: {
        ...request.constraints,
        ...pickDefined(definition.constraints ?? {})
      }
    };
  }

  async #invokeOnce(provider, definition, request, signal, diagnostics) {
    diagnostics.attempts += 1;
    if (signal?.aborted) return agentFailed('cancelled');
    try {
      const timeoutMs = request.constraints?.timeoutMs ?? 0;
      const raw = await withTimeout(
        () => provider.invoke(definition, request, { signal }),
        timeoutMs,
        `${definition.id}:${request.capability}`
      );
      return normalizeAgentResponse(raw);
    } catch (error) {
      return agentFailed(error instanceof Error ? error.message : String(error));
    }
  }

  #checkInput(input, schema, mode, diagnostics) {
    if (!schema || mode === 'off') return null;
    const { valid, errors } = validateSchema(input ?? null, schema);
    if (valid) {
      diagnostics.input = 'ok';
      return null;
    }

    const detail = formatSchemaErrors(errors);
    diagnostics.input = detail;
    // An invalid input is the platform's own bug: the planner built it. Failing
    // loudly here is cheaper than letting an agent answer a malformed question.
    if (mode === 'enforce') return agentFailed(`input-schema-violation: ${detail}`);
    return null;
  }

  /**
   * Coerce, validate, and only then ask the model to try again. Skipped and
   * failed responses carry no result to validate.
   */
  async #validateOutput(provider, definition, request, response, contract, mode, diagnostics, signal) {
    const schema = contract.outputSchema;
    if (!schema || mode === 'off') return response;
    if (response.status !== 'success' && response.status !== 'partial') return response;

    const maxAttempts = Math.max(0, definition.maxRepairAttempts ?? 2);
    let current = response;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      const checked = coerceAndValidate(current.result, schema);
      diagnostics.repairs.push(...checked.repairs);

      if (checked.valid) {
        diagnostics.output = attempt === 0 ? 'ok' : `ok-after-repair:${attempt}`;
        return { ...current, result: checked.value };
      }

      const detail = formatSchemaErrors(checked.errors);
      diagnostics.output = detail;
      if (attempt === maxAttempts) break;

      const repaired = await this.#requestRepair(provider, definition, request, current, schema, checked.errors, signal);
      // A deterministic agent has no repair round to offer; re-asking it would
      // return the identical payload forever, so stop at the first no-op.
      if (!repaired || sameResult(repaired.result, current.result)) break;
      current = repaired;
    }

    this.onEvent({ type: 'schema-violation', agent: definition.id, capability: request.capability, detail: diagnostics.output });

    if (mode === 'enforce') {
      return agentFailed(`output-schema-violation: ${diagnostics.output}`, {
        result: current.result,
        evidence: current.evidence,
        metrics: current.metrics
      });
    }
    // In `warn` mode the result still flows, but never as `success`: a consumer
    // reading only the status must not mistake it for a clean answer.
    return { ...current, status: 'partial', reason: current.reason ?? `output-schema-violation: ${diagnostics.output}` };
  }

  async #requestRepair(provider, definition, request, response, schema, errors, signal) {
    if (typeof provider.supportsRepair === 'function' && !provider.supportsRepair(definition)) return null;

    const repairRequest = {
      ...request,
      repair: {
        attempt: request.repair ? request.repair.attempt + 1 : 1,
        errors,
        schema,
        previous: response.result,
        prompt: buildRepairPrompt({
          schemaTitle: schema.title,
          schema,
          errors,
          previous: response.result
        })
      }
    };
    const repaired = await this.#invokeOnce(provider, definition, repairRequest, signal, { attempts: 0 });
    return repaired.status === 'success' || repaired.status === 'partial' ? repaired : null;
  }

  /**
   * Evidence that does not point at anything is worse than no evidence: it
   * makes an unsupported claim look supported. Malformed entries are dropped
   * and counted rather than silently carried into the context package.
   */
  #validateEvidence(response, mode, diagnostics) {
    const evidence = Array.isArray(response.evidence) ? response.evidence : [];
    if (evidence.length === 0 || mode === 'off') return response;

    const kept = evidence.filter((entry) => validateSchema(entry, EVIDENCE_SCHEMA).valid);
    const dropped = evidence.length - kept.length;
    if (dropped === 0) {
      diagnostics.evidence = 'ok';
      return response;
    }

    diagnostics.evidence = `dropped ${dropped} malformed evidence entr${dropped === 1 ? 'y' : 'ies'}`;
    return { ...response, evidence: kept };
  }
}

export function createAgentRuntime(options) {
  return new AgentRuntime(options);
}

function pickDefined(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null));
}

function sameResult(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
