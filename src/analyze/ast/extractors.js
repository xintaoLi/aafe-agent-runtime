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
 * Extract imports, framework signals, route-ish literals and dataflow hints from Babel ASTs.
 */
export function extractFromParsedFile(filePath, parsed, content = '') {
  const result = {
    file: filePath,
    imports: [],
    exports: [],
    calls: [],
    routePaths: [],
    routeObjects: [],
    frameworkSignals: [],
    dataHints: [],
    components: [],
    warnings: parsed?.warnings ?? []
  };

  const trees = parsed?.scriptTrees?.length
    ? parsed.scriptTrees
    : (parsed?.ast ? [{ ast: parsed.ast, setup: false }] : []);

  for (const tree of trees) {
    if (!tree.ast) continue;
    walk(tree.ast, (node, parent) => {
      collectImportExport(node, result);
      collectCalls(node, result);
      collectFrameworkSignals(node, result, tree);
      collectRouteLiterals(node, parent, result);
      collectDataHints(node, result);
      collectComponents(node, result, tree);
    });
  }

  // Regex supplements for Vue templates / JSX route strings missed by AST
  for (const match of content.matchAll(/\bpath\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    if (!result.routePaths.includes(match[1])) result.routePaths.push(match[1]);
  }
  for (const match of content.matchAll(/<(?:Route|route)\b[^>]*\bpath\s*=\s*['"`]([^'"`]+)['"`]/g)) {
    if (!result.routePaths.includes(match[1])) result.routePaths.push(match[1]);
  }

  return result;
}

function collectImportExport(node, result) {
  if (node.type === 'ImportDeclaration') {
    const source = node.source?.value;
    if (!source) return;
    const names = (node.specifiers ?? []).map((spec) => {
      if (spec.type === 'ImportDefaultSpecifier') return 'default';
      if (spec.type === 'ImportNamespaceSpecifier') return '*';
      return spec.imported?.name ?? spec.local?.name ?? '';
    }).filter(Boolean);
    result.imports.push({ source, names, kind: 'import' });
  }
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    const source = node.source?.value;
    result.exports.push({
      type: node.type,
      source: source ?? null,
      name: node.declaration?.id?.name
        ?? node.declaration?.declarations?.[0]?.id?.name
        ?? (node.type === 'ExportDefaultDeclaration' ? 'default' : null)
    });
  }
  if (node.type === 'CallExpression' && node.callee?.name === 'require' && node.arguments?.[0]?.type === 'StringLiteral') {
    result.imports.push({ source: node.arguments[0].value, names: [], kind: 'require' });
  }
}

function collectCalls(node, result) {
  if (node.type !== 'CallExpression') return;
  const name = calleeName(node.callee);
  if (!name) return;
  result.calls.push(name);
}

function collectFrameworkSignals(node, result, tree) {
  const name = node.type === 'CallExpression' ? calleeName(node.callee) : null;
  if (name === 'createApp') result.frameworkSignals.push('vue3-createApp');
  if (name === 'createRouter') result.frameworkSignals.push('vue-router');
  if (name === 'defineComponent') result.frameworkSignals.push('vue-defineComponent');
  if (name === 'createBrowserRouter' || name === 'createHashRouter' || name === 'createRoutesFromElements') {
    result.frameworkSignals.push('react-router');
  }
  if (node.type === 'NewExpression' && node.callee?.name === 'Vue') {
    result.frameworkSignals.push('vue2-new-Vue');
  }
  if (tree.setup) result.frameworkSignals.push('vue3-script-setup');
  if (node.type === 'Identifier' && node.name === 'defineProps') result.frameworkSignals.push('vue3-defineProps');
  if (node.type === 'Identifier' && node.name === 'defineEmits') result.frameworkSignals.push('vue3-defineEmits');
  if (node.type === 'JSXElement') result.frameworkSignals.push('jsx');
  if (name === 'mapState' || name === 'mapActions' || name === 'mapGetters') {
    result.frameworkSignals.push('vuex');
  }
}

function collectRouteLiterals(node, parent, result) {
  if (node.type === 'ObjectProperty' || node.type === 'Property') {
    const key = node.key?.name ?? node.key?.value;
    if (key === 'path' && (node.value?.type === 'StringLiteral' || node.value?.type === 'Literal')) {
      const routePath = node.value.value;
      if (typeof routePath === 'string') {
        result.routePaths.push(routePath);
        result.routeObjects.push({ path: routePath });
      }
    }
    if (key === 'component' || key === 'element') {
      const last = result.routeObjects[result.routeObjects.length - 1];
      if (last && !last.component) {
        last.component = summarizeNode(node.value);
      }
    }
    if (key === 'name' && (node.value?.type === 'StringLiteral' || node.value?.type === 'Literal')) {
      const last = result.routeObjects[result.routeObjects.length - 1];
      if (last && !last.name) last.name = node.value.value;
    }
  }

  // React Router JSX: <Route path="..." />
  if (node.type === 'JSXOpeningElement') {
    const tag = node.name?.name;
    if (tag === 'Route' || tag === 'route') {
      const pathAttr = (node.attributes ?? []).find((attr) => attr.name?.name === 'path');
      const value = pathAttr?.value?.value ?? pathAttr?.value?.expression?.value;
      if (typeof value === 'string') {
        result.routePaths.push(value);
        result.routeObjects.push({ path: value, source: 'jsx-route' });
      }
    }
  }
}

function collectDataHints(node, result) {
  const name = node.type === 'CallExpression' ? calleeName(node.callee) : null;
  if (!name) return;
  if (/^(use|map)(State|Store|Query|Mutation|Request|Fetch|SWR|Axios)/i.test(name) || /^(fetch|axios|request|get|post|put|delete)$/i.test(name)) {
    result.dataHints.push(name);
  }
  if (/^(use[A-Z]\w+)$/.test(name)) result.dataHints.push(name);
  if (name === 'defineStore' || name === 'createStore' || name === 'createPinia') {
    result.dataHints.push(name);
    result.frameworkSignals.push(name === 'createPinia' || name === 'defineStore' ? 'pinia' : 'vuex-or-redux');
  }
}

function collectComponents(node, result, tree) {
  if (node.type === 'FunctionDeclaration' && node.id?.name && /^[A-Z]/.test(node.id.name)) {
    result.components.push({ name: node.id.name, kind: 'function' });
  }
  if (node.type === 'VariableDeclarator' && node.id?.name && /^[A-Z]/.test(node.id.name)) {
    if (['ArrowFunctionExpression', 'FunctionExpression', 'CallExpression'].includes(node.init?.type)) {
      result.components.push({ name: node.id.name, kind: 'variable' });
    }
  }
  if (tree.setup) result.components.push({ name: '(script-setup)', kind: 'vue-sfc' });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'errors') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit, node);
    }
  }
}

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    const object = calleeName(callee.object);
    const property = callee.property?.name ?? callee.property?.value ?? '';
    return object ? `${object}.${property}` : property;
  }
  return '';
}

function summarizeNode(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral' || node.type === 'Literal') return String(node.value);
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return 'lazy()';
  if (node.type === 'CallExpression') return calleeName(node.callee) + '()';
  if (node.type === 'JSXElement') return `<${node.openingElement?.name?.name ?? 'Component'} />`;
  return node.type;
}
