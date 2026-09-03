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

import { validateSchema } from '../schema/validate.js';
import { parseOpenSpecDelta } from './OpenSpecAdapter.js';

const TRACEABILITY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['taskId', 'changeId', 'revision', 'specs'],
  properties: {
    taskId: { type: 'string', minLength: 1 },
    changeId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 0 },
    specs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['capability', 'requirements', 'files', 'tests'],
        properties: {
          capability: { type: 'string', minLength: 1 },
          requirements: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
          files: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
          tests: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
});

export class SDDValidator {
  validate(change, artifacts, traceability = null) {
    const errors = [];
    const warnings = [];
    validateProposal(artifacts.proposal, errors);
    validateDesign(artifacts.design, errors);
    const requirements = validateSpecs(artifacts.specs, errors);
    validateTasks(artifacts.tasks, errors, warnings);
    validateTraceability(traceability, change, requirements, errors, warnings);
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      artifactStatus: {
        proposal: Boolean(artifacts.proposal),
        specs: Object.keys(artifacts.specs ?? {}).length,
        design: Boolean(artifacts.design),
        tasks: Boolean(artifacts.tasks),
        traceability: Boolean(traceability)
      }
    };
  }
}

function validateProposal(content, errors) {
  if (!content) {
    errors.push(problem('proposal.md', 'required', 'proposal.md is required'));
    return;
  }
  requireSection(content, 'Why', 'proposal.md', errors);
  requireSection(content, 'What Changes', 'proposal.md', errors);
}

function validateDesign(content, errors) {
  if (!content) {
    errors.push(problem('design.md', 'required', 'design.md is required for the spec-driven schema'));
    return;
  }
  if (!String(content).trim()) errors.push(problem('design.md', 'empty', 'design.md must not be empty'));
}

function validateSpecs(specs, errors) {
  const entries = Object.entries(specs ?? {});
  const references = new Map();
  if (entries.length === 0) {
    errors.push(problem('specs/', 'required', 'at least one delta spec is required'));
    return references;
  }

  for (const [capability, content] of entries) {
    const file = `specs/${capability}/spec.md`;
    const parsed = parseOpenSpecDelta(content);
    if (parsed.requirements.length === 0) {
      errors.push(problem(file, 'requirements', 'delta spec must contain ADDED, MODIFIED, or REMOVED requirements'));
      continue;
    }
    const titles = new Set();
    for (const requirement of parsed.requirements) {
      const key = normalize(requirement.title);
      if (titles.has(key)) errors.push(problem(file, 'duplicate', `duplicate requirement: ${requirement.title}`));
      titles.add(key);
      if (requirement.operation !== 'REMOVED') {
        validateScenario(requirement, file, errors);
      }
    }
    references.set(capability, titles);
  }
  return references;
}

function validateScenario(requirement, file, errors) {
  const content = requirement.content;
  if (!/^####\s+Scenario:\s*.+$/im.test(content)) {
    errors.push(problem(file, 'scenario', `requirement "${requirement.title}" needs at least one scenario`));
    return;
  }
  for (const keyword of ['GIVEN', 'WHEN', 'THEN']) {
    if (!new RegExp(`^\\s*-\\s*${keyword}\\b`, 'im').test(content)) {
      errors.push(problem(file, 'scenario', `requirement "${requirement.title}" scenario is missing ${keyword}`));
    }
  }
}

function validateTasks(content, errors, warnings) {
  if (!content) {
    errors.push(problem('tasks.md', 'required', 'tasks.md is required'));
    return;
  }
  const tasks = String(content).match(/^\s*-\s*\[[ xX]\]\s+.+$/gm) ?? [];
  if (tasks.length === 0) errors.push(problem('tasks.md', 'checklist', 'tasks.md must contain checklist items'));
  if (tasks.length > 0 && tasks.every((line) => /\[[xX]\]/.test(line))) {
    warnings.push(problem('tasks.md', 'complete', 'all implementation tasks are already checked'));
  }
}

function validateTraceability(value, change, requirements, errors, warnings) {
  if (value == null) {
    warnings.push(problem('traceability.json', 'missing', 'traceability is not recorded yet'));
    return;
  }
  const result = validateSchema(value, TRACEABILITY_SCHEMA);
  errors.push(...result.errors.map((error) => problem(
    `traceability.json${error.path}`,
    error.keyword,
    error.message
  )));
  if (!result.valid) return;
  if (value.taskId !== change.taskId) {
    errors.push(problem('traceability.json/taskId', 'binding', 'taskId does not match the SDD change'));
  }
  if (value.changeId !== change.changeId) {
    errors.push(problem('traceability.json/changeId', 'binding', 'changeId does not match the SDD change'));
  }
  if (value.revision !== change.revision) {
    warnings.push(problem('traceability.json/revision', 'stale', 'traceability revision is not current'));
  }
  for (const spec of value.specs) {
    const available = requirements.get(spec.capability);
    if (!available) {
      errors.push(problem('traceability.json/specs', 'capability', `unknown capability: ${spec.capability}`));
      continue;
    }
    for (const requirement of spec.requirements) {
      if (!available.has(normalize(requirement))) {
        errors.push(problem(
          'traceability.json/specs',
          'requirement',
          `unknown requirement "${requirement}" in ${spec.capability}`
        ));
      }
    }
  }
}

function requireSection(content, title, file, errors) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = String(content);
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'im').exec(source);
  const remainder = match ? source.slice(match.index + match[0].length) : '';
  const nextHeading = remainder.search(/^##\s+/m);
  const body = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder;
  if (!match || !body.trim()) {
    errors.push(problem(file, 'section', `section "${title}" is required and must not be empty`));
  }
}

function problem(path, rule, message) {
  return { path, rule, message };
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

export { TRACEABILITY_SCHEMA };
