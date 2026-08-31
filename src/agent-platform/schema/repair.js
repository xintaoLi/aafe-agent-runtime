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

import { formatSchemaErrors, validateSchema } from './validate.js';

/**
 * Deterministic first stage of the repair loop (AGENTS.SCHEMA §14).
 *
 * A model that answers `"affectedFiles": "User.vue"` did not misunderstand the
 * task, it misunderstood the container. Fixing that locally is free; spending a
 * second model round-trip on it is not. Only what survives this stage is worth
 * asking the model to redo.
 *
 * @typedef RepairResult
 * @property {*} value
 * @property {string[]} repairs   Human-readable list of what was coerced.
 */

/**
 * @returns {RepairResult}
 */
export function coerceToSchema(value, schema, { root = schema, path = '' } = {}) {
  const repairs = [];
  const coerced = coerce(value, schema, { root, path, repairs });
  return { value: coerced, repairs };
}

/**
 * Coerce, then validate. The caller escalates to a model repair round only when
 * `valid` is still false.
 * @returns {{ valid: boolean, value: *, errors: object[], repairs: string[] }}
 */
export function coerceAndValidate(value, schema) {
  const { value: coerced, repairs } = coerceToSchema(value, schema);
  const { valid, errors } = validateSchema(coerced, schema);
  return { valid, value: coerced, errors, repairs };
}

/**
 * Prompt fed back to the model when deterministic coercion was not enough.
 * It carries the schema and the concrete violations rather than a generic
 * "invalid output", because a model cannot fix what it cannot see.
 */
export function buildRepairPrompt({ schemaTitle, schema, errors, previous }) {
  return [
    `Your previous answer did not satisfy the ${schemaTitle ?? 'output'} schema.`,
    '',
    'VIOLATIONS',
    formatSchemaErrors(errors, 20),
    '',
    'SCHEMA',
    JSON.stringify(schema, null, 2),
    '',
    'YOUR PREVIOUS ANSWER',
    truncateJson(previous, 4000),
    '',
    'Return ONLY the corrected JSON object. Do not explain the correction.',
    'Do not invent data to fill required fields: use an empty array or an empty string when you have no evidence.'
  ].join('\n');
}

function coerce(value, schema, ctx) {
  if (!schema || typeof schema !== 'object') return value;
  const resolved = schema.$ref ? resolveRef(schema.$ref, ctx.root) : schema;
  if (!resolved || typeof resolved !== 'object') return value;

  const types = resolved.type === undefined
    ? []
    : (Array.isArray(resolved.type) ? resolved.type : [resolved.type]);

  let current = value;

  // A JSON payload wrapped in a string is the single most common structured
  // output failure; unwrap it before doing anything else.
  if (typeof current === 'string' && (types.includes('object') || types.includes('array'))) {
    const parsed = tryParse(current);
    if (parsed !== undefined) {
      note(ctx, 'parsed a JSON string into a structured value');
      current = parsed;
    }
  }

  if (types.includes('array') && !Array.isArray(current) && current != null && !fitsAny(current, types)) {
    note(ctx, `wrapped a ${describe(current)} into an array`);
    current = [current];
  }
  if (types.includes('string') && typeof current !== 'string' && isScalar(current) && !fitsAny(current, types)) {
    note(ctx, `stringified a ${describe(current)}`);
    current = String(current);
  }
  if ((types.includes('number') || types.includes('integer')) && typeof current === 'string') {
    const parsed = Number(current.trim());
    if (Number.isFinite(parsed)) {
      note(ctx, 'parsed a numeric string');
      current = types.includes('integer') ? Math.round(parsed) : parsed;
    }
  }
  if (types.includes('integer') && typeof current === 'number' && !Number.isInteger(current)) {
    note(ctx, 'rounded a fractional value to an integer');
    current = Math.round(current);
  }
  if (types.includes('boolean') && typeof current === 'string') {
    const normalized = current.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      note(ctx, 'parsed a boolean string');
      current = normalized === 'true';
    }
  }

  current = clampNumber(current, resolved, ctx);
  current = normalizeEnum(current, resolved, ctx);

  if (Array.isArray(current) && resolved.items && !Array.isArray(resolved.items)) {
    current = current.map((item, index) => coerce(item, resolved.items, { ...ctx, path: `${ctx.path}/${index}` }));
  }
  if (isPlainObject(current)) {
    current = coerceObject(current, resolved, ctx);
  }
  return current;
}

function coerceObject(value, schema, ctx) {
  const next = { ...value };
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (next[key] !== undefined) {
      next[key] = coerce(next[key], propertySchema, { ...ctx, path: `${ctx.path}/${key}` });
    }
  }

  // A missing required field with an unambiguous empty value is filled rather
  // than reported: an empty array is an honest "nothing found", and forcing a
  // model round-trip to say so wastes a call.
  for (const key of schema.required ?? []) {
    if (next[key] !== undefined) continue;
    const propertySchema = resolveRef(schema.properties?.[key]?.$ref, ctx.root) ?? schema.properties?.[key];
    const empty = emptyValueFor(propertySchema);
    if (empty === undefined) continue;
    note(ctx, `filled missing required "${ctx.path}/${key}" with ${JSON.stringify(empty)}`);
    next[key] = empty;
  }
  return next;
}

/**
 * Only containers get a default. A missing required string that carries meaning
 * (a root cause, a reason) must stay missing so the model is asked again.
 */
function emptyValueFor(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  if ('default' in schema) return schema.default;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('array')) return [];
  if (types.includes('object') && !(schema.required ?? []).length) return {};
  return undefined;
}

function clampNumber(value, schema, ctx) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  let next = value;
  if (Number.isFinite(schema.minimum) && next < schema.minimum) {
    note(ctx, `clamped ${next} up to the minimum ${schema.minimum}`);
    next = schema.minimum;
  }
  if (Number.isFinite(schema.maximum) && next > schema.maximum) {
    note(ctx, `clamped ${next} down to the maximum ${schema.maximum}`);
    next = schema.maximum;
  }
  return next;
}

/**
 * `"HIGH"` and `"high"` are the same answer; casing is not a contract breach.
 */
function normalizeEnum(value, schema, ctx) {
  if (!Array.isArray(schema.enum) || typeof value !== 'string') return value;
  if (schema.enum.includes(value)) return value;
  const match = schema.enum.find((option) =>
    typeof option === 'string' && option.toLowerCase() === value.trim().toLowerCase());
  if (!match) return value;
  note(ctx, `normalized enum value "${value}" to "${match}"`);
  return match;
}

function fitsAny(value, types) {
  return types.some((type) => {
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isPlainObject(value);
    if (type === 'null') return value === null;
    if (type === 'integer') return Number.isInteger(value);
    return typeof value === type;
  });
}

function isScalar(value) {
  return value === null || ['number', 'boolean', 'bigint'].includes(typeof value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function note(ctx, message) {
  if (ctx.repairs.length < 30) ctx.repairs.push(message);
}

function tryParse(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
  const pointer = ref.slice(1).replace(/^\//, '');
  if (!pointer) return root;
  let current = root;
  for (const segment of pointer.split('/')) {
    if (current == null || typeof current !== 'object') return null;
    current = current[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current ?? null;
}

function truncateJson(value, limit) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const safe = String(text ?? 'null');
  return safe.length > limit ? `${safe.slice(0, limit)}\n… (truncated)` : safe;
}
