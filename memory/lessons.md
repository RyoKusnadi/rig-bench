# Lessons

What verification failures, blocked specs, and postmortems taught. Entry format and pruning
convention: see `memory/README.md`.

## 2026-07-03 — Retry contract exercised end-to-end for the first time (spec 0001, PR #63–66)

Spec 0001 ran the full lifecycle including a controlled failed verification: attempt 1
failed two criteria, the `## Verification Failures` section was written per the spec-verify
Phase 6a format, spec-exec used that section as the authoritative fix list, and attempt 2
passed and moved the spec to `finished/` with the failure section stripped. Findings: the
contract works as written; `verify_attempts` surviving in the finished spec's frontmatter is
a useful permanent trace that the retry path ran; and the failure-section format was precise
enough to fix from without re-reading the original conversation — which is the property that
matters. This satisfied the "run for real" gate that later concurrent-dispatch work was
explicitly waiting on.

## 2026-07-03 — Verification steps must describe the tree at verification time (spec 0006, PR #74)

Spec 0006's Verification step asserted exact per-state counts ("finished ≥ 5 and zero counts
elsewhere") — a state that can't exist while the spec itself is still sitting in
waiting_verification/. First genuine (non-controlled) verification failure in this repo.
Rule going forward: author Verification steps as invariants that hold at verification time
(structure, sums, fixture-driven behaviors), never as snapshots of expected future tree
state. Spec-plan should check for this when reviewing a draft's Verification section.

## 2026-07-03 — First blocked escalation: fix passes must re-check every clause (spec 0006, PR #77)

Spec 0006 hit MAX_VERIFY_ATTEMPTS and moved to blocked/ — the first spec to exercise the
escalation path. The attempt-1 fix corrected the flagged Verification clause but left the
same error class (asserting absolute tree state) in a neighboring clause, which failed
attempt 2. Two rules: (1) a fix pass reviews the whole section it's editing against the
failure's *class*, not just the quoted clause; (2) fixture-based verification must assert
the fixture's own delta (appears/disappears), never the absolute state around it. The
blocked → un-block → fresh-budget path (specs/README.md) worked as designed.
