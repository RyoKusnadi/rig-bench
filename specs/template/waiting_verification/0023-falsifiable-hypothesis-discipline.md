---
id: "0023"
title: Falsifiable hypothesis and one-mechanism-per-spec discipline in planning
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

`spec-plan`'s existing scope check ("Assess scope first") only catches bundling at the
*deliverable* level — multiple files or components stitched into one spec. It doesn't catch
a single-file spec that bundles two independent, unrelated changes under one Problem
statement ("and also fix X while we're in there"), nor does it require the design to state a
falsifiable claim about what the change is supposed to achieve. Meta-Harness's proposer
instructions require both explicitly: a falsifiable hypothesis per candidate, and "one
mechanism per candidate... if you're tempted to add 'and also...' that's a second candidate."

## Acceptance Criteria

- When `spec-plan` works through Phase 2 (capture intent) with the user, it shall elicit and
  record a falsifiable claim of the form "if this ships, X should happen" for the spec being
  drafted.
- When the honest claim is that the change only adjusts an existing knob (a limit, default,
  or threshold) rather than introducing new behavior, `spec-plan` shall record it as such
  rather than framing it as a new capability.
- When drafting a single-deliverable spec in Phase 3, `spec-plan` shall check the assembled
  Acceptance Criteria against the Phase 2 falsifiable claim and flag any criterion serving an
  unrelated second claim as a candidate for splitting into its own spec.

## Out of Scope

- Any new frontmatter field or template section for the hypothesis — it's folded into the
  existing `Problem` section content, matching how spec-plan already folds "key decisions"
  into `Problem`/`Implementation Notes` without a dedicated section.
- Retroactively rewriting existing specs to add a stated hypothesis — this applies to specs
  drafted going forward.
- A mechanical/automated bundling detector — this is a self-critique step in the skill's
  prose, for the planning agent (and the user reviewing the draft) to apply, not a script.

## Files/Interfaces Touched

- `.claude/skills/spec-plan/SKILL.md` — Phase 2 gains the falsifiable-claim question; Phase 3
  gains the one-mechanism self-check alongside the existing deliverable-count scope check.

## Implementation Notes

- The falsifiable-claim question sits alongside "what does success look like" and "what would
  the docs say if this shipped" in Phase 2 — same moment, same collaborative discussion with
  the user, not a separate gate.
- The one-mechanism check in Phase 3 is explicitly framed as distinct from the existing
  deliverable-count check: a spec can be exactly one file and still fail it if that one file's
  Acceptance Criteria serve two unrelated claims.
- This spec is itself an example of the discipline it describes: its falsifiable claim is
  narrow ("planning surfaces a stated hypothesis and self-checks for bundling") and doesn't
  bundle in, say, a template change or a check-specs.sh update — those would be separate
  specs if pursued.

## Verification

`grep -B2 -A5 "falsifiable claim" .claude/skills/spec-plan/SKILL.md` shows the question in
Phase 2 and the self-check in Phase 3, each naming a concrete example of what triggers a
split ("and also..." / an unrelated second claim). `scripts/check-specs.sh template` passes.
