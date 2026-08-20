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
 * Mermaid (.mmd) projections for humans. JSON/JSONL remain the Agent source of truth.
 */

export function mermaidModuleRelations(modules = [], dependencies = []) {
  const lines = ['flowchart LR'];
  for (const mod of modules.slice(0, 40)) {
    lines.push(`  ${nodeId(mod.name)}["${escapeLabel(mod.name)}\\n${mod.files ?? 0} files"]`);
  }
  for (const dep of dependencies.slice(0, 80)) {
    const from = String(dep.from).replace(/^module:/, '');
    const to = String(dep.to).replace(/^module:/, '');
    lines.push(`  ${nodeId(from)} --> ${nodeId(to)}`);
  }
  if (lines.length === 1) lines.push('  empty["No modules"]');
  return `${lines.join('\n')}\n`;
}

export function mermaidModuleRoutes(moduleBundle) {
  const lines = ['flowchart TD', `  mod["${escapeLabel(moduleBundle.name)}"]`];
  for (const route of (moduleBundle.routes ?? []).slice(0, 30)) {
    const rid = nodeId(`route-${route.path || route.file}`);
    lines.push(`  ${rid}["${escapeLabel(route.path || '(route)')}"]`);
    lines.push(`  mod --> ${rid}`);
    if (route.file) {
      const fid = nodeId(`file-${route.file}`);
      lines.push(`  ${fid}["${escapeLabel(shortPath(route.file))}"]`);
      lines.push(`  ${rid} --> ${fid}`);
    }
  }
  if ((moduleBundle.routes ?? []).length === 0) lines.push('  none["No owned routes"]');
  return `${lines.join('\n')}\n`;
}

export function mermaidModuleArchitecture(moduleBundle) {
  const lines = ['flowchart TB', `  subgraph ${nodeId(moduleBundle.name)}["${escapeLabel(moduleBundle.name)}"]`];
  for (const component of (moduleBundle.components ?? []).slice(0, 24)) {
    lines.push(`    ${nodeId(component.name)}["${escapeLabel(component.name)}"]`);
  }
  for (const file of (moduleBundle.filePaths ?? []).slice(0, 12)) {
    if ((moduleBundle.components ?? []).some((item) => item.file === file)) continue;
    lines.push(`    ${nodeId(file)}["${escapeLabel(shortPath(file))}"]`);
  }
  lines.push('  end');
  for (const dep of (moduleBundle.dependencies ?? []).slice(0, 20)) {
    const to = String(dep).replace(/^module:/, '');
    lines.push(`  ${nodeId(moduleBundle.name)} --> ${nodeId(to)}["${escapeLabel(to)}"]`);
  }
  return `${lines.join('\n')}\n`;
}

export function mermaidComponentRelations(relations = []) {
  const lines = ['flowchart LR'];
  const seen = new Set();
  for (const rel of relations.slice(0, 80)) {
    const from = nodeId(rel.from);
    const to = nodeId(rel.to);
    if (!seen.has(from)) {
      lines.push(`  ${from}["${escapeLabel(rel.fromLabel || rel.from)}"]`);
      seen.add(from);
    }
    if (!seen.has(to)) {
      lines.push(`  ${to}["${escapeLabel(rel.toLabel || rel.to)}"]`);
      seen.add(to);
    }
    lines.push(`  ${from} -->|${escapeLabel(rel.type || 'uses')}| ${to}`);
  }
  if (lines.length === 1) lines.push('  empty["No component relations"]');
  return `${lines.join('\n')}\n`;
}

export function mermaidDataflow(flowOrBundle) {
  const flows = Array.isArray(flowOrBundle)
    ? flowOrBundle
    : (flowOrBundle?.flows ?? [flowOrBundle].filter(Boolean));
  const lines = ['flowchart TD'];
  let edgeCount = 0;
  for (const flow of flows.slice(0, 20)) {
    for (const edge of (flow.edges ?? []).slice(0, 20)) {
      if (edgeCount >= 60) break;
      const from = nodeId(edge.from);
      const to = nodeId(edge.to);
      lines.push(`  ${from}["${escapeLabel(shortId(edge.from))}"]`);
      lines.push(`  ${to}["${escapeLabel(shortId(edge.to))}"]`);
      lines.push(`  ${from} -->|${escapeLabel(edge.type || 'flow')}| ${to}`);
      edgeCount += 1;
    }
  }
  if (edgeCount === 0) lines.push('  empty["No dataflow edges"]');
  return `${lines.join('\n')}\n`;
}

export function mermaidArchitectureOverview(modules = [], dependencies = []) {
  return mermaidModuleRelations(modules, dependencies);
}

function nodeId(value) {
  return `n_${String(value)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'x'}`;
}

function escapeLabel(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '#quot;')
    .replace(/\n/g, ' ')
    .slice(0, 80);
}

function shortPath(file) {
  const parts = String(file).split('/');
  return parts.slice(-2).join('/');
}

function shortId(value) {
  return String(value)
    .replace(/^(file|route|import|data|module|call):/, '')
    .slice(0, 60);
}
