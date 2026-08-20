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
 * Knowledge model shared by the impact, validator and context agents.
 *
 * @typedef {'module'|'feature'|'route'|'component'|'flow'|'file'} KnowledgeKind
 *
 * @typedef KnowledgeItem
 * @property {KnowledgeKind} kind
 * @property {string} id
 * @property {string} label
 * @property {object[]} evidence
 * @property {number} confidence
 * @property {'verified'|'unverified'|'rejected'} [verification]
 *
 * @typedef ImpactItem
 * @property {string} id
 * @property {string} label
 * @property {number} score
 * @property {string} why
 * @property {object[]} evidence
 *
 * @typedef {'low'|'medium'|'high'} RiskLevel
 *
 * @typedef ImpactReport
 * @property {'requirement'|'diff'} source
 * @property {ImpactItem[]} affectedFiles
 * @property {ImpactItem[]} affectedModules
 * @property {ImpactItem[]} affectedFeatures
 * @property {ImpactItem[]} affectedDataFlows
 * @property {ImpactItem[]} affectedBusinessFlows
 * @property {string[]} affectedTests
 * @property {RiskLevel} risk
 * @property {number} confidence
 */

/**
 * Module ids appear bare in `modules/index.json` but prefixed in relation
 * edges (`module:src-cli`). Everything downstream uses the bare form.
 */
export function normalizeModuleId(id) {
  return String(id ?? '').replace(/^module:/, '');
}

export function createImpactItem(partial = {}) {
  return {
    id: partial.id ?? '',
    label: partial.label ?? partial.id ?? '',
    score: Number.isFinite(partial.score) ? Number(partial.score.toFixed(3)) : 0,
    why: partial.why ?? '',
    evidence: partial.evidence ?? []
  };
}

export function createImpactReport(partial = {}) {
  return {
    source: partial.source ?? 'requirement',
    affectedFiles: partial.affectedFiles ?? [],
    affectedModules: partial.affectedModules ?? [],
    affectedFeatures: partial.affectedFeatures ?? [],
    affectedDataFlows: partial.affectedDataFlows ?? [],
    affectedBusinessFlows: partial.affectedBusinessFlows ?? [],
    affectedTests: partial.affectedTests ?? [],
    risk: partial.risk ?? 'low',
    confidence: partial.confidence ?? 0
  };
}

/**
 * Risk grows with blast radius, then gets bumped when the touched modules were
 * already flagged risky by the architecture analyzer.
 * @returns {RiskLevel}
 */
export function deriveRisk({ moduleCount = 0, fileCount = 0, architectureRisks = 0 }) {
  let score = 0;
  if (moduleCount >= 5 || fileCount >= 25) score += 2;
  else if (moduleCount >= 2 || fileCount >= 8) score += 1;
  if (architectureRisks > 0) score += 1;
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}
