---
id: "0007"
title: PostToolUse hook auto-running check-specs.sh on spec file edits
status: finished
depends_on: ["0004", "0005"]
verify_attempts: 0
source: REMOVED.md#hooks-lib-and-scripts-third-pass
---
## Problem

Spec consistency issues (status/folder mismatch, dangling or cyclic depends_on) are only
caught when someone remembers to run `make check`. Drift introduced mid-task surfaces at
review instead of at write time.

## Acceptance Criteria

- When an Edit or Write tool call touches a file under `specs/<project>/<state>/`, the hook
  shall run `scripts/check-specs.sh <project>` for that project.
- If the check reports issues, then the hook shall exit 2 with the check output on stderr,
  so the agent sees the issues immediately.
- When the edited file is not under a project's lifecycle folders (including
  `specs/README.md` and `specs/spec-template.md`), the hook shall exit 0 without running
  anything.
- If the hook receives unparsable input, then it shall fail open (exit 0) with a stderr
  note, matching the pre-bash hook's fail-open decision.
- The hook shall use only Node.js built-ins and shall be registered for PostToolUse in
  `.claude/settings.json`.
- The hook's routing (which paths trigger a check, which don't) shall be covered by
  `node --test` tests runnable via `npm test`.

## Out of Scope

- Running the full `make check` (state-sync included) on every edit — state.yaml/README
  edits are rare and deliberate; per-spec checks are the ones that drift mid-task.
- Blocking the edit itself. PostToolUse runs after the write; this hook is feedback, not a
  gate — the pre-tool gatekeeper pattern stays removed.

## Files/Interfaces Touched

- `hooks/post-spec-edit-check.mjs` (new)
- `tests/post-spec-edit-check.test.mjs` (new)
- `.claude/settings.json` (register hook)

## Implementation Notes

Extract `tool_input.file_path`, normalize against `process.cwd()`, and match
`specs/<project>/<state>/<file>.md` (three-plus segments under specs/ — the two top-level
markdown files have only two and won't match). Spawn `bash scripts/check-specs.sh <project>`
synchronously; on non-zero exit, exit 2 and forward the output on stderr.

**Security note (per CLAUDE.md non-negotiables, this spec touches hook wiring):** the hook
executes a fixed repo script with the project-directory name as its only argument, derived
from the edited path — it never executes content from the edited file. A hostile
`<project>` segment is still just an argument to check-specs.sh, which validates the
directory exists. Fail-open on malformed events mirrors spec 0004's trade-off: a runtime
protocol change degrades to no-op rather than blocking edits, observable via stderr.

## Verification

`npm test` passes, covering: a spec-folder path triggers the check (exit 0 on the current
clean tree), `specs/README.md` and non-spec paths don't, garbage stdin fails open.
`.claude/settings.json` registers the hook for PostToolUse with an Edit|Write matcher.
