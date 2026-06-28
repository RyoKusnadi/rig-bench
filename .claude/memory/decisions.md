# Architectural Decisions

Decisions made during development runs: what was chosen, what was rejected, and why.
Updated by memory-manager when a significant design choice is made.

<!-- memory-manager appends entries here in this format:
### <decision title>
**Date:** YYYY-MM-DD
**Source:** <agent or pipeline>
**Decision:** <what was chosen>
**Alternatives considered:** <what was rejected>
**Rationale:** <why this choice was made>
**Revisit when:** <conditions under which this decision should be re-evaluated>
-->

### Questionnaire-driven research loop ("Ralph loop")
**Date:** 2026-06-23
**Source:** retroactive documentation (see git history for original implementation commits)
**Decision:** `researcher` runs a search→extract→verify cycle per iteration; loop control (confidence scoring, stagnation detection, iteration counting) lives in JS (`lib/research-state.mjs`, mirrored inline in `workflows/research.js` since workflow scripts have no filesystem/Node API access), not in the agent's own judgment. A single final `SYNTHESIZE`-mode call produces the report from verified facts only, run at `frontier` tier.
**Alternatives considered:** Letting the agent self-report confidence and decide when to stop.
**Rationale:** Loop-control state (confidence, stagnation streaks) needs to be deterministic and auditable across iterations — an LLM call recomputing it from scratch each time risks drift and can't be unit tested the way `lib/research-state.mjs`'s pure functions can.
**Revisit when:** Workflow scripts gain filesystem/Node API access, removing the need to mirror `lib/research-state.mjs` inline.

### Two-tier Code Checkpoint Architecture
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Tier 1 (`scripts/code-map.mjs`) regex-walks `hooks/`, `lib/`, `scripts/`, `workflows/`, `subagents/` and extracts a deterministic module-boundary map (imports/exports, workflow meta, agent frontmatter) to `.claude/session-state/structural-checkpoint.json`. Tier 2 (`hooks/pre-compact.mjs`) snapshots the actual content (or signatures for files over ~200 lines) of files under active edit to `.claude/session-state/working-set-checkpoint.json`. `hooks/session-start.mjs` injects both at session start.
**Alternatives considered:** An AST parser for more precise extraction.
**Rationale:** No build step or TypeScript compiler exists in this repo to lean on; a regex-based extractor needs zero dependencies, and a missed edge case produces an incomplete map (agent still has Read/Grep as fallback), not a wrong one.
**Revisit when:** This repo adds a build step or TS compiler that could replace the regex extraction with real parsing.

### "Lean 2" agent roster consolidation
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Collapsed a 15-agent roster (orchestrator, planner, developer, test-writer, refactorer, code-reviewer, security-reviewer, secret-scanner, dependency-auditor, verifier, debugger, docs-writer, git-assistant, changelog-writer, memory-manager) into two agents — `operator` and `inspector` — that each do their combined job in a single spawn per pipeline stage. `scout` (mechanical-only, zero judgment) and `researcher` (a genuinely distinct job, not a reviewer) are deliberate, narrow exceptions that don't reintroduce reviewer-sprawl.
**Alternatives considered:** Keeping the full 15-agent roster; adding more specialized agents over time.
**Rationale:** Every additional agent spawn carries fixed token/latency overhead ("spawn-tax") regardless of how small its job is — combining related judgment calls into one spawn cuts that overhead without losing review coverage.
**Revisit when:** A genuinely distinct job emerges that doesn't fit `operator`'s or `inspector`'s existing mode set (the same bar `scout` and `researcher` had to clear).

### Role-Based Access Control via PreToolUse hook
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** `hooks/pre-tool-gatekeeper.mjs` enforces a strict read-only boundary for the `research` role (set via `scripts/set-agent-role.mjs`, read from `RIGBENCH_AGENT_ROLE`/`.claude/hook-state/agent-role.json`): only read tools, output writes scoped to `TITLE.MD`/`research_output`/`tmp`, a narrow Bash allowlist (cat/grep/rg/find/curl), and read-only Git subcommands (status/log/diff/show/branch).
**Alternatives considered:** Trusting the `researcher` agent's own system prompt to stay read-only without a hook-level enforcement layer.
**Rationale:** The Ralph loop must never edit `src/` or run arbitrary code — a prompt-level instruction is not a security boundary, but a `PreToolUse` hook that denies by tool/role is.
**Revisit when:** A new agent role needs a similarly scoped boundary — generalize `decideForResearch()` rather than hardcoding a second role-specific branch.

