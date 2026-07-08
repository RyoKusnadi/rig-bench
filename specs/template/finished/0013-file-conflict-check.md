---
id: "0013"
title: Automate the file-conflict gate in check-specs.sh
status: finished
depends_on: ["0012"]
verify_attempts: 0
branch: "0013-file-conflict-check"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/94"
history:
  - finished 2026-07-08T12:09:22Z
source: ""
---
## Problem

The file-conflict gate — two specs touching the same file must be chained via
`depends_on` before concurrent execution — is a manual grep documented in
`specs/README.md`. Nothing runs it automatically, so a conflicting batch reaches
`ready/` whenever someone forgets, and the failure surfaces later as a merge conflict
between concurrently-executed PRs.

## Acceptance Criteria

- When two specs in a project's `ready/` or `in_progress/` folders list the same path
  under `## Files/Interfaces Touched` and neither spec is reachable from the other
  through the `depends_on` graph, `check-specs.sh` shall report an ISSUE naming both
  specs and the shared path.
- The check shall extract the path from a bullet line as the backtick-quoted token when
  one exists, otherwise the first whitespace-delimited token, so trailing prose on the
  bullet does not defeat matching.
- When the shared-file pair is connected through `depends_on` in either direction
  (directly or transitively), `check-specs.sh` shall not report it.
- The `specs/README.md` "File-conflict gate" section shall name `check-specs.sh` as the
  automated form of the scan, keeping the manual grep only as background.

## Out of Scope

- Scanning `draft/`, `finished/`, `blocked/`, or `abandoned/` — only states eligible for
  (concurrent) execution can conflict.
- Auto-inserting `depends_on` edges — the check reports; a human or spec-plan decides
  the chain direction.
- Cross-project conflicts (projects are independent repos/lifecycles by design).

## Files/Interfaces Touched

- `scripts/check-specs.sh` — new `[file-conflict]` rule in the existing awk graph pass
- `specs/README.md` — point the "File-conflict gate" section at the automated check
- `tests/spec-scripts.test.mjs` — fixtures for conflict, chained-no-conflict, and
  prose-heavy bullet extraction

## Implementation Notes

- Reachability already has most of its machinery in the existing awk DFS (cycle
  detection) — extend that pass rather than adding a second graph implementation.
  Reachable(a→b) OR reachable(b→a) suppresses the issue; sibling specs sharing a file
  with no path between them is exactly the reported case.
- Path normalization: strip a leading `- `, then prefer the first `` `…` `` span;
  else take the first token. Compare paths as literal strings — no filesystem resolution
  (files may not exist yet for a `ready` spec).
- Bash-3.2/awk-only per `memory/gotchas.md` (2026-07-05); the section-scoped bullet
  scan can reuse the sizing check's awk section-state pattern.
- This batch itself contains intentional overlaps chained via `depends_on`
  (0012→0013→0014→0015→0018 share `scripts/check-specs.sh`) — the implemented check must
  come back clean on the real tree, which doubles as a live test of the suppression rule.

## Verification

Run `npm test` — `tests/spec-scripts.test.mjs` gains cases asserting, against a temp
fixture project: two `ready` specs listing the same backticked path with no `depends_on`
edge make `check-specs.sh` exit 1 with a `[file-conflict]` ISSUE naming both ids; adding
`depends_on` from one to the other makes the same fixture pass. `make check` exits 0 on
the real tree.
