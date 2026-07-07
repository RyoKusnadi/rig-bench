---
id: "0020"
title: Record state-transition timestamps in spec frontmatter
status: ready
depends_on: ["0012", "0014", "0018"]
verify_attempts: 0
source: ""
---
## Problem

Cycle-time metrics are reconstructed from `git log --follow` on each spec file — a
best-effort proxy that measures commit times, collapses same-day transitions to zero,
and breaks when moves are squashed. The lifecycle has well-defined transition moments;
nothing records them.

## Acceptance Criteria

- The spec template shall define a `history` frontmatter list whose entries are flat
  `- <state> <ISO-8601 UTC timestamp>` lines, with the initial entry recorded when the
  spec is first written to `ready/`.
- When spec-exec or spec-verify moves a spec between lifecycle folders, the respective
  skill shall direct appending a `history` entry for the entered state in the same step
  as the `git mv` and `status` edit.
- When a finished spec carries `history` entries, `spec-metrics.sh` shall compute its
  cycle time from the first `ready` entry to the `finished` entry.
- If a finished spec has no `history` entries, then `spec-metrics.sh` shall fall back
  to the existing `git log --follow` computation.
- The `specs/README.md` lifecycle section shall document the `history` convention.

## Out of Scope

- Backfilling `history` into existing specs (the git-log fallback covers them forever).
- Per-state dwell-time reporting in `spec-metrics.sh` (the data enables it; add when
  wanted).
- Machine enforcement that every move appended an entry — like the status-field edit,
  it's part of the documented move procedure; a missing entry degrades to the fallback.

## Files/Interfaces Touched

- `specs/spec-template.md` — add `history:` with a commented initial-entry convention
- `.claude/skills/spec-exec/SKILL.md` — append-entry instruction in the move steps
- `.claude/skills/spec-verify/SKILL.md` — append-entry instruction in Phases 5/6b
- `scripts/spec-metrics.sh` — prefer `history` timestamps, fall back to git log
- `specs/README.md` — document the convention in the Lifecycle section

## Implementation Notes

- Entry format is deliberately flat (`- ready 2026-07-07T04:00:00Z`) so the existing
  line-oriented awk parsing handles it — a `history:` line opens the block, subsequent
  `^[ ]*- ` lines split on whitespace into state + timestamp. This respects the
  dependency-free decision in `memory/decisions.md` (no YAML parser).
- Timestamps are agent-written at move time (`date -u +%Y-%m-%dT%H:%M:%SZ`), same-step
  with the mv and status edit per the centralized-moves lesson
  (`memory/lessons.md` 2026-07-06, finding 3) — never as a separate pass.
- `spec-metrics.sh` cycle time in seconds→days as today; a `history` with `finished`
  but no `ready` entry (or unparseable timestamps) counts as absent → fallback, so a
  malformed hand edit degrades instead of erroring.
- Note the 0012 interaction: both specs touch `spec-template.md` frontmatter and both
  skills' move prose — this spec lands on top of 0012's merged shape (hence
  `depends_on`), on 0014's README edits, and on 0015/0018's `tests/spec-scripts.test.mjs`
  additions (via `depends_on: 0018`, which transitively orders the whole chain).
- Bash-3.2/awk-only per `memory/gotchas.md` (2026-07-05).

## Verification

Run `npm test` — `tests/spec-scripts.test.mjs` gains cases asserting, against a temp
fixture project: a `finished/` spec with `history` entries `ready` and `finished` three
days apart reports `3 day(s)` from `spec-metrics.sh` without any git history for the
file; a `finished/` spec without `history` still reports via the git fallback (or the
no-git skip message in a non-repo fixture). `make metrics` runs clean on the real tree.
