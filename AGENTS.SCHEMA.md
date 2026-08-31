# AAFE Agent Prompt + Schema 落地规范

以下直接按 **AAFE Agent Platform 可落地实现**设计。每个 Agent 独立维护：

```text
agents/
├── planner/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
├── code-intelligence/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
├── impact-analyzer/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
├── test-agent/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
├── failure-analyzer/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
├── knowledge-validator/
│   ├── prompt.ts
│   ├── input.schema.json
│   ├── output.schema.json
│   └── index.ts
└── context-agent/
    ├── prompt.ts
    ├── input.schema.json
    ├── output.schema.json
    └── index.ts
```

统一原则：

> **Prompt 定义 Agent 的行为，Input Schema 定义 Agent 能接收什么，Output Schema 定义 Agent 必须产出什么。**

模型只负责推理，不负责决定协议。

---

# 1. 通用 Agent Contract

所有 Agent 共用：

```typescript
export interface AgentRequest<T = unknown> {
  taskId: string;
  runId: string;
  agentId: string;

  goal: string;

  input: T;

  context?: {
    project?: ProjectContext;
    knowledge?: KnowledgeItem[];
    evidence?: Evidence[];
    previousResults?: AgentResult[];
  };

  constraints?: {
    maxTokens?: number;
    timeoutMs?: number;
    confidenceThreshold?: number;
  };
}
```

统一返回：

```typescript
export interface AgentResponse<T = unknown> {
  status: 'success' | 'partial' | 'failed';

  result: T;

  confidence: number;

  evidence: Evidence[];

  knowledgeUpdates?: KnowledgeUpdate[];

  suggestions?: AgentSuggestion[];

  errors?: AgentError[];
}
```

---

# 2. A0 — Planner / Router Agent

## 职责

唯一职责：

> **根据当前任务状态决定下一步应该调用哪个 Agent，以及调用方式。**

它不分析代码、不修改代码、不执行测试。

---

## 2.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlannerInput",
  "type": "object",
  "required": [
    "goal",
    "executionState",
    "availableAgents"
  ],
  "properties": {
    "goal": {
      "type": "string"
    },
    "executionState": {
      "type": "object",
      "required": [
        "status",
        "completedSteps",
        "failedSteps"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "initial",
            "running",
            "waiting",
            "failed",
            "completed"
          ]
        },
        "completedSteps": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "failedSteps": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "currentResults": {
          "type": "array"
        }
      }
    },
    "availableAgents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "capabilities"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "capabilities": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "knowledgeSummary": {
      "type": "object"
    },
    "previousResults": {
      "type": "array"
    }
  }
}
```

---

## 2.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlannerOutput",
  "type": "object",
  "required": [
    "action",
    "reason"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "invoke",
        "parallel",
        "replan",
        "complete",
        "need_input",
        "fail"
      ]
    },
    "reason": {
      "type": "string"
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "agentId",
          "goal"
        ],
        "properties": {
          "agentId": {
            "type": "string"
          },
          "goal": {
            "type": "string"
          },
          "input": {},
          "priority": {
            "type": "integer",
            "minimum": 0
          },
          "dependsOn": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "completionReason": {
      "type": "string"
    }
  }
}
```

---

## 2.3 `prompt.ts`

```text
You are the AAFE Planner / Router Agent.

Your responsibility is to determine what should happen next in an AAFE task.

You are NOT a coding agent.
You are NOT a code analyzer.
You are NOT a test executor.

Your only responsibility is planning and routing.

AVAILABLE AGENTS

You will receive a list of available Agents and their capabilities.

You MUST only select Agents that exist in availableAgents.

CORE RULES

1. Understand the current goal.
2. Inspect the current execution state.
3. Inspect completed and failed steps.
4. Determine whether enough information exists for the next step.
5. Select the Agent whose capability best matches the current requirement.
6. Multiple independent tasks should use "parallel".
7. If previous results invalidate the current plan, use "replan".
8. If the task is fully completed, use "complete".
9. If required information cannot be obtained from available Agents, use "need_input".
10. Never invent Agent IDs.
11. Never fabricate Agent results.
12. Never modify source code.
13. Never execute shell commands.
14. Never claim that a task is complete without sufficient evidence.

PLANNING PRINCIPLE

Prefer the smallest next action that can reduce uncertainty.

Do not generate a complete workflow unless the current information requires it.

The execution may repeatedly return to you after each Agent result.

OUTPUT

Return ONLY JSON matching the PlannerOutput schema.
```

