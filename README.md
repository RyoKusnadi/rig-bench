# rig-bench

A production-grade multi-agent harness for AI-driven software engineering. Provides specialized agents, deterministic workflows, quality gates, and a memory system — all running on top of Claude Code.

---

## What It Is

**rig-bench** wires Claude Code into a structured engineering pipeline. Instead of one model doing everything, it routes work through two focused specialists — `operator` (build) and `inspector` (adversarial review) — in a fixed sequence, with a third, minimal `scout` agent running deterministic discovery/gate checks (never judgment) ahead of both. Control flow and retry logic live in JavaScript — not inside a model's judgment.

**Core properties:**
- Deterministic pipelines — same input, same agent sequence, every time
- Quality gates with capped retries (2 max per stage); escalates to human on failure
- Zero-retry hard stops for secrets (`SECRET_FOUND`) and critical CVEs (`CRITICAL_CVE`)
- Dual-layer read-only enforcement (runtime `disallowedTools` + model-layer prose)
- Full audit trail (`.claude/bash.log`) of every Bash command run by any agent

---

## Repository Layout

```
rig-bench/
├── subagents/       # 4 specialized agent definitions (.md with YAML frontmatter) — "Lean 2" roster + scout (mechanical-only, no judgment work — see workflows/README.md "Declined") + researcher (questionnaire-driven research loop, todo.md "Ralph Loop" Phase 1)
├── workflows/       # 8 deterministic state-machine pipelines (.js orchestration scripts)
├── config/
│   ├── model-tiers.json    # Tier registry: frontier/standard/economy → model ID, max_tokens, temperature
│   └── schemas/             # Canonical JSON Schemas for operator/inspector output (direct-invocation path)
├── lib/
│   ├── schema-validator.mjs # Zero-dependency validator for the direct/manual invocation path
│   ├── pipeline-state.mjs   # Canonical pipeline_state shape/merge logic (documented reference — see below)
│   └── memory-store.mjs     # Local TF-IDF vector store (better-sqlite3) for .claude/memory/ + memory/
├── scripts/
│   ├── report.mjs           # Reads telemetry/runs/*.jsonl, prints cost/escalation/outcome stats
│   ├── ingest-memory.mjs    # Chunks .claude/memory/+memory/ markdown into the vector store
│   ├── query-memory.mjs     # CLI agents run via Bash for top-K relevant memory chunks
│   └── prune-memory.mjs     # Archives stale (30d+ unused) vectors, never deletes
├── hooks/           # Git/Claude Code safety + lifecycle hooks (.mjs, Node.js — cross-platform)
├── memory/          # Portable cross-project context (personas, projects, knowledge)
├── telemetry/runs/  # Gitignored — per-run JSONL written by hooks/telemetry-writer.mjs
├── package.json     # Local tooling only (better-sqlite3) — never a runtime dep of workflows/*.js
└── .claude/         # Project-level settings, commands, and codebase memory
    ├── settings.json         # Hook wiring (SessionStart / PreToolUse / PostToolUse / Stop / PreCompact)
    ├── settings.local.json   # Permissions allowlist
    ├── commands/             # Custom slash commands (/ship, /audit, /review, /evolve)
    ├── memory/               # Codebase facts (conventions, architecture, gotchas)
    └── memory-vectors.db     # Gitignored — sqlite vector store, regenerable via `npm run memory:ingest`
```

---

## Agents

Each agent is a single `.md` file with YAML frontmatter declaring its model, tool permissions, and completion signal contract. See [subagents/README.md](subagents/README.md) for the full breakdown.

| Agent | Role | Default tier | Permission |
|---|---|---|---|
| `operator` | Plans, implements (TDD), tests, self-verifies, refactors, diagnoses bugs, writes docs/CHANGELOG, ships (commit + draft PR), and (TUNE mode) mutates/commits/reverts one mutation in the `autotune` loop | `standard` (Sonnet) | manual |
| `inspector` | Read-only adversarial review in one pass: secrets (SEC-4), OWASP/STRIDE, dependency/CVE audit, two-pass code quality (low / medium / high / maximum effort); also (EVALUATE mode) defines/scores binary criteria for the `autotune` loop, blind to the mutation rationale | `standard` (Sonnet) | semi-auto |
| `researcher` | One step of a questionnaire-seeded research loop: search, extract candidate facts, verify each against a primary source — never decides confidence or loop exit (`lib/research-state.mjs` does); also synthesizes the final report from verified facts only, run at `frontier` tier | `standard` (Sonnet) for the loop, `frontier` (Opus) for synthesis | semi-auto |

Each agent's frontmatter declares a `model_tier` (`frontier`/`standard`/`economy`), not a hardcoded model ID — see [Model Tier Registry & Routing](#model-tier-registry--routing) below for how the actual model gets resolved per call.

Both agents are spawned with zero pre-loaded file context — they `Grep` for the
modules/symbols the task names and `Read` only what that turns up, instead of
expecting the orchestrator to paste the codebase into the prompt. See the
"Context isolation" section at the top of each agent's `.md` file.

