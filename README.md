# rig-bench

A production-grade multi-agent harness for AI-driven software engineering. Provides specialized agents, deterministic workflows, quality gates, and a memory system — all running on top of Claude Code.

---

## What It Is

**rig-bench** wires Claude Code into a structured engineering pipeline. Instead of one model doing everything, it routes work through two focused specialists — `operator` (build) and `inspector` (adversarial review) — in a fixed sequence. Control flow and retry logic live in JavaScript — not inside a model's judgment.

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
├── subagents/       # 2 specialized agent definitions (.md with YAML frontmatter) — "Lean 2" roster
├── workflows/       # 6 deterministic pipelines (.js orchestration scripts)
├── hooks/           # Git/Claude Code safety hooks (.sh)
├── memory/          # Portable cross-project context (personas, projects, knowledge)
└── .claude/         # Project-level settings, commands, and codebase memory
    ├── settings.json         # Hook wiring (PreToolUse / PostToolUse)
    ├── settings.local.json   # Permissions allowlist
    ├── commands/             # Custom slash commands (/ship, /audit, /review)
    └── memory/               # Codebase facts (conventions, architecture, gotchas)
```

---

## Agents

Each agent is a single `.md` file with YAML frontmatter declaring its model, tool permissions, and completion signal contract. See [subagents/README.md](subagents/README.md) for the full breakdown.

| Agent | Role | Model | Permission |
|---|---|---|---|
| `operator` | Plans, implements (TDD), tests, self-verifies, refactors, diagnoses bugs, writes docs/CHANGELOG, ships (commit + draft PR) — run in BUILD / REFACTOR / DOCS / SHIP mode | Sonnet | manual |
| `inspector` | Read-only adversarial review in one pass: secrets (SEC-4), OWASP/STRIDE, dependency/CVE audit, two-pass code quality (low / medium / high / maximum effort) | Sonnet | semi-auto |

This collapses what used to be a 15-agent roster (orchestrator, planner, developer, test-writer, refactorer, code-reviewer, security-reviewer, secret-scanner, dependency-auditor, verifier, debugger, docs-writer, git-assistant, changelog-writer, memory-manager) into two agents that each do their combined job in a single spawn — see `todo.md` for the rationale (spawn-tax reduction).

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

Six deterministic pipelines. Arguments are passed as structured objects; all gate logic is in JavaScript.

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

## Quality Gates

| Verdict | Stage | Action | Retries |
|---|---|---|---|
| `SECRET_FOUND` / `ESCALATION` | inspector | Hard stop — human rotates credential | 0 |
| `CRITICAL_CVE` | inspector | Release blocked — fix CVE first | 0 |
| `CRITICAL_BLOCK` | inspector | Hand off to operator for fixes | ≤ 1 |
| `NO_TESTS` | operator (REFACTOR mode) | Procedural block — run BUILD mode to add tests first | N/A |
| Any gate after 1 retry | any | Escalate to human with full attempt history | — |
| Missing `<task-notification>` | any | Treated as BLOCK — malformed responses fail safe | — |

---

## Hook System

Seven hooks intercept tool calls and session lifecycle events Claude Code makes:

### `hooks/branch-safety.sh` (PreToolUse)

Runs **before** every Bash tool use. Blocks:
- Direct push to default branch (`main` / `master`)
- Force push (`--force`, `--force-with-lease`, `-f`)
- `git reset --hard` (destructive — user must run manually)

Exit 0 = allow. Exit 2 = block with message shown to the model.

```
Claude issues Bash("git push origin main")
    │
    ▼
branch-safety.sh reads stdin JSON
    │
    ├── not a git push? ──► exit 0 (allow)
    ├── push to non-default? ──► exit 0 (allow)
    └── push to main / force push ──► exit 2 (BLOCKED, message shown)
```

### `hooks/log-bash.sh` (PostToolUse)

Runs **after** every Bash tool use. Appends to `.claude/bash.log`:

```
[2026-06-16 14:23:01] exit=0 cmd=go test ./...
[2026-06-16 14:23:08] exit=1 cmd=go build ./cmd/server
```

### `hooks/block-dangerous-commands.sh` (PreToolUse)

Runs **before** every Bash tool use, alongside `branch-safety.sh`. Blocks generic
destructive commands unrelated to git branches: `rm -rf` against `/`, `~`, or `.`;
fork bombs; `dd`/`mkfs` against block devices; recursive `chmod 777 /`; redirecting
into a raw block device; piping a downloaded script straight into a shell
(`curl ... | sh`); and mass working-tree wipes (`git clean -fd`, `git checkout -- .`).

```
Claude issues Bash("rm -rf /")
    │
    ▼
