---
id: "0006"
title: make status — per-state spec counts and attention items
status: blocked
depends_on: []
verify_attempts: 2
source: improvement-plan.md#phase-3
---
## Problem

Seeing where a project's specs stand requires ls-ing seven folders and reading frontmatter
by hand. There is no single view of counts per state or of specs needing attention
(failed-once verifications, blocked escalations).

## Acceptance Criteria

- The `scripts/spec-status.sh` script shall print, for a project, the count of specs in
  each lifecycle state (states read from `workflows/state.yaml`, not hardcoded).
- The script shall list each spec in `waiting_verification/` with `verify_attempts > 0` as
  an attention item, showing id, title, and attempts.
- The script shall list each spec in `blocked/` as an attention item, showing id and title.
- When no project argument is given, the script shall apply the same single-project
  resolution rule as `check-specs.sh`.
- The `Makefile` shall provide a `status` target invoking the script.

## Out of Scope

- Cross-project rollups, colors/TUI, watching — a plain printout is the deliverable.
- Any mutation. This is read-only.

## Files/Interfaces Touched

- `scripts/spec-status.sh` (new)
- `Makefile` (add `status` target)

## Implementation Notes

Reuse the parsing idioms from check-specs.sh (frontmatter awk, state list from state.yaml
per memory/decisions.md's dependency-free rule). Folder order in the printout should follow
state.yaml's order, which is lifecycle order.

## Verification

`make status` prints one line per state named in `workflows/state.yaml` (same set, same
order) plus a `total` line equal to the sum of the counts, and exits 0; with a scratch spec
in `waiting_verification/` carrying `verify_attempts: 2`, it appears under "Needs
attention", and with the scratch removed the attention section shows "(none)".

## Verification Failures

Attempt 2 of 2.

- Verification step: "with the scratch removed the attention section shows '(none)'".
  Reason: spec 0006 itself legitimately sits in waiting_verification/ with
  verify_attempts > 0 at verification time, so the attention section is non-empty
  regardless of the scratch — the attempt-1 fix corrected one clause but repeated the
  future-tree-snapshot error in another. All Acceptance Criteria and the other
  Verification clauses (state set/order from state.yaml, sum == total, scratch appears
  while present) PASS. The fix must assert only the scratch's own appearance/disappearance,
  not the absolute content of the attention section.
