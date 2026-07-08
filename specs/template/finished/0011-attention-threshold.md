---
id: "0011"
title: Metrics-driven attention threshold in spec-status
status: finished
depends_on: []
verify_attempts: 0
history:
  - finished 2026-07-08T12:09:22Z
source: ""
---
## Problem

`make status`'s "Needs attention" section only reacts to individual specs (failed
attempts in waiting_verification, blocked). A creeping aggregate signal — a rising share
of specs failing verification at least once — stays invisible until someone computes it
by hand. This spec adds one advisory, threshold-driven attention line, with the threshold
as data.

## Acceptance Criteria

- The `workflows/state.yaml` file shall carry an `attention.verify_failure_rate_threshold_pct`
  key holding an integer percentage.
- When the percentage of finished specs with `verify_attempts` greater than 0 exceeds
  the threshold, `spec-status.sh` shall print an attention line naming the computed
  rate, the threshold value, and the `state.yaml` key it came from.
- If `finished/` contains no specs, then `spec-status.sh` shall skip the rate check.
- If the threshold key is absent from `state.yaml`, then `spec-status.sh` shall skip
  the rate check without failing (advisory feature, fail-open).
- The script shall continue to emit the existing per-state counts and per-spec attention
  items unchanged.

## Out of Scope

- The metrics script itself (spec 0010) — this spec reads only `verify_attempts` from
  `finished/` frontmatter, independently of 0010's code.
- A prose copy of the threshold in `specs/README.md` and any `check-state-sync.sh`
  change — see Implementation Notes.
- Blocking behavior: the line is advisory; `spec-status.sh` stays read-only and exits 0.

## Files/Interfaces Touched

- `scripts/spec-status.sh`
- `workflows/state.yaml`

## Implementation Notes

- **Why no sync enforcement for this constant:** MAX_VERIFY_ATTEMPTS and
  MAX_CONCURRENT_DISPATCH are sync-enforced because they exist in two places (README
  prose + YAML). This threshold has no prose consumer — its single home is `state.yaml`,
  read at runtime, so there is nothing to drift and nothing to sync. Deliberately
  smaller; if a prose copy ever appears, extend `check-state-sync.sh` then.
- Parse with the existing line-oriented awk style
  (`awk '/^[[:space:]]*verify_failure_rate_threshold_pct:/ { print $NF; exit }'`) —
  dependency-free bash, bash-3.2 compatible (memory/decisions.md, memory/gotchas.md).
- Integer math only: `rate_pct = attempted * 100 / finished_total` in awk; strictly
  greater-than comparison against the threshold.
- Suggested initial value: `50` — the live tree today is 1 of 9 (11%), so the line stays
  quiet until something is genuinely wrong.
- Add the check inside the existing "Needs attention" block so `(none)` logic keeps
  working (increment `ATTENTION` when the line prints).

## Verification

From the repo root:
1. `scripts/spec-status.sh template` exits 0 and its per-state counts section is
   byte-identical to before the change except for any new attention line.
2. Fixture delta: create `specs/tmp-threshold-fixture/finished/` with two minimal specs,
   both carrying `verify_attempts: 1` (100% > 50); run `scripts/spec-status.sh
   tmp-threshold-fixture`; the threshold attention line shall appear. Change both to
   `verify_attempts: 0` and the line shall disappear. Remove the fixture afterwards;
   assert only the fixture's own delta (memory/lessons.md 2026-07-03).
3. `make check` passes (state-sync untouched by design).
