# CLAUDE.md

Guidance for Claude Code when working in this repo. See [README.md](README.md) for the full design writeup — this file is the quick-reference subset.

## What this repo is

A harness skeleton for Claude Code: safety hooks (`hooks/*.mjs`), spec-driven pipeline (`specs/`, `scripts/specs-graph.mjs`), a code-map generator (`scripts/code-map.mjs`), and placeholder directories for workflows and config schemas to be re-implemented. See `REMOVED.md` for what was stripped and why.

## Commands

```bash
make test    # node --test tests/**/*.test.js (also: npm test)
make lint    # node --check over hooks/lib/scripts (no eslint config — see Makefile)
make clean   # git clean -fdX
npm run code:map     # regenerate .claude/session-state/structural-checkpoint.json
npm run specs:graph  # validate spec dependency graph
```

## Conventions

- Hooks/lib/scripts are plain ESM `.mjs`, no build step, no TypeScript.
- Every hook in `hooks/` follows the same shape: read stdin JSON via `readStdinJson()`, wrap the body in `runHook(name, event, root, toolName, () => {...})` from `hooks/lib/hook-utils.mjs`, always exit 0 unless explicitly blocking (`block()`/`permissionDeny()`). Hooks fail open on unexpected errors by design.
- New tests go in `tests/*.test.js`, run via Node's built-in `node:test`/`node:assert` — no external test framework.

## Gotchas

- `.claude/bash.log`, `.claude/hooks.log`, and `.claude/session-state/` are gitignored and regenerable — never hand-edit or commit them.
- `hooks/pre-tool-gatekeeper.mjs` still contains dead `research`-role logic (carve-outs for the removed research workflow) — harmless but can be cleaned up when the gatekeeper is next touched.
