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

import { agentPartial, agentSkipped, agentSuccess } from '../../agent-platform/protocol/response.js';
import {
  findingsToKnowledgeUpdates,
  summarizeFindings,
  validateFileExists,
  validateFlowTraceable,
  validateHasEvidence
} from '../../knowledge/validator/rules.js';
import { normalizeModuleId } from '../../knowledge/model/index.js';

/**
 * A5 — Knowledge Validator.
 *
 * Sits between knowledge production and knowledge consumption (RFC §18). It
 * runs on deterministic rules only, and it never deletes an impact item on its
 * own: rejected entries are reported so the context agent can exclude them,
 * which keeps a validator bug from silently hiding real findings.
 */
export class KnowledgeValidatorAgent {
  id = 'knowledge-validator';
  version = '1.0.0';

  constructor({ knowledge = null } = {}) {
    this.knowledge = knowledge;
  }

  async run(request) {
    const root = request.context?.root ?? process.cwd();
    const knowledge = request.context?.knowledge ?? this.knowledge;
    if (!knowledge) {
      return agentSkipped('knowledge-store-unavailable');
    }

    const impact = pickImpact(request);
    if (!impact) {
      return agentSkipped('no-impact-report-to-validate', {
        nextActions: [{ capability: 'requirement-impact', reason: 'validation needs an impact report first' }]
      });
    }

    const started = Date.now();
    const [modulesIndex, features] = await Promise.all([knowledge.modulesIndex(), knowledge.features()]);
    const knownModules = new Set(modulesIndex.map((entry) => normalizeModuleId(entry.id)));
    const knownFiles = new Set((await knowledge.fileToModuleIndex()).keys());

    const findings = [];

    for (const item of impact.affectedFiles ?? []) {
      findings.push(await validateFileExists(root, item.id));
    }
    for (const item of impact.affectedModules ?? []) {
      const id = normalizeModuleId(item.id);
      findings.push(knownModules.has(id)
        ? { verdict: 'ok', rule: 'module-exists', target: id }
        : { verdict: 'reject', rule: 'module-exists', target: id, detail: 'module not in analyze output' });
    }
    for (const item of impact.affectedFeatures ?? []) {
      const feature = features.find((candidate) => candidate.id === item.id) ?? item;
      findings.push(validateHasEvidence('feature', feature));
    }
    for (const item of impact.affectedDataFlows ?? []) {
      findings.push(validateFlowTraceable({ id: item.id, nodes: item.nodes ?? nodesFromEdges(item) }, knownFiles));
    }
    for (const item of impact.affectedBusinessFlows ?? []) {
      findings.push(validateHasEvidence('business', item));
    }

    const summary = summarizeFindings(findings);
    const rejected = findings.filter((item) => item.verdict === 'reject').map((item) => item.target);
    const downgraded = findings.filter((item) => item.verdict === 'downgrade').map((item) => item.target);

    const result = {
      checked: findings.length,
      summary,
      rejected,
      downgraded,
      findings: findings.filter((item) => item.verdict !== 'ok').slice(0, 50),
      trustedImpact: filterImpact(impact, new Set(rejected))
    };

    const response = {
      knowledgeUpdates: findingsToKnowledgeUpdates(findings, 'impact'),
      metrics: { duration: Date.now() - started }
    };

    if (findings.length === 0) {
      return agentSuccess({ ...result, note: 'impact report was empty; nothing to validate' }, response);
    }
    return summary.reject > 0
      ? agentPartial(result, `${summary.reject} knowledge item(s) rejected`, response)
      : agentSuccess(result, response);
  }
}

/**
 * The planner passes the capability name; the actual payload comes from the
 * prior results carried on the request context.
 */
function pickImpact(request) {
  const prior = request.context?.priorResults;
  if (!prior) return null;
  const entries = prior instanceof Map ? Array.from(prior.entries()) : Object.entries(prior);
  for (const key of ['requirement-impact', 'change-impact']) {
    const found = entries.find(([capability]) => capability === key);
    if (found?.[1]?.result) return found[1].result;
  }
  return null;
}

function filterImpact(impact, rejected) {
  const keep = (items = []) => items.filter((item) => !rejected.has(normalizeModuleId(item.id)) && !rejected.has(item.id));
  return {
    ...impact,
    affectedFiles: keep(impact.affectedFiles),
    affectedModules: keep(impact.affectedModules),
    affectedFeatures: keep(impact.affectedFeatures),
    affectedDataFlows: keep(impact.affectedDataFlows),
    affectedBusinessFlows: keep(impact.affectedBusinessFlows)
  };
}

function nodesFromEdges(item) {
  return (item.edges ?? []).flatMap((edge) => [edge.from, edge.to]).filter(Boolean);
}
