# rig-bench

A production-grade multi-agent harness for AI-driven software engineering. Provides specialized agents, deterministic workflows, quality gates, and a memory system — all running on top of Claude Code.

---

## What It Is

**rig-bench** wires Claude Code into a structured engineering pipeline. Instead of one model doing everything, it routes work through focused specialists (planner, developer, security reviewer, etc.) in a fixed sequence. Control flow and retry logic live in JavaScript — not inside a model's judgment.

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
├── agents/          # 14 specialized agent definitions (.md with YAML frontmatter)
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

Each agent is a single `.md` file with YAML frontmatter declaring its model, tool permissions, and completion signal contract.

| Agent | Role | Model | Permission |
|---|---|---|---|
| `orchestrator` | Pipeline conductor — sequences agents, enforces gates | Sonnet | auto |
| `planner` | Reads codebase → file-level implementation plan | Sonnet | auto |
| `developer` | TDD implementation: write test → code → pass | Sonnet | manual |
| `test-writer` | Unit + integration tests (AAA pattern), coverage audit | Sonnet | semi-auto |
| `refactorer` | Smell-by-smell restructuring with test baseline | Sonnet | semi-auto |
| `code-reviewer` | Two-pass quality audit (low / medium / high / maximum effort) | Sonnet | semi-auto |
| `security-reviewer` | OWASP A01–A10 + STRIDE threat model | Sonnet | semi-auto |
| `secret-scanner` | SEC-4 credential detection (8 grep patterns, target <10s) | Haiku | semi-auto |
| `dependency-auditor` | CVE / license / version scan (npm, Go, pip, Rust, .NET, Ruby, Maven) | Sonnet | semi-auto |
| `verifier` | Binary spec-compliance check with real execution evidence | Sonnet | semi-auto |
| `debugger` | Root-cause analysis — ranks hypotheses, never applies fixes | Sonnet | semi-auto |
| `docs-writer` | README / CLAUDE.md / docstrings — verifies examples compile | Sonnet | semi-auto |
| `git-assistant` | Conventional commits validation + draft PR creation | Sonnet | manual |
| `changelog-writer` | CHANGELOG.md management (Keep a Changelog format) | Sonnet | semi-auto |
| `memory-manager` | Context load / save / update / query across sessions | Haiku | semi-auto |

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

The orchestrator parses `pipeline-gate` to decide: advance → retry → escalate. It never pipes raw text between agents — it extracts and re-structures findings before passing them downstream.

---

## Workflows

Six deterministic pipelines. Arguments are passed as structured objects; all gate logic is in JavaScript.

### 1. `new-feature` — Full Feature Delivery

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOAD MEMORY                                                         │
│  memory-manager:LOAD → conventions, architecture, gotchas           │
└───────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PRE-FLIGHT                                                          │
│  secret-scanner ──► SECRET_FOUND? ──► STOP (human rotates)          │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PLAN                                                                │
│  planner ──► file-level plan with phases                            │
└───────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  IMPLEMENT  (retry ≤ 2)                                              │
│  developer ──► write failing test → implement → pass test suite     │
└───────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TEST                                                                │
│  test-writer ──► unit + integration tests, coverage audit           │
└───────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CODE REVIEW  (retry ≤ 2)                                            │
│  code-reviewer ──► CRITICAL_BLOCK? ──► developer fixes ──► re-review│
└───────────────────┬─────────────────────────────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SECURITY REVIEW  (retry ≤ 2)                                        │
│  security-reviewer ──► CRITICAL? ──► developer fixes ──► re-review  │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  VERIFY  (retry ≤ 2)                                                 │
│  verifier ──► SPEC_VIOLATION? ──► developer fixes ──► re-verify     │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ VERIFIED
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PR                                                                  │
│  git-assistant ──► branch safety check → conventional commit → PR   │
└───────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SAVE MEMORY                                                         │
│  memory-manager:SAVE → conventions, architecture, gotchas, decisions│
└─────────────────────────────────────────────────────────────────────┘
```

**Args:** `task` (string), `effort` (low|medium|high|maximum), `branch` (optional)

---

### 2. `bug-fix` — Diagnosis to PR

```
┌──────────────────────────────────────────────────────────────┐
│  LOAD MEMORY → gotchas, architecture, prior fixes            │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  DIAGNOSE  (optional — skip if known_cause=true)             │
│  debugger ──► reproduce → ranked hypotheses → root cause     │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  FIX  (retry ≤ 2)                                            │
│  developer ──► write regression test FIRST → minimal fix     │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  TEST                                                        │
│  test-writer ──► regression + edge-case tests                │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  VERIFY  (retry ≤ 2)                                         │
│  verifier ──► bug resolved + no adjacent regressions         │
└────────────────────┬─────────────────────────────────────────┘
                     │ VERIFIED
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  PR → git-assistant → "Closes #<issue>" in body              │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  SAVE MEMORY → root cause, gotchas, lessons-learned          │
└──────────────────────────────────────────────────────────────┘
```

**Args:** `bug` (string), `known_cause` (boolean), `stack_trace` (optional)

---

### 3. `refactor` — Restructuring with Test Baseline

```
LOAD MEMORY
    │
    ▼
