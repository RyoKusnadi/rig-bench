# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this repo is

A clean-slate harness skeleton for Claude Code. All subsystems (hooks, workflows, agents, memory, telemetry, research) have been stripped for reimplementation. See `REMOVED.md` for the full record of what was removed and why.

## Non-negotiables

A short list of hard rules every spec must respect, regardless of project. This is
deliberately small — a few genuinely non-negotiable constraints, not a style guide. The
`spec-plan` skill's considerations scan checks new specs against this list; keep it updated
here rather than duplicating it into the skill, so there's one place to change it.

- **No destructive git operations without explicit confirmation.** No force-push, no
  `git reset --hard` on a shared branch, no deleting a branch with unmerged work, without the
  human confirming first.
- **Auth-, secrets-, or credential-touching specs need an explicit security note** in
  `Implementation Notes` — what's being trusted, what the failure mode looks like if it's
  wrong. Silence on this for such a spec is a gap, not an indication there's nothing to say.
- **Never commit directly to a project's default branch.** Every change goes through a
  feature branch and a PR, even for one-line fixes — this repo's whole model depends on PRs
  being the reviewable unit.

## Memory

`memory/` holds this repo's durable memory — `decisions.md`, `gotchas.md`, `lessons.md`,
conventions in `memory/README.md`. Read it (or `grep -ri <term> memory/`) before planning or
debugging; write back per its entry format when something is decided, discovered, or learned.
Plain markdown, no tooling — grep is the query engine by design.

## Structure

| Directory | Contents |
|---|---|
| `specs/spec-template.md` | Canonical spec template |
| `specs/<project_name>/` | Per-project spec lifecycle folders (`draft/`, `ready/`, `in_progress/`, etc.) — `specs/template/` is this harness's own specs |
| `.claude/skills/spec-plan/` | Skill covering the planning phase of the spec lifecycle |
| `.claude/skills/spec-exec/` | Skill covering the execution phase of the spec lifecycle |
| `.claude/skills/spec-verify/` | Skill covering the verification phase of the spec lifecycle |
| `.claude/agents/` | `spec-executor.md`, `spec-verifier.md` — thin dispatch entry points into the skills |
| `workflows/state.yaml` | Machine-readable mirror of the spec lifecycle state table (data only, no orchestration code — see `specs/README.md` "State Transitions" and `improvement-plan.md` Phase 2) |
| `memory/` | Durable file-based memory (decisions, gotchas, lessons) |
| `hooks/` | `pre-bash-safety.mjs` (destructive-git confirmation gate), `post-spec-edit-check.mjs` (spec-drift feedback on edit) |
| `lib/` | Placeholder (`.gitkeep`) |
| `scripts/` | Utility scripts (`check-specs.sh`, `check-state-sync.sh`) |
| `config/schemas/` | Placeholder (`.gitkeep`) |
| `tests/` | `node --test` suites (run via `npm test`) |
| `projects/` | Placeholder (`.gitkeep`) |

## Commands

```bash
make clean   # git clean -fdX
make check   # state-table sync check + per-spec consistency checks (incl. dep-graph)
make status  # per-state spec counts + attention items (failed attempts, blocked)
npm test     # node --test suites (hooks)
```