This collapses what used to be a 15-agent roster (orchestrator, planner, developer, test-writer, refactorer, code-reviewer, security-reviewer, secret-scanner, dependency-auditor, verifier, debugger, docs-writer, git-assistant, changelog-writer, memory-manager) into two agents that each do their combined job in a single spawn — see `todo.md` for the rationale (spawn-tax reduction). A third agent, `scout`, was added later — it's a deliberate, narrow exception (see the `memory-manager` "Not built" note further down): mechanical command-running only, zero judgment surface, so it doesn't reintroduce the reviewer-sprawl this consolidation guards against. A fourth, `researcher` (`todo.md` "Ralph Loop"), is a second deliberate exception, on different grounds: it's not a reviewer competing with `inspector`'s role, it's a genuinely distinct job (iterative web research, not build/review) that neither `operator` nor `inspector` is scoped for. Per-call loop control, confidence scoring, and state merging stay in JavaScript (`lib/research-state.mjs`) — `researcher` only does the search-and-verify step itself, the same separation of judgment-vs-control already used for `operator`/`inspector`.

### Agent Communication Protocol

Every agent emits two structured blocks on completion:

```xml
<task-notification>
  verdict: PASS | BLOCK | ESCALATE
  pipeline-gate: PASS | BLOCK | ESCALATE
  findings:
    - severity: CRITICAL | HIGH | MEDIUM | LOW
      file: path/to/file.go
      line: 42
      message: "description"
</task-notification>
```

```yaml
## HANDOFF
findings:
  - file:line — description
```

The calling workflow parses `pipeline-gate` to decide: advance → retry → escalate. It never pipes raw text between agents — it extracts and re-structures findings before passing them downstream.

---

## Workflows

Eight deterministic pipelines. Arguments are passed as structured objects; all gate logic is in JavaScript.

### 1. `new-feature` — Full Feature Delivery

```
┌─────────────────────────────────────────────────────────────────────┐
│  BUILD                                                                │
│  operator ──► load memory → plan → TDD implement → self-verify       │
│              → local commit                                         │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INSPECT  (retry ≤ 1)                                                 │
│  inspector ──► secrets + OWASP/STRIDE + deps + quality, one pass     │
│              ESCALATE (secret/critical) ──► STOP, zero retries       │
│              BLOCK ──► operator fixes ──► re-inspect                 │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SHIP                                                                 │
│  operator ──► push → draft PR → save lessons to .claude/memory/      │
└─────────────────────────────────────────────────────────────────────┘
```

