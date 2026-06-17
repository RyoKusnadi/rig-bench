# memory/

Structured context files for the agent harness. Portable — checked into the repo and travels across machines.

---

## Layout

```
memory/
    personas/          ← user preferences, agent behavior tuning
    sessions/          ← rolling scratch notes (7-day TTL)
    knowledge/         ← harness-specific reference knowledge
        security/      ← SEC-4 patterns, OWASP A01–A10, STRIDE cheatsheet
        agents/        ← verdict vocabulary, pipeline patterns, writing guide

.claude/memory/        ← codebase facts (managed by memory-manager agent)
    MEMORY.md          ← index
    conventions.md
    architecture.md
    gotchas.md
    lessons-learned.md
    decisions.md
```

---

## What goes where

| Type | Location | Updated by |
|---|---|---|
| Stable project conventions | `CLAUDE.md` | Human |
| Codebase facts from pipeline runs | `.claude/memory/` | memory-manager agent |
| User preferences / behavior tuning | `memory/personas/` | Human |
| Session scratch notes | `memory/sessions/` | Human or agents |
| Harness-specific reference knowledge | `memory/knowledge/` | Human, deliberately |

---

## How memory-manager uses this folder

On LOAD:
1. Reads `memory/personas/default.md` (always)
2. Loads relevant `memory/knowledge/` files by task keywords — security/agent topics only
3. Reads all `.claude/memory/` files for codebase-specific facts

`knowledge/` holds only what the model cannot derive from training data: SEC-4 grep patterns, OWASP/STRIDE checklists, and harness-internal contracts (verdict vocabulary, pipeline shapes, agent authoring rules).
