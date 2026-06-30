# Architecture

## What This Repository Is

`rig-bench` is a spec-driven multi-agent harness for Claude Code. It is not an application in the traditional sense — it has no server, no database, and no user-facing UI. Instead, it is an orchestration framework where AI agents read structured specification files, implement features in isolated git worktrees, verify their own work, and open draft PRs. The repo is intentionally kept as a clean slate: all legacy subsystems (memory vector store, telemetry, research loop, read-budget hook) have been stripped and are being reimplemented from scratch.

## Major Modules / Directories

### `specs/`
The central artifact store. Every unit of work is represented as a Markdown file with YAML frontmatter living in one of the lifecycle subdirectories. The spec file is the source of truth for a feature — it defines requirements, acceptance criteria, implementation plan, and a concrete verification step. Specs move through directories as their status changes; the directory name is the status.

Lifecycle subdirectories:
- `specs/draft/` — in-progress authoring; may contain `[NEEDS CLARIFICATION]` markers
- `specs/ready/` — fully specified; ready to be picked up by the workflow
- `specs/in_progress/` — actively being implemented by an operator agent
- `specs/waiting_verification/` — implemented; awaiting inspector verification
- `specs/finished/` — shipped (merged PR is the permanent record)
- `specs/blocked/` — waiting on an unresolved dependency or external decision
- `specs/abandoned/` — will not be implemented; kept for reference

### `workflows/`
JavaScript ES-module scripts that define multi-phase orchestration pipelines. The runtime is the Claude Code `Workflow` tool. Each workflow exports a `meta` object (name, description, phases array) and then uses top-level `await` with `agent()`, `pipeline()`, `phase()`, and `log()` primitives provided by the harness.

- `workflows/operator.js` — the primary execution pipeline: Discover → PreFlight → Execute → Verify → Retry → Merge → Report. Reads `specs/ready/`, builds a dependency wave graph, fans out one operator agent per spec into an isolated git worktree, verifies each with an inspector agent, retries once on failure, and opens a draft PR via the shipper agent.
- `workflows/bootstrap-memory.js` — one-shot semantic memory generation: spawns an Architect Agent to write `memory/ARCHITECTURE.md` and `memory/RULES.md`, then a Reviewer Agent to fact-check and correct them.

### `.claude/agents/`
Subagent persona definitions (Markdown with YAML frontmatter). Each file defines the agent's name, model tier, allowed tools, isolation mode, and detailed behavioral instructions. The harness injects the matching agent file when a workflow calls `agent(..., { agentType: 'operator' })`.

- `.claude/agents/operator.md` — implements specs. Two modes: (1) Plan mode (interactive, drafts specs with user), (2) Implement mode (spawned by workflow, runs in a git worktree). Handles both rig-bench specs (changes in the harness worktree) and project specs (changes inside a standalone repo under `projects/`).
- `.claude/agents/inspector.md` — read-only verifier. Checks out the feature branch, reads the spec's acceptance criteria, validates each criterion against the implementation diff, runs the spec's Verification step, and returns a structured PASS/FAIL verdict. Also performs drift detection: if the implementation introduces a major architectural shift not reflected in `memory/ARCHITECTURE.md` or `memory/RULES.md`, it emits a `MEMORY_DRIFT_WARNING:` line that the operator workflow intercepts.
- `.claude/agents/shipper.md` — ships a verified branch. Pushes the branch, opens a PR (draft for rig-bench specs, merge-ready for project specs), squash-merges it, and calls `scripts/archive-spec.sh` to record the spec under `memory/archive/`.

### `.claude/commands/`
Slash-command definitions invoked directly in the Claude Code REPL.

- `.claude/commands/plan.md` — `/plan <task>`: collaborative intent-capture and spec-drafting session. Enters plan mode, asks clarifying questions, drafts one or more specs with full frontmatter, and writes them to `specs/ready/` after user approval.
- `.claude/commands/execute.md` — `/execute [all | <id> ...]`: discovers ready specs and invokes `workflows/operator.js` for concurrent execution.
- `.claude/commands/verify.md` — `/verify [all | <id> ...]`: runs inspector agents against specs in `waiting_verification/`.