---

# 3. A1 — Code Intelligence Agent

## 职责

```text
AST / Static Facts / Source
        ↓
Architecture
DataFlow
Feature
BusinessFlow
Dependency
```

---

## 3.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CodeIntelligenceInput",
  "type": "object",
  "required": [
    "project",
    "files"
  ],
  "properties": {
    "project": {
      "type": "object",
      "required": [
        "language"
      ],
      "properties": {
        "language": {
          "type": "string"
        },
        "framework": {
          "type": "string"
        },
        "packageManager": {
          "type": "string"
        }
      }
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "path"
        ],
        "properties": {
          "path": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "summary": {
            "type": "string"
          }
        }
      }
    },
    "symbols": {
      "type": "array"
    },
    "dependencies": {
      "type": "array"
    },
    "astFacts": {
      "type": "array"
    },
    "dataFlows": {
      "type": "array"
    },
    "existingKnowledge": {
      "type": "array"
    }
  }
}
```

---

## 3.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CodeIntelligenceOutput",
  "type": "object",
  "required": [
    "architecture",
    "dataFlows",
    "features",
    "businessFlows",
    "dependencies",
    "evidence"
  ],
  "properties": {
    "architecture": {
      "type": "object",
      "required": [
        "modules"
      ],
      "properties": {
        "modules": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "name",
              "evidence"
            ],
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "files": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "dependencies": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "evidence": {
                "type": "array"
              }
            }
          }
        }
      }
    },
    "dataFlows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "steps",
          "evidence"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "evidence": {
            "type": "array"
          }
        }
      }
    },
    "features": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "name",
          "evidence"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "relatedFiles": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "evidence": {
            "type": "array"
          }
        }
      }
    },
    "businessFlows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "steps",
          "evidence"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "trigger": {
            "type": "string"
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "evidence": {
            "type": "array"
          }
        }
      }
    },
    "dependencies": {
      "type": "array"
    },
    "evidence": {
      "type": "array"
    }
  }
}
```

---

## 3.3 Prompt

```text
You are the AAFE Code Intelligence Agent.

Your responsibility is to transform static code analysis facts and source-code evidence into structured project knowledge.

You must analyze:

1. Architecture
2. Module relationships
3. Dependencies
4. Data flows
5. Features
6. Business flows

IMPORTANT

Static analysis facts are authoritative for structural relationships.

Source code is authoritative for implementation details.

Do not invent relationships that cannot be supported by the provided evidence.

RULES

1. Every important conclusion MUST contain evidence.
2. Do not invent files.
3. Do not invent functions.
4. Do not invent APIs.
5. Do not invent business rules.
6. Separate confirmed facts from inferred semantics.
7. When semantic interpretation is uncertain, lower confidence.
8. Prefer AST and static facts over LLM inference.
9. Do not modify source code.
10. Do not provide implementation suggestions unless explicitly requested.

ARCHITECTURE

Identify:
- modules
- components
- services
- stores
- utilities
- external dependencies
- module relationships

DATA FLOW

Trace data where evidence permits:

Input
→ State
→ Function
→ Service
→ API
→ Response
→ State
→ UI

FEATURE

Group related implementation into coherent user-facing features.

BUSINESS FLOW

Only identify business flows when there is sufficient implementation evidence.

OUTPUT

Return ONLY JSON matching CodeIntelligenceOutput.
```

---

