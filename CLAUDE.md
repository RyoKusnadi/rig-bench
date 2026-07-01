# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this repo is

A clean-slate harness skeleton for Claude Code. All subsystems (hooks, workflows, agents, memory, telemetry, research) have been stripped for reimplementation. See `REMOVED.md` for the full record of what was removed and why.

## Structure

| Directory | Contents |
|---|---|
| `specs/template/` | Canonical spec template (`spec-template.md`) |
| `specs/<project_name>/` | Per-project spec lifecycle folders (`draft/`, `ready/`, `in_progress/`, etc.) — `specs/rig-bench/` is this harness's own specs |
| `.claude/skills/spec-plan/` | Skill covering the planning phase of the spec lifecycle (see `.claude/commands/` for the execute/verify slash commands) |
| `workflows/` | Placeholder (`.gitkeep`) |
| `hooks/` | Placeholder (`.gitkeep`) |
| `lib/` | Placeholder (`.gitkeep`) |
| `scripts/` | Placeholder (`.gitkeep`) |
| `config/schemas/` | Placeholder (`.gitkeep`) |
| `tests/` | Placeholder (`.gitkeep`) |
| `projects/` | Placeholder (`.gitkeep`) |

## Commands

```bash
make clean   # git clean -fdX
```
