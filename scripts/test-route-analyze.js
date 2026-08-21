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

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSourceFile } from '../src/static-analysis/ast/parseFile.js';
import { extractFromParsedFile } from '../src/static-analysis/ast/extractors.js';
import { ArchitectureAnalyzer } from '../src/static-analysis/analyzers/architecture.js';
import { buildModuleBundles } from '../src/static-analysis/modules/buildBundles.js';
import { partitionModules } from '../src/static-analysis/modules/partition.js';
import { resolveRoutesFromEntries } from '../src/static-analysis/routes/resolveRoutes.js';
import { filePathMatches, joinRoutePath, normalizeRouteRecord } from '../src/static-analysis/routes/normalize.js';
import { buildTestPlan } from '../src/agents/test-agent/plan.js';
import { isRealRoute } from '../src/testing/e2e/yaml.js';

assert.equal(joinRoutePath('/manage', 'clean-templates'), '/manage/clean-templates');
assert.equal(joinRoutePath('/manage/clean-templates', 'list'), '/manage/clean-templates/list');
assert.equal(joinRoutePath('/manage', '/absolute'), '/absolute');
assert.equal(joinRoutePath('/manage', ''), '/manage');
assert.equal(filePathMatches('bklog/web/src/views/list.vue', 'src/views/list.vue'), true);
assert.equal(filePathMatches('src/views/list.vue', 'src/other/list.vue'), false);

const nestedRouter = `
export default [
  {
    path: '/manage',
    name: 'manage',
    component: Layout,
    children: [
      {
        path: 'clean-templates',
        name: 'clean-templates',
        component: () => import('@/views/clean-templates/index.vue'),
        children: [
          { path: 'list', name: 'clean-templates-list', component: () => import('@/views/clean-templates/list.vue') },
          { path: 'create', name: 'clean-templates-create', component: () => import('@/views/clean-templates/create.vue') },
          { path: 'edit/:templateId', name: 'clean-templates-edit', component: () => import('@/views/clean-templates/edit.vue') }
        ]
      }
    ]
  }
];
`;

const extracted = extractFromParsedFile('src/router/manage.js', parseSourceFile('src/router/manage.js', nestedRouter), nestedRouter);
const paths = extracted.routePaths;
assert.ok(paths.includes('/manage/clean-templates/list'), `expected joined list route, got ${paths.join(',')}`);
assert.ok(paths.includes('/manage/clean-templates/create'));
assert.ok(paths.includes('/manage/clean-templates/edit/:templateId'));
assert.ok(!paths.includes('list'), 'relative child path must not be emitted standalone');
assert.ok(!paths.includes('clean-templates'), 'relative parent segment must not be emitted standalone');
const listRoute = extracted.routeObjects.find((item) => item.path === '/manage/clean-templates/list');
assert.equal(listRoute.importSource, '@/views/clean-templates/list.vue');
assert.ok(extracted.imports.some((item) => item.source === '@/views/clean-templates/list.vue' && item.kind === 'import()'));

const stringRoutes = ['/manage/clean-templates/list', '/manage/clean-templates/create'].map((pathValue) => normalizeRouteRecord(pathValue));
assert.equal(stringRoutes[0].path, '/manage/clean-templates/list');

const partitioned = partitionModules({
  routes: [
    { path: '/manage/clean-templates/list', file: 'src/router/manage.js', component: 'src/views/clean-templates/list.vue', name: 'list' }
  ],
  visited: ['src/router/manage.js', 'src/views/clean-templates/list.vue'],
  nodes: {
    'src/views/clean-templates/list.vue': { components: [{ name: 'CleanTemplateList' }], frameworkSignals: [], dataHints: [] }
  },
  edges: []
});
const routeModule = partitioned.find((item) => item.routes.some((route) => route.path === '/manage/clean-templates/list'));
assert.ok(routeModule, 'route module should own the joined path');
assert.ok(routeModule.files.includes('src/views/clean-templates/list.vue'));
assert.ok(routeModule.components.includes('CleanTemplateList'));