# 4. A2 — Impact Analyzer

这是需求开发和代码变更分析的核心 Agent。

---

## 4.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ImpactAnalyzerInput",
  "type": "object",
  "required": [
    "mode",
    "request"
  ],
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "requirement",
        "diff"
      ]
    },
    "request": {
      "type": "object",
      "properties": {
        "requirement": {
          "type": "string"
        },
        "diff": {
          "type": "string"
        }
      }
    },
    "knowledge": {
      "type": "object"
    },
    "evidence": {
      "type": "array"
    }
  }
}
```

---

## 4.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ImpactAnalyzerOutput",
  "type": "object",
  "required": [
    "affectedFiles",
    "affectedModules",
    "affectedFeatures",
    "affectedDataFlows",
    "affectedTests",
    "risk",
    "evidence"
  ],
  "properties": {
    "affectedFiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "path",
          "impact",
          "reason",
          "confidence"
        ],
        "properties": {
          "path": {
            "type": "string"
          },
          "impact": {
            "type": "string",
            "enum": [
              "direct",
              "indirect",
              "potential"
            ]
          },
          "reason": {
            "type": "string"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      }
    },
    "affectedModules": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "affectedFeatures": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "affectedDataFlows": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "affectedTests": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "changePlan": {
      "type": "array"
    },
    "risk": {
      "type": "object",
      "required": [
        "level",
        "reason"
      ],
      "properties": {
        "level": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high",
            "critical"
          ]
        },
        "reason": {
          "type": "string"
        }
      }
    },
    "evidence": {
      "type": "array"
    }
  }
}
```

---

## 4.3 Prompt

```text
You are the AAFE Impact Analyzer.

Your responsibility is to determine which parts of a software project are affected by:

1. A new requirement
2. A code change / Git diff

You must distinguish:

- Direct impact
- Indirect impact
- Potential impact

RULES

1. Never claim a file is affected without evidence.
2. Never invent files or modules.
3. Use static dependency information whenever available.
4. Use data-flow information to identify downstream impact.
5. Use feature and business-flow knowledge to identify functional impact.
6. Separate confirmed impact from potential risk.
7. A shared utility does not automatically mean every consumer is affected.
8. Do not treat semantic similarity as proof of dependency.
9. Every important conclusion must include evidence.
10. Confidence must reflect the quality of evidence.

REQUIREMENT MODE

Determine:

Requirement
→ Feature
→ Module
→ Data Flow
→ Files
→ Tests

DIFF MODE

Determine:

Changed Code
→ Direct Dependencies
→ Data Flow
→ Features
→ Business Flows
→ Tests
→ Regression Risk

OUTPUT

Return ONLY JSON matching ImpactAnalyzerOutput.
```

---

# 5. A3 — Test Agent

---

## 5.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TestAgentInput",
  "type": "object",
  "required": [
    "goal",
    "feature",
    "businessFlows"
  ],
  "properties": {
    "goal": {
      "type": "string"
    },
    "feature": {
      "type": "object"
    },
    "businessFlows": {
      "type": "array"
    },
    "dataFlows": {
      "type": "array"
    },
    "impact": {
      "type": "object"
    },
    "existingTests": {
      "type": "array"
    },
    "testFramework": {
      "type": "string"
    }
  }
}
```

---

## 5.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TestAgentOutput",
  "type": "object",
  "required": [
    "testPlan",
    "testCases"
  ],
  "properties": {
    "testPlan": {
      "type": "object",
      "required": [
        "scope",
        "strategy"
      ],
      "properties": {
        "scope": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "strategy": {
          "type": "string"
        }
      }
    },
    "testCases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "priority",
          "preconditions",
          "steps",
          "expected"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "critical",
              "high",
              "medium",
              "low"
            ]
          },
          "preconditions": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "expected": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "relatedFeature": {
            "type": "string"
          },
          "relatedFlow": {
            "type": "string"
          }
        }
      }
    },
    "testCode": {
      "type": "string"
    }
  }
}
```

