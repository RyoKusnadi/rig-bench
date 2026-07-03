---
id: "0008"
title: Thin spec-executor and spec-verifier agent definitions
status: in_progress
depends_on: []
verify_attempts: 0
source: improvement-plan.md#phase-4
---
## Problem

The README promises concurrent worktree-isolated execution, but `.claude/agents/` is empty —
there is nothing to dispatch. Phase 4's design calls for agent definitions that are entry
points into the existing skills, never owners of lifecycle prose.

## Acceptance Criteria

- The `.claude/agents/spec-executor.md` agent shall delegate implementation work to the
  `spec-exec` skill by reference, containing routing/isolation rules only.
- The `.claude/agents/spec-verifier.md` agent shall delegate verification to the
  `spec-verify` skill by reference, containing routing/scope rules only.
- Neither agent file shall restate lifecycle mechanics (state transitions, retry contract,
  failure-section format) — references to `specs/README.md` and the skills only.
- The `spec-executor` agent shall require operating inside a dedicated git worktree and
  refuse (report back, not improvise) if the worktree precondition is not met.
- The `spec-verifier` agent shall be read-and-report within the target project's code, with
  spec-file lifecycle moves as its only writes, consistent with the spec-verify skill.

## Out of Scope

- The dispatch procedure itself (worktree creation, limits, collection) — spec 0009.
- Any third agent (scout/inspector/shipper shapes from the removed passes).

## Files/Interfaces Touched

- `.claude/agents/spec-executor.md` (new)
- `.claude/agents/spec-verifier.md` (new)

## Implementation Notes

Decoupling test from Phase 4: deleting either file must break nothing except the ability to
dispatch it — the skills must remain fully usable directly. Keep each under ~40 lines of
body; length creep here is the kill-criterion signature.

## Verification

Each agent file exists with valid frontmatter (name, description) and references its skill
and `specs/README.md`; `grep -c "waiting_verification\|verify_attempts" .claude/agents/*.md`
returns 0 hits per file body beyond skill/README references (no restated lifecycle
mechanics); `scripts/check-specs.sh template` passes.
