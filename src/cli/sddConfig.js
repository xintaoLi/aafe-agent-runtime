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

const ENABLED = new Set(['1', 'true', 'yes', 'on', 'enabled', '开启', '启用']);
const DISABLED = new Set(['0', 'false', 'no', 'off', 'disabled', '关闭', '禁用']);

export function defaultSDDConfig() {
  return {
    enabled: true,
    root: 'openspec',
    schema: 'spec-driven',
    approvalRequired: true
  };
}

export function resolveSDDConfig(projectConfig = {}, overrides = {}) {
  const raw = projectConfig.sdd && typeof projectConfig.sdd === 'object' ? projectConfig.sdd : {};
  const defaults = defaultSDDConfig();
  return {
    ...defaults,
    ...raw,
    enabled: normalizeBoolean(overrides.enabled ?? raw.enabled, defaults.enabled),
    root: nonEmpty(overrides.root ?? raw.root) ?? defaults.root,
    schema: nonEmpty(overrides.schema ?? raw.schema) ?? defaults.schema,
    approvalRequired: normalizeBoolean(
      overrides.approvalRequired ?? raw.approvalRequired,
      defaults.approvalRequired
    )
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (ENABLED.has(normalized)) return true;
  if (DISABLED.has(normalized)) return false;
  return fallback;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}
