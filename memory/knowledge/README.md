# Knowledge Base

Static reference knowledge for the agent harness. Lives inside `memory/knowledge/` so the memory-manager can serve it as part of context briefs. Agents read from here — they never write here.

Only harness-specific content lives here. General language idioms, git conventions, and code-quality catalogues are omitted — the model knows those. What's here are the SEC-4 patterns, OWASP checklists, STRIDE model, and harness-internal contracts that agents cannot derive from training data alone.

---

## Contents

### `security/`
- [`sec-4-patterns.md`](security/sec-4-patterns.md) — 8 SEC-4 grep patterns for credential detection (shared by secret-scanner and security-reviewer)
- [`owasp-top10.md`](security/owasp-top10.md) — OWASP A01–A10 quick reference with what to look for in code
- [`stride-cheatsheet.md`](security/stride-cheatsheet.md) — STRIDE threat model cheatsheet with code-level checks

### `agents/`
- [`verdict-vocabulary.md`](agents/verdict-vocabulary.md) — all verdicts for all agents in one place
- [`pipeline-patterns.md`](agents/pipeline-patterns.md) — the built-in pipelines and quality gate rules
- [`writing-agents.md`](agents/writing-agents.md) — how to write a new agent (frontmatter schema, system prompt patterns)

---

## Using the knowledge base

### Via memory-manager LOAD
memory-manager automatically includes relevant knowledge sections in its context brief based on task keywords (security/agent topics only).

### From an agent prompt
Agents with `Read` access can load specific knowledge files directly:

```
Read memory/knowledge/security/owasp-top10.md before running the OWASP audit.
```
