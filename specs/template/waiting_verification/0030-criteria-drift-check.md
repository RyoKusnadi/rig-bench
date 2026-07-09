---
id: "0030"
title: "Criteria drift check: the test must not change while being taken"
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "feat/0021-verification-trace-capture"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/102"
history:
  - ready 2026-07-08T00:00:00Z
  - in_progress 2026-07-08T00:00:00Z
  - waiting_verification 2026-07-08T00:00:00Z
source: ""
axis: "verification-loop"
---
## Problem

A spec's Acceptance Criteria and Verification sections are what the implementation gets
graded against, and nothing detects them being edited after work starts — an implementation
can weaken its own test and then "pass" it. Meta-Harness guards its evaluation with a
held-out test set that is never exposed to the optimizing process; the analog for a
pass/fail harness is that the graded sections must not be silently editable by the party
being graded. Falsifiable claim: if this ships, a spec whose graded sections changed between
the base ref and the working tree while in `in_progress/` or `waiting_verification/` gets
flagged at `make check` time.

## Acceptance Criteria

- When `check-specs.sh` examines a spec in `in_progress/` or `waiting_verification/` whose
  id also exists at the base ref, it shall compare the spec's Acceptance Criteria and
  Verification sections against that base version — locating the base file by id rather
  than path, so lifecycle folder moves alone never register as a change.
- If the graded sections differ from the base version, then `check-specs.sh` shall emit a
  `WARN [criteria-drift]` naming the file and base path, and shall not fail the run — a
  criteria change can be a legitimate, human-approved scope decision; the requirement is
  visibility, not prohibition.
- If the base ref is unresolvable, or the spec's id does not exist at the base ref, then
  the check shall skip silently, reusing the same `TRANSITION_BASE_REF` override and
  fail-open posture as the transition check (spec 0014).

## Out of Scope

- Blocking or reverting criteria edits — WARN severity is deliberate; distinguishing a
  legitimate scope change from self-serving weakening requires human judgment the checker
  doesn't have.
- Watching the Problem, Out of Scope, or Implementation Notes sections — those may
  legitimately evolve during implementation; only the two graded sections are the test.
- Detecting drift on `finished/` specs — post-merge, the base ref contains the finished
  file itself and the comparison is meaningless; the window that matters is while work is
  open.

## Files/Interfaces Touched

- `scripts/check-specs.sh` — new criteria-drift block between the transition-enforcement
  and PR-traceability checks, sharing `TRANSITION_BASE_REF`.
- `tests/spec-scripts.test.mjs` — three scratch-repo cases: drift warns without failing, a
  pure lifecycle move does not warn, an id absent at base is skipped.

## Implementation Notes

Design borrowed from Meta-Harness (Lee et al., 2026, arXiv:2605.27276): its outer loop
holds out a test set "never exposed during evolution" so the optimizing process cannot fit
the evaluation; translated here as the graded sections being change-detected rather than
access-restricted, since a file-based harness can't hide the file from its implementer —
visibility of edits is the enforceable equivalent. Mechanism prototyped in `/tmp` per spec
0022 before implementation (id-based base lookup across a `git mv`, section extraction via
awk, frontmatter-only change as negative control). Bash-3.2-safe: no associative arrays
(per the 2026-07-05 gotcha), plain `git ls-tree` + `grep` per spec. The check found by id
(`grep "/${id}-[^/]*\.md$"`) tolerates the file being renamed with a different slug, not
just moved between folders.

## Verification

Run `npm test` — the three spec-0030 cases in `tests/spec-scripts.test.mjs` assert: editing
a graded section after a move emits `WARN [criteria-drift]` with exit 0; a lifecycle move
alone emits no drift warning; a spec id absent at the base ref is skipped. Then run
`make check` on this branch — exits clean, demonstrating the skip path on specs 0021-0030
(absent at origin/main) against the real tree.
