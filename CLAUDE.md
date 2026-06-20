# CLAUDE.md

Guidance for Claude Code when working in this repo. See [README.md](README.md) for the full design writeup — this file is the quick-reference subset.

## What this repo is

A multi-agent harness for Claude Code: `subagents/` (operator/inspector/scout/researcher), `workflows/*.js` (deterministic pipelines), `hooks/*.mjs` (safety/lifecycle), `lib/*.mjs` (shared logic, documented reference only — not importable from `workflows/*.js`, which has no filesystem/Node API access), `scripts/*.mjs` (CLI tools), `config/schemas/*.json` (output contracts).

## Commands

```bash
make test    # node --test tests/**/*.test.js (also: npm test)
make lint    # node --check over hooks/lib/scripts (no eslint config — see Makefile)
make clean   # git clean -fdX
npm run memory:ingest   # chunk .claude/memory/ + memory/ into the TF-IDF vector store
npm run memory:query    # CLI: top-K relevant memory chunks for a query
npm run report          # aggregate stats from telemetry/runs/*.jsonl
```

## Conventions

- Hooks/lib/scripts are plain ESM `.mjs`, no build step, no TypeScript.
- `workflows/*.js` are NOT standalone Node scripts — they run inside the Workflow tool's own async wrapper (top-level `return`/`await` is valid there). `make lint` deliberately excludes them; don't try to `node --check` one directly.
- Every hook in `hooks/` follows the same shape: read stdin JSON via `readStdinJson()`, wrap the body in `runHook(name, event, root, toolName, () => {...})` from `hooks/lib/hook-utils.mjs`, always exit 0 unless explicitly blocking (`block()`/`permissionDeny()`). Hooks fail open on unexpected errors by design.
- Every workflow script follows the `STATES`/`TRANSITIONS`/`TIER_MODELS`/`ESCALATION_POLICY` pattern documented in `workflows/README.md` ("Writing a custom workflow") — copy an existing workflow rather than starting from scratch.
- `config/schemas/*.json` are the canonical contracts for agent structured output; each workflow's inline `GATE_SCHEMA`/`SCOUT_SCHEMA` must stay a subset (`tests/lib-workflow-sync.test.js` catches drift on the tier/retry constants, not the schemas themselves — verify schema changes by hand).
- New tests go in `tests/*.test.js`, run via Node's built-in `node:test`/`node:assert` — no external test framework.

## Gotchas

- `.claude/agent-telemetry.json`, `.claude/bash.log`, `.claude/hooks.log`, `telemetry/runs/`, and `.claude/memory-vectors.db` are gitignored and regenerable — never hand-edit or commit them.
- `lib/memory-store.mjs` uses TF-IDF, not neural embeddings — deliberate (see workflows/README.md "Declined"); don't add an embedding dependency without re-reading that rationale first.
- See `.claude/memory/gotchas.md` and `.claude/memory/decisions.md` for accumulated, harness-specific gotchas and architectural decisions beyond what's listed here.

## Where to look first

- `todo.md` — improvement backlog, grouped by priority; check it before assuming something is unhandled.
- `workflows/README.md` — per-workflow args/return reference, model routing, and the full "Declined" list of options considered and rejected.
- `subagents/README.md` and `subagents/SCHEMA.md` — agent roster and the frontmatter/output contract every agent follows.
