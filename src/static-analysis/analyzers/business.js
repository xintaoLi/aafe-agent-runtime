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

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSemanticAnalyzer } from '../semantic/port.js';
import { createAnalysisResult } from '../types/result.js';
import { createEvidence } from '../types/evidence.js';

/**
 * Business Analyzer v1: static Business Candidates only.
 * Does not invent business facts; LLM semantic enrichment goes through Semantic Port.
 */
export class BusinessAnalyzer {
  id = 'business';
  version = '1.0.0';

  async analyze(_input, context) {
    const started = Date.now();
    if (context.config.business?.enabled === false) {
      return createAnalysisResult(this.id, this.version, { candidates: [] }, {
        status: 'partial',
        diagnostics: [{ level: 'info', code: 'disabled', message: 'business analyzer disabled' }]
      });
    }

    const features = context.features?.candidates ?? [];
    const candidates = [];

    for (const feature of features) {
      const rules = [];
      for (const file of unique(feature.evidence.map((item) => item.file).filter(Boolean)).slice(0, 5)) {
        const abs = path.join(context.config.root, file);
        const content = await safeRead(abs);
        if (!content) continue;
        if (/redirect\(['"`]\/login['"`]\)|navigate\(['"`]\/login['"`]\)|to\s*:\s*['"`]\/login['"`]/.test(content)
          || /if\s*\(\s*!?\s*(user|isAuth|isAuthenticated|token)/.test(content)) {
          rules.push({
            text: '用户可能需要认证后才能访问该功能',
            evidence: [createEvidence({ type: 'source', file, reason: 'auth-guard pattern' })]
          });
        }
        if (/hasPermission|checkPermission|role\s*===|roles\.includes|can\(['"`]/.test(content)) {
          rules.push({
            text: '存在权限/角色校验逻辑（候选，需人工确认具体角色）',
            evidence: [createEvidence({ type: 'source', file, reason: 'permission pattern' })]
          });
        }
      }

      candidates.push({
        id: `business:${feature.id.replace(/^feature:/, '')}`,
        featureId: feature.id,
        name: feature.name,
        description: `Static business candidate derived from feature ${feature.name}`,
        actors: [],
        preconditions: rules.filter((rule) => /认证/.test(rule.text)).map((rule) => rule.text),
        postconditions: [],
        rules: rules.map((rule) => rule.text),
        workflows: feature.entrypoints,
        evidence: [
          ...feature.evidence.slice(0, 5),
          ...rules.flatMap((rule) => rule.evidence)
        ],
        confidence: Math.max(0.3, (feature.confidence ?? 0.5) - 0.15),
        status: 'candidate',
        source: 'static'
      });
    }

    const semantic = createSemanticAnalyzer(context.config.llm);
    const semanticResult = await semantic.analyze({
      kind: 'business',
      candidates
    }, context);

    return createAnalysisResult(this.id, this.version, {
      candidates: candidates.slice(0, 200),
      semantic: semanticResult
    }, {
      evidence: candidates.flatMap((item) => item.evidence).slice(0, 120),
      stats: {
        businessCandidates: candidates.length,
        durationMs: Date.now() - started
      }
    });
  }
}

function unique(items) {
  return [...new Set(items)];
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
