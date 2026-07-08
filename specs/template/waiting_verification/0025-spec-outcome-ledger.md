---
id: "0025"
title: Structured outcome ledger for finished and blocked specs
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "feat/0021-verification-trace-capture"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/102"
history:
  - ready 2026-07-08T00:00:00Z
  - in_progress 2026-07-08T00:00:00Z
  - waiting_verification 2026-07-08T00:00:00Z
source: ""
---
## Problem

When `spec-plan` drafts a new spec, the only way to learn "has something like this been
tried before, and did it work" is to read individual spec files and `memory/`'s prose
notebooks. There's no structured, queryable record of terminal outcomes across the spec
history. Meta-Harness's outer loop solves the analogous problem with
`evolution_summary.jsonl` and `frontier_val.json` — a compact per-attempt record that later
iterations read before proposing new candidates, specifically to avoid re-trying what's
already been tried. rig-bench has no equivalent for its own finished/blocked specs.

## Acceptance Criteria

- When `spec-verify` moves a spec to `finished/`, it shall append one line to
  `memory/spec-ledger.jsonl` recording the project, id, title, outcome (`finished`), the
  spec's `verify_attempts`, and a UTC timestamp.
- When `spec-verify` moves a spec to `blocked/`, it shall append one line to the same ledger
  with outcome `blocked`, following the same format.
- The `scripts/spec-ledger.sh` script shall support appending a record given a project, id,
  title, outcome, and verify-attempts count, validating that outcome is `finished` or
  `blocked` and that verify-attempts is a non-negative integer.
- The `scripts/spec-ledger.sh` script shall support listing recorded outcomes, optionally
  filtered by project and/or outcome.
- If the ledger file does not yet exist, then `scripts/spec-ledger.sh list` shall report that
  no outcomes are recorded and exit zero, and `append` shall create the file (and its parent
  directory) rather than failing.
- When `spec-plan` reaches Phase 2's memory consultation step, it shall also check
  `scripts/spec-ledger.sh list <project> blocked` for prior blocked attempts in the spec's
  area before drafting.

## Out of Scope

- Any tagging of *why* a spec was blocked, or a mechanism/axis label per record — the ledger
  records terminal outcome and attempt count only; the "why" lives in the blocked spec file
  itself (still on disk under `blocked/`) and in `memory/lessons.md`. Adding richer tagging is
  a candidate for a future spec if the plain outcome record proves insufficient in practice.
  This keeps this spec's mechanism single and scoped (spec 0023's discipline, applied to
  itself).
- Clearing or rewriting ledger entries — unlike the per-spec trace and failure section, the
  ledger is meant to persist as a durable history across the whole project, not be reset on
  success.
- A un-blocking workflow change — `specs/README.md`'s existing "Un-blocking a spec" procedure
  (reset `verify_attempts` to 0) is unaffected; the ledger's `blocked` record from the earlier
  attempt simply stays as history.

## Files/Interfaces Touched

- `scripts/spec-ledger.sh` — new dependency-free bash script: `append` and `list` subcommands
  over `memory/spec-ledger.jsonl`.
- `tests/spec-ledger.test.mjs` — new `node --test` suite exercising the script against
  fixture directories.
- `.claude/skills/spec-verify/SKILL.md` — Phase 5 (finished move) and Phase 6b (blocked move)
  each append a ledger record.
- `.claude/skills/spec-plan/SKILL.md` — Phase 2's memory-consultation step also checks the
  ledger for prior blocked attempts.
- `specs/README.md` — new "Outcome ledger" note alongside the existing "Clearing the record
  on success" note.

## Implementation Notes

- `memory/spec-ledger.jsonl` is plain JSON Lines — one flat object per line, `grep`/`cut`
  friendly, matching the file-based-memory convention and requiring no `jq` dependency (not
  assumed present in this environment). Title strings are escaped for backslash and
  double-quote only, since spec titles are single-line plain text by `spec-template.md`'s
  convention.
- Unlike the Phase 3d verification trace (spec 0021) and the `## Verification Failures`
  section, the ledger is **never cleared** — it's the durable cross-spec history the trace
  and failure section deliberately are not. This is the same distinction Meta-Harness draws
  between per-iteration logs (verbose, can be pruned) and `evolution_summary.jsonl` (compact,
  kept forever).
- `scripts/spec-ledger.sh` mirrors `spec-trace.sh` and `spec-status.sh`: resolves `REPO_ROOT`
  from its own location, pure bash, no external dependencies.

## Verification

Run `npm test` — `tests/spec-ledger.test.mjs` asserts: `append` writes a well-formed,
correctly-escaped JSON line and creates `memory/` if absent; `append` rejects an invalid
outcome or a non-numeric attempts count; `list` with no arguments prints every record; `list`
filters by project and by project+outcome; `list` is a clean exit-zero no-op both before any
record exists and when a filter matches nothing. Then run `make check` — `check-specs.sh`
and `check-state-sync.sh` still report no issues.
