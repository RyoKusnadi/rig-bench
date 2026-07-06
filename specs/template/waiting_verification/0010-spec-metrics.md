---
id: "0010"
title: Lifecycle metrics script and make target
status: waiting_verification
depends_on: []
verify_attempts: 0
source: ""
---
## Problem

The lifecycle produces analyzable data (frontmatter `verify_attempts`, `depends_on`,
per-state folders, git history of tracked spec files) but nothing aggregates it —
`make status` shows the present state only. The removed `telemetry/` subsystem is being
re-added as what it should have been: read-only reporting over data that already exists,
no collection layer, no database.

## Acceptance Criteria

- The `scripts/spec-metrics.sh` script shall resolve its target project the same way
  `spec-status.sh` does (explicit argument, else exactly one `specs/<project>/` folder,
  else usage error).
- The script shall print a `verify_attempts` distribution (count of specs per attempts
  value) across all specs on disk for the project.
- The script shall print the count and percentage of finished specs with
  `verify_attempts` greater than 0 (the verification failure rate).
- The script shall print the number of specs with a non-empty `depends_on` and the
  maximum `depends_on` chain depth.
- When a finished spec file is tracked in git, the script shall print a best-effort
  cycle time (first commit to last commit on that file); if a spec file is untracked,
  then the script shall skip it without failing.
- If `workflows/state.yaml` is missing, then the script shall exit 1 with an error,
  consistent with the other lifecycle scripts.
- The script shall write nothing to disk (read-only, like `spec-status.sh`).
- The Makefile shall gain a `metrics` target that runs `scripts/spec-metrics.sh template`,
  mirroring the `status` target's shape.

## Out of Scope

- Attention thresholds and any change to `spec-status.sh` or `state.yaml` (spec 0011).
- Historical/rolling metrics that would require storing snapshots — everything is
  computed on demand from the current tree and git history.
- Cross-project aggregate views; one project per invocation, like the other scripts.

## Files/Interfaces Touched

- `scripts/spec-metrics.sh` (new)
- `Makefile` (`metrics` target, `.PHONY` line)

## Implementation Notes

- Dependency-free bash/awk, line-oriented parsing (memory/decisions.md 2026-07-03) and
  bash-3.2 compatible — no associative arrays, no mapfile (memory/gotchas.md 2026-07-05).
  Reuse `spec-status.sh`'s `frontmatter()`/`fm_field()` awk approach by copying the small
  helpers; do not introduce a shared lib for two scripts.
- Distribution counting without `declare -A`: emit `attempts` values one per line and
  aggregate with `sort | uniq -c`, or a single awk pass.
- Chain depth: iterative — depth(spec) = 1 + max depth of its `depends_on`; cycles are
  already caught by `check-specs.sh`, so cap iterations at the spec count as a guard
  rather than re-implementing cycle detection.
- Cycle time via `git log --follow --format=%ct -- <file>` (oldest vs newest), printed
  in whole days; `git log` on an untracked file yields empty output — treat as skip.
- Output style: aligned `printf` rows with section headings, matching `spec-status.sh`.

## Verification

From the repo root:
1. `scripts/spec-metrics.sh template` exits 0 and prints the three sections
   (attempts distribution, failure rate, dependency stats).
2. Fixture delta: create `specs/tmp-metrics-fixture/{finished,ready}/` with two minimal
   specs, one carrying `verify_attempts: 3`; run `scripts/spec-metrics.sh
   tmp-metrics-fixture`; the distribution output shall contain a row with attempts value
   `3` and count `1`, and the failure-rate line shall report 1 of 1 finished specs
   (100%). Remove the fixture afterwards; assert only the fixture's own delta, never
   the absolute state of real projects (memory/lessons.md 2026-07-03).
3. `make metrics` runs the script against `template` and exits 0.
