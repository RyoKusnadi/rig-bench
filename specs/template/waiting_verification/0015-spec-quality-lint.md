---
id: "0015"
title: Lint spec quality in check-specs.sh
status: waiting_verification
depends_on: ["0014"]
verify_attempts: 0
source: ""
---
## Problem

Three spec-quality invariants exist only as prose: clarification markers may not leave
`draft/`, a generated failures section implies `verify_attempts > 0`, and every spec
carries the template's required sections. None is checked, so violations surface only
when a human happens to read the file.

## Acceptance Criteria

- If a spec outside `draft/` contains the clarification marker — the bracketed
  `NEEDS CLARIFICATION` tag immediately followed by a colon — then `check-specs.sh`
  shall report an ISSUE.
- If a spec whose `verify_attempts` is `0` or missing contains a `Verification Failures`
  second-level heading at the start of a line, then `check-specs.sh` shall report an
  ISSUE.
- If a spec is missing any required second-level section heading, then `check-specs.sh`
  shall report an ISSUE naming the missing section.
- The required-section list shall be derived from `specs/spec-template.md`'s own `##`
  headings at run time, not hardcoded in the script.

## Out of Scope

- Judging section *content* (empty-but-present sections, EARS grammar conformance —
  sentence-shape linting is not reliably grep-able and stays a spec-plan/review concern).
- Scanning `specs/spec-template.md` itself or `specs/README.md` (both sit outside the
  per-state folders the checker walks, and both legitimately mention the marker).
- The inverse failures-section check (attempts > 0 but section absent) — spec-verify
  legitimately strips the section on a pass while attempts stay recorded.

## Files/Interfaces Touched

- `scripts/check-specs.sh` — three new rules: `[stray-clarification]`,
  `[stale-failures-section]`, `[missing-section]`
- `specs/spec-template.md` — consumed read-only as the section-list source
- `tests/spec-scripts.test.mjs` — fixtures for all three rules

## Implementation Notes

- Marker match is the colon form only (bracket, marker name, colon): specs may legitimately
  *mention* the marker name in prose (this spec does), and the colon is what the
  README's marker convention actually prescribes for a live, unresolved question.
- Failures-section match anchors to line start (`^## Verification Failures`) so inline
  backticked mentions in prose don't false-positive.
- Section derivation: awk collects `^## ` headings from `specs/spec-template.md` — same
  no-third-copy reasoning as deriving valid states from `state.yaml` (spec 0001). If the
  template file is missing, error out loudly like the existing `STATE_YAML` guard does.
- Existing specs across all folders must pass unmodified; if any pre-0015 spec turns out
  to violate a rule, fix that spec in the same PR rather than weakening the rule.
- Bash-3.2/awk-only per `memory/gotchas.md` (2026-07-05).

## Verification

Run `npm test` — new cases assert, against a temp fixture project: a `ready/` spec
containing a colon-form clarification marker fails with `[stray-clarification]` while
the identical spec placed in `draft/` passes; a spec with `verify_attempts: 0` plus a
line-start failures heading fails with `[stale-failures-section]`; a spec missing its
`Out of Scope` heading fails with `[missing-section]` naming it. `make check` exits 0
on the real tree.
