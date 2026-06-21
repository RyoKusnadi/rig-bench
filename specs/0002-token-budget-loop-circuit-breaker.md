---
id: 0002
title: Deterministic circuit breaker for repeated test-fix loops
status: ready
depends_on: []
source: todo.md#3-the-honor-system-token-budgets
---

## Problem

`MAX_TOKEN_BUDGET` in `workflows/*.js` is only checked *after* an `agent()`
call returns. If `operator` enters a write→test-fail→fix→test-fail loop, it
can burn 50k+ tokens before the orchestrator's `budget.spent()` check ever
runs — there's no in-flight kill switch.

## Acceptance Criteria

- `hooks/auto-run-tests.mjs` tracks consecutive test failures (per
  session/file) using existing session-state conventions (see
  `.claude/session-state/last-test-results.json`).
- On the 3rd consecutive failure for the same target, the hook writes a flag
  file under `.claude/session-state/` and injects an `additionalContext`
  warning telling the agent to stop fixing and escalate, instead of letting
  it keep trying.
- `operator.md` gets a new Hard Rule: if the loop-detected flag exists, the
  agent must output `ESCALATE` immediately rather than continue editing.
- The failure counter resets to 0 on a passing test run.
- A new test exercises: 3 consecutive failures → flag written +
  `additionalContext` present; a pass after 2 failures → counter reset, no
  flag.

## Out of Scope

- Killing an in-flight `agent()` call mid-execution — out of reach for a
  PostToolUse hook; this spec only prevents the *next* loop iteration from
  starting blind.
- Changing `MAX_TOKEN_BUDGET` enforcement itself in `workflows/*.js`.

## Implementation Notes

Mirrors the flag-file pattern todo.md sketches for
`.claude/session-state/loop-detected.flag`. Keep the failure counter
keyed by file/target so unrelated test runs don't share state. Clear the
flag once `operator` reads it and escalates (or have `session-start.mjs`
clear stale flags past a TTL, consistent with how `working-set-checkpoint.json`
staleness is already handled).
