---
id: "0016"
title: Extend pre-bash-safety hook to more destructive command classes
status: ready
depends_on: []
verify_attempts: 0
source: ""
---
## Problem

`hooks/pre-bash-safety.mjs` gates four destructive git patterns (force push, hard reset,
force branch delete, unrestricted force clean) but misses other common irreversible
commands: recursive-force `rm`, stash destruction, remote-branch deletion via push, and
working-tree discards via `checkout --`/`restore`. Those slip through with no
confirmation today.

## Acceptance Criteria

- When a Bash command invokes `rm` with recursive and force flags against a path outside
  the temp allowlist (`/tmp/`, `/private/tmp/`, or a path segment ending in
  `node_modules`), the hook shall emit permissionDecision `ask`.
- When a Bash command contains `git stash drop` or `git stash clear`, the hook shall
  emit permissionDecision `ask`.
- When a Bash command contains `git push` with `--delete`, or a refspec whose local side
  is empty (whitespace then `:refname`), the hook shall emit permissionDecision `ask`.
- When a Bash command contains `git checkout` with a `--` pathspec separator, or
  `git restore` without `--staged` as its only restore target, the hook shall emit
  permissionDecision `ask`.
- If the hook input is malformed or a command matches nothing, then the hook shall exit
  0 without output, and the hook shall never emit permissionDecision `deny`.

## Out of Scope

- Shell-semantics parsing (variables, eval, encodings) — this stays a pattern-matching
  honest-mistake catcher, not a security boundary, per the hook's existing header.
- `find -delete`, `truncate`, `dd`, and other rarer destructive tools — extend later if
  they actually bite.
- Any change to hook registration in `.claude/settings.json` (already wired for Bash).

## Files/Interfaces Touched

- `hooks/pre-bash-safety.mjs` — new entries in `DESTRUCTIVE_PATTERNS` (reusing its
  `re` + optional `extra` shape)
- `tests/pre-bash-safety.test.mjs` — positive and negative cases per new pattern

## Implementation Notes

- Security note (per CLAUDE.md non-negotiables): what's trusted is the raw command
  string from the PreToolUse event; the failure mode of a missed pattern is a silent
  destructive run — identical to today's baseline, so additions only tighten. The
  "ask, never deny" contract keeps a false positive's cost at one confirmation click,
  which is why moderately-greedy patterns are acceptable here.
- `rm` pattern: flags may be combined or separate (`-rf`, `-fr`, `-r -f`, `--recursive
  --force`); the `extra` callback checks every non-flag argument against the allowlist —
  one non-allowlisted target is enough to ask.
- Push refspec: deletion is an *empty local side* (`git push origin :feature` or
  `--delete feature`); `main:main` and plain pushes must not match — require whitespace
  immediately before the colon.
- `git restore --staged <file>` only unstages (safe — no ask); `--staged` together with
  `--worktree`, or no `--staged` at all, discards working-tree content (ask).
- Keep the segment-bounded `[^|;&]*` style of the existing regexes so one pipeline
  segment can't contaminate the next.

## Verification

Run `npm test` — `tests/pre-bash-safety.test.mjs` gains cases asserting `ask` for:
`rm -rf src`, `rm -r -f ./build`, `git stash drop`, `git stash clear`,
`git push origin :feature`, `git push origin --delete feature`, `git checkout -- .`,
`git restore .`; and silent exit 0 for: `rm -rf /tmp/scratch`,
`rm -rf node_modules`, `git stash list`, `git push origin main`,
`git push origin main:main`, `git restore --staged file.txt`, `git checkout -b topic`.
