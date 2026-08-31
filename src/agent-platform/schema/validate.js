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
 * JSON Schema draft-07 subset, implemented here rather than pulled in as a
 * dependency: agent contracts only need structural keywords, and the runtime
 * must stay installable in air-gapped repos with zero transitive deps.
 *
 * Supported: type, enum, const, required, properties, patternProperties,
 * additionalProperties, items (schema or tuple), minItems/maxItems/uniqueItems,
 * minimum/maximum/exclusive*, multipleOf, minLength/maxLength/pattern,
 * anyOf/oneOf/allOf/not, and local `$ref` into `#/definitions/*` or `#/$defs/*`.
 *
 * @typedef SchemaError
 * @property {string} path      JSON pointer-ish location, e.g. `/affectedFiles/0/path`.
 * @property {string} keyword
 * @property {string} message
 *
 * @typedef ValidationResult
 * @property {boolean} valid
 * @property {SchemaError[]} errors
 */

const TYPE_CHECKS = Object.freeze({
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null
});

/**
 * @param {*} value
 * @param {object} schema
 * @returns {ValidationResult}
 */
export function validateSchema(value, schema, { root = schema, maxErrors = 40 } = {}) {
  const errors = [];
  walk(value, schema, '', { root, errors, maxErrors });
  return { valid: errors.length === 0, errors };
}

/**
 * One-line summary suitable for an `AgentResponse.reason` or a repair prompt.
 */
export function formatSchemaErrors(errors, limit = 6) {
  if (!errors || errors.length === 0) return '';
  const shown = errors.slice(0, limit).map((error) => `${error.path || '/'}: ${error.message}`);
  const rest = errors.length - shown.length;
  return rest > 0 ? `${shown.join('; ')} (+${rest} more)` : shown.join('; ');
}

function walk(value, schema, path, ctx) {
  if (ctx.errors.length >= ctx.maxErrors) return;
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    push(ctx, path, 'schema', 'no value is allowed here');
    return;
  }
  if (typeof schema !== 'object') return;

  const resolved = schema.$ref ? resolveRef(schema.$ref, ctx.root) : schema;
  if (!resolved) {
    push(ctx, path, '$ref', `unresolvable $ref "${schema.$ref}"`);
    return;
  }

  checkCombinators(value, resolved, path, ctx);
  if (!checkType(value, resolved, path, ctx)) return;
  checkEnum(value, resolved, path, ctx);
  checkNumber(value, resolved, path, ctx);
  checkString(value, resolved, path, ctx);
  checkArray(value, resolved, path, ctx);
  checkObject(value, resolved, path, ctx);
}

function checkType(value, schema, path, ctx) {
  if (schema.type === undefined) return true;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.some((type) => TYPE_CHECKS[type]?.(value))) return true;
  push(ctx, path, 'type', `expected ${types.join(' | ')}, got ${describe(value)}`);
  return false;
}

