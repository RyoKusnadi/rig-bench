---
id: "0001"
title: Enforce sync between state.yaml, README state table, and check-specs.sh
status: waiting_verification
depends_on: []
verify_attempts: 0
source: improvement-plan.md#phase-2
---
## Problem

The spec-lifecycle state set lives in three hand-maintained places — `workflows/state.yaml`,
the State Transitions table in `specs/README.md`, and the `VALID_STATES` array in
`scripts/check-specs.sh` — and nothing enforces they agree. `specs/README.md` documents this
as a known gap; this spec closes it.

## Acceptance Criteria

- The `scripts/check-state-sync.sh` script shall parse state names and
  `retry.max_verify_attempts` from `workflows/state.yaml` using only bash/awk/grep/sed (no
  new dependencies).
- When run, `check-state-sync.sh` shall report any state present in `workflows/state.yaml`
  but missing from the `specs/README.md` State Transitions table, and vice versa.
- When run, `check-state-sync.sh` shall report a mismatch between
  `retry.max_verify_attempts` in `workflows/state.yaml` and the `MAX_VERIFY_ATTEMPTS = N`
  value stated in `specs/README.md`.
- If any mismatch is found, then `check-state-sync.sh` shall exit 1; otherwise it shall
  exit 0.
- `scripts/check-specs.sh` shall derive its valid-state list from `workflows/state.yaml`
  instead of a hand-maintained array.
- If `workflows/state.yaml` is missing or yields no states, then each script shall exit 1
  with an error naming the file.
- The `Makefile` shall provide a `check` target that runs both scripts.

## Out of Scope

- Generating the README table from the YAML (or vice versa) — this spec only detects drift,
  it doesn't make one file render the other.
- CI wiring. Exit codes are CI-ready, but adding a workflow file is a separate decision.
- Validating the `entered_by` / `valid_next` columns — state *names* and the retry constant
  are the drift-prone parts; deep structural comparison is not worth the parser complexity
  in bash.

## Files/Interfaces Touched

- `scripts/check-state-sync.sh` (new)
- `scripts/check-specs.sh` (derive valid states from state.yaml)
- `Makefile` (add `check` target)
- `specs/README.md` (update the "Known gap" paragraph to reflect enforcement)

## Implementation Notes

`state.yaml`'s structure is simple enough for line-oriented parsing: states are
`  - name: <word>` lines under `states:`, and the constant is the
`  max_verify_attempts: <n>` line. The README table rows all match `^\| \`<state>\` \|`.
Set comparison via sorted lists + `comm` or a bash loop — either is fine. Keep both scripts
dependency-free (that was the stated reason the third copy existed at all; removing the
copy must not reintroduce a YAML-parser dependency).

## Verification

`make check` exits 0 on the current tree. Then, with a scratch edit adding a fake state
`- name: bogus` to `workflows/state.yaml`, `scripts/check-state-sync.sh` reports the
missing README row and exits 1 (edit reverted afterwards). `scripts/check-specs.sh template`
still passes and no longer contains a literal hand-maintained `VALID_STATES=(...)` array.