### `scripts/`
Bash and Node helper scripts used by agents at runtime.

- `scripts/build-structure-index.sh` — scans all source files and writes a structural index to `memory/structure.json`. Each entry records file path, type, exported symbols, and import paths (regex-based, JS/TS-aware). Uses `set -euo pipefail` and atomic temp-file writes for safety.
- `scripts/search-structure.sh` — queries `memory/structure.json` for case-insensitive substring matches across file paths, exports, and imports; returns the top 5 hits. Exits with error code 1 if the index is missing or empty.
- `scripts/bootstrap-git-history.sh` — extracts the last 50 commits (SHA, date, message, comma-separated changed files) and writes them to `memory/archive/git/index.json`. Uses Node.js for safe JSON construction.
- `scripts/search-git-history.sh` — searches `memory/archive/git/index.json` for commits matching a query string; provides a cache-friendly way to find recent commit context.
- `scripts/archive-spec.sh` — copies a finished spec from `specs/finished/` to `memory/archive/<id>/spec.md`, records the commit SHA to `memory/archive/<id>/commit.sha`, extracts id/title/tags from YAML frontmatter, and appends/updates an entry in `memory/archive/index.json`. Uses Node.js for safe JSON manipulation.
- `scripts/read-worktree-diff.sh` — prints the diff between the current branch and `main` (falls back to the previous commit if `main` does not exist), truncated to 10,000 lines. Used by the inspector as a cheap first pass before opening whole files.
- `scripts/read-file-summary.sh` — returns a cached file summary from `memory/archive/summaries/`, or falls back to raw file content on cache miss or stale hash.
- `scripts/write-file-summary.sh` — saves a file summary and current git blob hash to `memory/archive/summaries/`.

### `memory/`
The semantic memory vault for the harness itself.

- `memory/ARCHITECTURE.md` — this file; describes the harness structure.
- `memory/RULES.md` — coding conventions, naming rules, error-handling patterns, lifecycle constraints.
- `memory/PENDING_UPDATES.md` — staging area for drift warnings emitted by the inspector. The operator workflow spawns a Maintenance Agent to resolve each entry and then removes it.
- `memory/structure.json` — structural index produced by `scripts/build-structure-index.sh`.
- `memory/archive/` — immutable records of finished specs (`archive/<id>/spec.md`, `archive/<id>/commit.sha`), a searchable index (`archive/index.json`), and git history snapshots (`archive/git/index.json`).

### `projects/`
Each subdirectory is an independent git repository for a standalone project spec. The `projects/` directory itself is gitignored (only `.gitkeep` is tracked) to keep each project repo self-contained.

### `config/schemas/` / `lib/` / `hooks/` / `tests/`
Currently placeholder directories (`.gitkeep` only). All prior implementations have been stripped for clean-slate reimplementation. See `REMOVED.md` for the full record.

## Primary Control Flow

A spec moves through the harness via the operator workflow in this sequence:

1. **Discovery** — the workflow reads every `.md` in `specs/ready/`, parses YAML frontmatter, and builds a dependency wave graph using `depends_on` fields. Specs with no unsatisfied dependencies form the first wave; specs that depend only on first-wave specs form the second wave, and so on.

2. **PreFlight** — before any spec runs, the workflow invokes `scripts/build-structure-index.sh` to refresh `memory/structure.json` so agents navigate a current map.

3. **Execute** — each spec in a wave is assigned to an operator agent running in an isolated git worktree. The operator creates a feature branch, moves the spec to `specs/in_progress/`, implements all acceptance criteria, stages files explicitly, commits, moves the spec to `specs/waiting_verification/`, and returns a structured result. Complex specs (complexity: high, or touching 3+ files) receive `memory/RULES.md` and `memory/ARCHITECTURE.md` as context before execution.

4. **Checkpoint detection** — if the operator wrote `PROGRESS.md` to its branch (a context-exhaustion signal), the workflow spawns a fresh operator to resume from the `## Next` section, up to 3 times. On the third resume failure, the spec is marked failed.

