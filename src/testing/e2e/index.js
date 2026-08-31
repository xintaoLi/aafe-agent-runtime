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

export { loadE2eConfig, sanitizeBaseUrl, combineEntryUrl, parseTestPageUrl, normalizeUrlRole, expandSecretRef, isE2eEnabled, DEFAULT_E2E_CONFIG, NEED_BASE_URL_CODE, NEED_BASE_URL_PROMPT, NEED_URL_ROLE_CODE, NEED_URL_ROLE_PROMPT } from './config.js';
export {
  DEFAULT_E2E_AUTH,
  NEED_AUTH_CODE,
  NEED_AUTH_PROMPT,
  normalizeAuthMode,
  resolveAuthStatePath,
  storageStateLooksValid,
  sessionLooksLoggedOut,
  accessAllowsSkipAuth,
  probeAnonymousAccess,
  prepareE2eAuth,
  captureAuthState
} from './auth.js';
export { planTestLayers, shouldRouteToUnitChain } from './layers.js';
export {
  renderSmokeCase,
  renderFeatureCase,
  parseCaseYaml,
  listCases,
  writeCases,
  existingEntrySet,
  isRealRoute,
  normalizeEntry,
  nextIds
} from './yaml.js';
export { matchExistingCases } from './match.js';
export { buildInventoryPack, writeInventoryCases, persistImpactPack, runCoverageGeneration } from './inventory.js';
export { parsePrUrl, fetchPullRequest, resolvePrToken, INLINE_TOKEN_REJECTION, redactSecrets } from './pr.js';
export { compileCaseToSpec, writeCompiledSpecs, renderPlaywrightConfig } from './compile.js';
export { executeE2eCases, detectPlaywright } from './runner.js';
export { writeUnifiedReport, buildReport, createRunId, EXIT_CODE, worstStatus } from './report.js';