### Security hardening: schema-correction retries, Bash allowlist, SSRF protection
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Three independent hardening measures: (1) `lib/agent-wrapper.mjs`'s `safeAgent()` retries a failed-schema `agent()` call up to 2x with a `[SYSTEM CORRECTION]` prompt showing the exact schema before giving up; (2) `hooks/pre-bash-safety.mjs` supports an opt-in allowlist mode (`RIGBENCH_ALLOWED_COMMANDS`) that defaults to deny-by-command-segment instead of a denylist, closing variable-expansion/pipe-to-shell bypasses; (3) `hooks/pre-webfetch-security.mjs` resolves the requested hostname and blocks private/reserved/metadata IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, and IPv6 equivalents) before allowing a fetch.
**Alternatives considered:** A denylist-only Bash safety check (the prior approach); trusting WebFetch's own URL validation.
**Rationale:** A denylist of "dangerous" command patterns is trivially bypassable via variable expansion or piping to a shell; an allowlist that checks each command segment isn't. SSRF via WebFetch to internal/metadata endpoints is a known class of vulnerability that URL-string checks alone don't catch — resolving the hostname to an IP and checking that is the real check.
**Revisit when:** The DNS-rebinding window between `pre-webfetch-security.mjs`'s check and the actual fetch becomes a practical risk (documented residual gap — this is defense-in-depth, not a full proxy).

### Per-session Read budget (context isolation guardrail)
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** `hooks/read-budget.mjs` blocks further `Read` calls once a session exceeds `RIGBENCH_MAX_READS` (default 50), tracked per `session_id` in `.claude/agent-telemetry.json` with file-locking to avoid race conditions across concurrent sessions.
**Alternatives considered:** No limit; relying on agents to self-regulate Read usage.
**Rationale:** Forces agents back to Grep-based retrieval instead of loading the repo wholesale into context — a guardrail against a known failure mode (context window exhaustion from indiscriminate file reads), not a security boundary.
**Revisit when:** Claude Code's `session_id` scoping changes such that multiple subagents sharing one `session_id` need independent budgets.

### All hooks migrated to Node.js (no Bash)
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Every hook is a plain `.mjs` file using only portable Node APIs (`node:fs`, `node:path`, `node:child_process`) via shared helpers in `hooks/lib/hook-utils.mjs`. No hook is a Bash script.
**Alternatives considered:** Bash scripts for hooks (the original approach for some).
**Rationale:** Bash has no guaranteed `PATH` on Windows by default, and Windows path/quoting semantics differ enough from POSIX shells to cause silent failures; Node ships everywhere Claude Code runs.
**Revisit when:** Hands-on Windows verification surfaces a portability gap not covered by sticking to Node's standard library.

### Instincts v2: capture/validate/promote pipeline
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** `hooks/evaluate-session.mjs` (Stop hook) scans the transcript for failure keywords (GATE_FAIL, BLOCKED, ESCALATE, etc.), deduplicates by content hash, and writes/bumps low-confidence instinct files under `.claude/instincts/pending/` with an occurrence counter. `hooks/session-start.mjs` surfaces the top 3 pending instincts by occurrence count. Promotion into permanent rules (`subagents/rules/common/`) happens only via the manual `/evolve` command — never automatically on a threshold or timer.
**Alternatives considered:** Automatic promotion once an instinct crosses an occurrence threshold.
**Rationale:** Capture should be cheap and automatic (a keyword scan), but promoting something to a permanent rule that shapes future agent behavior is a high-leverage, hard-to-reverse change — keeping that step manual and reviewable avoids silently baking in a one-off fluke as a standing rule.
**Revisit when:** False-positive promotions become a recurring problem even with manual review, suggesting the capture step itself needs better signal.

### Token telemetry and reporting
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Every workflow wraps `agent()` calls to record the output-token delta from `budget.spent()` per call (`token_telemetry`) and tier escalations (`escalations`) in its return value. `hooks/telemetry-writer.mjs` (PostToolUse on the Workflow tool) persists these to gitignored `telemetry/runs/*.jsonl`; `scripts/report.mjs` aggregates aggregate cost/escalation/outcome stats from them.
**Alternatives considered:** A richer breakdown including input/cache-read/cache-creation tokens.
**Rationale:** `budget.spent()` only exposes the output-token delta at this API layer — that's the data available, and it's still useful for relative cost comparison across workflow stages even without the full breakdown.
**Revisit when:** The Workflow tool's `budget` API exposes input/cache token breakdowns, allowing `telemetry-writer.mjs` to record full cost instead of output-only.

