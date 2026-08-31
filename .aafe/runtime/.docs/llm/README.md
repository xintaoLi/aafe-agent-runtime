# LLM Enrichment (Reserved)

Deterministic AST facts under `facts/` are the source of truth today.

When an LLM API is configured via `.aafe.config.json`:

```json
{
  "analyze": {
    "llm": { "enabled": true, "provider": "openai-compatible", "baseUrl": "", "model": "" }
  }
}
```

or env `AAFE_ANALYZE_LLM_PROVIDER` + `AAFE_ANALYZE_LLM_API_KEY`, `aafe analyze --llm` may enrich module narratives.

Contract:

1. Input: `facts/modules/<id>.json`
2. Prompt: `prompts/analyze-module.md`
3. Output: optional markdown sections appended to architecture/dataflow module docs (never overwrite raw facts JSON)

Until configured, `analyzeModuleWithLlm` returns `skipped: llm-not-configured`.
