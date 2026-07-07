---
id: "0017"
title: SessionStart hook priming sessions with spec-status output
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "reland-0012-0020-implementations"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/100"
source: ""
---
## Problem

Lifecycle state (per-state counts, failed attempts, blocked specs) is only visible when
someone remembers to run `make status`. A fresh session starts blind: it can pick up
work without knowing two specs are waiting verification or one is blocked, and nothing
in the harness surfaces that automatically.

## Acceptance Criteria

- When a session starts, the hook shall print `scripts/spec-status.sh` output for every
  project directory under `specs/` to stdout, so it lands in the session's context.
- If `specs/` contains no project directories, or `spec-status.sh` is missing or exits
  non-zero, then the hook shall exit 0 with no error surfaced (fail-open, observable via
  a stderr note only).
- The hook shall be registered under `SessionStart` in `.claude/settings.json`.
- The hook shall use Node built-ins only.

## Out of Scope

- Running `spec-metrics.sh` or `check-specs.sh` at session start — status is the cheap,
  always-relevant view; the others are on-demand.
- Filtering by "current" project — all projects' status is small enough to print.
- Any change to `spec-status.sh` itself.

## Files/Interfaces Touched

- `hooks/session-start-status.mjs` — new SessionStart hook
- `.claude/settings.json` — register the hook under a `SessionStart` block
- `tests/session-start-status.test.mjs` — new test file

## Implementation Notes

- Project enumeration mirrors the canonical procedure in `specs/README.md`: directories
  one level under `specs/`, nothing else (`fs.readdirSync` + `isDirectory()` — never
  plain listing, which would pick up `spec-template.md`).
- Run `spawnSync("bash", ["scripts/spec-status.sh", project])` per project and
  concatenate stdout. A SessionStart hook's stdout is added to context, so plain
  printing is the whole delivery mechanism — no `hookSpecificOutput` envelope needed.
- Fail-open shape copied from the two existing hooks: malformed stdin, missing script,
  or non-zero child exit all end in `process.exit(0)`, with a one-line stderr note so
  the skip stays observable (same trade-off documented in `pre-bash-safety.mjs`).
- Tests spawn the hook with `cwd` pointed at a fixture tree (a `specs/<proj>/` skeleton
  plus the real `scripts/spec-status.sh` copied or path-reachable), matching how
  `tests/post-spec-edit-check.test.mjs` already exercises hook+script integration.

## Verification

Run `npm test` — `tests/session-start-status.test.mjs` asserts: with a fixture
containing one project skeleton, hook stdout contains that project's `Spec status —`
header and the hook exits 0; with an empty `specs/` fixture, the hook exits 0 and prints
nothing to stdout. Manually: start a new Claude Code session in this repo and confirm
the status block appears in the session context.
