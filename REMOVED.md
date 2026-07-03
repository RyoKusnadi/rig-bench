# Removed Components

This file records what was stripped from the harness on 2026-06-28, and why.
All of these are planned for re-implementation in the future.

> **Re-implementation status (2026-07-03):** the memory system has been re-added as
> file-based markdown (`memory/`, specs 0002–0003 — deliberately smaller than the removed
> TF-IDF/SQLite design); `pre-bash-safety` and a new post-spec-edit check are the restored
> hooks (specs 0004, 0007); dependency-graph validation returned as in-script checks (spec
> 0005); and concurrent dispatch returned as prose + data + thin agents — explicitly NOT as
> `workflows/*.js` (specs 0008–0009, improvement-plan.md Phase 4). The workflow-code shape
> itself remains removed by design.

---

## Hooks, lib, and scripts *(third pass)*

**What was removed:**
- `hooks/`: all hook files (`auto-run-tests.mjs`, `post-bash-processor.mjs`, `pre-bash-safety.mjs`, `pre-tool-gatekeeper.mjs`, `pre-webfetch-security.mjs`) and `hooks/lib/hook-utils.mjs`; replaced by `hooks/.gitkeep`
- `lib/spec-graph.mjs` — spec dependency graph validator; replaced by `lib/.gitkeep`
- `scripts/code-map.mjs`, `scripts/specs-graph.mjs`; replaced by `scripts/.gitkeep`
- `tests/`: all remaining test files; replaced by `tests/.gitkeep`
- `settings.json` hooks block cleared (no hooks registered)
- `package.json` scripts cleared; `package-lock.json` trimmed
- `Makefile` reduced to `make clean` only

**Why:** Completing the clean-slate reset. Will be re-added when the new design is ready.

---

## Workflows, output schemas, and shared lib utilities *(second pass)*

**What was removed:**
- `workflows/` — all orchestration scripts (`bug-fix.js`, `new-feature.js`, `refactor.js`, `pr-review.js`, `docs-update.js`, `release-prep.js`, `execute-specs.js`, `verify-specs.js`, `README.md`); replaced by `workflows/.gitkeep`
- `config/schemas/` — all agent output schemas (`inspector-output`, `operator-output`, `scout-output`, `execute-spec-output`) plus `README.md`; replaced by `config/schemas/.gitkeep`
- `config/model-tiers.json` — model-tier routing table (was mirrored inline in every workflow)
- `lib/pipeline-state.mjs` — structured pipeline state shape (only used by workflows)
- `lib/agent-wrapper.mjs` — retry wrapper for `agent()` calls in workflows
- `lib/schema-validator.mjs` — lightweight JSON Schema validator for agent output boundaries
- `tests/pipeline-state.test.js`, `tests/agent-wrapper.test.js`, `tests/schema-validator.test.js`, `tests/lib-workflow-sync.test.js`, `tests/execute-specs.test.js`

**Why:** All workflows depended on agent definitions (operator/inspector/scout) that were removed in the first pass. Keeping workflow skeletons without their agents was noise. Starting fresh when the agent design is settled.

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

---

## Memory system, operator/inspector/shipper agents, and their supporting scripts *(2026-07-01)*

**What was removed:**
- `.claude/agents/operator.md`, `.claude/agents/inspector.md`, `.claude/agents/shipper.md` — replaced by `.claude/agents/.gitkeep`
- `workflows/operator.js`, `workflows/bootstrap-memory.js`
- `memory/` — `RULES.md`, `PENDING_UPDATES.md`, `ARCHITECTURE.md`, `structure.json`, `archive/`
- `memory.md` (top-level)
- `scripts/archive-spec.sh`, `scripts/bootstrap-git-history.sh`, `scripts/build-structure-index.sh`, `scripts/read-file-summary.sh`, `scripts/read-worktree-diff.sh`, `scripts/search-git-history.sh`, `scripts/search-structure.sh`, `scripts/write-file-summary.sh`
- Doc references in `CLAUDE.md`, `README.md`, and `specs/README.md` — structure table, "Remember" step, "Memory over re-reading" design principle, and the canonical-caller/shared-file examples that pointed at these files
- `.claude/skills/spec-plan/SKILL.md` and `.claude/skills/spec-exec/SKILL.md`'s project-resolution pointers no longer name the `operator` agent as a caller

**Why:** This system (specs 0001–0015, PRs #37–#55) had grown substantial — real structural indexing, git-history search, file-summary caching, drift detection, and a checkpoint-driven operator loop — but was reverted back toward the clean-slate state this file's intro already describes, to give the next iteration of the design a genuinely fresh start rather than building `spec-exec` on top of a partially-organic system. **Note:** this is a bigger reversion than the other passes above — undoing ~1,100 lines of previously merged, reviewed work, not stub cleanup. Re-implementation should treat this as a deliberate reset, not an accident to quietly restore.
