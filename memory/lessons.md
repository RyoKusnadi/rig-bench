# Lessons

What verification failures, blocked specs, and postmortems taught. Entry format and pruning
convention: see `memory/README.md`.

## 2026-07-03 — Retry contract exercised end-to-end for the first time (spec 0001)

Spec 0001 ran the full lifecycle including a controlled failed verification: attempt 1
failed two criteria, the `## Verification Failures` section was written per the spec-verify
Phase 6a format, spec-exec used that section as the authoritative fix list, and attempt 2
passed and moved the spec to `finished/` with the failure section stripped. Findings: the
contract works as written; `verify_attempts` surviving in the finished spec's frontmatter is
a useful permanent trace that the retry path ran; and the failure-section format was precise
enough to fix from without re-reading the original conversation — which is the property that
matters. This satisfied the "run for real" gate that later concurrent-dispatch work was
explicitly waiting on.

## 2026-07-03 — Verification steps must describe the tree at verification time (spec 0006)

Spec 0006's Verification step asserted exact per-state counts ("finished ≥ 5 and zero counts
elsewhere") — a state that can't exist while the spec itself is still sitting in
waiting_verification/. First genuine (non-controlled) verification failure in this repo.
Rule going forward: author Verification steps as invariants that hold at verification time
(structure, sums, fixture-driven behaviors), never as snapshots of expected future tree
state. Spec-plan should check for this when reviewing a draft's Verification section.

## 2026-07-03 — First blocked escalation: fix passes must re-check every clause (spec 0006)

Spec 0006 hit MAX_VERIFY_ATTEMPTS and moved to blocked/ — the first spec to exercise the
escalation path. The attempt-1 fix corrected the flagged Verification clause but left the
same error class (asserting absolute tree state) in a neighboring clause, which failed
attempt 2. Two rules: (1) a fix pass reviews the whole section it's editing against the
failure's *class*, not just the quoted clause; (2) fixture-based verification must assert
the fixture's own delta (appears/disappears), never the absolute state around it. The
blocked → un-block → fresh-budget path (specs/README.md) worked as designed.

## 2026-07-06 — First real concurrent dispatch run (specs 0010+0011)

Two independent specs were dispatched concurrently for the first time, per spec-exec's
Phase 4b: dispatcher-created worktrees off main, one spec-executor agent each, results
collected as they arrived, lifecycle moves kept in the dispatcher's checkout. Findings:

1. **The procedure held and the kill criterion did not fire** — the agent definitions
   stayed thin (no lifecycle prose accumulated); all lifecycle mechanics stayed in the
   skill + dispatcher.
2. **Spec files don't travel into worktrees** — they're working-set files, so a worktree
   based on main may not contain the spec being implemented. The working pattern: the
   dispatcher embeds the spec's full content in the dispatch prompt and explicitly forbids
   the executor from touching `specs/` (fixtures under `specs/tmp-*` excepted). Codify
   this in any future dispatch: content-in-prompt, lifecycle-with-dispatcher.
3. **Centralized moves kept the invariant clean** — running `check-specs.sh` after every
   ready → in_progress → waiting_verification move caught nothing, but only because the
   status-field sed happened in the same step as each `git mv`; do them together, never
   as separate passes.
4. Both executors ran verification under `/bin/bash` 3.2 explicitly — the 2026-07-05
   gotcha entry did its job at design time (both specs carried the constraint in their
   Implementation Notes).