---

## 5.3 Prompt

```text
You are the AAFE Test Agent.

Your responsibility is to design and generate automated tests based on verified project knowledge.

You must focus on behavior, not implementation details.

INPUT SOURCES

- Requirement
- Feature knowledge
- Business flows
- Data flows
- Impact analysis
- Existing tests

RULES

1. Test real user-visible behavior.
2. Every test must map to a feature or business flow.
3. Cover happy paths.
4. Cover important boundary conditions.
5. Cover important negative cases.
6. Cover regression risks identified by Impact Analysis.
7. Do not invent UI elements that are not supported by project evidence.
8. Do not invent API behavior.
9. Prefer existing project test patterns.
10. Do not declare a test passed unless an executor provides the result.

TEST GENERATION

Each test case must contain:

- Preconditions
- Steps
- Expected results

If testCode is requested, generate code using the configured test framework.

The LLM does not execute the browser.

OUTPUT

Return ONLY JSON matching TestAgentOutput.
```

---

# 6. A4 — Failure Analyzer

---

## 6.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FailureAnalyzerInput",
  "type": "object",
  "required": [
    "testResult"
  ],
  "properties": {
    "testResult": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "stack": {
      "type": "string"
    },
    "console": {
      "type": "array"
    },
    "network": {
      "type": "array"
    },
    "screenshot": {
      "type": "string"
    },
    "trace": {
      "type": "string"
    },
    "diff": {
      "type": "string"
    },
    "knowledge": {
      "type": "object"
    },
    "impact": {
      "type": "object"
    }
  }
}
```

---

## 6.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FailureAnalyzerOutput",
  "type": "object",
  "required": [
    "classification",
    "rootCause",
    "evidence",
    "confidence"
  ],
  "properties": {
    "classification": {
      "type": "string",
      "enum": [
        "product_bug",
        "test_bug",
        "environment",
        "data",
        "network",
        "unknown"
      ]
    },
    "symptom": {
      "type": "string"
    },
    "immediateCause": {
      "type": "string"
    },
    "rootCause": {
      "type": "object",
      "required": [
        "description"
      ],
      "properties": {
        "description": {
          "type": "string"
        },
        "files": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "symbols": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "affectedFlows": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "fixSuggestion": {
      "type": "object"
    },
    "regressionTests": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "evidence": {
      "type": "array"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    }
  }
}
```

---

## 6.3 Prompt

```text
You are the AAFE Failure Analyzer.

Your responsibility is to determine why an automated test failed.

You must distinguish:

1. Product bug
2. Test bug
3. Environment problem
4. Test data problem
5. Network problem
6. Unknown

ANALYSIS MODEL

Failure
→ Symptom
→ Immediate Cause
→ Root Cause
→ Affected Code
→ Affected Flow
→ Regression Risk

RULES

1. Do not assume every failed test means a product bug.
2. Test infrastructure failures must be separated from product failures.
3. Use stack traces as evidence.
4. Use console and network information as evidence.
5. Use screenshots and traces when available.
6. Correlate the failure with Git diff when available.
7. Correlate the failure with known data flows.
8. Do not invent root causes.
9. Every root-cause conclusion must have evidence.
10. If evidence is insufficient, classify as unknown rather than guessing.

OUTPUT

Return ONLY JSON matching FailureAnalyzerOutput.
```

---

# 7. A5 — Knowledge Validator

---

## 7.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "KnowledgeValidatorInput",
  "type": "object",
  "required": [
    "knowledge"
  ],
  "properties": {
    "knowledge": {
      "type": "array"
    },
    "sourceFacts": {
      "type": "array"
    },
    "symbols": {
      "type": "array"
    },
    "dependencies": {
      "type": "array"
    },
    "dataFlows": {
      "type": "array"
    }
  }
}
```

---

## 7.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "KnowledgeValidatorOutput",
  "type": "object",
  "required": [
    "results"
  ],
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "knowledgeId",
          "valid",
          "confidence"
        ],
        "properties": {
          "knowledgeId": {
            "type": "string"
          },
          "valid": {
            "type": "boolean"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "reason": {
            "type": "string"
          },
          "evidence": {
            "type": "array"
          },
          "corrections": {
            "type": "array"
          }
        }
      }
    }
  }
}
```

