---
id: 0001
title: Auto-ingest memory vector DB on write
status: ready
depends_on: []
source: todo.md#2-memory-vector-db-staleness
---

## Problem

`operator` writes new lessons to `.claude/memory/*.md` via Bash during SHIP
mode, but the TF-IDF vector store (`.claude/memory-vectors.db`) only updates
when a human manually runs `npm run memory:ingest`. Any workflow that calls
`scripts/query-memory.mjs` between a write and the next manual ingest misses
the most recent memory.

## Acceptance Criteria

- After a Bash command that writes to `.claude/memory/` or `memory/`
  completes, `scripts/ingest-memory.mjs` runs automatically without blocking
  the calling agent (fire-and-forget, not synchronous).
- A normal Bash command unrelated to `.claude/memory/`/`memory/` triggers no
  extra ingestion work.
- Ingestion failure (e.g. corrupt memory file) does not fail or block the
  triggering tool call — `hooks/post-bash-processor.mjs` must still exit 0,
  consistent with this repo's fail-open hook convention.
- A new test in `tests/post-bash-processor.test.js` (or equivalent) covers:
  triggering on a memory write, not triggering on an unrelated command.

## Out of Scope

- Changing `lib/memory-store.mjs`'s TF-IDF approach (see
  `workflows/README.md` "Declined" — don't add embeddings here).
- Ingesting on `Write`/`Edit` tool calls — this hook only sees `Bash`
  (`post-bash-processor.mjs` is a PostToolUse hook scoped to Bash); if memory
  files end up written via `Write`/`Edit` instead of Bash, this spec doesn't
  cover that path.

## Implementation Notes

Modify `hooks/post-bash-processor.mjs`: after a command touching
`.claude/memory/` or `memory/` completes, spawn
`node scripts/ingest-memory.mjs` detached/unref'd so it runs in the
background. Follow the existing `runHook()`/fail-open pattern from
`hooks/lib/hook-utils.mjs` — don't let a spawn failure surface as a block.
