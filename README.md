# rig-bench

A clean-slate multi-agent harness for Claude Code. Spec-driven development with a plan→execute pipeline, concurrent worktree-isolated execution, and a structured lifecycle for every deliverable.

---

## What It Is

**rig-bench** gives you a disciplined, end-to-end loop for AI-driven software engineering:

1. **Plan** — design a spec interactively before any code is written
2. **Execute** — implement specs concurrently, each agent in its own git worktree
3. **Verify** — confirm implementation matches requirements before marking as finished

The `operator` agent is the core execution primitive. It runs inside an isolated git worktree per spec, creates a feature branch, implements, commits, and advances the spec through the lifecycle — all without touching any other spec's work.

---

## Repository Layout

```
rig-bench/
├── .claude/
│   ├── agents/
│   │   ├── operator.md       # Plan + implement (orchestrator or per-spec worker)
│   │   ├── inspector.md      # Verification (worktree-isolated, read-only)
│   │   └── shipper.md        # PR creation (worktree-isolated, push+PR)
│   ├── commands/
│   │   ├── operator.md       # /operator — plan once, then execute all specs concurrently
│   │   ├── plan.md           # /plan    — interactive spec authoring
│   │   ├── execute.md        # /execute — execute one or more ready specs
│   │   └── verify.md         # /verify  — verify waiting specs against their criteria
│   └── settings.json         # Permissions
├── workflows/
│   └── operator.js           # Concurrent execution workflow (pipeline + worktrees)
├── specs/                    # Spec lifecycle folders
│   ├── draft/                # Being written; may have [NEEDS CLARIFICATION] markers
│   ├── ready/                # All ambiguity resolved; ready to execute
│   ├── in_progress/          # Actively being implemented
│   ├── waiting_verification/ # Implementation complete; awaiting human confirmation
│   ├── finished/             # Shipped — merged PR is the permanent record
│   ├── blocked/              # Waiting on a dependency or decision
│   └── abandoned/            # Won't do; kept for reference
├── hooks/                    # Placeholder (to be implemented)
├── lib/                      # Placeholder (to be implemented)
├── scripts/                  # Placeholder (to be implemented)
├── config/schemas/           # Placeholder (to be implemented)
├── tests/                    # Placeholder (to be implemented)
└── projects/                 # Placeholder (to be implemented)
```

---

## Agents

Three agents, each with a focused role:

| Agent | File | Role | Model | Isolation |
|---|---|---|---|---|
| `operator` | `.claude/agents/operator.md` | Plans and implements specs — orchestrator when invoked top-level, implementer when spawned per-spec | Sonnet | worktree |
| `inspector` | `.claude/agents/inspector.md` | Verifies implementation against acceptance criteria (read-only) | Sonnet | worktree |
| `shipper` | `.claude/agents/shipper.md` | Pushes the verified branch and opens a draft PR | Haiku | worktree |

### operator

Two modes, one agent:

**Orchestrator mode** (invoked with a task description):
1. **Plan phase** — follows `/plan` command logic: reads `specs/README.md`, finds the next spec ID, captures intent with the user via `AskUserQuestion`, drafts specs, gets user approval, writes them to `specs/ready/`
2. **Execute phase** — follows `/execute` command logic: validates dependencies, then invokes `workflows/operator.js` which fans out concurrent per-spec execution — each spec runs in its own worktree via a fresh operator spawn

**Implement mode** (spawned by the workflow with a specific spec):
1. Creates a feature branch (`{id}-{slug}`)
2. Moves spec `ready/ → in_progress/` and commits
3. Reads the spec, implements all acceptance criteria
4. Commits the implementation (staged explicitly, never `git add -A`)
5. Moves spec `in_progress/ → waiting_verification/`, updates status frontmatter
6. Returns: `spec_id`, `status`, `branch`, `summary`, `errors`

### inspector

1. Checks out the feature branch in its worktree
2. Reads the spec from `specs/waiting_verification/{filename}`
3. Checks each EARS-style acceptance criterion — finds the specific code (file:line) that satisfies it
4. Runs the `Verification` step from the spec
5. Returns: `spec_id`, `verdict` (PASS/FAIL), `criteria_results[]`, `failures[]`

