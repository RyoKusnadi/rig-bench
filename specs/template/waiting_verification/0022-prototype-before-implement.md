---
id: "0022"
title: Mandatory prototype step before implementing a new mechanism
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

`spec-exec`'s implementation step goes straight from reading a spec to writing the final
files, with no required step to test a new mechanism in isolation first. Meta-Harness's
proposer instructions (both its text-classification and terminal-bench-2 SKILL.md files)
make prototyping mandatory before implementing, because unprototyped candidates that
introduce a genuinely new mechanism disproportionately turn out to have bugs or produce no
effect. rig-bench's implementation step has no equivalent discipline today.

## Acceptance Criteria

- When `spec-exec` implements a spec whose Acceptance Criteria or Implementation Notes
  describe a mechanism not already present elsewhere in the repo (a new algorithm, file
  format, or control-flow shape), it shall first write and run a throwaway script under
  `/tmp/` exercising that mechanism against a small number of concrete inputs, before
  editing the real files.
- When the spec only wires together, extends, or configures an existing pattern already
  used elsewhere in the repo, `spec-exec` shall skip the prototype step.
- After confirming the prototype behaves as the spec describes, `spec-exec` shall delete the
  throwaway script before or as part of the real implementation — it shall never be
  committed.

## Out of Scope

- Any tooling to enforce this automatically (a pre-commit check for leftover `/tmp/` scripts,
  etc.) — this is a documented step in the skill's prose, following this repo's existing
  "procedure in prose, no orchestration code" pattern (spec 0008), not a new script.
- Changing what a spec must contain (no new template section) — the judgment of "does this
  introduce a new mechanism" is made from the existing Acceptance Criteria / Implementation
  Notes content.

## Files/Interfaces Touched

- `.claude/skills/spec-exec/SKILL.md` — Phase 5, step 2 ("Implement") gains the
  prototype-first instruction.

## Implementation Notes

- Placed inside the existing "Implement" step rather than as a new numbered step, since it's
  a precondition on that step rather than a separate phase — it always resolves to either "do
  nothing extra" (wiring-only spec) or "prototype, then implement" (new-mechanism spec).
- The line between "new mechanism" and "wiring an existing pattern" is a judgment call left
  to the implementer, mirroring how Meta-Harness's own instructions rely on the agent's
  judgment rather than a mechanical rule (e.g. "is the logic in `predict()` identical to the
  base except for constants?"). Spec 0021 (verification-trace capture) is a worked example
  either way it's read: its trace-writing logic was new enough to be worth a `/tmp` check
  against a couple of sample verification runs before it was wired into the skill's prose.

## Verification

`grep -A3 "Prototype first" .claude/skills/spec-exec/SKILL.md` shows the instruction inside
Phase 5's Implement step, naming both the trigger condition (new mechanism vs. wiring) and
the required cleanup (delete the throwaway script). `scripts/check-specs.sh template` passes.
