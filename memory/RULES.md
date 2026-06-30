# Rules

## Naming Conventions

### Spec Files
Spec files follow the pattern `{id}-{kebab-slug}.md` where `id` is a zero-padded four-digit integer (e.g. `0001`, `0015`). IDs are sequential and never reused — even if a spec is abandoned, its ID is retired. The slug is a kebab-case summary of the title. Example: `0007-git-history-search-tool.md`.

To find the next available ID, scan all lifecycle folders at once:
```bash
find specs -name "[0-9]*.md" | sort | tail -1
```
Never look in git history for IDs — spec files are gitignored and will not appear there. Never re-scan for IDs mid-session; allocate all IDs needed for a planning pass from a single read to avoid collisions when drafting multiple specs simultaneously.

### Branches
Feature branches are named after the spec they implement: `{id}-{kebab-slug}`. For example, `0001-memory-directory-structure`. This mirrors the spec filename exactly (minus the `.md` extension), making it trivial to locate the spec from a branch name. Retry branches append `-retry`: e.g. `0001-memory-directory-structure-retry`.

### Commits
Commit messages follow the Conventional Commits pattern with a spec ID scope:
- `feat({id}): {title}` — for spec implementation commits
- `chore({id}): pre-ship cleanup` — for uncommitted-change commits before shipping
- `checkpoint: progress snapshot` — for mid-execution PROGRESS.md commits

Example: `feat(0007): git history search tool`

### Agent Tool Labels
When agents call `agent()` or `pipeline()`, the `label` field uses the pattern `{action}:{spec-id}` or `{role}:{action}`. Examples: `exec:0007`, `verify:0007`, `preflight:structure-index`, `memory-context:0007`, `maintenance:drift`.

### Memory Archive Paths
Archived specs live at `memory/archive/{id}/spec.md` (the spec file) and `memory/archive/{id}/commit.sha` (the SHA of the last commit that touched the spec). The git history index lives at `memory/archive/git/index.json`. The spec archive index lives at `memory/archive/index.json`.

## File Organization Rules

### Where New Specs Go
New specs are always written to `specs/ready/{id}-{slug}.md` after user approval. The `specs/draft/` folder is the correct destination only for specs that still contain `[NEEDS CLARIFICATION]` markers or otherwise are not yet approved. Specs must never be written before the user approves the plan.

### Where New Workflows Go
New orchestration scripts go in `workflows/` as ES-module `.js` files. Each must export a `meta` object with `name`, `description`, and a `phases` array. The file should use only the `agent()`, `pipeline()`, `phase()`, and `log()` primitives provided by the Claude Code harness.

### Where New Agent Definitions Go
New subagent personas go in `.claude/agents/{name}.md` with YAML frontmatter specifying `name`, `description`, `model`, `tools`, and `isolation`. Agent files are the single source of truth for agent behavior; no agent logic should be duplicated into workflow scripts.

### Where New Commands Go
New slash-command definitions go in `.claude/commands/{name}.md` with a YAML frontmatter block containing at minimum a `description` field.

### Where New Scripts Go
Utility scripts (Bash or Node) used by agents at runtime go in `scripts/`. Scripts must be runnable from the repo root without arguments (or with clearly documented arguments). Use `set -euo pipefail` in all Bash scripts.

### Where Project Code Goes
Each standalone project lives in `projects/{name}/` as its own independent git repository (its own `.git`). The `projects/` directory is gitignored except for `.gitkeep`. Project code must never be committed into the rig-bench worktree.