const architecture = await new ArchitectureAnalyzer().analyze({}, {
  config: { architecture: { enabled: true }, llm: { enabled: false } },
  graph: { routeGraph: { routes: partitioned[0] ? [{ path: '/manage/clean-templates/list', file: 'src/router/manage.js', component: 'src/views/clean-templates/list.vue' }] : [], visited: [], nodes: {}, edges: [] } }
});
const archRoutes = architecture.data.modules.flatMap((mod) => mod.routes);
assert.equal(typeof archRoutes[0], 'object');
assert.equal(archRoutes[0].path, '/manage/clean-templates/list');

const bundles = buildModuleBundles({
  architecture: {
    modules: architecture.data.modules.map((mod) => ({
      ...mod,
      filePaths: mod.filePaths ?? []
    }))
  },
  features: { candidates: [] },
  dataflow: { flows: [] },
  graph: { routeGraph: { nodes: {}, edges: [] } },
  cache: { parsed: new Map() }
});
assert.ok(bundles.bundles.some((bundle) => bundle.routes.some((route) => route.path === '/manage/clean-templates/list')));

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aafe-routes-'));
try {
  const write = async (relative, content) => {
    const file = path.join(tmp, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  };
  await write('package.json', JSON.stringify({ name: 'demo', dependencies: { vue: '3.0.0', 'vue-router': '4.0.0' } }));
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
  await write('src/main.js', "import router from './router/index.js';\nexport default router;\n");
  await write('src/router/index.js', "import routes from './manage.js';\nexport default { routes };\n");
  await write('src/router/manage.js', nestedRouter);
  await write('src/views/clean-templates/index.vue', '<template><div /></template>\n<script>export default { name: "CleanTemplates" }</script>\n');
  await write('src/views/clean-templates/list.vue', '<template><div /></template>\n<script>export default { name: "CleanTemplateList" }</script>\n');
  await write('src/views/clean-templates/create.vue', '<template><div /></template>\n<script>export default { name: "CleanTemplateCreate" }</script>\n');
  await write('src/views/clean-templates/edit.vue', '<template><div /></template>\n<script>export default { name: "CleanTemplateEdit" }</script>\n');

  const graph = await resolveRoutesFromEntries(tmp, {
    frameworkHint: 'vue3',
    entries: [{ file: 'src/main.js', exists: true, kind: 'entry' }]
  });
  const resolvedPaths = graph.routes.map((route) => route.path);
  assert.ok(resolvedPaths.includes('/manage/clean-templates/list'), `graph routes: ${resolvedPaths.join(',')}`);
  const resolvedList = graph.routes.find((route) => route.path === '/manage/clean-templates/list');
  assert.equal(resolvedList.component, 'src/views/clean-templates/list.vue');
  assert.ok(isRealRoute(resolvedList.path));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const knowledge = {
  async findModuleByFile(file) {
    return filePathMatches(file, 'src/views/clean-templates/list.vue') ? 'route-manage' : null;
  },
  async getModule() {
    return {
      id: 'route-manage',
      files: ['src/router/manage.js', 'src/views/clean-templates/list.vue'],
      routes: [
        { path: '/manage/clean-templates/list', file: 'src/router/manage.js', component: 'src/views/clean-templates/list.vue' },
        { path: '/manage/clean-templates/create', file: 'src/router/manage.js', component: 'src/views/clean-templates/create.vue' }
      ]
    };
  },
  async modulesIndex() {
    return [{ id: 'route-manage', routes: ['/manage/clean-templates/list'] }];
  }
};

const plan = await buildTestPlan({
  impact: null,
  knowledge,
  requirement: 'feat: 日志平台采集接入清洗模板改版',
  runners: { e2e: { id: 'playwright' }, unit: { id: 'vitest' } },
  scenario: 'pr',
  changedFiles: ['bklog/web/src/views/clean-templates/list.vue']
});
const planPaths = plan.scenarios.map((item) => item.source?.path);
assert.ok(planPaths.includes('/manage/clean-templates/list'), `plan should use joined routes, got ${planPaths.join(',')}`);

console.log('test-route-analyze: ok');