---

## 7.3 Prompt

```text
You are the AAFE Knowledge Validator.

Your responsibility is to verify whether generated project knowledge is supported by actual project evidence.

VALIDATION PRIORITY

1. AST facts
2. Symbol information
3. Dependency graph
4. Data-flow graph
5. Source code
6. Git information
7. Semantic LLM reasoning

RULES

1. Never validate a claim only because it sounds reasonable.
2. A claim must have supporting evidence.
3. Structural claims should be verified using deterministic facts whenever possible.
4. Semantic claims may require LLM reasoning.
5. If evidence contradicts the claim, mark it invalid.
6. If evidence is insufficient, do not mark the claim valid.
7. Provide correction suggestions when possible.
8. Never create new unsupported project knowledge.

OUTPUT

Return ONLY JSON matching KnowledgeValidatorOutput.
```

---

# 8. A6 — Context / Evidence Agent

这个 Agent 建议尽量做成：

```text
Deterministic Retrieval
+
Optional LLM Compression
```

而不是纯 LLM。

---

## 8.1 `input.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ContextAgentInput",
  "type": "object",
  "required": [
    "goal"
  ],
  "properties": {
    "goal": {
      "type": "string"
    },
    "knowledge": {
      "type": "array"
    },
    "files": {
      "type": "array"
    },
    "features": {
      "type": "array"
    },
    "dataFlows": {
      "type": "array"
    },
    "businessFlows": {
      "type": "array"
    },
    "impact": {
      "type": "object"
    },
    "tokenBudget": {
      "type": "integer",
      "minimum": 1000
    }
  }
}
```

---

## 8.2 `output.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ContextAgentOutput",
  "type": "object",
  "required": [
    "summary",
    "relevantFiles",
    "relevantKnowledge",
    "evidence"
  ],
  "properties": {
    "summary": {
      "type": "string"
    },
    "relevantFiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "path",
          "reason"
        ],
        "properties": {
          "path": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "symbols": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "relevantKnowledge": {
      "type": "array"
    },
    "dataFlows": {
      "type": "array"
    },
    "businessFlows": {
      "type": "array"
    },
    "tests": {
      "type": "array"
    },
    "constraints": {
      "type": "array"
    },
    "evidence": {
      "type": "array"
    },
    "tokenEstimate": {
      "type": "integer"
    }
  }
}
```

---

## 8.3 Prompt

```text
You are the AAFE Context / Evidence Agent.

Your responsibility is to construct the smallest useful context required for another Agent or IDE coding Agent.

You must retrieve only information relevant to the current goal.

RULES

1. Prefer relevant information over complete information.
2. Do not include unrelated files.
3. Do not include the entire project unless explicitly required.
4. Prioritize directly affected files.
5. Include dependencies required to understand the affected flow.
6. Include relevant architecture information.
7. Include relevant data flows.
8. Include relevant business flows.
9. Include relevant existing tests.
10. Every important context item should have evidence.
11. Respect the provided token budget.
12. Never invent missing information.

CONTEXT PRIORITY

1. Directly affected files
2. Direct dependencies
3. Related data flows
4. Related features
5. Related business flows
6. Related tests
7. Wider architectural context

If information is uncertain, explicitly mark it as uncertain.

OUTPUT

