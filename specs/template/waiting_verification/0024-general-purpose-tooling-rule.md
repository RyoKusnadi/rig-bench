---
id: "0024"
title: "Non-negotiable: shared tooling stays general-purpose"
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "feat/0021-verification-trace-capture"
pr: ""
history:
  - ready 2026-07-08T00:00:00Z
  - in_progress 2026-07-08T00:00:00Z
  - waiting_verification 2026-07-08T00:00:00Z
source: ""
---
## Problem

`CLAUDE.md`'s Non-negotiables list hard constraints every spec must respect (destructive git
ops, secrets handling, branch discipline), and `spec-plan` already checks every spec against
that list regardless of size. But nothing in that list guards against a future edit to shared
tooling (`.claude/skills/`, `hooks/`, `scripts/`) quietly special-casing one spec's needs —
e.g. a hook that checks "if spec id is 0021, skip this validation." Both Meta-Harness
SKILL.md files carry an explicit anti-overfitting rule against exactly this pattern (banning
task/dataset-specific hardcoding in general-purpose scaffold code), with a reusable test:
would this help with something nobody has written yet?

## Acceptance Criteria

- `CLAUDE.md`'s Non-negotiables section shall include a rule that changes to shared tooling
  (`.claude/skills/`, `hooks/`, `scripts/`) must not special-case a specific spec id, project
  name, or one-off scenario.
- The rule shall state the applicability test: would this rule or code path help with a spec
  nobody has written yet?
- The rule shall clarify that citing a spec for provenance (e.g. "see spec 0021") is
  distinct from and permitted alongside this rule, since `spec-plan`'s existing Non-negotiables
  check already applies to every spec automatically — no separate skill edit is needed to
  wire this one in.

## Out of Scope

- A lint or script that mechanically detects spec-id conditionals in shared tooling — left as
  a judgment call during `spec-plan`'s existing Non-negotiables check and during review, same
  as the other three Non-negotiables.
- Rewriting any existing shared-tooling file to remove hardcoding — no such case is known to
  exist today; this spec is preventive.

## Files/Interfaces Touched

- `CLAUDE.md` — Non-negotiables section gains one new bullet.

## Implementation Notes

- Because `spec-plan`'s Phase 2 already says "Check every spec, regardless of size, against
  `CLAUDE.md`'s 'Non-negotiables' section," adding the rule there is sufficient — it takes
  effect for every future spec without a second edit to `spec-plan/SKILL.md` itself. This is
  the mechanism `CLAUDE.md` describes for the whole section: "keep it updated here rather than
  duplicating it into the skill."
- Explicitly scoped to *shared* tooling — the spec files under `specs/<project>/` themselves
  are expected to be specific to one deliverable; this rule would be nonsensical applied to
  them.

## Verification

`grep -A6 "Shared tooling stays general-purpose" CLAUDE.md` shows the new bullet with its
applicability test and the provenance-citation carve-out. `scripts/check-specs.sh template`
passes.
