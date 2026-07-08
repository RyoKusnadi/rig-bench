---
id: "0021"
title: Capture raw verification traces for the fix loop
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

The verify→fix retry loop is this harness's own self-improvement loop, but when a spec
fails verification the only feedback `spec-exec` receives is the compressed
`## Verification Failures` summary (plus a distilled `memory/lessons.md` line). The raw
record of the verification run — the actual commands `spec-verify` ran and their full
output — is discarded. Meta-Harness (Lee et al., 2026) shows empirically that an improver
fed raw execution traces fixes far more than one fed only summaries, and that summaries
cannot recover the dropped signal; the fix agent here is in exactly the weaker condition.

## Acceptance Criteria

- When `spec-verify` runs the Verification step for a spec, it shall write the run's raw
  record — the commands executed and their full output, plus per-criterion PASS/FAIL
  evidence — to `specs/<project>/.traces/<id>/attempt-<N>.md`, where `<N>` is that run's
  attempt number.
- When a spec fails verification, `spec-verify` shall commit the attempt trace together
  with the `## Verification Failures` section update.
- When `spec-exec` fixes a spec carrying a `## Verification Failures` section, it shall read
  the latest verification trace (via `scripts/spec-trace.sh <project> <id>`) in addition to
  that section before making changes.
- The `scripts/spec-trace.sh` script shall, given a project, list the specs that have
  traces with their attempt count and latest attempt.
- When given a project and a spec id, `scripts/spec-trace.sh` shall print that spec's latest
  attempt trace, or a named attempt when an attempt number is also given.
- If a requested project, spec id, or attempt has no trace, then `scripts/spec-trace.sh`
  shall exit non-zero with a message naming what was missing.
- When a spec passes verification, `spec-verify` shall remove that spec's `.traces/<id>/`
  directory in the same step that clears the `## Verification Failures` section, so
  `finished/` specs carry no trace directory.

## Out of Scope

- Any change to what counts as a verification PASS/FAIL — this spec only records the run,
  it does not alter the verdict. A trace write that fails is noted and never blocks the
  verdict.
- Capturing traces for the plan phase or for execution runs that were never verified — the
  trace is scoped to verification runs, the point where compressed feedback is handed off.
- Compressing, summarizing, or LLM-rewriting the trace. The whole point is that it is raw;
  the `## Verification Failures` section remains the compressed view.
- A new persistent store or database. Traces are plain markdown under `specs/`, grepped
  directly, matching the file-based memory convention.

## Files/Interfaces Touched

- `scripts/spec-trace.sh` — new dependency-free bash query view over
  `specs/<project>/.traces/`: list, show-latest, show-attempt-N.
- `tests/spec-trace.test.mjs` — new `node --test` suite exercising the script against
  fixture trees.
- `.claude/skills/spec-verify/SKILL.md` — Phase 3d writes the trace; Phase 5 clears it on
  success; Phase 6 commits it with the failure record and points the summary at it.
- `.claude/skills/spec-exec/SKILL.md` — fix path reads the trace alongside the failures
  section.
- Docs & memory (`specs/README.md`, `CLAUDE.md`, `memory/decisions.md`) — retry contract,
  structure table, and the trace-over-summary decision with its Meta-Harness basis.

## Implementation Notes

- Trace layout is `specs/<project>/.traces/<id>/attempt-<N>.md`, four levels under `specs/`
  so it is not caught by the `specs/*/*/*.md` ignore rule and is tracked normally (no
  `git add -f`). `.traces` is not a lifecycle-state folder, so `check-specs.sh` (which scans
  only the state folders from `workflows/state.yaml`) never validates trace files as specs.
- `<N>` is `verify_attempts + 1` — the value the counter will hold if this run fails — used
  whether the run passes or fails, so a first-run pass is `attempt-1`. This keeps trace
  numbering aligned with the `## Verification Failures` "Attempt {n} of {max}" line.
- `spec-trace.sh` mirrors `spec-status.sh`: resolves `REPO_ROOT` from its own location,
  supports the single-project shorthand, and is pure bash + `find` per the dependency-free
  tooling decision in `memory/decisions.md`.
- Traces clear on success for the same reason the `## Verification Failures` section does
  (no stale failure history in a shipped spec; git history is the permanent record) — so the
  Phase 5 removal is `git rm -r` when tracked, `rm -rf` otherwise.
- Trace capture is best-effort: a failure to write the trace is reported but never changes
  the verification verdict (Phase 3d), matching the fail-open posture of the hooks.

## Verification

Run `npm test` — `tests/spec-trace.test.mjs` asserts, against fixture trees: list mode
reports specs with their attempt counts and latest attempt; a project with no traces is a
clean exit-0 no-op; show mode with no attempt prints the latest and with an explicit number
prints that attempt; unknown spec id, missing attempt number, and non-existent project each
exit non-zero with a message naming what was missing. Then run `make check` — `check-specs.sh`
and `check-state-sync.sh` still report no issues (the `.traces/` directory is not a lifecycle
folder and is not validated as specs). Manually confirm `scripts/spec-trace.sh template`
runs and reports no traces on a clean tree.
