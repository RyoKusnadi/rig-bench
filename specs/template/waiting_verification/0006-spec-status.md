---
id: "0006"
title: make status — per-state spec counts and attention items
status: waiting_verification
depends_on: []
verify_attempts: 1
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

`make status` on the current tree prints all seven states with finished ≥ 5 and zero
counts elsewhere, and an empty attention section; with a scratch spec in
`waiting_verification/` carrying `verify_attempts: 1`, it appears under attention (scratch
removed afterwards).

## Verification Failures

Attempt 1 of 2.

- Verification step: `make status` on the current tree, expected "all seven states with
  finished ≥ 5 and zero counts elsewhere, and an empty attention section".
  Reason: the tree at verification time necessarily has this spec (and its batch peers) in
  waiting_verification/, so "zero counts elsewhere" cannot hold — the step was authored
  against a post-verification tree state. All Acceptance Criteria pass; the failure is in
  the spec's own Verification wording, which needs correcting to describe checks that can
  hold at verification time (state names from state.yaml present, counts sum to total,
  attention behavior via scratch fixture).
