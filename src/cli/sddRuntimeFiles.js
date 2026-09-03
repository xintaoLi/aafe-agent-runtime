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

export function sddRuntimePaths(prefix = '.ai-agent') {
  return [
    `${prefix}/sdd/SKILL.md`,
    `${prefix}/sdd/rules/sdd-gate.md`,
    `${prefix}/sdd/rules/workflow.md`,
    `${prefix}/sdd/rules/artifacts.md`
  ];
}

export function sddRuntimeFiles(prefix = '.ai-agent') {
  const [skill, gate, workflow, artifacts] = sddRuntimePaths(prefix);
  return {
    [skill]: sddSkill(),
    [gate]: sddGateRule(),
    [workflow]: sddWorkflowRule(),
    [artifacts]: sddArtifactsRule()
  };
}

export function sddPointerRuleMdc({ agentPrefix = '.ai-agent' } = {}) {
  return `---
description: AAFE SDD / OpenSpec opt-in gate pointer
alwaysApply: true
---

# AAFE SDD Gate

Source of truth: \`${agentPrefix}/sdd/SKILL.md\`.

SDD is part of the feature workflow and is enabled by default. When
\`.aafe.config.json → sdd.enabled\` is not false, load this pack from \`${agentPrefix}/sdd/SKILL.md\`.
An explicit \`aafe sdd\` command also activates it. \`sdd.enabled: false\` is the project opt-out.
`;
}

function sddSkill() {
  return `---
name: aafe-sdd
description: Run AAFE's opt-in SDD workflow with OpenSpec-compatible artifacts.
---

# AAFE SDD

Use for the feature pipeline unless the project explicitly sets \`sdd.enabled: false\`, and whenever
the user requests SDD, OpenSpec, or specification-driven development.

Read in order:
1. \`rules/sdd-gate.md\`
2. \`rules/workflow.md\`
3. \`rules/artifacts.md\`

Task is the isolation and execution owner. SDD Change is the specification lifecycle.
Project Rules, Skills, Knowledge and Memory remain repository-native sources; never copy them into SDD artifacts.
`;
}

function sddGateRule() {
  return `# SDD Enablement Gate

- enabled: default for feature work; also enabled by explicit SDD/OpenSpec/spec-driven intent or an \`aafe sdd\` command.
- disabled: only when project config explicitly sets \`sdd.enabled: false\`.

Trivial edits may use a light artifact set; durable implementation still follows the same feature pipeline.
`;
}

function sddWorkflowRule() {
  return `# SDD Workflow

OpenSpec artifacts form a dependency graph, not a locked waterfall:

\`proposal → specs/design → tasks\`

The existing feature pipeline owns execution. Its planning segment produces these SDD artifacts,
then \`sdd_gate\` and \`architecture_gate\` must pass before the implementation segment continues.
SDD is not routed as a separate feature type.

Artifacts may be revised at any time. A revision invalidates prior validation and approval.
Implementation requires current validation and approval. Keep one active SDD Change per durable AAFE Task.
Do not automatically invoke a coding runtime from artifact-generation commands.
`;
}

function sddArtifactsRule() {
  return `# SDD Artifact Contract

- \`proposal.md\`: non-empty Why and What Changes sections.
- \`specs/<capability>/spec.md\`: ADDED/MODIFIED/REMOVED requirements with scenarios for active requirements.
- \`design.md\`: technical approach and decisions, not observable requirements.
- \`tasks.md\`: concrete checkbox implementation tasks.
- Traceability and revisions are task-private runtime data under \`.aafe/tasks/<taskId>/sdd/\`.
- Current specs live in \`openspec/specs/\`; active changes live in \`openspec/changes/\`.

Specs contain behavior. Implementation details belong in design and tasks.
`;
}
