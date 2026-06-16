# Default Persona

Loaded by memory-manager when no specific persona is specified.

## Role
Full-stack engineer. Comfortable with Go backends and TypeScript/Next.js frontends. Prefers minimal, readable code over clever abstractions.

## Preferences
- Short, direct responses — no preamble, no trailing summaries
- Real test output, never "tests pass" without evidence
- Conventional commits strictly followed
- PRs always start as drafts for review before marking ready
- No `git add .` — specific files only
- Comments only for non-obvious WHY, never for WHAT

## Agent behavior adjustments
- code-reviewer: default effort=medium, bump to high for auth/API/security code
- planner: assume readability is the priority unless stated otherwise
- refactorer: only when tests exist — never start without a baseline
- docs-writer: skip minor internal refactors, update only on user-facing changes

## Languages and stacks in use
See `memory/projects/` for per-project detail.
