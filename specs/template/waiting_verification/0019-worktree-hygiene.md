---
id: "0019"
title: Worktree hygiene script for concurrent dispatch
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "0019-worktree-hygiene"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/101"
source: ""
---
## Problem

Concurrent dispatch creates one worktree per spec (`../<repo>-wt-<id>`, branch
`spec-<id>-<slug>`) and removes it "once that spec's PR has landed" — by prose
convention only. An interrupted run leaves worktrees and branches behind with nothing
to surface them; they accumulate silently next to the repo.

## Acceptance Criteria

- The script shall list every git worktree whose branch matches `spec-<id>-*` or whose
  path contains `-wt-<id>`, showing the worktree path, branch, spec id, and the spec's
  current lifecycle folder.
- If a listed worktree's spec is not in `in_progress/`, then the script shall flag it
  as stale and print the exact `git worktree remove <path>` command without executing
  it.
- The script shall perform no mutation of any kind — read-only output, suggested
  commands only.
- When `make worktrees` is invoked, it shall run the script for the repo.
- If no dispatch worktrees exist, then the script shall report that and exit 0.

## Out of Scope

- Auto-removal, even with a flag — per the non-negotiables, destructive cleanup stays a
  human-executed command; the script's job ends at printing it.
- Branch deletion suggestions for merged spec branches (`git branch -d` after PR merge
  is routine git hygiene, not dispatch-specific).
- Managing worktrees of nested project repos under `projects/` (their worktrees live
  relative to those repos, out of this script's scope).

## Files/Interfaces Touched

- `scripts/worktree-status.sh` — new read-only script
- `Makefile` — new `worktrees` target
- `tests/worktree-status.test.mjs` — new test file

## Implementation Notes

- Parse `git worktree list --porcelain` (stable, line-oriented: `worktree <path>` /
  `branch refs/heads/<name>` stanzas) with awk — no associative-array bash, per
  `memory/gotchas.md` (2026-07-05).
- Spec id extraction: from branch `spec-XXXX-…` first, path `…-wt-XXXX` as fallback.
  Locate the spec's folder with the same `find specs/*/<state>/ -name "XXXX-*.md"`
  shape the other scripts use; a spec found in no folder reports as `unknown` and is
  flagged stale (its worktree definitely shouldn't exist).
- Security note (per CLAUDE.md non-negotiables): the trust boundary is that this script
  only ever *reads* git state; the failure mode if the staleness logic is wrong is a
  human being shown a wrong suggested command — which they still have to run themselves.
  That's why "never executes" is an acceptance criterion, not a style choice.
- Tests init a scratch repo, create a worktree with a `spec-0001-x` branch, and lay a
  `specs/template/` skeleton with `0001-*.md` in `finished/` — then assert the flag and
  that the worktree still exists after the run (the read-only invariant, asserted as a
  fixture delta per `memory/lessons.md` 2026-07-03).

## Verification

Run `npm test` — `tests/worktree-status.test.mjs` asserts: in the scratch-repo fixture,
output lists the worktree with spec id `0001` and folder `finished`, flags it stale,
prints a `git worktree remove` line, and `git worktree list` still shows the worktree
afterwards; with no dispatch worktrees the script prints the empty-state message and
exits 0. Manually: `make worktrees` runs against the real repo without error.
