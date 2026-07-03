---
id: "0009"
title: Concurrent dispatch procedure with worktree isolation and a data-backed limit
status: waiting_verification
depends_on: ["0008"]
verify_attempts: 0
source: improvement-plan.md#phase-4
---
## Problem

Spec 0008 created the agents; nothing describes how they are dispatched. The README's
promised concurrent worktree-isolated execution needs a procedure — in prose and data, per
the Phase 4 constraints, with no orchestration code.

## Acceptance Criteria

- The `spec-exec` skill shall contain a "Concurrent dispatch" section describing: when
  concurrency applies (user asked for multiple specs; no dependency edges between them;
  file-conflict gate re-checked), one worktree per spec, one `spec-executor` dispatch per
  worktree, and result collection.
- The dispatch section shall cap simultaneous executors at `MAX_CONCURRENT_DISPATCH` and
  reference `specs/README.md` as the constant's canonical prose home.
- The dispatch section shall state that serial execution remains the default.
- `workflows/state.yaml` shall carry `dispatch.max_concurrent`, and `specs/README.md` shall
  state `MAX_CONCURRENT_DISPATCH = <n>` in its State Transitions area.
- `scripts/check-state-sync.sh` shall report a mismatch between the two, in the same way it
  does for the retry constant.
- The `spec-verify` skill shall note that dispatched verification goes through the
  `spec-verifier` agent and follows the identical contract.
- No JavaScript or other orchestration code shall be added under `workflows/`.

## Out of Scope

- Automatic dispatch triggering (a hook or watcher that launches executors) — dispatch is
  something the main session does when asked.
- Cross-worktree merge automation — each spec still lands as its own PR.

## Files/Interfaces Touched

- `.claude/skills/spec-exec/SKILL.md`
- `.claude/skills/spec-verify/SKILL.md`
- `workflows/state.yaml`
- `specs/README.md`
- `scripts/check-state-sync.sh`

## Implementation Notes

Worktree naming: `../<repo>-wt-<spec-id>` (outside the main checkout, one per spec), branch
`spec-<id>-<slug>`, removed with `git worktree remove` after the PR lands. The limit check in
check-state-sync.sh mirrors the retry-constant comparison verbatim. Default
`max_concurrent: 3` — small enough that failure triage stays humane, per the plan's warning
about dispatching failures into a void.

## Verification

`make check` exits 0; with a scratch edit setting `max_concurrent: 5` in state.yaml only,
`check-state-sync.sh` reports a dispatch-drift issue and exits 1 (edit reverted);
`grep -c "Concurrent dispatch" .claude/skills/spec-exec/SKILL.md` ≥ 1;
`grep -c "spec-verifier" .claude/skills/spec-verify/SKILL.md` ≥ 1; `ls workflows/` shows
only `state.yaml`.
