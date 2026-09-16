/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company. All rights reserved.
 * Licensed under the MIT License.
 */

import { randomUUID } from 'node:crypto';
import { normalizeUsage } from '../llm/usage.js';

export const INVOCATION_METRIC_VERSION = 1;

/**
 * Convert provider-specific telemetry into a small, secret-free record.
 * Deliberately ignore arbitrary metadata, prompts and responses.
 */
export function createInvocationMetric(input = {}) {
  // Accept provider usage for new records and the normalized top-level token
  // fields when a validated metric is appended or migrated.
  const usage = normalizeUsage(input.usage ?? input);
  const startedAt = validDate(input.startedAt) ?? new Date();
  const finishedAt = validDate(input.finishedAt) ?? new Date();
  const latencyMs = finite(input.latencyMs)
    ?? Math.max(0, finishedAt.getTime() - startedAt.getTime());
  return {
    version: INVOCATION_METRIC_VERSION,
    traceId: safeId(input.traceId) ?? randomUUID(),
    taskId: safeId(input.taskId),
    executionId: safeId(input.executionId),
    source: enumValue(input.source, ['cli', 'wecom', 'web', 'api', 'runtime']),
    provider: safeName(input.provider) ?? 'unknown',
    model: safeName(input.model),
    operation: safeName(input.operation),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    totalTokens: usage.totalTokens,
    estimatedInputTokens: finite(input.estimatedInputTokens),
    latencyMs,
    firstTokenMs: finite(input.firstTokenMs),
    estimatedCost: finite(input.estimatedCost) ?? usage.cost,
    route: safeName(input.route),
    routeConfidence: bounded(input.routeConfidence, 0, 1),
    routeCorrected: typeof input.routeCorrected === 'boolean' ? input.routeCorrected : null,
    success: input.success === true,
    errorCode: safeErrorCode(input.errorCode),
    createdAt: (validDate(input.createdAt) ?? finishedAt).toISOString()
  };
}

export function validateInvocationMetric(value) {
  if (!value || value.version !== INVOCATION_METRIC_VERSION) return false;
  if (!safeId(value.traceId) || !safeName(value.provider)) return false;
  if (typeof value.success !== 'boolean') return false;
  return ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens',
    'estimatedInputTokens', 'latencyMs', 'firstTokenMs', 'estimatedCost',
    'routeConfidence'].every((key) => value[key] === null || finite(value[key]) !== null)
    && Boolean(validDate(value.createdAt));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function bounded(value, min, max) {
  const number = finite(value);
  return number !== null && number >= min && number <= max ? number : null;
}

function safeId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(text) ? text : null;
}

function safeName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.replace(/[^A-Za-z0-9._:@/-]/g, '_').slice(0, 128) : null;
}

function safeErrorCode(value) {
  const text = safeName(value);
  return text ? text.slice(0, 128) : null;
}

function enumValue(value, allowed) {
  const text = String(value ?? '').trim().toLowerCase();
  return allowed.includes(text) ? text : null;
}

function validDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