block-dangerous-commands.sh reads stdin JSON
    │
    ├── not Bash, or no destructive pattern matched? ──► exit 0 (allow)
    └── matches a blocked pattern ──► exit 2 (BLOCKED, message shown)
```

### `hooks/auto-run-tests.sh` (PostToolUse)

Runs **after** every Write/Edit to a `.go`/`.ts`/`.tsx`/`.js`/`.jsx`/`.py` file. Walks
up to the nearest `go.mod`/`package.json`/`pyproject.toml`/`setup.py`, runs a scoped
test command for that file (`timeout 30`), and emits a compact JSON summary —
`{"status":"pass","tool":"go test","exit_code":0,"summary":"ok ...","first_error":""}`
— as supplementary hook feedback. Exits silently (no test config found, or the file
extension isn't covered) rather than nagging on every doc/config edit. This is the
`auto-run-tests` hook from `todo.md` Phase 2 — it doesn't replace the standalone
verifier step (that's now part of `operator`'s self-verification gate), it just adds a
fast, cheap pass/fail signal right after a file changes.

### `hooks/summarize-cli-output.sh` (PostToolUse)

Runs **after** every Bash call, alongside `log-bash.sh`. When the command matches a
known verbose tool (`npm audit`, `go test`, `golangci-lint`, `pytest`, `cargo audit`,
`pip-audit`, `govulncheck`), greps the already-returned output for counts and the
first failure, and prints a condensed JSON pointer. **Limitation:** a `PostToolUse`
hook's stdout is *additional* context — it cannot shrink or replace the verbose
output the Bash tool already returned. This hook adds a "here's the gist" line next
to a long transcript; it does not truncate it.

### `hooks/evaluate-session.sh` (Stop)

Runs **after every session stop** (no matcher — Stop isn't tool-scoped). Scans the
session transcript for our own failure vocabulary (`GATE_FAIL`, `NO_TESTS`,
`REGRESSION`, `EXAMPLE_FAIL`, `PREFLIGHT_FAIL`, `CRITICAL_BLOCK`, `SECRET_FOUND`,
`BLOCKED`, `ESCALATE`) and writes/updates an instinct file under
`.claude/instincts/pending/INST-<hash>.md` — frontmatter with `confidence: 0.3` and
an `occurrences:` counter that increments on repeat sightings of the same pattern.
This is the Capture step (plus a cheap Validate) from `todo.md`'s Instincts v2
pipeline — full auto-promotion to `.claude/rules/common/` and the `/evolve`
clustering command are not implemented. **Always exits 0** — it's purely
observational and must never force the session to keep going (exit 2 on a Stop hook
blocks stopping).

```
Claude finishes a response, session stops
    │
    ▼
evaluate-session.sh reads stdin JSON (transcript_path, session_id)
    │
    ├── no failure keywords found in transcript? ──► exit 0, no-op
    └── match found ──► write/bump .claude/instincts/pending/INST-<hash>.md, exit 0
```

### `hooks/pre-compact.sh` (PreCompact)

Runs **before context gets compacted** (matcher `""` — both manual and auto
compaction). Snapshots the current branch, `git diff HEAD --stat`, and the last few
user-turn messages from the transcript (the closest available proxy for "the
original task") into `.claude/session-state/compact.json`, so a long `operator` run
doesn't lose track of its original request across a compaction. **Always exits 0** —
exit 2 on PreCompact blocks compaction entirely, which is never the intent here.

---

## Continuous Learning (Instincts)

`.claude/instincts/pending/` and `.claude/session-state/compact.json` are
gitignored, session-local artifacts (same treatment as `.claude/bash.log`) — they
accumulate observations across runs on one machine but aren't meant to be committed.
An instinct with a high `occurrences` count across distinct sessions is a candidate
for manual promotion into a permanent convention in `.claude/memory/conventions.md`
or a new `subagents/rules/` file; that promotion step is currently manual, not
automated.

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
```

`operator` reads relevant `.claude/memory/` context as Step 0 of every BUILD/REFACTOR/DOCS run, and writes new findings back to it during SHIP mode — so each run benefits from prior runs without a dedicated memory agent or manual bookkeeping.

---

## Custom Slash Commands

| Command | Workflow | Description |
|---|---|---|
| `/ship <task>` | `new-feature` | Full feature delivery pipeline |
| `/audit [version]` | `release-prep` | Security + dependency audit before release |
| `/review [pr-number]` | `pr-review` | Parallel quality review of a PR or current diff |

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
