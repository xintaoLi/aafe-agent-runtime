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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadE2eConfig } from './config.js';
import { matchExistingCases } from './match.js';
import {
  caseFileName,
  existingEntrySet,
  isRealRoute,
  listCases,
  nextIds,
  normalizeEntry,
  renderFeatureCase,
  renderSmokeCase,
  writeCases
} from './yaml.js';
import { normalizeRouteRecord } from '../../static-analysis/routes/normalize.js';

/**
 * Build a full-coverage inventory from analyze knowledge (not a repo-wide scan).
 */
export async function buildInventoryPack({ knowledge, root, casesDir, extraFiles = [] } = {}) {
  if (!knowledge) {
    return { ok: false, error: 'analyze-output-missing', suggestedChains: [], routes: [], features: [] };
  }
  if (!(await knowledge.exists())) {
    return { ok: false, error: 'analyze-output-missing', suggestedChains: [], routes: [], features: [] };
  }

  const routes = [];
  const features = [];
  const modules = await knowledge.modulesIndex();
  for (const entry of modules) {
    const slice = await knowledge.getModule(entry.id);
    for (const route of slice?.routes ?? []) {
      const record = normalizeRouteRecord(route);
      const routePath = record.path || route.route || null;
      if (!isRealRoute(routePath)) continue;
      routes.push({
        path: normalizeEntry(routePath),
        moduleId: slice.id,
        file: record.file || route.file || slice.files?.[0] || null
      });
    }
    for (const feature of slice?.features ?? []) {
      features.push({
        id: feature.id,
        name: feature.name ?? feature.label ?? feature.id,
        moduleId: slice.id,
        entrypoints: feature.entrypoints ?? [],
        evidence: feature.evidence ?? []
      });
    }
  }

  for (const candidate of await knowledge.features()) {
    if (features.some((item) => item.id === candidate.id)) continue;
    features.push({
      id: candidate.id,
      name: candidate.name ?? candidate.id,
      moduleId: null,
      entrypoints: candidate.entrypoints ?? [],
      evidence: candidate.evidence ?? []
    });
  }

  const uniqueRoutes = dedupeRoutes(routes);
  const matchedCases = casesDir
    ? await matchExistingCases(casesDir, { routeHints: uniqueRoutes.map((item) => item.path) })
    : [];
  const covered = new Set(matchedCases.map((item) => normalizeEntry(item.entry)));

  const suggestedChains = uniqueRoutes.map((route, index) => {
    const matched = matchedCases.filter((item) => item.entry === route.path).map((item) => item.id);
    return {
      id: `INV-${String(index + 1).padStart(3, '0')}`,
      kind: 'route',
      title: `冒烟覆盖 ${route.path}`,
      entryHints: [route.path],
      moduleId: route.moduleId,
      file: route.file,
      matchedCaseIds: matched,
      coverage: matched.length > 0 || covered.has(route.path) ? 'existing' : 'missing'
    };
  });

  const missingFeatures = [];
  for (const feature of features) {
    const bound = bindFeatureRoute(feature, uniqueRoutes);
    if (!bound) {
      missingFeatures.push({
        id: feature.id,
        name: feature.name,
        coverage: 'missing',
        reason: 'feature has no real route entry'
      });
      continue;
    }
    const matched = matchedCases.filter((item) => item.entry === bound.path).map((item) => item.id);
    suggestedChains.push({
      id: `FEAT-CHAIN-${slug(feature.id).slice(0, 24)}`,
      kind: 'feature',
      title: `功能覆盖 ${feature.name}`,
      featureId: feature.id,
      entryHints: [bound.path],
      moduleId: feature.moduleId,
      file: bound.file,
      matchedCaseIds: matched,
      coverage: matched.length > 0 || covered.has(bound.path) ? 'existing' : 'missing'
    });
  }

  return {
    ok: true,
    builtAt: new Date().toISOString(),
    root: root ?? null,
    extraFiles,
    routes: uniqueRoutes,
    features,
    suggestedChains,
    matchedCases,
    verification: {
      items: [
        { category: 'new-feature', count: suggestedChains.filter((item) => item.coverage === 'missing').length },
        { category: 'regression-guard', count: matchedCases.length },
        { category: 'manual-confirm', count: missingFeatures.length }
      ],
      manualConfirmRequired: missingFeatures.length > 0,
      missingFeatures
    }
  };
}

