---
id: "0027"
title: Axis tag on the outcome ledger and a diversity nudge in planning
status: waiting_verification
depends_on: ["0025"]
verify_attempts: 0
branch: "feat/0021-verification-trace-capture"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/102"
history:
  - ready 2026-07-08T00:00:00Z
  - in_progress 2026-07-08T00:00:00Z
  - waiting_verification 2026-07-08T00:00:00Z
source: ""
axis: "memory-ledger"
---
## Problem

The spec 0025 outcome ledger records *that* a spec finished or was blocked, but not *what
area of the harness it touched*, so there's no way to notice "the last several specs all
changed the same part of the harness" without re-reading each one. Meta-Harness's proposer
instructions track this explicitly via named axes (prompt template, memory content, selection
algorithm, ...) and require diversifying: "if last 3 iterations explored the same axis, pick
different ones." rig-bench has no equivalent signal.

## Acceptance Criteria

- The `spec-template.md` frontmatter shall include an optional `axis` field (default `""`), a
  short freeform label for which part of the harness a spec primarily changes.
- When `spec-plan` drafts a spec that clearly targets one identifiable part of the harness, it
  shall set that spec's `axis` field; it shall leave `axis` as `""` when no single label is a
  natural fit.
- The `scripts/spec-ledger.sh append` command shall accept an optional sixth argument for
  `axis`; when omitted, the recorded `axis` shall be an empty string, and all five-argument
  call sites shall continue to work unchanged.
- When `spec-verify` appends a finished or blocked record to the ledger, it shall include the
  spec's `axis` frontmatter value.
- When `spec-plan` consults the ledger per spec 0025, it shall also check whether the most
  recent 3 `finished` records for the project share the same `axis`, and if so, note this to
  the user before drafting — advisory only, never a block on continuing.

## Out of Scope

- Any hard block on repeating an axis — the note is informational; a genuine multi-spec
  sequence on one axis is a legitimate reason to continue.
- Automated or enum-constrained axis classification — `axis` stays freeform text, matching
  this repo's grep-over-schema convention; consistency is a human/agent judgment call, not a
  validated set.
- Backfilling `axis` onto specs 0001-0026, which predate this field — `check-specs.sh`
  doesn't require it (mirrors how `pr` is exempt for specs predating that field, per
  `spec-template.md`'s existing note).
- A dedicated ledger query subcommand for "recent axes" — `scripts/spec-ledger.sh list
  <project> finished` already returns axis-bearing lines; the last 3 are read directly from
  that output, keeping the script's surface unchanged from spec 0025 beyond the one new
  optional argument.

## Files/Interfaces Touched

- `specs/spec-template.md` — new optional `axis` frontmatter field, with a doc note.
- `scripts/spec-ledger.sh` — `append` accepts an optional 6th `axis` argument.
- `tests/spec-ledger.test.mjs` — new test covering the axis argument; existing 5-argument
  tests continue to pass unchanged (backward compatibility).
- `.claude/skills/spec-verify/SKILL.md` — both ledger-append call sites (finished, blocked)
  pass `axis`.
- `.claude/skills/spec-plan/SKILL.md` — sets `axis` when drafting, and checks the last 3
  `finished` records for a repeated axis during the existing ledger-consultation step.

## Implementation Notes

- `axis` is deliberately optional and freeform rather than a new required, validated field —
  adding a required field would touch `check-specs.sh` and force retrofitting every existing
  spec; freeform + optional keeps this a strict extension, and `scripts/spec-ledger.sh`'s
  backward-compatible 5-or-6-argument `append` mirrors that at the script level.
- This spec's own `axis` is set to `memory-ledger`, continuing the same axis as spec 0025 —
  a deliberate, acknowledged case of the very pattern this spec asks `spec-plan` to flag going
  forward, since 0027 extends 0025's mechanism directly rather than starting a new one.
- `depends_on: ["0025"]` because this spec adds an argument to a script and a field
  referenced in prose that spec 0025 introduces; `spec-exec`'s branch-base rule (per
  `specs/README.md`'s file-conflict `Rule`) applies if 0025 isn't merged first.

## Verification

Run `npm test` — `tests/spec-ledger.test.mjs`'s existing cases still pass unchanged (proving
backward compatibility), plus the new axis-argument case confirms `axis` round-trips through
`append`. `grep -A5 "axis" specs/spec-template.md` shows the new field and its doc note.
`grep -B2 -A4 "same .axis." .claude/skills/spec-plan/SKILL.md` shows the diversity-nudge
instruction. `scripts/check-specs.sh template` passes.