### Research reports ingested into the same memory vector store
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** `scripts/ingest-memory.mjs` chunks `research/{topic}/TITLE.MD` reports by header alongside `.claude/memory/` and `memory/` markdown, ingesting all of it into the same TF-IDF vector store (`lib/memory-store.mjs`). No separate metadata/tagging columns — topic/version terms in a report's YAML frontmatter are part of the first chunk's plain text, so they already factor into that chunk's vector.
**Alternatives considered:** A separate store or metadata schema for research reports, with explicit topic/version tags.
**Rationale:** A second store or schema would be more precise but adds real complexity for a benefit (structured tag filtering) the corpus size doesn't need yet — plain-text frontmatter already makes topic/version terms searchable through normal TF-IDF retrieval.
**Revisit when:** The research corpus grows large enough that plain-text frontmatter terms start producing noisy/irrelevant matches, justifying real metadata columns.

### Stagnation detection and query mutation in the research loop
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Two guards in `workflows/research.js` (mirrored from `lib/research-state.mjs`): if `researcher` re-issues the exact same `next_search_query` it was just given, the workflow force-mutates it (alternating ` site:reddit.com` / ` alternative to` suffixes) before the next iteration; if confidence improves by less than 0.05 for 2 consecutive iterations, the loop stops early (`stagnated: true`) and moves straight to synthesis instead of exhausting the iteration budget.
**Alternatives considered:** Relying solely on the max-iteration cap to bound the loop.
**Rationale:** A max-iteration cap alone still burns the full budget chasing a confidence score that's stopped moving, or repeating a dead-end search verbatim — both are detectable patterns worth short-circuiting on, independent of the iteration count.
**Revisit when:** The stagnation threshold (0.05 over 2 iterations) proves too aggressive or too lax in practice — these constants are mirrored in two places (`lib/research-state.mjs` and `workflows/research.js`) and must be changed in both.

### `new_memories` structured field alongside direct Bash writes
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Agent output schemas include an optional `new_memories` array (`{title, content}` pairs) that workflows collect and return as structured data — but this is additive, not a replacement: `operator` still writes to `.claude/memory/` directly via Bash during SHIP mode, since workflow scripts have no filesystem access to do that ingestion themselves.
**Alternatives considered:** Having the JS orchestrator (workflow script) handle memory-file writes itself from the `new_memories` field.
**Rationale:** Workflow scripts have no filesystem/Node API access, so they cannot write `.claude/memory/*.md` themselves regardless of how the data is shaped — `new_memories` exists for observability/telemetry, not as the actual write mechanism.
**Revisit when:** Workflow scripts gain filesystem access, at which point `new_memories` could become the real write path instead of a secondary signal.

### Rejected: dedicated memory-manager agent
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Did not build a third agent for memory curation.
**Alternatives considered:** Adding a `memory-manager` agent (raised as "optional but recommended").
**Rationale:** Directly reverses the Lean-2 consolidation's purpose (cutting spawn-tax by merging judgment work into fewer agents) for a need `operator`'s existing SHIP-mode memory-writing step plus the `new_memories` field already cover.
**Revisit when:** Memory curation needs grow complex enough (e.g. real deduplication/conflict resolution across entries) that `operator`'s SHIP-mode step genuinely can't absorb it.

### Rejected: custom mid-loop context compactor
**Date:** 2026-06-23
**Source:** retroactive documentation
**Decision:** Did not build a custom `lib/compactor.js` to track and reset a single agent's message history mid-flight.
**Alternatives considered:** A custom compaction library giving the JS orchestrator visibility into a single `agent()` call's token usage during its run.
**Rationale:** Each `agent()` call is atomic from the orchestrator's side — no visibility until it returns, so mid-flight tracking isn't possible at that layer. Claude Code's own `PreCompact` hook (`hooks/pre-compact.mjs`) plus `operator`/`inspector`'s documented "Context recovery" sections already solve the same problem at the platform level.
**Revisit when:** The Workflow tool's `agent()` API exposes any mid-call visibility, which it does not today.
