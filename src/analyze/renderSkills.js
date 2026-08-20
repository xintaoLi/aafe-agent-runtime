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
 * Render on-demand skills pointing at the configurable analyze output (default `.aafe`).
 */

export function renderArchitectureOnDemandSkill(report) {
  const output = report.docsOut ?? report.output ?? '.aafe';
  return `# Skill: Architecture On-Demand

Generated: ${report.generatedAt}
Project: ${report.projectName}

## Purpose

Load architecture facts **per module** without scanning the whole tree.

## Agent loading protocol

1. \`${output}/manifest.json\`
2. \`${output}/index.json\`
3. \`${output}/modules/index.json\` → pick one module id
4. \`${output}/modules/<id>/index.json\` (module entry)
5. Only then open \`${output}/modules/<id>/json/architecture.json\` / \`routes.json\` / \`components.json\`
6. Human diagrams (optional): \`${output}/modules/<id>/mmd/\`
7. **Forbidden:** eagerly open every module or \`knowledge/graph/jsonl/\`

## Module ids (summary)

${(report.modules ?? []).slice(0, 40).map((mod) => `- \`${mod.id}\` (${mod.fileCount} files)`).join('\n') || '- Run \`aafe analyze\` to populate modules.'}

## Related

- Locator: \`.ai-agent/skills/project-architecture-locator.md\`
- Dataflow: \`.ai-agent/skills/dataflow-on-demand.md\`
`;
}

export function renderDataflowOnDemandSkill(report) {
  const output = report.docsOut ?? report.output ?? '.aafe';
  return `# Skill: Dataflow On-Demand

Generated: ${report.generatedAt}
Project: ${report.projectName}

## Purpose

Load dataflow facts **per module**.

## Agent loading protocol

1. \`${output}/index.json\` → \`${output}/modules/index.json\`
2. \`${output}/modules/<id>/index.json\`
3. \`${output}/modules/<id>/json/dataflow.json\`
4. Cross-module: \`${output}/knowledge/relations/json/dataflow.json\`
5. Human: \`${output}/modules/<id>/mmd/dataflow.mmd\`
6. **Forbidden:** dump all flows into context

## Module ids (summary)

${(report.modules ?? []).slice(0, 40).map((mod) => `- \`${mod.id}\``).join('\n') || '- Run \`aafe analyze\` to populate modules.'}

## Related

- Architecture: \`.ai-agent/skills/architecture-on-demand.md\`
`;
}

export function renderDeepLocatorAppendix(report) {
  const output = report.docsOut ?? report.output ?? '.aafe';
  return `
## Deep analysis (on-demand)

Outer entry only:
- \`${output}/manifest.json\`
- \`${output}/index.json\`
- \`${output}/modules/index.json\`

Then one module:
- \`${output}/modules/<id>/index.json\` → \`json/\` (Agent) / \`mmd/\` (Human)

Global knowledge lives under \`${output}/knowledge/\` — do not scan it by default.
`;
}
