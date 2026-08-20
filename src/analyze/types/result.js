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
 * @typedef {object} Evidence
 * @property {'source'|'ast'|'dependency'|'route'|'api'|'config'} type
 * @property {string} file
 * @property {number} [startLine]
 * @property {number} [endLine]
 * @property {string} [symbol]
 * @property {string} [reason]
 */

/**
 * @typedef {object} AnalysisStats
 * @property {number} [scannedFiles]
 * @property {number} [symbols]
 * @property {number} [modules]
 * @property {number} [dependencies]
 * @property {number} [flows]
 * @property {number} [features]
 * @property {number} [businessCandidates]
 * @property {number} [durationMs]
 */

/**
 * @typedef {object} Diagnostic
 * @property {'info'|'warn'|'error'} level
 * @property {string} code
 * @property {string} message
 * @property {string} [file]
 */

/**
 * @typedef {object} AnalysisResult
 * @property {string} analyzer
 * @property {string} version
 * @property {'success'|'partial'|'failed'} status
 * @property {*} data
 * @property {Evidence[]} evidence
 * @property {Diagnostic[]} diagnostics
 * @property {AnalysisStats} stats
 */

/**
 * @param {string} analyzer
 * @param {string} version
 * @param {*} data
 * @param {object} [extra]
 * @returns {AnalysisResult}
 */
export function createAnalysisResult(analyzer, version, data, extra = {}) {
  return {
    analyzer,
    version,
    status: extra.status ?? 'success',
    data,
    evidence: extra.evidence ?? [],
    diagnostics: extra.diagnostics ?? [],
    stats: extra.stats ?? {}
  };
}
