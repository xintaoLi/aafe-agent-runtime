# Memory OOM Activation Gate

Memory rules MUST NOT load by default. Activate only for explicit OOM/leak requests, a memory-related current-analysis signal, a MEMORY_* AgentFinding, or an explicit custom memory-agent request.