export async function writeInventoryCases(pack, { casesDir, update = false, force = false } = {}) {
  const marker = await readInventoryMarker(path.dirname(casesDir));
  if (marker?.initialized && !update && !force) {
    return {
      written: [],
      skipped: true,
      reason: 'inventory-already-initialized',
      enableWith: 'aafe test --coverage --update'
    };
  }

  const existing = await listCases(casesDir);
  const covered = await existingEntrySet(casesDir);
  const pending = pack.suggestedChains.filter((chain) => {
    const entry = chain.entryHints?.[0];
    if (!entry || chain.coverage === 'existing') return false;
    return !covered.has(normalizeEntry(entry));
  });

  const smokePending = pending.filter((chain) => chain.kind !== 'feature');
  const featPending = pending.filter((chain) => chain.kind === 'feature');
  const ids = existing.map((item) => item.id);
  const smokeIds = nextIds(ids, 'SMOKE', smokePending.length);
  const featIds = nextIds([...ids, ...smokeIds], 'FEAT', featPending.length);

  const files = [];
  smokePending.forEach((chain, index) => {
    const entry = chain.entryHints[0];
    const id = smokeIds[index];
    files.push({
      id,
      name: caseFileName(id),
      entry,
      content: renderSmokeCase(id, entry, { sourcePath: chain.file })
    });
  });
  featPending.forEach((chain, index) => {
    const entry = chain.entryHints[0];
    const id = featIds[index];
    files.push({
      id,
      name: caseFileName(id),
      entry,
      content: renderFeatureCase(id, {
        title: chain.title,
        entry,
        featureId: chain.featureId,
        sourcePath: chain.file
      })
    });
  });

  const written = await writeCases(casesDir, files);
  if (written.length > 0 || existing.length > 0) {
    await writeInventoryMarker(path.dirname(casesDir), {
      initialized: true,
      initializedAt: marker?.initializedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      caseCount: existing.length + written.length,
      mode: 'smoke'
    });
  }
  return { written, skipped: false };
}

export async function persistImpactPack(impactDir, name, pack) {
  await mkdir(impactDir, { recursive: true });
  const file = path.join(impactDir, name);
  await writeFile(file, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  return file;
}

function bindFeatureRoute(feature, routes) {
  const needles = [
    ...(feature.entrypoints ?? []),
    ...(feature.evidence ?? []).map((item) => item.file).filter(Boolean)
  ];
  for (const needle of needles) {
    if (isRealRoute(needle)) {
      const hit = routes.find((route) => route.path === normalizeEntry(needle));
      return hit ?? { path: normalizeEntry(needle), file: null };
    }
    const hit = routes.find((route) => route.file && needle && route.file.includes(String(needle)));
    if (hit) return hit;
  }
  return routes.find((route) => route.moduleId && feature.moduleId && route.moduleId === feature.moduleId) ?? null;
}

function dedupeRoutes(routes) {
  const byPath = new Map();
  for (const route of routes) {
    if (!byPath.has(route.path)) byPath.set(route.path, route);
  }
  return Array.from(byPath.values());
}

function slug(value) {
  return String(value ?? 'unknown').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function readInventoryMarker(uiAiDir) {
  const file = path.join(uiAiDir, 'project.yaml');
  if (!existsSync(file)) return null;
  const text = await readFile(file, 'utf8');
  if (!/inventory:/.test(text)) return null;
  return {
    initialized: /initialized:\s*true/.test(text),
    initializedAt: text.match(/initializedAt:\s*"?([^"\n]+)"?/)?.[1] ?? null
  };
}

async function writeInventoryMarker(uiAiDir, marker) {
  await mkdir(uiAiDir, { recursive: true });
  const file = path.join(uiAiDir, 'project.yaml');
  const body = `baseUrlEnv: AAFE_E2E_BASE_URL
casesDir: cases
inventory:
  initialized: ${marker.initialized}
  initializedAt: ${JSON.stringify(marker.initializedAt)}
  updatedAt: ${JSON.stringify(marker.updatedAt)}
  caseCount: ${marker.caseCount}
  mode: ${marker.mode}
`;
  if (existsSync(file)) {
    const current = await readFile(file, 'utf8');
    if (/inventory:/.test(current)) {
      const next = current.replace(/inventory:\n(?:[ \t].*\n)*/m, body.slice(body.indexOf('inventory:')));
      await writeFile(file, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
      return;
    }
    await writeFile(file, `${current.trimEnd()}\n${body}`, 'utf8');
    return;
  }
  await writeFile(file, body, 'utf8');
}

export async function runCoverageGeneration({ knowledge, root, update = false, force = false } = {}) {
  const config = await loadE2eConfig(root);
  const pack = await buildInventoryPack({ knowledge, root, casesDir: config.casesDirAbs });
  if (!pack.ok) return { pack, written: [], config };
  const result = await writeInventoryCases(pack, { casesDir: config.casesDirAbs, update, force });
  const packPath = await persistImpactPack(config.impactDirAbs, 'inventory.json', pack);
  return { pack, packPath, ...result, config };
}
