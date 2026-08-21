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

import { joinRoutePath, looksLikeComponentFile } from '../routes/normalize.js';

/**
 * Bump whenever the extraction output changes shape or meaning. It is the
 * cache key for cross-run reuse: without it, an old entry would silently
 * reintroduce facts the current extractor would never produce.
 */
export const EXTRACTOR_VERSION = '1.1.0';

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
    routeTrees: [],
    namedRouteArrays: {},
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
      collectRouteTables(node, parent, result);
      collectDataHints(node, result);
      collectComponents(node, result, tree);
    });
  }

  stitchNamedChildren(result);
  flattenRouteTrees(result);

  // Regex only keeps absolute paths — relative children are joined from the AST.
  for (const match of content.matchAll(/\bpath\s*:\s*['"`](\/[^'"`]+)['"`]/g)) {
    if (!result.routePaths.includes(match[1])) result.routePaths.push(match[1]);
  }
  for (const match of content.matchAll(/<(?:Route|route)\b[^>]*\bpath\s*=\s*['"`](\/[^'"`]+)['"`]/g)) {
    if (!result.routePaths.includes(match[1])) result.routePaths.push(match[1]);
  }

  return result;
}

function collectImportExport(node, result) {
  if (node.type === 'ImportDeclaration') {
    const source = node.source?.value;
    if (!source) return;
    const names = [];
    const locals = [];
    for (const spec of node.specifiers ?? []) {
      const local = spec.local?.name;
      if (local) locals.push(local);
      if (spec.type === 'ImportDefaultSpecifier') names.push('default');
      else if (spec.type === 'ImportNamespaceSpecifier') names.push('*');
      else names.push(spec.imported?.name ?? spec.local?.name ?? '');
    }
    result.imports.push({ source, names: names.filter(Boolean), locals, kind: 'import' });
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
    result.imports.push({ source: node.arguments[0].value, names: [], locals: [], kind: 'require' });
  }
  const dynamicSource = importCallSource(node);
  if (dynamicSource) {
    result.imports.push({ source: dynamicSource, names: [], locals: [], kind: 'import()' });
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

const ROUTE_TABLE_KEYS = new Set(['routes', 'constantRoutes', 'asyncRoutes', 'routeList', 'routeConfig']);
const ROUTE_HINT_KEYS = new Set(['component', 'element', 'children', 'redirect', 'name', 'components', 'meta']);

function collectRouteTables(node, parent, result) {
  if (node.type === 'ObjectProperty' || node.type === 'Property') {
    const key = node.key?.name ?? node.key?.value;
    if (ROUTE_TABLE_KEYS.has(key) && node.value?.type === 'ArrayExpression') {
      pushTrees(result, extractRouteArray(node.value, '', result));
    }
  }
  if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'ArrayExpression') {
    pushTrees(result, extractRouteArray(node.declaration, '', result));
  }
  if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'ObjectExpression') {
    const tree = extractRouteObject(node.declaration, '', result);
    if (tree) pushTrees(result, [tree]);
  }
  if (node.type === 'VariableDeclarator' && node.id?.name && node.init?.type === 'ArrayExpression') {
    if (looksLikeRouteArray(node.init)) {
      const trees = extractRouteArray(node.init, '', result);
      result.namedRouteArrays[node.id.name] = trees;
      if (ROUTE_TABLE_KEYS.has(node.id.name)) pushTrees(result, trees);
    }
  }
  if (node.type === 'VariableDeclarator' && node.id?.name && node.init?.type === 'ObjectExpression') {
    const tree = extractRouteObject(node.init, '', result);
    if (tree) {
      result.namedRouteArrays[node.id.name] = [tree];
      if (String(tree.rawPath || '').startsWith('/') || ROUTE_TABLE_KEYS.has(node.id.name)) {
        pushTrees(result, [tree]);
      }
    }
  }
  if (node.type === 'JSXElement' && parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment') {
    collectJsxRoutes(node, '', result);
  }
}

function pushTrees(result, trees) {
  for (const tree of trees) result.routeTrees.push(tree);
}

function looksLikeRouteArray(node) {
  const elements = (node.elements ?? []).filter(Boolean);
  if (elements.length === 0) return false;
  return elements.some((el) => el.type === 'ObjectExpression' && isRouteLikeObject(el));
}

function isRouteLikeObject(node) {
  if (node?.type !== 'ObjectExpression') return false;
  const keys = objectKeys(node);
  return keys.includes('path') && keys.some((key) => ROUTE_HINT_KEYS.has(key));
}

function extractRouteArray(arrayNode, parentPath, result) {
  const trees = [];
  for (const element of arrayNode.elements ?? []) {
    if (!element) continue;
    if (element.type === 'SpreadElement' && element.argument?.type === 'Identifier') {
      trees.push({
        path: parentPath || '',
        rawPath: '',
        name: '',
        component: '',
        importSource: '',
        childrenRef: element.argument.name,
        children: []
      });
      continue;
    }
    if (element.type === 'Identifier') {
      trees.push({
        path: parentPath || '',
        rawPath: '',
        name: '',
        component: '',
        importSource: '',
        childrenRef: element.name,
        children: []
      });
      continue;
    }
    if (element.type === 'ObjectExpression') {
      const tree = extractRouteObject(element, parentPath, result);
      if (tree) trees.push(tree);
    }
  }
  return trees;
}

function extractRouteObject(node, parentPath, result) {
  if (!isRouteLikeObject(node)) return null;
  const props = objectProps(node);
  const rawPath = stringLiteral(props.path);
  if (rawPath == null) return null;
  const path = joinRoutePath(parentPath, rawPath);
  const componentInfo = extractComponentInfo(props.component ?? props.element, result);
  const tree = {
    path,
    rawPath,
    name: stringLiteral(props.name) || '',
    component: componentInfo.component,
    importSource: componentInfo.importSource,
    childrenRef: '',
    children: []
  };
  if (props.children?.type === 'ArrayExpression') {
    tree.children = extractRouteArray(props.children, path, result);
  } else if (props.children?.type === 'Identifier') {
    tree.childrenRef = props.children.name;
  }
  return tree;
}

function collectJsxRoutes(node, parentPath, result) {
  if (!node || node.type !== 'JSXElement') {
    if (node?.type === 'JSXFragment') {
      for (const child of node.children ?? []) collectJsxRoutes(child, parentPath, result);
    }
    return;
  }
  const tag = node.openingElement?.name?.name;
  if (tag === 'Route' || tag === 'route') {
    const pathAttr = (node.openingElement.attributes ?? []).find((attr) => attr.name?.name === 'path');
    const rawPath = pathAttr?.value?.value ?? pathAttr?.value?.expression?.value;
    const path = typeof rawPath === 'string' ? joinRoutePath(parentPath, rawPath) : parentPath;
    if (typeof rawPath === 'string') {
      result.routeTrees.push({
        path,
        rawPath,
        name: '',
        component: '',
        importSource: '',
        childrenRef: '',
        children: []
      });
    }
    for (const child of node.children ?? []) collectJsxRoutes(child, path || parentPath, result);
    return;
  }
  for (const child of node.children ?? []) collectJsxRoutes(child, parentPath, result);
}

function stitchNamedChildren(result) {
  const resolveRef = (tree) => {
    if (tree.childrenRef && result.namedRouteArrays[tree.childrenRef]) {
      const parentPath = tree.path || '';
      tree.children = rebaseTrees(result.namedRouteArrays[tree.childrenRef], parentPath);
      tree.childrenRef = '';
    }
    for (const child of tree.children ?? []) resolveRef(child);
  };
  for (const tree of result.routeTrees) resolveRef(tree);
  for (const trees of Object.values(result.namedRouteArrays)) {
    for (const tree of trees) resolveRef(tree);
  }
}

function rebaseTrees(trees, parentPath) {
  return (trees ?? []).map((tree) => {
    const path = joinRoutePath(parentPath, tree.rawPath ?? '');
    return {
      ...tree,
      path,
      children: rebaseTrees(tree.children, path)
    };
  });
}

function flattenRouteTrees(result) {
  const visit = (tree) => {
    if (tree.path) {
      if (!result.routePaths.includes(tree.path)) result.routePaths.push(tree.path);
      result.routeObjects.push({
        path: tree.path,
        rawPath: tree.rawPath,
        name: tree.name,
        component: tree.component,
        importSource: tree.importSource,
        childrenRef: tree.childrenRef
      });
    }
    for (const child of tree.children ?? []) visit(child);
  };
  for (const tree of result.routeTrees) visit(tree);
}

function extractComponentInfo(node, result) {
  if (!node) return { component: '', importSource: '' };
  if (node.type === 'Identifier') {
    const source = importSourceForLocal(result, node.name);
    return { component: source || node.name, importSource: source };
  }
  const lazy = importCallSource(node) || findImportInFunction(node);
  if (lazy) return { component: lazy, importSource: lazy };
  if (node.type === 'CallExpression' && calleeName(node.callee) === 'defineAsyncComponent') {
    return extractComponentInfo(node.arguments?.[0], result);
  }
  const summary = summarizeNode(node);
  return {
    component: looksLikeComponentFile(summary) ? summary : summary,
    importSource: looksLikeComponentFile(summary) ? summary : ''
  };
}

function findImportInFunction(node) {
  if (!node) return '';
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    return findImportInFunction(node.body);
  }
  if (node.type === 'BlockStatement') {
    for (const statement of node.body ?? []) {
      const found = findImportInFunction(statement.argument ?? statement.expression ?? statement);
      if (found) return found;
    }
  }
  return importCallSource(node);
}

function importCallSource(node) {
  if (!node) return '';
  if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') return node.source.value;
  if (node.type === 'CallExpression' && node.callee?.type === 'Import' && node.arguments?.[0]?.type === 'StringLiteral') {
    return node.arguments[0].value;
  }
  return '';
}

function importSourceForLocal(result, local) {
  for (const item of result.imports ?? []) {
    if ((item.locals ?? []).includes(local) || (item.names ?? []).includes(local)) return item.source;
  }
  return '';
}

function objectProps(node) {
  const props = {};
  for (const property of node.properties ?? []) {
    if (property.type !== 'ObjectProperty' && property.type !== 'Property') continue;
    const key = property.key?.name ?? property.key?.value;
    if (key) props[key] = property.value;
  }
  return props;
}

function objectKeys(node) {
  return Object.keys(objectProps(node));
}

function stringLiteral(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral' || node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  return null;
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