5. **Verify** — an inspector agent checks out the feature branch, reads the spec from `specs/waiting_verification/`, validates each acceptance criterion against the implementation (first via `scripts/read-worktree-diff.sh`, then reading individual files if needed for clarity), runs the spec's Verification step, and checks for memory drift. Returns PASS or FAIL with per-criterion detail.

6. **Retry** — on a first FAIL, the workflow re-executes the spec from scratch on a new branch (named `{id}-retry`) and runs a second verification pass. A second FAIL marks the spec blocked.

7. **Ship** — on PASS, the shipper agent pushes the branch, opens a draft PR, squash-merges it, and calls `scripts/archive-spec.sh` to archive the spec.

8. **Archive** — the spec is copied to `memory/archive/<id>/spec.md`; the commit SHA is recorded in `memory/archive/<id>/commit.sha`; metadata is recorded in `memory/archive/index.json`.

9. **Drift resolution** — if the inspector emitted a `MEMORY_DRIFT_WARNING:` line (detected via regex in the summary field), the workflow appends it to `memory/PENDING_UPDATES.md` and spawns a Maintenance Agent to rewrite the affected memory file sections and remove the entry.

Spec authoring (the `/plan` command) is separate: it runs via the operator agent in plan mode (not spawned by the workflow), captures user intent, drafts specs with EARS-style acceptance criteria, performs file-conflict scanning, and writes approved specs to `specs/ready/` for the workflow to execute.

## External Integrations

- **GitHub CLI (`gh`)** — used by the shipper agent to create PRs (`gh pr create`), merge them (`gh pr merge --squash`), and (for project specs) create new GitHub repos (`gh repo create`).
- **Git** — used throughout for branching, committing, worktree isolation, and diff generation.
- **Node.js** — used in `scripts/archive-spec.sh` and `scripts/search-git-history.sh` for safe JSON manipulation. The package is `type: "module"` (ES modules).
- **AgentShield** — `.github/workflows/agentshield.yml` runs `npx ecc-agentshield scan --path .claude` on every PR to `main`, producing a security report as a build artifact (currently non-blocking via `continue-on-error`).
- **Claude Code API** — the harness is built entirely on the Claude Code `Workflow`, `agent()`, `pipeline()`, `phase()`, and `log()` primitives. Model assignments per agent: operator uses `sonnet`, inspector uses `sonnet`, shipper uses `haiku`; bootstrap architect uses `claude-sonnet-4-6` and bootstrap reviewer uses `claude-haiku-4-5-20251001`; memory maintenance agents also use `claude-haiku-4-5-20251001`.

## Key Files (Quick Reference)

| File | Responsibility |
|---|---|
| `workflows/operator.js` | Primary orchestration pipeline for spec execution |
| `workflows/bootstrap-memory.js` | One-shot memory generation workflow |
| `.claude/agents/operator.md` | Operator agent persona and implementation instructions |
| `.claude/agents/inspector.md` | Inspector agent persona and verification + drift-detection instructions |
| `.claude/agents/shipper.md` | Shipper agent persona and PR/merge instructions |
| `.claude/commands/plan.md` | `/plan` slash-command: collaborative spec authoring |
| `.claude/commands/execute.md` | `/execute` slash-command: trigger operator workflow |
| `.claude/commands/verify.md` | `/verify` slash-command: trigger inspector workflow |
| `specs/README.md` | Canonical spec format, lifecycle rules, frontmatter schema, EARS criteria guide |
| `scripts/build-structure-index.sh` | Generates `memory/structure.json` structural index |
| `scripts/archive-spec.sh` | Archives a finished spec into `memory/archive/` |
| `scripts/read-worktree-diff.sh` | Cheap branch diff for inspector verification |
| `scripts/bootstrap-git-history.sh` | Seeds `memory/archive/git/index.json` with recent commits |
| `memory/PENDING_UPDATES.md` | Staging queue for drift warnings awaiting Maintenance Agent resolution |
| `memory/archive/index.json` | Searchable index of all archived finished specs |
| `.claude/settings.json` | Harness permissions (all tools allowed; hooks block currently empty) |
| `.gitignore` | Excludes spec files, `projects/*`, telemetry dirs, hook state, vector DB |
| `REMOVED.md` | Historical record of all stripped subsystems and rationale |
