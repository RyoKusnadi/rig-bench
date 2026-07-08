---
id: "0029"
title: Regression gate in verification
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

`spec-verify`'s Phase 3 checks a spec's Acceptance Criteria and runs its own Verification
step — and nothing else. An implementation can pass its own check while breaking other
specs' tests or the repo's consistency checks, and verification would still mark it
finished. Meta-Harness's outer loop evaluates every candidate against the full benchmark
rather than only its target capability for exactly this reason: an improvement that
regresses everything around it must count as a failure, not a pass.

## Acceptance Criteria

- When `spec-verify` verifies a spec, it shall — after the spec's own Verification step —
  run the target project's standing gates (for this harness: the Makefile's `check` target
  and the npm test suite; for a nested project: that project's own declared check/test
  commands) and record the result as a labeled `Regression gate` PASS/FAIL line in the
  spec's report and trace.
- If a spec's own Verification step passes but the project gates fail, then `spec-verify`
  shall treat the spec as failing verification, following the same retry contract as a
  failed criterion.
- When verifying multiple specs against the same working tree in one session, `spec-verify`
  shall run the gates once for the session and attribute any gate failure to the spec(s)
  whose touched files plausibly caused it, saying so in each affected report.
- If the target project defines no gates, then `spec-verify` shall note their absence in the
  report and continue without treating it as a failure.

## Out of Scope

- Defining new gates for any project, or requiring projects to have them — this spec runs
  whatever a project already declares; a project with no gates gets a note, not a failure.
- Bisecting which exact change caused a gate failure — attribution across concurrently
  verified specs is a stated judgment call, not an automated mechanism.
- Changing what the spec's own Verification step must contain — the per-spec check and the
  project-wide gate remain distinct layers, and this spec only adds the second.

## Files/Interfaces Touched

- `.claude/skills/spec-verify/SKILL.md` — new step 3c-2 (run project gates); the Phase 3d
  trace format and Phase 4 report format each gain a `Regression gate` line.
- `specs/README.md` — the retry contract names a gate failure as a third failure trigger
  alongside a failed criterion and a failed Verification step.

## Implementation Notes

Design borrowed from Meta-Harness (Lee et al., 2026, arXiv:2605.27276;
`stanford-iris-lab/meta-harness`): its outer loop scores every candidate on the full
benchmark suite, never only the capability the candidate targets, and its frontier only
admits candidates on full-suite results. Translated to a pass/fail harness: the "full
benchmark" is the project's own standing gates, discoverable rather than hardcoded (per
spec 0024, the instruction names discovery paths — Makefile, package manifest, README — not
a fixed command list, so it generalizes to nested projects). Gates run once per session
rather than once per spec because gate runtime is per-tree, not per-spec; the per-spec unit
of record stays intact via attribution in each affected report. This is a prose-only change
(spec 0008's pattern) — the gates themselves already exist; what's new is that verification
must run them and count them.

## Verification

`grep -B2 -A8 "Regression gate" .claude/skills/spec-verify/SKILL.md` shows step 3c-2, the
trace-format line, and the report-format line; `grep -A2 "regression gate" specs/README.md`
shows the retry-contract trigger. `scripts/check-specs.sh template` passes, and the full
gates this spec adds to verification pass on this very branch (`make check` && `npm test`).