refactorer ──► smell-by-smell refactor, run tests after each change
    │               │
    │           NO_TESTS ──► block until test-writer runs first
    │
    ▼  (retry ≤ 2)
code-reviewer ──► CRITICAL_BLOCK? ──► refactorer fixes ──► re-review
    │ PASS
    ▼
verifier ──► SPEC_VIOLATION? ──► refactorer fixes ──► re-verify  (retry ≤ 2)
    │ VERIFIED
    ▼
git-assistant ──► Draft PR
    │
    ▼
SAVE MEMORY
```

**Args:** `target` (module/file path), `goal` (string describing what to clean up)

---

### 4. `pr-review` — Parallel Review Synthesis

```
secret-scanner
    │ PASS
    ▼
┌───────────────────────────────┐
│ code-reviewer (parallel)      │
│ security-reviewer (parallel)  │──► synthesize → deduplicate → prioritize
│ dependency-auditor (parallel) │
└───────────────────────────────┘
    │
    ▼
Optional: verifier (spec compliance)
    │
    ▼
Return: overall_gate, blocking_count, merged_findings
```

**Args:** `pr_number` or `diff` (string), `effort` (optional)

---

### 5. `docs-update` — Documentation Sync

```
LOAD MEMORY
    │
    ▼
docs-writer ──► update README / CLAUDE.md / docstrings, verify examples compile
    │
    ▼
git-assistant ──► Draft PR
    │
    ▼
SAVE MEMORY
```

**Args:** `trigger` (what changed that requires docs update)

---

### 6. `release-prep` — Pre-Release Gate

```
LOAD MEMORY
    │
    ▼
secret-scanner ──► SECRET_FOUND? ──► STOP
    │ PASS
    ▼
dependency-auditor ──► CRITICAL_CVE? ──► STOP (fix before releasing)
    │ PASS
    ▼
git-assistant (release mode)
    ├── validate all commits follow conventional commits
    ├── move [Unreleased] entries to [version] in CHANGELOG.md
    └── create Release PR
    │
    ▼
SAVE MEMORY → dep verdict, hygiene flags, PR reference
```

**Args:** `version` (e.g. `v1.2.0`)

---

## Quality Gates

| Verdict | Stage | Action | Retries |
|---|---|---|---|
| `SECRET_FOUND` / `ESCALATION` | secret-scanner | Hard stop — human rotates credential | 0 |
| `CRITICAL_CVE` | dependency-auditor | Release blocked — fix CVE first | 0 |
| `CRITICAL_BLOCK` | code-reviewer | Hand off to developer for fixes | ≤ 2 |
| `SPEC_VIOLATION` | verifier | Hand off to developer for fixes | ≤ 2 |
| `NO_TESTS` | refactorer | Procedural block — test-writer must run first | N/A |
| Any gate after 2 retries | any | Escalate to human with full attempt history | — |
| Missing `<task-notification>` | any | Treated as BLOCK — malformed responses fail safe | — |

---

## Hook System

Two hooks intercept every Bash call Claude Code makes:

### `hooks/branch-safety.sh` (PreToolUse)

Runs **before** every Bash tool use. Blocks:
- Direct push to default branch (`main` / `master`)
- Force push (`--force`, `--force-with-lease`, `-f`)

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

---

## Memory System

Three layers; each serves a different scope and TTL.

```
Layer 1: .claude/memory/  (project-level, managed by memory-manager)
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
    Active session facts loaded by memory-manager:LOAD at pipeline start
```

The `memory-manager` agent loads relevant context at the start of each pipeline run and saves new findings at the end — so each run benefits from prior runs without manual bookkeeping.

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

**Dual-layer read-only enforcement** on analysis-only agents (planner, verifier, debugger, security-reviewer, dependency-auditor, secret-scanner):
1. `disallowedTools` in YAML frontmatter — Claude Code runtime blocks the call
2. `OPERATION CONSTRAINTS` prose block in system prompt — model layer refuses

Both layers required; missing either allows the constraint to be bypassed.
