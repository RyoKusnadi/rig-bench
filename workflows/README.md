# Workflows

JavaScript workflow scripts that orchestrate the agents in deterministic pipelines. Each script handles retry logic, quality gates, and escalation in code — not in a model's judgment.

---

## How workflows differ from the orchestrator agent

| | Orchestrator agent | Workflow scripts |
|---|---|---|
| **Control flow** | Model decides what to do next | Code (loops, conditionals) |
| **Parallelism** | Sequential by default | True `parallel()` support |
| **Retry logic** | Prompt-based, may hallucinate | Counted `while` loops |
| **Resumability** | Starts fresh each run | Resume from a `runId` on failure |
| **Debugging** | Read the conversation | Read the script |

Use workflows when you want guaranteed, auditable execution. Use the orchestrator agent for exploratory or one-off tasks where flexibility matters more than determinism.

---

## Installation

Workflows must be placed in `.claude/workflows/` in your project to be invokable by name:

```bash
# Copy all workflows
mkdir -p your-project/.claude/workflows
cp workflows/*.js your-project/.claude/workflows/

# Workflows also need the agents installed
mkdir -p your-project/.claude/agents
for f in agents/*/; do
  name=$(basename "$f")
  cp "agents/$name/$name.md" "your-project/.claude/agents/$name.md"
done
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
Workflow({ name: 'pr-review', args: { pr: 15, verify: true, spec: 'Rate limit must return 429 with Retry-After header' } })
```

### Resume a failed run

```javascript
Workflow({ scriptPath: '.claude/workflows/new-feature.js', resumeFromRunId: 'wf_abc123' })
```

---

## Workflow reference

### `new-feature.js`

Full feature delivery pipeline with quality gate loops.

```
secret-scanner → planner → developer ←──────────────────┐
                                 ↓                       │
                           test-writer                   │
                                 ↓                       │  retry ≤ 2
                          code-reviewer ─ CRITICAL ──────┤
                                 ↓                       │
                       security-reviewer ─ CRITICAL ─────┘
                                 ↓
                            verifier ─ SPEC_VIOLATION → developer (retry ≤ 2)
                                 ↓
                          git-assistant → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | What to implement |
| `effort` | string | No | `low` / `medium` / `high` / `maximum` (default: `medium`) |
| `branch` | string | No | Feature branch name hint |

---

### `bug-fix.js`

Bug fix from diagnosis to PR.

```
debugger (optional) → developer → test-writer → verifier → git-assistant → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `bug` | string | Yes | Bug description or failing test name |
| `known_cause` | boolean | No | Set `true` to skip debugger (default: `false`) |
| `stack_trace` | string | No | Paste the stack trace for better debugger context |

---

### `refactor.js`

Cleanup pipeline that requires tests to exist before starting.

```
refactorer → code-reviewer → verifier → git-assistant → Draft PR
         ↑                                    ↑
    NO_TESTS → block         SPEC_VIOLATION → refactorer (retry ≤ 2)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | File, module, or smell to refactor |
| `goal` | string | No | `readability` / `performance` / `extensibility` (default: `readability`) |

---

### `pr-review.js`

Parallel review across three dimensions, synthesized into one report.

```
secret-scanner → ┌─ code-reviewer ─────────┐
                 ├─ security-reviewer ──────┤ → synthesize → optional verifier
                 └─ dependency-auditor ─────┘
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `pr` | number | No | PR number — omit to review current HEAD diff |
| `effort` | string | No | code-reviewer effort mode (default: `medium`) |
| `verify` | boolean | No | Run verifier after review (default: `false`) |
| `spec` | string | No | Requirements text for verifier (required if `verify=true`) |

---

### `docs-update.js`

Keeps docs in sync after a code change.

```
docs-writer → git-assistant → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `trigger` | string | Yes | What changed that needs docs updating |
| `scope` | string | No | Specific files or sections to update |

---

### `release-prep.js`

Pre-release security + CVE gate, then creates a release PR with CHANGELOG.

```
secret-scanner → dependency-auditor → git-assistant (release mode) → Release PR
                        ↑
           CRITICAL_CVE → block (fix before releasing)
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
| `CRITICAL_BLOCK` (code-reviewer) | Return to developer with `file:line` fixes | Max 2 |
| `SPEC_VIOLATION` (verifier) | Return to developer with unmet requirements | Max 2 |
| `CRITICAL_CVE` (dependency-auditor) | Release pipeline blocked | 0 — fix CVE first |
| `NO_TESTS` (refactorer) | Block — run test-writer first | N/A |
| Any gate after 2 retries | Escalate to human with full attempt history | — |
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
  agentType: 'developer',     // invokes .claude/agents/developer.md
})

// Run agents in parallel (all start at once, wait for all)
const [a, b, c] = await parallel([
  () => agent('...', { agentType: 'code-reviewer' }),
  () => agent('...', { agentType: 'security-reviewer' }),
  () => agent('...', { agentType: 'dependency-auditor' }),
])

// Log progress (shown in /workflows UI)
log('Stage N complete — advancing...')

// Mark a new phase (groups agents in progress view)
phase('Review')

// Return structured result
return { outcome: 'COMPLETE', summary: '...' }
```

See [SCHEMA.md](../agents/SCHEMA.md) for the full agent frontmatter reference.
