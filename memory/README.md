# memory/

Structured context files for the agent harness. This folder holds knowledge that spans projects, sessions, and personas — distinct from `.claude/memory/` which holds codebase-specific facts.

---

## Three memory layers

```
memory/                        ← this folder — cross-project, portable context
    README.md                  ← this file
    personas/                  ← who is using this harness and how
    projects/                  ← per-project context snapshots
    sessions/                  ← rolling session notes (scratch space)
    knowledge/                 ← reference knowledge (patterns, standards, idioms)
        security/              ← SEC-4 patterns, OWASP top 10, STRIDE cheatsheet
        code-quality/          ← code smells, test patterns
        git/                   ← conventional commits, PR template
        agents/                ← verdict vocabulary, pipeline patterns, writing guide
        languages/             ← Go idioms, TypeScript/Next.js patterns

.claude/memory/                ← project-level codebase knowledge (managed by memory-manager agent)
    MEMORY.md                  ← index
    conventions.md             ← coding patterns
    architecture.md            ← structural facts
    gotchas.md                 ← things that broke
    lessons-learned.md         ← pipeline outcomes
    decisions.md               ← architectural choices

CLAUDE.md                      ← project-wide instructions (always loaded, rarely changes)
```

---

## What goes where

| Type of knowledge | Where it lives | Updated by |
|---|---|---|
| Stable project conventions | `CLAUDE.md` | Human, manually |
| Codebase facts discovered by agents | `.claude/memory/` | memory-manager agent |
| Pipeline run outcomes | `.claude/memory/lessons-learned.md` | memory-manager agent |
| Per-project context snapshot | `memory/projects/` | Human or memory-manager |
| Who is working on what | `memory/personas/` | Human |
| Scratch notes from a session | `memory/sessions/` | Human or agents |
| Reference patterns and standards | `memory/knowledge/` | Human, deliberately |

---

## Subfolders

### `personas/`

Who is using the harness and their preferences. Loaded at the start of a session to tune agent behavior.

```
personas/
    default.md       ← loaded unless a specific persona is active
    backend-dev.md   ← backend engineer working on Go services
    frontend-dev.md  ← frontend engineer on Next.js
```

### `projects/`

One file per active project. A snapshot of what's being worked on, key decisions, and context that's too volatile for CLAUDE.md but too important to lose between sessions.

```
projects/
    my-profile.md           ← Next.js portfolio
    tier1-support-ai.md     ← Go AI backend
    mcp-go-local-server.md  ← MCP server
```

### `sessions/`

Rolling scratch space. Agents can write here during a long session to avoid losing context. Automatically stale — files older than 7 days can be deleted.

```
sessions/
    2026-06-16-rate-limit.md    ← notes from today's rate-limit work
```

### `knowledge/`

Reference knowledge that rarely changes. Agents with `Read` access load specific files before running. memory-manager serves the relevant subset in its context brief based on task keywords.

```
knowledge/
    security/
        sec-4-patterns.md          ← 8 secret-detection grep patterns + escalation protocol
        owasp-top10.md             ← OWASP A01–A10 code-level audit reference
        stride-cheatsheet.md       ← STRIDE threat model + code-level checks per stack
    code-quality/
        code-smells.md             ← code smell catalogue with indicators + refactoring
        test-patterns.md           ← AAA, test pyramid, naming, coverage targets, mocking rules
    git/
        conventional-commits.md    ← types, format, scopes, validation, good/bad examples
        pr-template.md             ← PR body template + release PR template
    agents/
        verdict-vocabulary.md      ← all verdicts for all 14 agents
        pipeline-patterns.md       ← the 6 built-in pipelines + gate rules + retry logic
        writing-agents.md          ← how to write a new agent (frontmatter, patterns, checklist)
    languages/
        go-idioms.md               ← error handling, nil checks, naming, testing, concurrency
        typescript-patterns.md     ← typing, async, Next.js App Router, component patterns
```

---

## How memory-manager uses this folder

On LOAD, memory-manager:
1. Always reads `memory/personas/default.md`
2. Reads the matching `memory/projects/<name>.md` when a known project is in scope
3. Reads relevant `memory/knowledge/` files based on task keywords (e.g. task includes "security" → loads sec-4-patterns.md and owasp-top10.md)
4. Reads all `.claude/memory/` files for codebase-specific facts

To request a specific knowledge file in a LOAD call:

```
LOAD task="add auth middleware" also load memory/knowledge/security/owasp-top10.md
```