**Args:** `task` (string), `effort` (low|medium|high|maximum — inspector's effort), `branch` (optional)

---

### 2. `bug-fix` — Diagnosis to PR

```
┌──────────────────────────────────────────────────────────────┐
│  FIX                                                          │
│  operator ──► load memory → diagnose (unless known_cause)     │
│              → regression test FIRST → minimal fix → commit   │
└────────────────────┬─────────────────────────────────────────┘
                     │ PASS
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  INSPECT  (retry ≤ 1)                                         │
│  inspector ──► bug resolved + no adjacent regressions         │
│              + no security/dependency issues introduced       │
└────────────────────┬─────────────────────────────────────────┘
                     │ PASS
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  SHIP                                                         │
│  operator ──► push → draft PR ("Closes #<issue>")             │
│              → save root cause + fix to .claude/memory/       │
└──────────────────────────────────────────────────────────────┘
```

**Args:** `bug` (string), `known_cause` (boolean), `stack_trace` (optional)

---

### 3. `refactor` — Restructuring with Test Baseline

```
operator ──► confirm test baseline → smell-by-smell refactor, test after each
    │               │
    │           NO_TESTS ──► block until a BUILD-mode run adds tests first
    │
    ▼  (retry ≤ 1)
inspector ──► behavior unchanged + quality improved? ──► BLOCK → operator fixes
    │ PASS
    ▼
operator (SHIP) ──► Draft PR → save outcome to .claude/memory/
```

**Args:** `target` (module/file path), `goal` (string describing what to clean up)

---

### 4. `pr-review` — Single-Pass Review

```
inspector ──► secrets (SEC-4) → OWASP/STRIDE → dependency/CVE audit
              → two-pass code quality (+ spec compliance if `spec` given)
    │
    ▼
Return: overall_gate, blocking_count, merged_findings
```

One agent now covers what used to be 3 parallel reviewers + a synthesis step — inspector reads the diff once and runs all four passes in the same context.

**Args:** `pr_number` or `diff` (string), `effort` (optional), `spec` (optional — enables spec-compliance check)

---

### 5. `docs-update` — Documentation Sync

```
operator (DOCS) ──► update README / CLAUDE.md / docstrings / CHANGELOG,
                    verify examples compile → commit
    │
    ▼
inspector ──► light review (secrets, no stray code changes)
    │
    ▼
operator (SHIP) ──► Draft PR
```

**Args:** `trigger` (what changed that requires docs update)

---

### 6. `release-prep` — Pre-Release Gate

```
inspector (effort=maximum) ──► full secret scan + dependency/CVE audit
              │
    ESCALATION / CRITICAL_CVE? ──► STOP
              │ PASS / hygiene flags
              ▼
operator (SHIP, release mode)
    ├── validate all commits follow conventional commits
    ├── move [Unreleased] entries to [version] in CHANGELOG.md
    └── create Release PR → save dep verdict + PR reference to .claude/memory/
```

**Args:** `version` (e.g. `v1.2.0`)

---

### 7. `research` — Questionnaire-Driven Research Loop

```
researcher (RESEARCH) ──► search, extract, self-verify one round
              │
   confidence_score < validation_threshold
   && iteration_count < max_iterations? ──► loop
              │ no (threshold cleared, or max_iterations hit)
              ▼
researcher (SYNTHESIZE, frontier) ──► report from verified facts only
              ▼
Return: research_state + report ({frontmatter, body_markdown}, or null if synthesis BLOCKed)
```

No `scout` stage (no code/build/lint to gate). `confidence_score` is computed
deterministically by the workflow script after every iteration, never
self-reported by `researcher` — see
[workflows/README.md](workflows/README.md#researchjs). The caller (e.g. the
`/research` command) is responsible for stamping `generated_at` and writing
`report` to `research/{topic}/TITLE.MD`, since workflow scripts have no
filesystem access or real clock.

**Args:** `intake` (object — parsed `research/{topic}/intake.json`, produced by `node scripts/ask-questionnaire.mjs`)

---

### 8. `autotune` — Self-Improvement Loop

```
inspector (EVALUATE/DEFINE_CRITERIA) ──► binary criteria + test cases
              ▼
inspector (EVALUATE/SCORE) ──► baseline
              ▼
operator (TUNE/MUTATE) ──► scout (VALIDATE_AGENT_FILE) ─ BLOCK ──► operator (REVERT)
              │ PASS
              ▼
inspector (EVALUATE/SCORE, blind to rationale) ─ regressed ──► operator (REVERT)
              │ improved/equal
              ▼
operator (TUNE/COMMIT, local only) ──► loop until 3 perfect scores or max_iterations
```

A Karpathy-[autoresearch](https://github.com/karpathy/autoresearch)-style
mutate→measure→keep/discard loop, applied to this repo's own agent prompts
instead of adding a 5th/6th agent for it — see
[workflows/README.md](workflows/README.md#autotunejs) for why `operator`/
`inspector`/`scout` each got a new mode instead. v1 only allows mutating
`scout.md`/`researcher.md` — `operator.md`/`inspector.md` are excluded since
they ARE the mutator/evaluator here.

**Args:** `target` (`subagents/scout/scout.md` or `subagents/researcher/researcher.md`), `objective` (string)

---

## Model Tier Registry & Routing

`config/model-tiers.json` is the single source of truth mapping each tier to
a model ID, `max_tokens`, `temperature`, and a `use_cases` note:

| Tier | Model | Used for |
|---|---|---|
| `economy` | Haiku 4.5 | SHIP-mode pre-flight/PR formatting, DOCS mode, low-effort review — no design or security judgment involved |
| `standard` | Sonnet 4.6 | BUILD/REFACTOR implementation, medium/high-effort review — each agent's default tier |
| `frontier` | Opus 4.8 | Pre-release audit (`release-prep`'s Audit stage, always), and the escalation target when a `standard`-tier call BLOCKs for a complexity-related reason |

Workflow scripts can't `require()` this file at runtime (no filesystem
access — see "Token Telemetry" below), so each `workflows/*.js` embeds a
`TIER_MODELS` constant mirroring it. Keep both in sync if a tier's model ID
changes.

**Per-state escalation policy:** every state in a workflow's `ESCALATION_POLICY`
declares a `default_tier` and `escalation_tier`. The first attempt always
uses `default_tier`; if that call returns `pipeline_gate: BLOCK` for a
complexity-related reason (matched against the result's `summary` — "too
many files", "ambiguous", "complex", "architect…"), the workflow retries once
at `escalation_tier` before treating it as a real block. A `PASS` or
`ESCALATE` result never triggers escalation — only an ambiguous `BLOCK` does.
Every escalation is recorded in the run's `escalations` array (see Token
Telemetry below).

**`force_tier` override:** pass `args.tier` (`frontier`/`standard`/`economy`)
to any workflow to skip the escalation ladder entirely and pin every stage in
that run to one tier — useful for a critical task where you want maximum
quality on the first attempt, or for a trivial one where economy is enough
end to end. `release-prep`'s Audit stage ignores `force_tier` (always
`frontier`) since downgrading the pre-release secret/CVE gate defeats its
purpose.

`inspector`'s single-pass review (secrets + OWASP/STRIDE + deps + quality in
one spawn) deliberately is **not** split across models per dimension — doing
so would mean splitting that pass back into multiple spawns, undoing the
spawn-tax reduction the Lean 2 roster was built for. See "Model routing per
call" in [workflows/README.md](workflows/README.md) for the full rationale.

---

## Token Telemetry

Every `agent()` call in all six workflows is wrapped to record a token delta
via `budget.spent()` (the Workflow tool's real, documented token-accounting
API) before and after the call, and every return path — success, `BLOCKED`,
or `FAILED` — includes a `token_telemetry: [{label, tokens}, ...]` array and
an `escalations: [{state, from, to, reason}, ...]` array in its result.
**Workflow scripts have no filesystem access**, so they can't write a log
file directly — the return value is the only place this data can go from
inside the script.

`hooks/telemetry-writer.mjs` (PostToolUse, matcher `Workflow`) is what
actually persists it: it has real fs access, reads the Workflow tool's
`tool_response` after every run, and appends one JSON line per `token_telemetry`
entry plus one per escalation plus a `run_summary` line to
`telemetry/runs/{timestamp}-{workflow}.jsonl` (gitignored — session-local,
same treatment as `.claude/bash.log`). `scripts/report.mjs` reads every file
under `telemetry/runs/` and prints: average output-token cost per workflow
type, the top stages by token consumption, escalation frequency per state,
and an outcome breakdown — run it with `node scripts/report.mjs`.

This is **not** a reintroduction of the `claude -p`-headless-CLI-driving
`eval-harness/` infrastructure a previous revision of this repo removed at
explicit request — there's no scripted CLI driving Claude Code here, just a
hook reading the harness's own already-emitted tool results and a report
script reading flat JSON files it wrote. The honesty caveat: `tokens` is an
output-token delta from `budget.spent()` — the only signal the Workflow
tool's API exposes to a script. There's no `input_tokens`/`cache_read_tokens`/
`cache_creation_tokens` breakdown available at this layer, so
`telemetry-writer.mjs` doesn't fabricate those fields.

We still did not implement hard, JS-enforced token budgets that forcefully
terminate an over-budget `agent()` call mid-execution — there's no such
primitive in the Workflow tool's `agent()` API (no timeout/max-tokens
parameter, no kill switch once a call is in flight). Each workflow's
`MAX_TOKEN_BUDGET` constant is a **soft, checkpoint-based** guard instead: it's
checked after each stage completes (via `budget.spent()`), and forces a
`FAILED` outcome with "Token budget exceeded. Manual review required." if
exceeded — it can't interrupt a call that's already in flight. `inspector`
also self-enforces a tool-call budget per effort mode (see Step 1 of
`inspector.md`); `operator` has an equivalent soft, self-monitored budget for
BUILD/REFACTOR tasks (see "Self-monitored tool-call budget" in `operator.md`).
All three are honor-system/checkpoint guardrails, not something that can
forcibly cut off a call already running.

