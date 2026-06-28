# Removed Components

This file records what was stripped from the harness on 2026-06-28, and why.
All of these are planned for re-implementation in the future.

---

## Memory system

**What was removed:**
- `memory/` — top-level knowledge/personas/sessions directory
- `lib/memory-store.mjs` — TF-IDF vector store (used SQLite via `better-sqlite3`)
- `scripts/ingest-memory.mjs`, `scripts/query-memory.mjs`, `scripts/prune-memory.mjs`
- `tests/memory-store.test.js`, `tests/ingest-memory.test.js`, `tests/query-memory.test.js`, `tests/prune-memory.test.js`, `tests/helpers/memory-db-lock.mjs`
- `.claude/memory/` — project memory index (MEMORY.md, architecture.md, conventions.md, decisions.md, gotchas.md, lessons-learned.md)
- `.claude/commands/memory-prune.md`, `.claude/commands/evolve.md`
- `npm` scripts: `memory:ingest`, `memory:query`, `memory:prune`
- `better-sqlite3` dependency (only user — the memory store)

**Why:** The TF-IDF store added complexity and a native module dependency without enough daily value yet. Will be re-implemented with a cleaner design.

---

## Telemetry system

**What was removed:**
- `hooks/telemetry-writer.mjs` — PostToolUse hook that wrote Workflow completions to `telemetry/runs/`
- `scripts/report.mjs` — aggregated telemetry stats
- `scripts/token-dashboard.mjs` — local HTML dashboard for token usage
- `scripts/token-usage.mjs` — raw token usage reader from session transcripts
- `tests/telemetry-writer.test.js`, `tests/report.test.js`
- `make token-dashboard` Makefile target
- `npm` scripts: `report`, `token-dashboard`
- Hook entry in `settings.json`: PostToolUse `Workflow` → `telemetry-writer.mjs`

**Why:** Nice-to-have observability tooling, not load-bearing. Will be re-implemented when there's a clearer picture of what metrics actually matter.

---

## Read-budget hook

**What was removed:**
- `hooks/read-budget.mjs` — PreToolUse hook that counted Read calls per session and blocked past a configurable ceiling
- `tests/read-budget.test.js`
- Hook entry in `settings.json`: PreToolUse `Read` → `read-budget.mjs`

**Why:** The ceiling was hit too often in legitimate deep-read sessions and caused friction without clear safety payoff.

---

## Research system

**What was removed:**
- `lib/research-state.mjs` — Ralph-loop research state machine
- `lib/state-projector.mjs` — projected research state to bounded Markdown for agent prompts
- `scripts/ask-questionnaire.mjs` — YAML questionnaire runner that seeded research intake
- `scripts/sync-obsidian.mjs`, `scripts/query-obsidian.mjs`, `scripts/lint-obsidian.mjs` — Obsidian vault integration
- `workflows/research.js` — multi-iteration web-research workflow
- `config/schemas/research-intake.schema.json`, `research-state.schema.json`, `researcher-output.schema.json`
- `subagents/researcher/researcher.md` (also `.claude/agents/researcher.md`)
- `.claude/commands/research.md`, `.claude/commands/wiki-query.md`
- `intake/` directory (`research-questionnaire.yaml`, `spec-driven-task-splitting.yaml`)
- `tests/research-state.test.js`, `tests/ask-questionnaire.test.js`, `tests/state-projector.test.js`
- `tests/lint-obsidian.test.js`, `tests/query-obsidian.test.js`, `tests/sync-obsidian.test.js`
- `npm` scripts: `wiki:sync`, `wiki:query`, `wiki:lint`

**Why:** The research loop was rarely invoked directly and the Obsidian integration added external-path coupling. Will be re-implemented as a simpler, self-contained workflow when needed.

---

## Agent / subagent definitions

**What was removed:**
- `subagents/` — operator, inspector, scout agent markdown files, shared rules (Go, TypeScript, security, testing, common), README, SCHEMA
- `.claude/agents/` — operator.md, inspector.md, scout.md, researcher.md
- `workflows/autotune.js` — self-improvement loop that mutated agent files and scored them
- `.claude/commands/autotune.md`
- `scripts/set-agent-role.mjs` — wrote `.claude/hook-state/agent-role.json` before the research workflow
- `tests/set-agent-role.test.js`

**Why:** The agent definition files were tightly coupled to the removed research and memory systems. Starting fresh gives a clean slate for the next iteration of the operator/inspector/scout design.

**Note:** The orchestration workflows (`workflows/new-feature.js`, `bug-fix.js`, `refactor.js`, etc.) and the schemas (`config/schemas/operator-output.schema.json`, `inspector-output.schema.json`, `scout-output.schema.json`) are retained as structural reference. The `pre-tool-gatekeeper.mjs` hook still contains dead `research`-role logic — harmless but can be pruned when the gatekeeper is next touched.

---

## Removed commands (`.claude/commands/`)

| File | Purpose |
|---|---|
| `audit.md` | `/audit` — pre-release security + dependency scan |
| `autotune.md` | `/autotune` — agent self-improvement loop |
| `evolve.md` | `/evolve` — promote instincts to permanent rules |
| `memory-prune.md` | `/memory-prune` — enforce memory TTL |
| `research.md` | `/research` — questionnaire-driven research loop |
| `review.md` | `/review` — full PR quality review |
| `ship.md` | `/ship` — new-feature end-to-end pipeline |
| `verify.md` | `/verify` — verify specs awaiting human confirmation |
| `wiki-query.md` | `/wiki-query` — query Obsidian vault |

**Remaining commands:** `/plan`, `/execute`

---

## Removed hooks (from `settings.json`)

| Hook event | File | Reason |
|---|---|---|
| SessionStart | `session-start.mjs` | Only injected memory index + instincts |
| PreToolUse Read | `read-budget.mjs` | Too aggressive; caused friction |
| PostToolUse Workflow | `telemetry-writer.mjs` | Telemetry removal |
| Stop | `evaluate-session.mjs` | Wrote instincts (memory system) |
| PreCompact | `pre-compact.mjs` | Fed session-start; orphaned by its removal |

**Active hooks:** `pre-tool-gatekeeper.mjs`, `pre-bash-safety.mjs`, `pre-webfetch-security.mjs`, `post-bash-processor.mjs`, `auto-run-tests.mjs`
