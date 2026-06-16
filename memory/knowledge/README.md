# Knowledge Base

Static reference knowledge for the agent harness. Lives inside `memory/knowledge/` so the memory-manager can serve it automatically as part of every context brief. Agents read from here — they never write here. Knowledge here changes rarely and deliberately.

---

## How it differs from the other memory layers

| Layer | Who writes | When it changes | What it holds |
|---|---|---|---|
| `memory/knowledge/` | Humans (you) | Rarely, deliberately | Reference facts: patterns, checklists, standards |
| `.claude/memory/` | memory-manager agent | After every pipeline | Discovered codebase facts, lessons learned |
| `memory/personas/` `memory/projects/` | Humans (you) | Per session/project | Persona, project snapshots |
| `CLAUDE.md` | Humans (you) | When conventions change | Project-wide instructions |

---

## Contents

### `security/`
- [`sec-4-patterns.md`](security/sec-4-patterns.md) — 8 SEC-4 grep patterns for credential detection (shared by secret-scanner and security-reviewer)
- [`owasp-top10.md`](security/owasp-top10.md) — OWASP A01–A10 quick reference with what to look for in code
- [`stride-cheatsheet.md`](security/stride-cheatsheet.md) — STRIDE threat model cheatsheet with code-level checks

### `code-quality/`
- [`code-smells.md`](code-quality/code-smells.md) — code smell catalogue with indicators and refactoring approaches
- [`test-patterns.md`](code-quality/test-patterns.md) — AAA pattern, test pyramid, coverage targets, naming conventions

### `git/`
- [`conventional-commits.md`](git/conventional-commits.md) — commit types, format, scope rules, good/bad examples
- [`pr-template.md`](git/pr-template.md) — PR body template used by git-assistant

### `agents/`
- [`verdict-vocabulary.md`](agents/verdict-vocabulary.md) — all verdicts for all 14 agents in one place
- [`pipeline-patterns.md`](agents/pipeline-patterns.md) — the 6 built-in pipelines and quality gate rules
- [`writing-agents.md`](agents/writing-agents.md) — how to write a new agent (frontmatter schema, system prompt patterns)

### `languages/`
- [`go-idioms.md`](languages/go-idioms.md) — Go-specific conventions: error handling, naming, testing, package structure
- [`typescript-patterns.md`](languages/typescript-patterns.md) — TypeScript/Next.js conventions: typing, async, component patterns

---

## Using the knowledge base

### From an agent prompt
Agents with `Read` access can load specific knowledge files:

```
Read memory/knowledge/security/owasp-top10.md before running the OWASP audit.
Read memory/knowledge/git/conventional-commits.md before validating commit messages.
```

### Via the knowledge-base agent
For searches across the full knowledge base:

```
"What does the knowledge base say about SQL injection?"
"Look up the STRIDE check for denial of service"
"Find the conventional commit format for a breaking change"
```

### Via memory-manager LOAD
memory-manager automatically includes relevant knowledge sections in its context brief based on task keywords.
