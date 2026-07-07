---
id: "0018"
title: Check the memory writeback loop actually ran
status: waiting_verification
depends_on: ["0015"]
verify_attempts: 0
source: ""
---
## Problem

The lifecycle loop promises that every verification failure and every blocked escalation
leaves a distilled entry in `memory/lessons.md` (spec-verify Phase 6, memory/README.md).
Nothing checks this happened — the loop is hoped-for, not verifiable, and a skipped
writeback is silent exactly when it matters most (a blocked spec).

## Acceptance Criteria

- If a spec sits in `blocked/` and no `memory/lessons.md` entry heading carries that
  spec's provenance tag, then `check-specs.sh` shall report an ISSUE.
- When a spec in `waiting_verification/` has `verify_attempts` greater than 0 and no
  matching `lessons.md` provenance tag, `check-specs.sh` shall print an advisory WARN
  line that does not affect the exit code.
- The provenance match shall accept the documented tag forms — `spec NNNN` appearing in
  a `##` entry heading of `lessons.md` — including combined tags like
  `(spec 0006, PR #77)` or `(spec 0006 | PR #77)`.

## Out of Scope

- Checking `decisions.md`/`gotchas.md` writebacks (those have no lifecycle trigger).
- Judging entry *quality* — presence of the provenance tag is the checkable proxy.
- Auto-writing a missing entry — the check reports; spec-verify (or a human) writes.

## Files/Interfaces Touched

- `scripts/check-specs.sh` — new `[missing-lesson]` ISSUE (blocked) and WARN
  (waiting_verification with failed attempts) rules
- `memory/lessons.md` — consumed read-only
- `tests/spec-scripts.test.mjs` — fixtures for both rules

## Implementation Notes

- Match with awk over `lessons.md` heading lines (`^## `) for the literal `spec <id>`
  substring — struck-through (superseded) headings still count as having written the
  lesson; the pruning convention keeps them in the tree on purpose.
- The blocked case is a hard ISSUE (exit 1) because escalations are "exactly the events
  the notebook exists for" (spec-verify Phase 6b); the waiting_verification case stays
  advisory because attempt-1 failures may be mid-fix with the entry legitimately pending
  a moment — WARN keeps it visible without blocking CI on a race.
- The fixture project's `blocked/` spec needs a paired temp lessons file; make the
  lessons path overridable (e.g. `LESSONS_FILE` env var defaulting to
  `memory/lessons.md`) so tests don't touch the real notebook.
- Bash-3.2/awk-only per `memory/gotchas.md` (2026-07-05).

## Verification

Run `npm test` — new cases assert, against a temp fixture project and temp lessons
file: a spec in `blocked/` with no matching heading tag makes `check-specs.sh` exit 1
with `[missing-lesson]`; adding a `## 2026-01-01 — Title (spec NNNN)` heading makes it
pass; a `waiting_verification/` spec with `verify_attempts: 1` and no tag produces a
WARN line while the script still exits 0. `make check` exits 0 on the real tree.