function checkEnum(value, schema, path, ctx) {
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
    push(ctx, path, 'enum', `expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  }
  if ('const' in schema && !deepEqual(schema.const, value)) {
    push(ctx, path, 'const', `expected ${JSON.stringify(schema.const)}`);
  }
}

function checkNumber(value, schema, path, ctx) {
  if (typeof value !== 'number') return;
  if (Number.isFinite(schema.minimum) && value < schema.minimum) {
    push(ctx, path, 'minimum', `must be >= ${schema.minimum}`);
  }
  if (Number.isFinite(schema.maximum) && value > schema.maximum) {
    push(ctx, path, 'maximum', `must be <= ${schema.maximum}`);
  }
  if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) {
    push(ctx, path, 'exclusiveMinimum', `must be > ${schema.exclusiveMinimum}`);
  }
  if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) {
    push(ctx, path, 'exclusiveMaximum', `must be < ${schema.exclusiveMaximum}`);
  }
  if (Number.isFinite(schema.multipleOf) && schema.multipleOf > 0 && Math.abs(value % schema.multipleOf) > 1e-9) {
    push(ctx, path, 'multipleOf', `must be a multiple of ${schema.multipleOf}`);
  }
}

function checkString(value, schema, path, ctx) {
  if (typeof value !== 'string') return;
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
    push(ctx, path, 'minLength', `must be at least ${schema.minLength} characters`);
  }
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
    push(ctx, path, 'maxLength', `must be at most ${schema.maxLength} characters`);
  }
  if (typeof schema.pattern === 'string' && !safeRegExp(schema.pattern)?.test(value)) {
    push(ctx, path, 'pattern', `must match /${schema.pattern}/`);
  }
}

function checkArray(value, schema, path, ctx) {
  if (!Array.isArray(value)) return;
  if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
    push(ctx, path, 'minItems', `must contain at least ${schema.minItems} item(s)`);
  }
  if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
    push(ctx, path, 'maxItems', `must contain at most ${schema.maxItems} item(s)`);
  }
  if (schema.uniqueItems === true && hasDuplicates(value)) {
    push(ctx, path, 'uniqueItems', 'items must be unique');
  }

  if (Array.isArray(schema.items)) {
    value.forEach((item, index) => {
      const itemSchema = schema.items[index] ?? schema.additionalItems;
      if (itemSchema !== undefined) walk(item, itemSchema, `${path}/${index}`, ctx);
    });
    return;
  }
  if (schema.items !== undefined) {
    value.forEach((item, index) => walk(item, schema.items, `${path}/${index}`, ctx));
  }
}

function checkObject(value, schema, path, ctx) {
  if (!TYPE_CHECKS.object(value)) return;

  for (const key of schema.required ?? []) {
    // An explicit `undefined` is the JS way of spelling "absent": it does not
    // survive JSON serialisation, so treating it as present would make
    // in-process validation stricter than over-the-wire validation.
    if (value[key] === undefined) push(ctx, `${path}/${key}`, 'required', 'is required but missing');
  }

  const properties = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (value[key] !== undefined) walk(value[key], propertySchema, `${path}/${key}`, ctx);
  }

  const patterns = Object.entries(schema.patternProperties ?? {})
    .map(([pattern, propertySchema]) => ({ regexp: safeRegExp(pattern), propertySchema }))
    .filter((entry) => entry.regexp);

  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === undefined) continue;
    let matched = key in properties;
    for (const { regexp, propertySchema } of patterns) {
      if (!regexp.test(key)) continue;
      matched = true;
      walk(entryValue, propertySchema, `${path}/${key}`, ctx);
    }
    if (matched) continue;
    if (schema.additionalProperties === false) {
      push(ctx, `${path}/${key}`, 'additionalProperties', 'is not an allowed property');
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      walk(entryValue, schema.additionalProperties, `${path}/${key}`, ctx);
    }
  }
}

function checkCombinators(value, schema, path, ctx) {
  for (const branch of schema.allOf ?? []) walk(value, branch, path, ctx);

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => matches(value, branch, ctx.root))) {
    push(ctx, path, 'anyOf', 'does not match any allowed shape');
  }
  if (Array.isArray(schema.oneOf)) {
    const hits = schema.oneOf.filter((branch) => matches(value, branch, ctx.root)).length;
    if (hits !== 1) push(ctx, path, 'oneOf', `must match exactly one allowed shape, matched ${hits}`);
  }
  if (schema.not !== undefined && matches(value, schema.not, ctx.root)) {
    push(ctx, path, 'not', 'matches a forbidden shape');
  }

  // `if/then` is how a contract says "this field is required *for this action*",
  // which is exactly the shape planner and multi-capability agent outputs need.
  if (schema.if !== undefined) {
    const branch = matches(value, schema.if, ctx.root) ? schema.then : schema.else;
    if (branch !== undefined) walk(value, branch, path, ctx);
  }
}

function matches(value, schema, root) {
  return validateSchema(value, schema, { root, maxErrors: 1 }).valid;
}

/**
 * Only local pointers are supported. Remote `$ref` would make validation an IO
 * operation, which agent contracts must never be.
 */
function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
  const pointer = ref.slice(1).replace(/^\//, '');
  if (!pointer) return root;
  let current = root;
  for (const rawSegment of pointer.split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current == null || typeof current !== 'object') return null;
    current = current[segment];
  }
  return current ?? null;
}

function push(ctx, path, keyword, message) {
  if (ctx.errors.length >= ctx.maxErrors) return;
  ctx.errors.push({ path, keyword, message });
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function hasDuplicates(items) {
  const seen = new Set();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function safeRegExp(pattern) {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
