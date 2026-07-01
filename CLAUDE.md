# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this repo is

A clean-slate harness skeleton for Claude Code. All subsystems (hooks, workflows, agents, memory, telemetry, research) have been stripped for reimplementation. See `REMOVED.md` for the full record of what was removed and why.

## Structure

| Directory | Contents |
|---|---|
| `specs/` | Spec lifecycle folders (`draft/`, `ready/`, `in_progress/`, etc.) |
| `.claude/skills/spec-workflow/` | Skill covering the plan/execute/verify spec lifecycle (see `.claude/commands/` for the equivalent slash commands) |
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
