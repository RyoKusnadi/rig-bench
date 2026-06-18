# Workflows

JavaScript workflow scripts that orchestrate `operator` and `inspector` in deterministic pipelines. Each script handles retry logic, quality gates, and escalation in code — not in a model's judgment.

---

## How workflows differ from calling agents directly

| | Calling an agent directly | Workflow scripts |
|---|---|---|
| **Control flow** | Model decides what to do next | Code (loops, conditionals) |
| **Parallelism** | Sequential by default | True `parallel()` support |
| **Retry logic** | Prompt-based, may hallucinate | Counted `while` loops |
| **Resumability** | Starts fresh each run | Resume from a `runId` on failure |
| **Debugging** | Read the conversation | Read the script |

Use workflows when you want guaranteed, auditable execution. Call `operator`/`inspector` directly for exploratory or one-off tasks where flexibility matters more than determinism.

---

## Installation

Workflows must be placed in `.claude/workflows/` in your project to be invokable by name:

```bash
# Copy all workflows
mkdir -p your-project/.claude/workflows
cp workflows/*.js your-project/.claude/workflows/

# Workflows also need the agents installed
mkdir -p your-project/.claude/agents
cp ../subagents/operator/operator.md your-project/.claude/agents/operator.md
cp ../subagents/inspector/inspector.md your-project/.claude/agents/inspector.md
mkdir -p your-project/.claude/agents/rules
cp ../subagents/rules/*.md your-project/.claude/agents/rules/
```

---

## Running a workflow

### From Claude Code chat

```
/workflow new-feature --args '{"task": "add per-tenant rate limiting to the Gin API"}'
/workflow bug-fix --args '{"bug": "confidence scorer returns -1 on empty LLM response"}'
/workflow pr-review --args '{"pr": 42, "effort": "high"}'
```

### Programmatically (via the Workflow tool)

```javascript
Workflow({ name: 'new-feature', args: { task: 'add JWT refresh token support', effort: 'high' } })
Workflow({ name: 'bug-fix', args: { bug: 'nil pointer in cache.Get()', known_cause: true } })
Workflow({ name: 'pr-review', args: { pr: 15, spec: 'Rate limit must return 429 with Retry-After header' } })
```

### Resume a failed run

```javascript
Workflow({ scriptPath: '.claude/workflows/new-feature.js', resumeFromRunId: 'wf_abc123' })
```

---

## Workflow reference

### `new-feature.js`

Full feature delivery pipeline with a quality gate loop.

```
operator (BUILD) → inspector ─ BLOCK, retry ≤ 1 → operator (BUILD fix) ─┐
                       │                                                │
                       └────────────────────── re-inspect ──────────────┘
                       │ PASS
                       ▼
                  operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | What to implement |
| `effort` | string | No | `low` / `medium` / `high` / `maximum` — inspector's effort (default: `medium`) |
| `branch` | string | No | Feature branch name hint |

---

### `bug-fix.js`

Bug fix from diagnosis to PR.

```
operator (BUILD: diagnose + fix) → inspector ─ retry ≤ 1 → operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `bug` | string | Yes | Bug description or failing test name |
| `known_cause` | boolean | No | Set `true` to skip diagnosis (default: `false`) |
| `stack_trace` | string | No | Paste the stack trace for better diagnosis context |

---

### `refactor.js`

Cleanup pipeline that requires tests to exist before starting.

```
operator (REFACTOR) → inspector ─ retry ≤ 1 → operator (SHIP) → Draft PR
       ↑
  NO_TESTS → block (run new-feature/bug-fix in BUILD mode to add tests first)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | File, module, or smell to refactor |
| `goal` | string | No | `readability` / `performance` / `extensibility` (default: `readability`) |

---

### `pr-review.js`

Single-pass review across secrets, security, dependencies, and code quality.

```
inspector ── secrets (SEC-4) → OWASP/STRIDE → dependency/CVE audit → quality (+ spec check if `spec` given)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `pr` | number | No | PR number — omit to review current HEAD diff |
| `effort` | string | No | inspector effort mode (default: `medium`) |
| `spec` | string | No | Requirements text — when present, inspector also checks spec compliance |

---

### `docs-update.js`

Keeps docs in sync after a code change.

```
operator (DOCS) → inspector (light review) → operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `trigger` | string | Yes | What changed that needs docs updating |
| `scope` | string | No | Specific files or sections to update |

---

### `release-prep.js`

Pre-release security + CVE gate, then creates a release PR with CHANGELOG.

```
inspector (effort=maximum) ── ESCALATION / CRITICAL_CVE → stop
                   ↓
        operator (SHIP, release mode) → Release PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `version` | string | Yes | Version string, e.g. `"1.2.0"` |
| `branch` | string | No | Target branch (default: `main`) |
| `notes` | string | No | Release highlights for CHANGELOG |

---

## Quality gates summary

Every workflow enforces these gates:

| Signal | Action | Retries |
|---|---|---|
| `SECRET_FOUND` / `ESCALATION` | Pipeline stops immediately | **0** — human must rotate credential |
| `CRITICAL_BLOCK` (inspector) | Return to operator with `file:line` fixes | Max 1 |
| `CRITICAL_CVE` (inspector) | Release pipeline blocked | 0 — fix CVE first |
| `NO_TESTS` (operator REFACTOR mode) | Block — run BUILD mode to add tests first | N/A |
| Any gate after 1 retry | Escalate to human with full attempt history | — |
| Missing `<task-notification>` | Treated as `BLOCK` | — |

---

## Writing a custom workflow

Copy an existing script and adapt it. The key building blocks:

```javascript
// Dispatch a single agent
const result = await agent('prompt', {
  label: 'display-name',
  phase: 'Phase Name',
  schema: GATE_SCHEMA,        // forces structured output
  agentType: 'operator',      // invokes .claude/agents/operator.md
})

// Run agents in parallel (all start at once, wait for all)
const [a, b] = await parallel([
  () => agent('...', { agentType: 'operator' }),
  () => agent('...', { agentType: 'inspector' }),
])

// Log progress (shown in /workflows UI)
log('Stage N complete — advancing...')

// Mark a new phase (groups agents in progress view)
phase('Review')

// Return structured result
return { outcome: 'COMPLETE', summary: '...' }
```

See [SCHEMA.md](../subagents/SCHEMA.md) for the full agent frontmatter reference.