### shipper

1. Checks out the feature branch in its worktree
2. Reads the spec to extract title and acceptance criteria
3. Pushes the branch: `git push origin {branch}`
4. Opens a draft PR: `gh pr create --draft` with spec criteria as the body
5. Returns: `spec_id`, `status`, `pr_url`, `branch`

---

## The Operator Workflow

`workflows/operator.js` orchestrates the full pipeline. Each spec flows through three stages concurrently within a dependency wave:

```
Discover
  ↓ read specs/ready/, build dependency graph

Wave N (all specs in this wave run concurrently via pipeline())
  ↓
  Stage 1 — Execute (operator, worktree)
    create branch → implement → commit → move spec to waiting_verification/
  ↓
  Stage 2 — Verify (inspector, worktree)
    checkout branch → check criteria → run verification step
      PASS → continue
      FAIL → retry: re-execute (operator) → re-verify (inspector)
               PASS → continue
               FAIL → status=blocked, skip Stage 3

  Stage 3 — Merge (shipper, worktree)
    checkout branch → git push → gh pr create --draft

Report
  ↓ shipped (PR open) / blocked (verify failed) / stuck (unresolvable deps)
```

Specs with no dependency relationship run **concurrently** in the same wave. Specs in later waves start only after all specs in the previous wave complete. Set `depends_on` in spec frontmatter to control ordering.

---

## Commands

| Command | What it does |
|---|---|
| `/operator <task>` | Plan once (interactive), then execute all generated specs concurrently with worktree isolation |
| `/plan <task>` | Collaborative planning session — design a spec before any code is written |
| `/execute [all \| <id> ...]` | Execute one or more ready specs (sequential, no worktrees) |
| `/verify [all \| <id> ...]` | Verify implementation matches requirements; move passing specs to finished |

### `/operator` — full pipeline

```
/operator add user authentication with JWT
```

Runs Phase 1 (plan, interactive, user approves specs) then Phase 2 (Workflow tool, concurrent worktree execution). Ends with specs in `waiting_verification/` and branches ready to review.

### `/execute` — direct execution

```
/execute 0001 0002    # execute specific specs
/execute all          # execute everything in specs/ready/
```

The existing sequential executor — useful when you want to run a single spec or watch each one step-by-step.

---

## Spec Lifecycle

```
draft/ → ready/ → in_progress/ → waiting_verification/ → finished/
                     ↓ (if blocked)
                  blocked/   abandoned/
```

Each spec is a single `.md` file with YAML frontmatter:

```yaml
---
id: 0001
title: Add JWT authentication
status: ready
depends_on: []
---
## Problem
## Acceptance Criteria
## Out of Scope
## Files / Interfaces Touched
## Implementation Plan
## Verification
```

The `depends_on` array controls execution order — specs with no unmet dependencies run first. IDs of specs in `specs/finished/` are automatically treated as pre-satisfied.

---

## Worktrees

The `operator` agent uses Claude Code's built-in worktree isolation (`isolation: worktree` in the agent frontmatter, and `isolation: 'worktree'` in the Workflow script's `agent()` calls).

Each spec gets a temporary git worktree under `.claude/worktrees/`. The worktree is auto-removed if no changes are committed; if the agent commits work, the worktree (and its branch) persist until you merge or delete it.

If you have gitignored files that should be available in worktrees (e.g. `.env`), list them in `.worktreeinclude`:

```
.env
.env.local
```

---

## Design Principles

- **Spec first** — no code before the spec is written and approved
- **One spec = one PR** — sized to fit one feature branch and one review
- **Dependency ordering** — `depends_on` is the only coordination mechanism between specs
- **Worktree isolation** — concurrent agents never share a working directory
- **Structured output** — every agent call returns a typed schema, not prose
- **State, not transcripts** — the workflow passes structured data between phases, never raw text

---

## What's Planned

See `REMOVED.md` for the full inventory of systems stripped during the clean-slate reset, and their intended re-implementations:

- Hook system (safety, telemetry, lifecycle)
- Memory system (per-project + portable cross-project)
- Inspector agent (adversarial review, security, quality gates)
- Token telemetry
