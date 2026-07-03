---
id: "0004"
title: Pre-bash safety hook enforcing the destructive-git non-negotiable
status: finished
depends_on: []
verify_attempts: 0
source: REMOVED.md#hooks-lib-and-scripts-third-pass
---
## Problem

CLAUDE.md's first non-negotiable bans destructive git operations without explicit
confirmation, but it is prose with zero enforcement — nothing intervenes if an agent runs
`git push --force` anyway. This re-introduces exactly one of the removed hooks, scoped to
that single rule.

## Acceptance Criteria

- When a Bash tool call's command matches a destructive git pattern (`git push` with a
  force flag, `git reset --hard`, `git branch` with a force-delete flag, `git clean` with
  force+directories and no `X` restriction), the hook shall emit a PreToolUse `ask`
  decision so the operation requires explicit confirmation.
- When a command matches no destructive pattern, the hook shall exit 0 with no decision
  output, leaving normal permission flow untouched.
- If the hook receives unparsable or unexpected input, then it shall fail open (exit 0)
  and note the parse failure on stderr, rather than blocking all Bash usage.
- The hook shall use only Node.js built-ins (no npm dependencies).
- The hook shall be registered for PreToolUse/Bash in `.claude/settings.json`.
- The hook's pattern matching shall be covered by `node --test` tests runnable via
  `npm test`.

## Out of Scope

- Non-git destructive commands (`rm -rf`, disk operations) — the non-negotiable this
  enforces is specifically about git; widening the net is a separate decision.
- Hard-blocking (`deny`). The rule says "without explicit confirmation", so `ask` is the
  faithful enforcement — a human can still approve a legitimate force-push.
- Re-adding the other removed hooks (auto-run-tests, gatekeeper, webfetch security).

## Files/Interfaces Touched

- `hooks/pre-bash-safety.mjs` (new)
- `tests/pre-bash-safety.test.mjs` (new)
- `.claude/settings.json` (register hook)
- `package.json` (test script)

## Implementation Notes

PreToolUse protocol: JSON event on stdin carrying `tool_input.command`; emitting
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask",...}}` on
stdout requests confirmation. Patterns are conservative regexes over the raw command string;
`git clean -fdX` (the Makefile's own clean) must not trigger, `git clean -fd` must.
`--force-with-lease` still counts as a force push — safer than plain force, still rewrites
the remote.

**Security note (required by CLAUDE.md for safety-touching specs):** this hook is
defense-in-depth, not a security boundary. It trusts the command string the runtime hands
it and matches patterns on it; an adversarial command can trivially evade regexes
(variable indirection, base64, a script file). Failure mode if that trust is misplaced: a
destructive git op runs unconfirmed — which is exactly today's status quo, so the hook can
only reduce risk, not create it. It also deliberately fails open on malformed input so a
protocol change can't brick every Bash call; the trade-off is that a runtime bug silently
disables enforcement, which the stderr note makes observable.

## Verification

`npm test` passes, covering: force-push variants ask, `reset --hard` asks,
`branch -D` asks, `clean -fdX` allowed, plain `git status`/`git push` allowed, garbage
stdin exits 0. `.claude/settings.json` registers the hook under PreToolUse with a Bash
matcher. `scripts/check-specs.sh template` passes.