### Memory Files
The `memory/` directory holds semantic knowledge about the harness:
- `memory/ARCHITECTURE.md` — structural description (this repo's purpose, modules, data flow, key files, external integrations)
- `memory/RULES.md` — conventions and constraints (this file)
- `memory/PENDING_UPDATES.md` — transient drift warning queue; should never accumulate stale entries
- `memory/structure.json` — machine-generated structural index; regenerate with `scripts/build-structure-index.sh`
- `memory/archive/` — immutable records; never edit archive entries directly

## Error Handling Patterns

### Workflow-Level Error Handling
The operator workflow uses structured return values from every agent call. If an `agent()` call returns `null` or an object with `status: 'failed'`, the workflow propagates failure without throwing: `failVerify(spec_id, reason)` constructs a synthetic FAIL result so the pipeline can continue with other specs in the same wave. Errors are accumulated in `errors[]` arrays on result objects rather than thrown as exceptions.

### Checkpoint Pattern (Context Exhaustion)
When an operator agent runs low on context (more than 30 tool calls or self-assessed context pressure), it writes a `PROGRESS.md` checkpoint file to the worktree root with `## Done` and `## Next` sections, commits it, and returns `status: 'completed'`. The workflow detects the presence of `PROGRESS.md` on the branch and spawns a fresh operator agent to resume. This retry is capped at 3 resume attempts per spec; exceeding the cap appends `'checkpoint_resume_limit'` to the spec's errors array and marks it failed.

### Spec Retry Pattern
A spec that fails first-time verification is retried exactly once: the workflow re-executes it from scratch on a new branch (`{id}-retry`) and runs a second verification pass. A second FAIL marks the spec `blocked`. There is no third attempt.

### Git Safety in Scripts
All Bash scripts use `set -euo pipefail` so any unexpected command failure aborts the script immediately rather than silently continuing. Scripts that write to final output paths use a `mktemp` temp file plus atomic `mv` to avoid partial writes. The `trap cleanup EXIT` pattern ensures temp files are cleaned up even on failure.

### Missing Index Files
Scripts that search `memory/structure.json` or `memory/archive/git/index.json` exit with a human-readable error message and exit code 1 when the index is absent, directing the caller to run the appropriate bootstrap script first. They never silently return empty results.

### Drift Handling
If the inspector emits a `MEMORY_DRIFT_WARNING:` line in its summary field, the operator workflow detects it via regex match and intercepts it. The workflow appends it to `memory/PENDING_UPDATES.md` and immediately spawns a Maintenance Agent (using `claude-haiku-4-5-20251001` model) to read `memory/ARCHITECTURE.md` and `memory/RULES.md`, analyze the warning, rewrite the outdated sections to reflect the architectural change, and then remove the entry from `memory/PENDING_UPDATES.md`. The `MEMORY_DRIFT_WARNING:` prefix must be reproduced exactly (no variation in casing, spacing, or punctuation) because the operator workflow parses for this exact string via regex.

## Spec Authoring Constraints

### Ambiguity Gate
A spec must not move from `draft` to `ready` while any `[NEEDS CLARIFICATION: ...]` marker remains unresolved. Every criterion must be answerable by the operator agent without ambiguity.

### Acceptance Criteria Format
All acceptance criteria must be written in EARS (Easy Approach to Requirements Syntax) format:
- Ubiquitous: `The <component> shall <behavior>.`
- Event-driven: `When <trigger>, the <component> shall <behavior>.`
- Unwanted behavior: `If <condition>, then the <component> shall <behavior>.`

One criterion = one sentence = one checkable thing. If a criterion needs "and" to join two unrelated behaviors, it must be split into two criteria.

### File-Conflict Gate
Before a batch of specs is approved as ready, a conflict scan must be performed across all `## Files / Interfaces Touched` sections. Any file that appears in two or more specs must cause the later spec to list the earlier spec's ID in its `depends_on`. This enforces serial execution for specs that share a file, preventing merge conflicts in concurrent worktrees. The three most commonly shared files are `.claude/agents/operator.md`, `workflows/operator.js`, and any file under `memory/`.

### Verification Requirement
Every spec must include a `## Verification` section with a concrete, end-to-end check (a named test, a command with expected output, or an explicit manual step). A spec without a verification step cannot be considered ready.

## Implementation Constraints

### Staging Files
Agents must always stage files explicitly by naming them: `git add {file1} {file2}`. Using `git add .` or `git add -A` is prohibited because it may accidentally include unintended files such as `.env`, secrets, or generated artifacts.

### Worktree Isolation
Each spec executes in its own git worktree. Operator and inspector agents must not interact with other specs' worktrees. The shipper agent returns to `main` after merging and syncs with `git pull origin main`.

### Never Push to Main Directly
All changes must go through a PR. The shipper never pushes commits directly to `main`; it always creates a PR and squash-merges it via `gh pr merge --squash`.

### Complexity Classification
The operator workflow classifies each spec as `simple` or `complex` before execution (using the `classifySpec()` function in `workflows/operator.js`):
- `complexity: low` in frontmatter → simple (no memory context injected)
- `complexity: high` in frontmatter → complex (memory context injected)
- No `complexity` field, `files_to_modify_count` has fewer than 3 entries → simple
- No `complexity` field, `files_to_modify_count` has 3 or more entries → complex
- Neither field present → complex (conservative default)

Complex specs receive the full content of `memory/RULES.md` and `memory/ARCHITECTURE.md` as context before execution. Context is delivered as a `## Memory Context` section with subsections for each file.

## Gitignore Constraints

The following are gitignored and must never be committed:
- `.claude/bash.log`, `.claude/hooks.log` — runtime logs
- `.claude/hook-cache/`, `.claude/hook-state/`, `.claude/session-state/` — transient runtime state and hooks
- `.claude/agent-telemetry.json` — telemetry (stripped subsystem)
- `.claude/instincts/` — removed instinct system
- `.claude/memory-vectors.db` and related `*-*` files — removed vector memory store
- `telemetry/runs/` — removed telemetry system
- `todo.md` — personal task list, not versioned
- `node_modules/` — dependencies
- `memory-archive/` — old memory path (superseded by `memory/archive/`)
- `specs/*.md` and `specs/*/*.md` — all spec files (only `specs/README.md` is tracked via negation rule `!specs/README.md`)
- `projects/*` except `projects/.gitkeep` — project repos are self-contained and not tracked here
- `research/` — removed research system

## Testing Conventions

The `tests/` directory currently holds only a `.gitkeep` placeholder — all tests were removed as part of the clean-slate reset (see `REMOVED.md`). When tests are re-added, they should be placed in `tests/` as JavaScript test files. The package is `type: "module"`, so test files must use ES module syntax.

Each spec's `## Verification` section is the primary test contract for agent-implemented features. The inspector agent runs the verification step as part of its pass/fail determination.

## Settings and Permissions

`.claude/settings.json` grants the following tool permissions by default (no prompts): `Bash`, `Write`, `Edit`, `Glob`, `Grep`, `Read`, `NotebookEdit`, `WebFetch`, `WebSearch`, and `Command(plan)`. The hooks block is empty — all previously registered hooks have been stripped. Default mode is `"auto"` (user is prompted for any tools not explicitly in the allow list).

## CI / Security

The AgentShield security scan (`.github/workflows/agentshield.yml`) runs automatically on every PR targeting `main`. It scans the `.claude/` directory using `npx ecc-agentshield scan`. The job is currently `continue-on-error: true` (non-blocking) until false-positive rates are understood for this repo's pattern. The report is uploaded as a build artifact named `agentshield-report`.