---

## Quality Gates

| Verdict | Stage | Action | Retries |
|---|---|---|---|
| `SECRET_FOUND` / `ESCALATION` | inspector | Hard stop — human rotates credential | 0 |
| `CRITICAL_CVE` | inspector | Release blocked — fix CVE first | 0 |
| `CRITICAL_BLOCK` | inspector | Hand off to operator for fixes | ≤ 1 |
| `NO_TESTS` | operator (REFACTOR mode) | Procedural block — run BUILD mode to add tests first | N/A |
| Any gate after 1 retry | any | Escalate to human with full attempt history | — |
| Missing `<task-notification>` | any | Treated as BLOCK — malformed responses fail safe | — |
| `MAX_TOKEN_BUDGET` exceeded (checked after each stage) | any | `FAILED` — "Token budget exceeded. Manual review required." | — |

---

## Hook System

Seven hooks intercept tool calls and session lifecycle events Claude Code makes.
All hooks are plain Node.js (`.mjs`, no dependencies) rather than Bash — Bash
hooks throw pathing/quoting errors on native Windows (PowerShell has no `bash`
on PATH by default), while Node ships wherever Claude Code itself runs. (This
repo's own dev environment is macOS — the cross-platform claim rests on using
only `node:fs`/`node:path`/`node:child_process` and avoiding hardcoded `/`
path joins, not on having run a Windows test pass; there's no hands-on
Windows/Linux verification to report here.)

Shared stdin/repo-root/logging/caching helpers live in
`hooks/lib/hook-utils.mjs`. Every hook is wrapped in `runHook()`, which:
- Fails open (exit 0) on any uncaught exception, so a bug in the hook itself
  never blocks the agent — it logs the error and a `console.error` warning
  instead of crashing the tool call.
- Writes one structured JSON line per invocation to `.claude/hooks.log`
  (`timestamp`, `hook`, `event`, `tool`, `exit_code`, `duration_ms`,
  `decision`), and warns on stderr if a hook takes >500ms.
- Honors `RIGBENCH_DISABLED_HOOKS` (comma-separated hook names) to skip a
  hook entirely — e.g. `RIGBENCH_DISABLED_HOOKS=read-budget,auto-run-tests`.

`PreToolUse: Bash` and `PostToolUse: Bash` each run a single consolidated
hook rather than two separate processes — `pre-bash-safety.mjs` (branch
safety + generic destructive-command blocking) and `post-bash-processor.mjs`
(audit log + verbose-output summarization) — since both halves fire on
*every* Bash call. One Node process per event instead of two halves the
spawn overhead on the hottest path in the harness.

`RIGBENCH_HOOK_PROFILE` (`minimal` | `standard` | `strict`, default
`standard`) scales `pre-bash-safety.mjs`'s check set:

| Profile | Checks |
|---|---|
| `minimal` | Git branch safety only (push-to-main, force-push, `reset --hard`) |
| `standard` | + generic destructive-command blocking (default — this is everything described below) |
| `strict` | + blocks `git add .`/`git add -A` and `--no-verify` |

### `hooks/session-start.mjs` (SessionStart)

Runs **before the user's first prompt** of every session. Closes the loop the
other two lifecycle hooks open: `evaluate-session.mjs` (Stop) writes instincts
and `pre-compact.mjs` (PreCompact) snapshots in-flight task state, but neither
fires again to put that information back in front of the model. This hook
injects, as `additionalContext`:

1. The top 3 pending instincts by `occurrences` from `.claude/instincts/pending/`
   (with a pointer to `/evolve` once any of them recur enough to promote).
2. The last `PreCompact` snapshot (`.claude/session-state/compact.json`), if one
   exists — branch, diff stat, active files, last test result, and the last
   user message before compaction.
