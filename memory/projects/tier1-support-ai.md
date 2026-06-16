# tier1-support-ai

Go 1.24 + Gin multi-tenant AI customer support backend.

## Stack
- Go 1.24, Gin framework
- In-memory knowledge store (no persistent DB)
- OpenAI LLM integration with retry logic and confidence scoring
- Rate limiting (5 req/s, burst 10), response caching (5 min TTL), token budget enforcement

## Request pipeline
```
Handler → Rate Limiter → Cache → Budget Guard → Knowledge Store → LLM Client → Confidence Scorer → Fallback → Cache Write
```

## Key directories
- `internal/handler/` — HTTP entry points
- `internal/reliability/` — rate limiter, cache, budget guard
- `internal/llm/` — OpenAI client, retry, confidence scoring
- `internal/config/` — tenant config, language config (loaded from env vars)
- `cmd/server/` — main entry point

## Active context
<!-- Update this section when starting a new work session -->
- What's being worked on:
- Last known branch:
- Open decisions:

## Known gotchas
<!-- Add entries as they're discovered — or let memory-manager write here -->