Return ONLY JSON matching ContextAgentOutput.
```

---

# 9. Evidence Schema

上面所有 Agent 都会使用 Evidence，因此建议 AAFE 定义一个公共 Schema。

`schemas/evidence.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Evidence",
  "type": "object",
  "required": [
    "type",
    "source"
  ],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "source",
        "ast",
        "symbol",
        "dependency",
        "data-flow",
        "git",
        "test",
        "runtime",
        "network"
      ]
    },
    "source": {
      "type": "object",
      "required": [
        "file"
      ],
      "properties": {
        "file": {
          "type": "string"
        },
        "lineStart": {
          "type": "integer"
        },
        "lineEnd": {
          "type": "integer"
        },
        "symbol": {
          "type": "string"
        }
      }
    },
    "description": {
      "type": "string"
    }
  }
}
```

---

# 10. Knowledge Schema

Agent 1 的输出最终不要直接散落。

统一：

```typescript
interface KnowledgeItem {
  id: string;

  type:
    | 'architecture'
    | 'dependency'
    | 'data-flow'
    | 'feature'
    | 'business-flow';

  name: string;

  content: unknown;

  evidence: Evidence[];

  confidence: number;

  generatedBy: string;

  validated: boolean;

  updatedAt: number;
}
```

---

# 11. Agent 配置直接接入 `.aafe.agents.json`

最终：

```json
{
  "version": 1,

  "planner": {
    "model": "kimi-2.6",
    "endpoint": "${AAFE_PLANNER_ENDPOINT}",
    "temperature": 0.1
  },

  "agents": {
    "code-intelligence": {
      "enabled": true,
      "model": "kimi-2.6",
      "endpoint": "${AAFE_CODE_INTELLIGENCE_ENDPOINT}",
      "inputSchema": "./agents/code-intelligence/input.schema.json",
      "outputSchema": "./agents/code-intelligence/output.schema.json"
    },

    "impact-analyzer": {
      "enabled": true,
      "model": "deepseek",
      "endpoint": "${AAFE_IMPACT_ENDPOINT}",
      "inputSchema": "./agents/impact-analyzer/input.schema.json",
      "outputSchema": "./agents/impact-analyzer/output.schema.json"
    },

    "test-agent": {
      "enabled": true,
      "model": "qwen3",
      "endpoint": "${AAFE_TEST_AGENT_ENDPOINT}",
      "inputSchema": "./agents/test-agent/input.schema.json",
      "outputSchema": "./agents/test-agent/output.schema.json"
    },

    "failure-analyzer": {
      "enabled": true,
      "model": "deepseek",
      "endpoint": "${AAFE_FAILURE_ENDPOINT}",
      "inputSchema": "./agents/failure-analyzer/input.schema.json",
      "outputSchema": "./agents/failure-analyzer/output.schema.json"
    },

    "knowledge-validator": {
      "enabled": true,
      "model": "qwen3",
      "endpoint": "${AAFE_KNOWLEDGE_VALIDATOR_ENDPOINT}",
      "inputSchema": "./agents/knowledge-validator/input.schema.json",
      "outputSchema": "./agents/knowledge-validator/output.schema.json"
    },

    "context-agent": {
      "enabled": true,
      "model": "qwen3",
      "endpoint": "${AAFE_CONTEXT_AGENT_ENDPOINT}",
      "inputSchema": "./agents/context-agent/input.schema.json",
      "outputSchema": "./agents/context-agent/output.schema.json"
    }
  }
}
```

---

# 12. Prompt 也配置化

不要把 Prompt 写死在 Orchestrator。

Agent Registry 加：

```json
{
  "id": "impact-analyzer",
  "prompt": "./agents/impact-analyzer/prompt.ts",
  "inputSchema": "./agents/impact-analyzer/input.schema.json",
  "outputSchema": "./agents/impact-analyzer/output.schema.json"
}
```

这样以后可以：

```text
AAFE Core
     │
     ├── Agent Registry
     │
     ├── Prompt
     │
     ├── Input Schema
     │
     ├── Output Schema
     │
     └── Model
```

全部动态装载。

---

# 13. Agent Runtime 的统一执行流程

最终每个 Agent 都走完全一致的 Runtime：

```text
Agent Request
      │
      ▼