3. `.claude/memory/MEMORY.md`, so a plain conversational turn (no agent
   dispatch) still sees the project memory index.

Total injected context is capped at `RIGBENCH_SESSION_START_MAX_CHARS`
(default 8000) — sections are dropped lowest-priority-first (memory index,
then resumed context, then instincts) until it fits, with a warning logged
if truncation happened.

**Deliberately not task-type-aware** (e.g. "load `gotchas.md` for bug-fix,
`conventions.md` for new-feature"): `SessionStart` fires before the user's
first prompt, so there's no workflow/task signal yet to filter on. That kind
of task-aware retrieval already happens correctly elsewhere — `operator.md`
Step 0 greps `.claude/memory/` for keywords from the actual task once it's
known. Duplicating that here would just be a second, out-of-sync mechanism
for the same job.

Always exits 0 — this hook only adds context, it never blocks a session from starting.

### `hooks/pre-bash-safety.mjs` (PreToolUse)

Runs **before** every Bash tool use (merges what used to be two separate hooks,
`branch-safety.mjs` + `block-dangerous-commands.mjs`). Blocks:
- Direct push to default branch (`main` / `master`)
- Force push (`--force`, `--force-with-lease`, `-f`)
- `git reset --hard` (destructive — user must run manually)
- `rm -rf` against `/`, `~`, or `.`; fork bombs; `dd`/`mkfs` against block
  devices; recursive `chmod 777 /`; redirecting into a raw block device;
  piping a downloaded script straight into a shell (`curl ... | sh`); mass
  working-tree wipes (`git clean -fd`, `git checkout -- .`)

Resolving the default branch name (for the push check) calls `git remote
show origin`, which hits the network — that result is cached for 1 hour in
`.claude/hook-cache/default-branch.json` via the shared `cached()` helper, so
a flurry of `git push` attempts in one session doesn't re-pay that cost every
time (first call: ~3s cold; cached calls: ~0ms).

Exit 0 = allow. Exit 2 = block with message shown to the model.

```
Claude issues Bash("git push origin main")
    │
    ▼
pre-bash-safety.mjs reads stdin JSON
    │
    ├── not Bash, or no blocked pattern matched? ──► exit 0 (allow)
    └── push to main / force push / destructive pattern ──► exit 2 (BLOCKED, message shown)
```

### `hooks/post-bash-processor.mjs` (PostToolUse)

Runs **after** every Bash tool use (merges what used to be two separate hooks,
`log-bash.mjs` + `summarize-cli-output.mjs`). Always appends an audit-trail
line to `.claude/bash.log`:

```
[2026-06-16 14:23:01] exit=0 cmd=go test ./...
[2026-06-16 14:23:08] exit=1 cmd=go build ./cmd/server
```

Then, if the command matches a known verbose tool (`npm audit`, `go test`,
`golangci-lint`, `pytest`, `cargo audit`, `pip-audit`, `govulncheck`), greps
the already-returned output for counts and the first failure, and prints a
condensed JSON pointer alongside it. **Limitation — by design, not a bug to
fix:** Claude Code's `PostToolUse` hook contract has no field to override or
shrink the Bash tool's own returned `stdout`; `additionalContext` only adds
to what the model sees, it never replaces it. So a hook can't truncate a
5,000-line `go test`/`npm audit` transcript after the fact — the only real
lever is the command invocation itself. See "Token-conscious command
invocation" in `subagents/operator/operator.md` and Step 3 of
`subagents/inspector/inspector.md` for where that's actually enforced
(quiet-by-default test flags, `head -N`/`--json` on every static-analysis
and dependency-audit command).

### `hooks/auto-run-tests.mjs` (PostToolUse)

Runs **after** every Write/Edit to a `.go`/`.ts`/`.tsx`/`.js`/`.jsx`/`.py` file. Walks
up to the nearest `go.mod`/`package.json`/`pyproject.toml`/`setup.py`, runs a scoped
test command for that file (`timeout 30`), and emits a compact JSON summary —
`{"status":"pass","tool":"go test","exit_code":0,"summary":"ok ...","first_error":""}`
— as supplementary hook feedback. Exits silently (no test config found, or the file
extension isn't covered) rather than nagging on every doc/config edit. This is the
`auto-run-tests` hook from `todo.md` Phase 2 — it doesn't replace the standalone
verifier step (that's now part of `operator`'s self-verification gate), it just adds a
fast, cheap pass/fail signal right after a file changes. Also persists the
rolling last 3 results to `.claude/session-state/last-test-results.json`, so
`pre-compact.mjs` can fold recent test history into its compaction snapshot.

### `hooks/telemetry-writer.mjs` (PostToolUse, matcher: `Workflow`)

Runs **after** every `Workflow` tool call. Reads the workflow's own
`token_telemetry`/`escalations`/`outcome` fields off `tool_response` and
appends them as JSONL to `telemetry/runs/{timestamp}-{workflow}.jsonl` —
see "Token Telemetry" above for why this lives in a hook (real fs access)
rather than the workflow script itself (none). No-ops if `tool_name` isn't
`Workflow` or the result doesn't look like a workflow return value. Always
exits 0 — this hook is purely observational.

### `hooks/read-budget.mjs` (PreToolUse, matcher: `Read`)

Runs **before** every `Read` tool call. Tracks how many files the current
session has read (`session_id` → count, plus a capped recent-files list) in
`.claude/agent-telemetry.json`, and blocks once a session exceeds
`RIGBENCH_MAX_READS` (default **50** — the threshold from todo.md's "Context
Isolation Enforcement" target). Reading more than ~50 files via the `Read`
tool in one session usually means an agent gave up on `Grep`-based retrieval
and started loading the repo wholesale — the block message tells it to
narrow scope with `Grep` instead, or raise `RIGBENCH_MAX_READS` if the task
genuinely needs that much.

**Caveat — this is a budget guardrail, not a security boundary.** It only
sees `Read` calls that pass through a session with this hook wired into its
`settings.json`; it can't observe or enforce anything for a session that
doesn't have it configured. It also can't distinguish "one agent reading 51
different files" from "many short-lived subagents sharing one `session_id`"
without inspecting how Claude Code scopes that field per spawn — if it turns
out subagents inherit the parent's `session_id`, this budget is shared across
an entire workflow run (operator + inspector combined) rather than per-agent;
if each spawn gets its own `session_id`, it's naturally per-agent. Tune
`RIGBENCH_MAX_READS` per project if the default doesn't fit.

### `hooks/evaluate-session.mjs` (Stop)

Runs **after every session stop** (no matcher — Stop isn't tool-scoped). Scans the
session transcript for our own failure vocabulary (`GATE_FAIL`, `NO_TESTS`,
`REGRESSION`, `EXAMPLE_FAIL`, `PREFLIGHT_FAIL`, `CRITICAL_BLOCK`, `SECRET_FOUND`,
`BLOCKED`, `ESCALATE`) and writes/updates an instinct file under
`.claude/instincts/pending/INST-<hash>.md` — frontmatter with `confidence: 0.3` and
an `occurrences:` counter that increments on repeat sightings of the same pattern.
This is the Capture step (plus a cheap Validate, via the occurrence counter) from
`todo.md`'s Instincts v2 pipeline — promotion to `subagents/rules/common/` happens
via the `/evolve` command, not automatically here. **Always exits 0** — it's purely
observational and must never force the session to keep going (exit 2 on a Stop hook
blocks stopping).

```
Claude finishes a response, session stops
    │
    ▼
evaluate-session.mjs reads stdin JSON (transcript_path, session_id)
    │
    ├── no failure keywords found in transcript? ──► exit 0, no-op
    └── match found ──► write/bump .claude/instincts/pending/INST-<hash>.md, exit 0
```

### `hooks/pre-compact.mjs` (PreCompact)

Runs **before context gets compacted** (matcher `""` — both manual and auto
compaction). Snapshots the current branch, `git diff HEAD --stat`, the
changed file list (`active_files`), the rolling last-3 `auto-run-tests`
results (`last_test_results`, if any), and the last few user-turn messages
from the transcript (the closest available proxy for "the original task")
into `.claude/session-state/compact.json`, so a long `operator` run doesn't
lose track of its original request across a compaction. **Always exits 0** —
exit 2 on PreCompact blocks compaction entirely, which is never the intent here.

**Note on the 85%-context auto-compact trigger:** the *threshold* Claude Code
fires this hook at is an internal platform behavior — this hook only reacts
once the `PreCompact` event arrives, it doesn't (and can't) assert that the
trigger fired at the right usage percentage. That's not something a hook
script can test from the outside.

`SessionStart` only re-injects this snapshot at the *start* of a session — if
compaction happens mid-session (a long BUILD task, or a `maximum`-effort
inspector run), nothing fires automatically to put it back in front of the
model. `operator.md`'s "Context recovery" section and the matching note in
`inspector.md` cover that case: if the agent suspects it just got compacted
(it's unsure of the original task, or about to re-derive a decision it's
fairly sure it already made), it `Read`s `compact.json` itself and
cross-checks against the actual working tree before continuing.

---

## Continuous Learning (Instincts)

`.claude/instincts/pending/` and `.claude/session-state/compact.json` are
gitignored, session-local artifacts (same treatment as `.claude/bash.log`) — they
accumulate observations across runs on one machine but aren't meant to be committed.

```
Stop hook        ──► capture failure pattern  ──► .claude/instincts/pending/INST-<hash>.md
SessionStart hook ──► surface top-3 by occurrences at the start of the next session
/evolve command  ──► cluster recurring instincts (occurrences ≥ 3, or seen across
                     2+ sessions) into a permanent rule under subagents/rules/common/,
                     update .claude/memory/conventions.md, delete the promoted files
```

Promotion via `/evolve` is a deliberate, reviewable step — run it when you notice
the same instinct keeps reappearing, not on a timer.

`.claude/hooks.log` (structured per-hook invocation log), `.claude/hook-cache/`
(TTL cache, e.g. the resolved default branch), and `.claude/agent-telemetry.json`
(`read-budget.mjs`'s per-session Read counts) are the same kind of gitignored,
session-local artifact — useful for debugging a specific hook locally, not
meant to be committed.

---

## Memory System

Three layers; each serves a different scope and TTL.

```
Layer 1: .claude/memory/  (project-level, read/written by operator)
├── MEMORY.md            index
├── conventions.md       coding patterns discovered during sessions
├── architecture.md      structural facts, module boundaries
├── gotchas.md           things that broke, edge cases, surprises
├── lessons-learned.md   pipeline run outcomes, what worked
└── decisions.md         architectural choices with rationale

Layer 2: memory/  (portable — checked into repo, travels across machines)
├── personas/            who uses the harness, their preferences
├── projects/            per-project context snapshots
│   ├── mcp-go-local-server.md
│   ├── my-profile.md
│   └── tier1-support-ai.md
├── sessions/            rolling scratch space (7-day TTL)
└── knowledge/           stable reference material
    ├── security/        SEC-4 patterns, OWASP top 10, STRIDE cheatsheet
    ├── code-quality/    code smells catalogue, test patterns (AAA, pyramid)
    ├── git/             conventional commits spec, PR template
    ├── agents/          agent authoring guide, verdict vocabulary, pipeline patterns
    └── languages/       Go idioms, TypeScript / Next.js patterns

Layer 3: model context  (in-flight only, not persisted)
    Active session facts loaded by operator at the start of every BUILD/REFACTOR/DOCS step

Layer 4: .claude/memory-vectors.db  (derived, gitignored, regenerable)
    Local TF-IDF vector store over Layers 1+2 — see "Vector memory retrieval" below
```

`operator` reads relevant `.claude/memory/` context as Step 0 of every BUILD/REFACTOR/DOCS run, and writes new findings back to it during SHIP mode — so each run benefits from prior runs without a dedicated memory agent or manual bookkeeping.

`memory/sessions/`'s 7-day TTL and `.claude/memory/`'s staleness are enforced by
`/memory-prune`, not automatically — same "deliberate, reviewable step" posture
as `/evolve`. It archives (never deletes) session notes past the TTL, and only
*flags* stale-looking codebase-memory entries for a human to confirm before
anything is removed.

### Vector memory retrieval

This repo previously declined automatic vector-search retrieval over
`.claude/memory/`/`memory/`, reasoning that at a corpus of a few dozen
markdown files, keyword `Grep` gets equivalent results to embedding search —
revisit only if the corpus grows large enough that keyword matches start
missing semantically-related entries. That revisit happened: `lib/memory-store.mjs`
now provides **TF-IDF vector retrieval** (`npm run memory:ingest` to build the
store, `node scripts/query-memory.mjs "<query>" 3` to get the top-K relevant
chunks) — but deliberately **not** neural-embedding-based search. TF-IDF is
classical bag-of-words IR, computed in pure JS with zero external API calls
and no model download; `better-sqlite3` is the only new dependency. This was
a deliberate choice over `@xenova/transformers` (local neural embeddings,
heavier dependency + slower first run) or a paid embedding API (Voyage/OpenAI
— best quality, but a new secret + per-ingestion cost) given the corpus is
still small.

`operator`/`inspector` run `node scripts/query-memory.mjs` themselves via
Bash (Step 0 / Context isolation section of each agent's `.md`) — **not**
the JS orchestrator (`workflows/*.js`), which has no filesystem or Node.js
API access and so cannot import `lib/memory-store.mjs` or run any script.
The query script prints results wrapped in `<long_term_memory>`/`<memory_item>`
XML tags (the explicit-tag format Anthropic's context-engineering guidance
recommends for retrieved context), and each agent's Hard Rules instruct it to
treat that block as authoritative — see "Hard Rules" in `operator.md`/`inspector.md`.

`npm run memory:ingest` also walks `research/{topic}/TITLE.MD` (every report
the `research` workflow's `/research` command writes — see "research"
workflow above) into the same store (`todo.md` Phase 6). There's no separate
`type: research`/`topic`/`version` tag column — `lib/memory-store.mjs`'s
schema has no metadata filter, only cosine-similarity ranking — so "tagging"
is just `TITLE.MD`'s own YAML frontmatter sitting in plain text as that
file's first chunk; querying for a topic or version surfaces it through the
same retrieval path as everything else, no parallel mechanism added.
`operator`/`inspector` querying `scripts/query-memory.mjs` for a task that
overlaps a prior research topic gets that report's chunks back alongside
`.claude/memory/`/`memory/` results, with no extra wiring needed on their side.

`scripts/prune-memory.mjs` archives (never deletes) vectors unused for 30+
days with fewer than 2 accesses — the same staleness posture as `/memory-prune`
for the markdown layer, just applied to the derived vector index. Re-running
`npm run memory:ingest` rebuilds the store from scratch from the markdown
source of truth, which also undoes any archiving (the store is a cache, not
a source of truth).

**Not built — and why:** a dedicated `memory-manager` agent (raised as
"optional but recommended"). This repo deliberately collapsed a 15-agent
roster (including a `memory-manager`) down to "Lean 2" (`operator` +
`inspector`) specifically to cut spawn-tax — reintroducing a third agent for
memory curation directly reverses that consolidation. `operator`'s existing
SHIP-mode memory-writing step plus the `new_memories` structured field (see
"State-Passing" below) cover the same need without a third spawn. (The one
agent later added to the roster, `scout`, is not an exception to this
reasoning by accident — it does no review/curation/judgment work at all,
only mechanical command-running, so it doesn't compete with `inspector`'s
role the way a `memory-manager` would have. See "Scout stage" in
[workflows/README.md](workflows/README.md).)

### State-passing, not transcript-passing

Workflows never pass one agent's raw response text or conversation history
to the next agent — they only ever passed a `task`/`bug`/`target` description
plus already-extracted `{severity, file, line, message}` findings (this was
already true before Priority 3; see "Prompt minimality" in
[workflows/README.md](workflows/README.md)). What Priority 3 added: a
`pipelineState` object (`task_id`, `current_mode`, `files_changed`,
`test_status`, `last_error_message`, `inspector_findings`, `iteration_count`)
that every workflow builds and merges after each agent call (`mergeState()`),
then serializes into the next prompt as a `Pipeline state: {...}` JSON block —
structured data only, never prose or a transcript. `lib/pipeline-state.mjs`
documents the canonical shape; each workflow mirrors the same merge logic
inline (same reason `TIER_MODELS` is mirrored, not imported — no fs/Node
access in workflow scripts).

The Scout-stage work (see "Scout stage" in
[workflows/README.md](workflows/README.md)) extended the same object with
`repo_manifest` (the changed-files/dirs/toolchain `scout` MANIFEST mode
gathers once, up front) and `gate_status` (the most recent `scout` GATE
pass/fail) — both follow the identical pattern: a cheap agent's structured
result, merged once, threaded into every later prompt instead of re-derived.

`operator`/`inspector` both treat an incoming `pipeline_state` block as the
source of truth for current task status (Hard Rule 14) and are told they're
invoked with zero prior conversational context (Hard Rule 13) — there is no
"ask for the previous chat" to fall back to, by design.

**Deviation:** Priority 3 Phase 5's `new_memories` rule said *"do not write
to memory files directly via bash; let the orchestrator handle ingestion."*
That doesn't hold here — the orchestrator (`workflows/*.js`) has no
filesystem access either, so it's no more able to write a memory file than
the agent's own Bash tool is. `operator` keeps writing to `.claude/memory/`
directly via Bash during SHIP mode (the only mechanism in this harness that
actually persists memory); `new_memories` is additive — it surfaces the same
lesson as structured JSON so it's machine-readable in the run's result and
loggable, without replacing the one path that actually works.

**Not built — and why:** mid-loop context compaction for a single agent call
(`lib/compactor.js`, asked for in Priority 3 Phase 4). The proposed design
needed the JS orchestrator to track a single agent's *cumulative input
tokens during* its run and reset its message history mid-flight — but each
`agent()` call is atomic from the orchestrator's side; it only sees the
result once the call returns (see "Self-monitored tool-call budget" in
`operator.md`). Claude Code already has a real mechanism for this — the
`PreCompact` hook (`hooks/pre-compact.mjs`) snapshots state before an
auto-compact and `operator.md`/`inspector.md`'s "Context recovery" sections
tell the agent how to recover from it. Building a parallel custom compactor
would duplicate a platform feature that already does this job.

---

## Custom Slash Commands

| Command | Workflow | Description |
|---|---|---|
| `/ship <task>` | `new-feature` | Full feature delivery pipeline |
| `/audit [version]` | `release-prep` | Security + dependency audit before release |
| `/review [pr-number]` | `pr-review` | Parallel quality review of a PR or current diff |
| `/evolve` | — | Cluster `.claude/instincts/pending/` into a permanent `subagents/rules/common/` rule |
| `/memory-prune` | — | Archive stale `memory/sessions/` notes, flag stale `.claude/memory/` entries for review |
| `/research <topic>` | `research` | Questionnaire-driven research loop (`todo.md` "Ralph Loop", Phases 0/1/2/4) |
| `/autotune <target> <objective>` | `autotune` | Karpathy-autoresearch-style self-improvement loop for one agent `.md` file |

---

## Local Tooling (`npm`)

This is the only part of the repo that needs `npm install` — `workflows/*.js`
and the hooks are dependency-free by design (see "Token Telemetry" and
"Vector memory retrieval" above for why). `package.json` exists solely to
pull in `better-sqlite3` for the local memory vector store.

| Script | What it does |
|---|---|
| `npm run memory:ingest` | Rebuilds `.claude/memory-vectors.db` from `.claude/memory/` + `memory/` + `research/*/TITLE.MD` markdown |
| `npm run memory:query -- "<text>" [topK]` | CLI for the same query `operator`/`inspector` run via Bash |
| `npm run memory:prune [maxAgeDays] [minAccessCount]` | Archives stale vectors (default: 30 days, <2 accesses) |
| `npm run report` | Aggregates `telemetry/runs/*.jsonl` — see "Token Telemetry" |

---

## Security Design

**SEC-4 Credential Detection** — 8 grep patterns checked on every pipeline:
- AWS access keys and secret keys
- GitHub tokens (OAuth, PAT, server-to-server, fine-grained)
- Hardcoded JWTs (`eyJ...eyJ...`)
- Private keys (RSA, EC, Ed25519, PEM headers)
- Database URIs with embedded credentials (postgres, mysql, mongodb, redis)
- Generic high-entropy secrets (`api_key`, `secret_key`, `auth_token`, etc.)

Any match triggers `ESCALATION` — zero retries, pipeline stops, human must rotate.

**Dual-layer read-only enforcement** on `inspector` (the only analysis-only agent in the roster):
1. `disallowedTools` in YAML frontmatter — Claude Code runtime blocks the call
2. `OPERATION CONSTRAINTS` prose block in system prompt — model layer refuses

Both layers required; missing either allows the constraint to be bypassed.
