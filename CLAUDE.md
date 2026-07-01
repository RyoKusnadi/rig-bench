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

## Structure

| Directory | Contents |
|---|---|
| `specs/spec-template.md` | Canonical spec template |
| `specs/<project_name>/` | Per-project spec lifecycle folders (`draft/`, `ready/`, `in_progress/`, etc.) — `specs/template/` is this harness's own specs |
| `.claude/skills/spec-plan/` | Skill covering the planning phase of the spec lifecycle |
| `.claude/skills/spec-exec/` | Skill covering the execution phase of the spec lifecycle |
| `.claude/skills/spec-verify/` | Skill covering the verification phase of the spec lifecycle |
| `.claude/agents/spec-exec-worker.md` | Subagent: implements one spec in an isolated git worktree, dispatched by `spec-exec`'s concurrent-dispatch phase |
| `.claude/agents/spec-verify-worker.md` | Subagent: verifies one spec in an isolated git worktree, dispatched by `spec-verify`'s concurrent-dispatch phase |
| `workflows/state.yaml` | Machine-readable mirror of the spec lifecycle state table (data only, no orchestration code — see `specs/README.md` "State Transitions" and `improvement-plan.md` Phase 2) |
| `hooks/` | Placeholder (`.gitkeep`) |
| `lib/` | Placeholder (`.gitkeep`) |
| `scripts/` | Utility scripts (spec consistency checking) |
| `config/schemas/` | Placeholder (`.gitkeep`) |
| `tests/` | Placeholder (`.gitkeep`) |
| `projects/` | Placeholder (`.gitkeep`) |

## Commands

```bash
make clean   # git clean -fdX
```
