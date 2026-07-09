---
id: "0014"
title: Enforce state transitions against state.yaml valid_next
status: waiting_verification
depends_on: ["0013"]
verify_attempts: 0
branch: "0014-transition-enforcement"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/95"
source: ""
---
## Problem

`workflows/state.yaml` carries a `valid_next` list per state, but nothing consumes it.
The only enforced invariant is status-matches-folder, so an illegal jump — a spec moved
straight from `ready/` to `finished/` with its status edited to match — passes every
existing check.

## Acceptance Criteria

- When a spec file's lifecycle folder differs between a base git ref and the current
  tree, `check-specs.sh` shall validate the old-folder to new-folder transition against
  `valid_next` in `workflows/state.yaml` and report an ISSUE for an illegal transition.
- The base ref shall default to `origin/main` when it resolves, and shall be overridable
  via a `TRANSITION_BASE_REF` environment variable.
- If no base ref can be resolved, then `check-specs.sh` shall skip the transition check
  silently rather than fail (fail-open, matching the hooks' trade-off).
- The check shall detect moves via git rename detection so a `git mv` between lifecycle
  folders is seen as one transition, not an unrelated delete plus add.
- The `specs/README.md` "State Transitions" section shall note that `valid_next` is now
  enforced by `check-specs.sh`, not just documented.

## Out of Scope

- Blocking the move at mv time — `git mv` runs through Bash, outside the Edit/Write hook;
  this check catches the illegal transition at `make check` / CI / post-edit time.
- Validating *who* performed a transition (`entered_by` stays documentation).
- Multi-hop history validation — only the single base-vs-current delta is checked.

## Files/Interfaces Touched

- `scripts/check-specs.sh` — new `[illegal-transition]` rule
- `workflows/state.yaml` — consumed read-only (no schema change)
- `specs/README.md` — enforcement note in "State Transitions"
- `tests/spec-scripts.test.mjs` — temp-git-repo fixtures for legal/illegal moves

## Implementation Notes

- Diff shape: `git diff --name-status -M --diff-filter=R "$BASE" -- "specs/$PROJECT/"`
  against the working tree; parse `R<score> old new` lines, take path segment 3 (state
  folder) from each side, look up `valid_next` for the old state with the same
  line-oriented awk used for the existing state-list parse. A transition into the same
  folder (pure rename within a state) is not a transition.
- **Legality is path reachability through `valid_next`, not direct membership**
  (decided during implementation): one PR legitimately collapses multi-hop moves —
  this repo's own flow lands `ready -> in_progress -> waiting_verification` in a single
  branch, which a base-vs-tree diff sees as the endpoint pair
  `ready -> waiting_verification`. Direct-membership checking would fail every normal
  implementation PR. Illegal therefore means "no path exists" — which still catches
  the real violations: any move out of a terminal state (`finished`, `abandoned`) and
  any move back into `draft`.
- Base resolution: `git rev-parse --verify --quiet "${TRANSITION_BASE_REF:-origin/main}"`;
  empty result → skip. In CI (`checks.yml`) `origin/main` exists on PR checkouts; ensure
  the workflow's fetch depth actually includes it, or fetch it explicitly in the workflow.
- Spec files are gitignored and committed with `-f` (`memory/gotchas.md` 2026-07-03), so
  tracked specs diff normally; an untracked new spec has no old state and is correctly
  invisible to `--diff-filter=R`.
- Tests build a scratch git repo (the suite already spawns bash scripts; add a helper
  that inits a repo, commits a spec under `ready/`, sets `TRANSITION_BASE_REF` to that
  commit, then `git mv`s the file) — bash-3.2/awk-only in the script itself.

## Verification

Run `npm test` — new cases assert, in a scratch git repo with `TRANSITION_BASE_REF`
pinned to the base commit: `ready/ → finished/` makes `check-specs.sh` exit 1 with an
`[illegal-transition]` ISSUE naming both states; `ready/ → in_progress/` passes; running
with `TRANSITION_BASE_REF` pointing at a nonexistent ref passes (skip path). `make check`
exits 0 on the real tree.
