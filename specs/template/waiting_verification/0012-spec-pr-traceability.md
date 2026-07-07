---
id: "0012"
title: Add spec-to-PR traceability via branch/pr frontmatter fields
status: waiting_verification
depends_on: []
verify_attempts: 0
source: ""
---
## Problem

A finished spec has no machine-checkable link to the PR that implemented it. The branch
name convention (`0001-slug`) makes the mapping guessable by a human, but nothing records
the PR itself, and no check can confirm a `finished/` spec's implementation actually landed.

## Acceptance Criteria

- The spec template shall define optional `branch` and `pr` frontmatter fields, each
  defaulting to `""`.
- When spec-exec opens a spec's draft PR, the spec-exec skill shall direct recording the
  feature-branch name and PR URL in the spec's `branch` and `pr` frontmatter fields.
- When spec-verify moves a spec with a non-empty `pr` field to `finished/`, the spec-verify
  skill shall direct confirming the PR's state via `gh pr view` and including it in the
  report, treating an unavailable or unauthenticated `gh` as advisory (report, never block).
- If a spec in `finished/` has a `pr` field whose value is empty, then `check-specs.sh`
  shall report an ISSUE.
- The `check-specs.sh` `pr`-field check shall skip specs whose frontmatter has no `pr` key
  at all (specs predating this field are grandfathered).

## Out of Scope

- Automatically merging PRs or gating `finished/` on merge state — merging is a human
  action per the spec-exec Gotchas, and CI has no authenticated `gh`.
- Backfilling `branch`/`pr` into the nine already-finished specs.
- Any change to branch naming (already conventioned in `specs/README.md`).

## Files/Interfaces Touched

- `specs/spec-template.md` — add `branch: ""` and `pr: ""` to the frontmatter block
- `.claude/skills/spec-exec/SKILL.md` — Phase 5 step 2: record branch/pr when the PR opens
- `.claude/skills/spec-verify/SKILL.md` — Phase 5: advisory `gh pr view` confirmation
- `scripts/check-specs.sh` — new ISSUE `[empty-pr]` rule for finished specs
- `tests/spec-scripts.test.mjs` — fixture coverage for the new rule

## Implementation Notes

- Frontmatter extraction reuses the existing `fm_field` awk helper — it already returns
  empty for a missing key; distinguishing "key absent" from "key empty" needs a direct
  `grep -c '^pr:'` (or awk equivalent) on the frontmatter block, since `fm_field` can't.
- Stay bash-3.2/awk-only per `memory/gotchas.md` (2026-07-05) and the dependency-free
  decision in `memory/decisions.md`.
- The `gh pr view` step in spec-verify is prose guidance for the agent running the skill,
  not script code — no `gh` dependency enters `scripts/`. Failure of `gh` for any reason
  (missing binary, no auth, fork remotes) downgrades to a reported caveat, never a FAIL.
- Spec files are gitignored — fixture and real spec edits in tests must account for
  `git add -f` semantics (`memory/gotchas.md` 2026-07-03), though the check itself reads
  the tree, not git.

## Verification

Run `npm test` — `tests/spec-scripts.test.mjs` gains cases asserting, against a temp
fixture project: a spec in `finished/` with `pr: ""` makes `check-specs.sh` exit 1 and
print an `[empty-pr]` ISSUE; the same spec with the `pr` key removed passes; the same spec
with `pr: "https://github.com/x/y/pull/1"` passes. `make check` still exits 0 on the real
tree (all existing finished specs lack the key and are skipped).