Load Agent Definition
      │
      ├── Prompt
      ├── Input Schema
      ├── Output Schema
      └── Model
      │
      ▼
Validate Input
      │
      ▼
Build Context
      │
      ▼
LLM Invocation
      │
      ▼
Parse Structured Output
      │
      ▼
Validate Output Schema
      │
      ├── FAIL → Retry / Repair
      │
      ▼
Evidence Validation
      │
      ▼
Normalize Result
      │
      ▼
Knowledge / Execution State
```

---

# 14. Schema 校验失败必须有 Repair Loop

例如模型返回：

```json
{
  "affectedFiles": "User.vue"
}
```

但 Schema 要求：

```json
"affectedFiles": []
```

Runtime 不应该直接失败。

应该：

```text
LLM
 ↓
Schema Validation
 ↓
FAIL
 ↓
Structured Repair
 ↓
LLM
 ↓
Schema Validation
 ↓
PASS
```

最多：

```text
2~3 次
```

然后才判定 Agent Failed。

---

# 15. Agent 不应该共享 Prompt

每个 Agent 的 Prompt 必须独立。

但是可以共享：

```text
Base System Rules
```

例如：

```text
prompts/
├── base.ts
├── evidence.ts
├── structured-output.ts
└── agents/
    ├── planner.ts
    ├── code-intelligence.ts
    ├── impact.ts
    ├── test.ts
    ├── failure.ts
    ├── validator.ts
    └── context.ts
```

最终：

```typescript
const prompt = [
  BASE_PROMPT,
  EVIDENCE_POLICY,
  STRUCTURED_OUTPUT_POLICY,
  AGENT_PROMPT
].join('\n');
```

这样可以统一控制 Agent 行为。

---

# 16. 最终 AAFE Agent 开发规范

以后新增 Agent，只需要实现：

```text
agents/<agent-id>/
│
├── prompt.ts
├── input.schema.json
├── output.schema.json
├── context.ts
├── validator.ts
└── index.ts
```

然后 `.aafe.agents.json`：

```json
{
  "agents": {
    "new-agent": {
      "enabled": true,
      "model": "qwen3",
      "endpoint": "...",
      "prompt": "./agents/new-agent/prompt.ts",
      "inputSchema": "./agents/new-agent/input.schema.json",
      "outputSchema": "./agents/new-agent/output.schema.json"
    }
  }
}
```

Planner 自动通过：

```text
Agent Registry
      ↓
capabilities
      ↓
选择 Agent
```

而不是修改 Orchestrator 代码。

---

# 17. 第一版直接落地的 Agent 契约

最终固定成：

```text
A0 Planner
  Input  → Task + State + Agents + Knowledge Summary
  Output → Next Action

A1 Code Intelligence
  Input  → AST + Static Facts + Code
  Output → Architecture + DataFlow + Feature + BusinessFlow

A2 Impact Analyzer
  Input  → Requirement / Diff + Knowledge
  Output → Impact + Change Scope + Risk

A3 Test Agent
  Input  → Requirement + Feature + Flow + Impact
  Output → Test Plan + Test Cases + Test Code

A4 Failure Analyzer
  Input  → Test Result + Runtime Evidence + Code Knowledge
  Output → Classification + Root Cause + Fix Suggestion

A5 Knowledge Validator
  Input  → Knowledge + Static Facts + Evidence
  Output → Validity + Confidence + Correction

A6 Context Agent
  Input  → Goal + Knowledge + Impact + Token Budget
  Output → Minimal Context + Evidence
```

这套定义可以直接作为 AAFE 第一版 **Agent Contract**。其中最关键的不是 Prompt 本身，而是 **Prompt + Input Schema + Output Schema + Evidence + Validator 五者必须绑定在 Agent 内部**；这样后续替换 DeepSeek / Qwen3 / Kimi / HY3 时，AAFE 的 Agent 能力协议不会发生变化。
