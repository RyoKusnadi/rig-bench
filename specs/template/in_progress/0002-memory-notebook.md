---
id: "0002"
title: File-based memory notebook (decisions, gotchas, lessons)
status: in_progress
depends_on: []
verify_attempts: 0
source: REMOVED.md#memory-system
---
## Problem

The previous memory system (TF-IDF vector store, SQLite, native dependency) was removed as
complexity without daily value. Since then the harness has had no durable memory at all —
decisions, gotchas, and lessons live only in PR descriptions and conversation history.

## Acceptance Criteria

- The `memory/` directory shall contain `decisions.md`, `gotchas.md`, and `lessons.md`, plus
  a `README.md` defining the entry format.
- Each memory entry shall carry a date, a short title, and the spec ID or PR that produced
  it, per the format in `memory/README.md`.
- The memory files shall be plain markdown readable with grep — no database, no index, no
  new dependency.
- `memory/README.md` shall define a pruning convention: superseded entries are struck
  through with a pointer to the superseding entry, not deleted.
- `CLAUDE.md` shall point to `memory/` so every session loads the convention.
- Each memory file shall ship with at least one real seeded entry (from the spec 0001
  lifecycle exercise), so the format is demonstrated by example rather than described only
  in the abstract.

## Out of Scope

- Automatic write-back from skills (spec 0003 wires that loop).
- Any search tooling beyond grep — at this scale a query engine is the complexity the old
  system died of.
- Per-session or persona memory (the removed system's `sessions/`/`personas/` split) — not
  re-added until something needs it.

## Files/Interfaces Touched

- `memory/README.md` (new)
- `memory/decisions.md` (new)
- `memory/gotchas.md` (new)
- `memory/lessons.md` (new)
- `CLAUDE.md` (add memory section)

## Implementation Notes

Three files instead of one so grep scoping is natural (`grep -r foo memory/` still works
across all). Entry format kept minimal: `## YYYY-MM-DD — <title> (spec NNNN | PR #NN)` header
plus free prose — structure that survives being written by both humans and agents mid-task.
The pruning convention avoids deletion so git history isn't the only record of what was once
believed.

## Verification

`ls memory/` shows the four files; each of decisions/gotchas/lessons contains at least one
dated entry referencing spec 0001 or its PRs; `grep -l "memory/" CLAUDE.md` matches;
`scripts/check-specs.sh template` passes.
