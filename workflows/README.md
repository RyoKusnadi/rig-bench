# Workflows

JavaScript workflow scripts that orchestrate `scout`, `operator`, and
`inspector` in deterministic pipelines. Each script handles retry logic,
quality gates, and escalation in code — not in a model's judgment.

---

## How workflows differ from calling agents directly

| | Calling an agent directly | Workflow scripts |
|---|---|---|
| **Control flow** | Model decides what to do next | Code (loops, conditionals) |
| **Parallelism** | Sequential by default | True `parallel()` support |
| **Retry logic** | Prompt-based, may hallucinate | Counted `while` loops |
| **Resumability** | Starts fresh each run | Resume from a `runId` on failure |
| **Debugging** | Read the conversation | Read the script |

Use workflows when you want guaranteed, auditable execution. Call
`operator`/`inspector`/`scout` directly for exploratory or one-off tasks
where flexibility matters more than determinism.

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
cp ../subagents/scout/scout.md your-project/.claude/agents/scout.md
cp ../subagents/researcher/researcher.md your-project/.claude/agents/researcher.md
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
/workflow refactor --args '{"target": "internal/llm/client.go", "goal": "readability"}'
/workflow docs-update --args '{"trigger": "renamed cache.Get() to cache.Fetch()"}'
/workflow release-prep --args '{"version": "1.2.0", "notes": "Adds per-tenant rate limiting"}'
/workflow research --args '{"intake": {"topic": "..."}}'
/workflow autotune --args '{"target": "subagents/scout/scout.md", "objective": "fewer false-positive GATE BLOCKs"}'
```

### Programmatically (via the Workflow tool)

```javascript
Workflow({ name: 'new-feature', args: { task: 'add JWT refresh token support', effort: 'high' } })
Workflow({ name: 'bug-fix', args: { bug: 'nil pointer in cache.Get()', known_cause: true } })
Workflow({ name: 'pr-review', args: { pr: 15, spec: 'Rate limit must return 429 with Retry-After header' } })
Workflow({ name: 'refactor', args: { target: 'internal/cache/lru.go', goal: 'performance' } })
Workflow({ name: 'docs-update', args: { trigger: 'new /v2/support endpoint', scope: 'README.md, openapi.yaml' } })
Workflow({ name: 'release-prep', args: { version: '1.2.0', branch: 'main' } })
Workflow({ name: 'research', args: { intake: parsedIntakeJson } })
Workflow({ name: 'autotune', args: { target: 'subagents/researcher/researcher.md', objective: 'higher fact-verification rate', max_iterations: 6 } })
```

### Resume a failed run

```javascript
Workflow({ scriptPath: '.claude/workflows/new-feature.js', resumeFromRunId: 'wf_abc123' })
```

---

## Scout stage

Every workflow (except `pr-review.js`, which folds it into its own Stage 0)
opens with a **Scout** stage before any operator/inspector call. `scout` is a
new, minimal, economy-tier agent — it never reviews code or forms an
opinion; it only runs deterministic commands and reports the raw result. It
exists to buy back two kinds of waste this harness used to pay for on every
run:

1. **Repeated discovery.** Operator and inspector each independently ran
   `ls`/`tree`/`find`/`git status` at the start of their own task to build a
   mental map of the repo — twice per pipeline, from scratch, at
   standard/frontier-tier reasoning cost. `scout` MANIFEST mode runs that
   discovery once, at economy tier, and the result (`repo_manifest`) is
   threaded into every later prompt via `pipelineState` — both agents are
   told to skip their own `ls`/`tree`/`find`/`git status` when it's present.
2. **Expensive review of code that doesn't even compile.** Before this
   change, a broken build only surfaced once `inspector` (standard/frontier
   tier) ran its static-analysis step — by which point the pipeline had
   already paid for a full review pass on code that fails at `tsc --noEmit`
   or `go build`. `scout` GATE mode runs the project's own lint/typecheck/
   build/test commands and reports `PASS`/`BLOCK` with raw output; on
   `BLOCK`, the workflow routes straight back to `operator` for a fix and
   **never calls `inspector`** until the gate passes. The fix↔gate loop is
   capped at `GATE_MAX_RETRIES` (2) — a separate, more generous budget than
   the inspector-driven `MAX_RETRIES` (1), since these retries are cheap
   (economy-tier `scout` + `operator`).

Where a workflow both gathers a manifest and checks baseline health (every
code-writing workflow — `new-feature`, `bug-fix`, `refactor`), the two scout
calls run **concurrently** via `parallel()` — they have no data dependency
on each other. This is the harness's first real DAG instead of a strictly
sequential chain: two independent agent calls firing at once instead of
waiting in line.

`docs-update.js` and `release-prep.js` use Scout in MANIFEST-only mode (no
GATE stage) — neither writes compiled/linted source in the traditional
sense, so a deterministic build gate doesn't apply; they still get the
discovery savings.

This doesn't reverse the "Lean 2" agent-count decision (see Declined below)
— `scout` does no judgment work that competes with `inspector`'s role; it's
a command runner, not a third reviewer.

---

## Workflow reference

### `new-feature.js`

Full feature delivery pipeline with a fail-fast gate and a quality gate loop.

```
scout (MANIFEST ∥ baseline GATE) ──┐
                                    ▼
                          operator (BUILD) ─┐
                                             ▼
                          scout (GATE) ─ BLOCK, retry ≤ 2 → operator (fix) ─┐
                                             │                              │
                                             └────────── re-gate ───────────┘
                                             │ PASS
                                             ▼
                          inspector ─ BLOCK, retry ≤ 1 → operator (fix) → scout (re-gate) ─┐
                                             │                                              │
                                             └────────────────── re-inspect ─────────────────┘
                                             │ PASS
                                             ▼
                                   operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | What to implement |
| `effort` | string | No | `low` / `medium` / `high` / `maximum` — inspector's effort (default: `medium`) |
| `branch` | string | No | Feature branch name hint |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — pins every operator/inspector stage, skips escalation (`scout` always stays `economy`) |

**Returns** `{ outcome: 'COMPLETE'|'BLOCKED'|'FAILED', stage, reason?, findings?, token_telemetry, escalations, pipeline_state, new_memories }` — `COMPLETE` includes the rest of `operator`'s SHIP-mode result (PR URL etc); `BLOCKED` means a gate/inspector retry cap was hit; `FAILED` means the token budget was exceeded mid-run.

---

### `bug-fix.js`

Bug fix from diagnosis to PR, with the same scout/gate short-circuit as `new-feature.js`.

```
scout (MANIFEST ∥ baseline GATE) → operator (BUILD: diagnose + fix)
  → scout (GATE) ─ BLOCK, retry ≤ 2 → operator (fix) ─┐
                       │                               │
                       └──────────── re-gate ──────────┘
                       │ PASS
                       ▼
  → inspector ─ retry ≤ 1 → operator (fix) → scout (re-gate) → operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `bug` | string | Yes | Bug description or failing test name |
| `known_cause` | boolean | No | Set `true` to skip diagnosis (default: `false`) |
| `stack_trace` | string | No | Paste the stack trace for better diagnosis context |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — pins every operator/inspector stage, skips escalation |

**Returns** `{ outcome: 'COMPLETE'|'BLOCKED'|'FAILED', stage, reason?, findings?, token_telemetry, escalations, pipeline_state, new_memories }` — same shape as `new-feature.js`.

---

### `refactor.js`

Cleanup pipeline that requires tests to exist before starting.

```
scout (MANIFEST ∥ baseline GATE) → operator (REFACTOR)
  → scout (GATE) ─ BLOCK, retry ≤ 2 → operator (fix) ─┐
                       │                               │
                       └──────────── re-gate ──────────┘
                       │ PASS
                       ▼
  → inspector ─ retry ≤ 1 → operator (fix) → scout (re-gate) → operator (SHIP) → Draft PR
       ↑
  NO_TESTS → block (run new-feature/bug-fix in BUILD mode to add tests first)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | File, module, or smell to refactor |
| `goal` | string | No | `readability` / `performance` / `extensibility` (default: `readability`) |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — pins every operator/inspector stage, skips escalation |

**Returns** `{ outcome: 'COMPLETE'|'BLOCKED'|'FAILED', stage, reason?, findings?, token_telemetry, escalations, pipeline_state, new_memories }` — `BLOCKED` also covers the `NO_TESTS` baseline-check case (`stage: 'operator:refactor'`).

---

### `pr-review.js`

Single-pass review across secrets, security, dependencies, and code quality
— with a fail-fast gate that skips `inspector` entirely if the diff doesn't
even build.

```
scout (MANIFEST ∥ GATE) ─ GATE BLOCK → return findings immediately, never call inspector
                       │ GATE PASS
                       ▼
inspector ── secrets (SEC-4) → OWASP/STRIDE → dependency/CVE audit → quality (+ spec check if `spec` given)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `pr` | number | No | PR number — omit to review current HEAD diff |
| `effort` | string | No | inspector effort mode (default: `medium`) |
| `spec` | string | No | Requirements text — when present, inspector also checks spec compliance |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — skips the effort-based default tier for the inspect stage |

**Returns** `{ outcome: 'COMPLETE'|'REVIEW_FINDINGS'|'BLOCKED'|'FAILED', merged_findings, token_telemetry, escalations, new_memories }` — `COMPLETE` means inspector's `pipeline_gate` was `PASS` with no findings; `REVIEW_FINDINGS` means it passed gate but has non-blocking findings to report; `BLOCKED` is the scout GATE short-circuit (build doesn't compile — `inspector` never ran).

---

### `docs-update.js`

Keeps docs in sync after a code change.

```
scout (MANIFEST) → operator (DOCS) → inspector (light review) → operator (SHIP) → Draft PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `trigger` | string | Yes | What changed that needs docs updating |
| `scope` | string | No | Specific files or sections to update |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — pins every operator/inspector stage, skips escalation |

**Returns** `{ outcome: 'COMPLETE'|'BLOCKED'|'FAILED', stage, reason?, findings?, token_telemetry, escalations, pipeline_state, new_memories }` — `BLOCKED` covers an `EXAMPLE_FAIL` verdict (a documented example no longer runs), inspector findings, or a preflight failure at SHIP.

---

### `release-prep.js`

Pre-release security + CVE gate, then creates a release PR with CHANGELOG.

```
scout (MANIFEST) → inspector (effort=maximum) ── ESCALATION / CRITICAL_CVE → stop
                                  ↓
                       operator (SHIP, release mode) → Release PR
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `version` | string | Yes | Version string, e.g. `"1.2.0"` |
| `branch` | string | No | Target branch (default: `main`) |
| `notes` | string | No | Release highlights for CHANGELOG |
| `tier` | string | No | `force_tier` override for the Release stage only — the Audit stage always uses `frontier` |

**Returns** `{ outcome: 'COMPLETE'|'BLOCKED'|'FAILED', stage?, reason?, token_telemetry, escalations, pipeline_state?, new_memories? }` — `BLOCKED` covers an audit `ESCALATE`/`CRITICAL_CVE` verdict (release stage never runs) or a SHIP-stage preflight failure.

---

### `research.js`

Questionnaire-driven research loop (`todo.md` "Ralph Loop", Phases 4–5). No
`scout` stage — there's no code/build/lint to gate, just an iterative
search-verify loop followed by a single synthesis call.

```
researcher (RESEARCH) ── confidence < threshold && iterations < max && not stagnated ──┐
        │                                                                                │
        └────────────────────────────────── loop ───────────────────────────────────────┘
        │ confidence >= threshold, max_iterations reached, or stagnated (2 flat iterations)
        ▼
researcher (SYNTHESIZE, frontier tier) ── report from verified facts only
        ▼
return research_state + report (frontmatter fields + body_markdown, or null if synthesis BLOCKed)
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `intake` | object | Yes | Parsed `research/{topic}/intake.json` contents (see `config/schemas/research-intake.schema.json`) — pass the object itself, never a path; this script has no filesystem access |
| `tier` | string | No | `force_tier` override (`frontier`/`standard`/`economy`) — pins every `researcher` call, loop **and** synthesis (default: `standard` for the loop, `frontier` for synthesis) |

Confidence is computed deterministically in the workflow script after every
iteration (fraction of `focus_areas` covered by a `verified` fact) — `researcher`
never self-reports it or decides the loop is done. The loop stops at
`completed: true` once confidence clears `validation_threshold`; otherwise
`completed: false` and `research_state.stop_reason` is one of
`max_iterations` (the iteration cap was hit) or `stagnated` (confidence
improved by less than `0.05` for 2 consecutive iterations — `todo.md`
"Stagnation and Infinite Loops in the Research Agent": stops the loop early
instead of burning the remaining iteration/token budget chasing a confidence
score that's stopped moving). Independently, if `researcher`'s
`next_search_query` comes back identical to the query it was just given (the
agent stuck re-issuing the same search), the workflow force-mutates it
(appending `" site:reddit.com"` or `" alternative to"`, alternating) before
the next iteration rather than repeating the dead-end search verbatim. Both
behaviors are mirrored from `lib/research-state.mjs` (`nextStagnantStreak`,
`mutateQuery` — documented reference, not importable into the workflow
script itself).

Either way the loop stops, a single `SYNTHESIZE` call still runs afterward (a
below-threshold/partial report just says so up front, see `researcher.md`
SYNTHESIZE mode step 7). The returned `report` (`{frontmatter, body_markdown}`)
deliberately omits `generated_at` — this script can't call
`Date.now()`/`new Date()` (Workflow tool constraint), so the caller stamps it
and writes `research/{topic}/TITLE.MD` itself (see the `/research` command).
`report` is `null` if the synthesis call BLOCKed (e.g. zero verified facts)
or returned no valid response — `research_state` is still returned in that
case so nothing is lost.

---

### `autotune.js`

Karpathy-autoresearch-style self-improvement loop for one agent `.md` file —
mutate one thing, measure with binary criteria, keep or discard, repeat.
Reuses existing agents via new modes instead of adding a 5th/6th agent:
`operator` gets `TUNE` (mutate/commit/revert), `inspector` gets `EVALUATE`
(define criteria / score, blind to the mutation rationale — avoids the
"evaluator grades charitably when it knows the intent" bias), `scout` gets
`VALIDATE_AGENT_FILE` (a cheap, economy-tier structural sanity check that
catches a corrupted mutation before it can sabotage its own evaluation).

```
inspector (EVALUATE/DEFINE_CRITERIA) ──► 4-6 binary criteria + test cases
              ▼
inspector (EVALUATE/SCORE) ──► baseline score
              ▼
┌─ operator (TUNE/MUTATE, one operator at a time) ──────────────┐
│         ▼                                                      │
│  scout (VALIDATE_AGENT_FILE) ── BLOCK ──► operator (REVERT) ───┤
│         │ PASS                                                 │
│         ▼                                                      │
│  inspector (EVALUATE/SCORE, blind to rationale)                │
│         ▼                                                      │
│  score regressed? ──► operator (REVERT)                        │
│  score improved/equal? ──► operator (COMMIT, local only)       │
└─ loop until 3 consecutive perfect scores, or max_iterations ──┘
              ▼
Return: baseline_score, final_score, tuning_log, kept/discarded counts, stop_reason
```

| Arg | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | One of `subagents/scout/scout.md`, `subagents/researcher/researcher.md` — hardcoded v1 allowlist, enforced both in this script and as a model-layer refusal in `operator.md`'s TUNE mode. `operator.md`/`inspector.md` are deliberately excluded: they ARE this loop's mutator/evaluator, so mutating either risks a corrupted agent judging itself with no independent check left |
| `objective` | string | Yes | What "better" means for this target, in plain language |
| `max_iterations` | number | No | Default 8 |
| `stop_streak` | number | No | Consecutive perfect scores before stopping early — default 3 |
| `tier` | string | No | `force_tier` override for `operator`/`inspector` calls — `scout` always stays `economy` |

Each kept mutation is a **local commit only** — same posture as every other
workflow's `operator` calls (push/PR is always a separate, explicit step).
A discarded mutation is `git checkout`'d before the next iteration, so an
uncommitted bad mutation never lingers in the working tree across iterations.

---

Every workflow above also accepts an optional `task_id` (string) — seeds
`pipelineState.task_id` (see "State-passing, not transcript-passing" in the
root [README.md](../README.md)). Omitted from each table since it's not
pipeline-specific: pass it if you want to correlate a run's
`pipeline_state`/telemetry with an external tracker (ticket ID, issue
number); there's no auto-generated ID, since workflow scripts can't call
`Date.now()`/`Math.random()` to mint one themselves.

---

## Quality gates summary

Every workflow enforces these gates:

| Signal | Action | Retries |
|---|---|---|
| `SECRET_FOUND` / `ESCALATION` | Pipeline stops immediately | **0** — human must rotate credential |
| `GATE_BLOCK` (scout, deterministic lint/typecheck/build/test failure) | Return to operator with raw command output; never reaches inspector | Max 2 (`GATE_MAX_RETRIES`) |
| `CRITICAL_BLOCK` (inspector) | Return to operator with `file:line` fixes | Max 1 |
| `CRITICAL_CVE` (inspector) | Release pipeline blocked | 0 — fix CVE first |
| `NO_TESTS` (operator REFACTOR mode) | Block — run BUILD mode to add tests first | N/A |
| Any gate after its retry cap | Escalate to human with full attempt history | — |
| `agent()` returns `null` (schema validation failed / terminal error) | Treated as `BLOCK` / `ESCALATE` | — |

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

// Run agents in parallel (all start at once, wait for all) — the pattern
// every workflow now uses for its Scout stage, since manifest-gathering and
// baseline-gate-checking have no dependency on each other
const [manifestResult, baselineGate] = await parallel([
  () => agent('Mode: MANIFEST\n\n...', { agentType: 'scout', schema: SCOUT_SCHEMA }),
  () => agent('Mode: GATE\n\n...', { agentType: 'scout', schema: SCOUT_SCHEMA }),
])

// Log progress (shown in /workflows UI)
log('Stage N complete — advancing...')

// Mark a new phase (groups agents in progress view)
phase('Review')

// Return structured result
return { outcome: 'COMPLETE', summary: '...' }
```

State machine + tier resolution (the pattern every `workflows/*.js` now follows):

```javascript
const STATES = { DO_THING: 'DO_THING', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = { [STATES.DO_THING]: { PASS: STATES.DONE, BLOCK: STATES.FAILED } }
const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = { [STATES.DO_THING]: { default_tier: 'standard', escalation_tier: 'frontier' } }
const forceTier = args && args.tier && TIER_MODELS[args.tier] ? args.tier : null
const resolveModel = (state) => TIER_MODELS[forceTier || ESCALATION_POLICY[state].default_tier]

const result = await agent('...', { agentType: 'operator', schema: GATE_SCHEMA, model: resolveModel(STATES.DO_THING) })
const next = result ? (TRANSITIONS[STATES.DO_THING][result.pipeline_gate] || STATES.FAILED) : STATES.FAILED
```

Scout/gate short-circuit loop (the pattern every code-writing workflow uses
between its build-like stage and `inspector`):

```javascript
async function ensureGatePasses(labelPrefix, buildFixPrompt) {
  let gateRetries = 0
  let gateResult = await runScoutGate(`${labelPrefix}-gate`) // scout, Mode: GATE
  while (gateResult && gateResult.pipeline_gate === 'BLOCK' && gateRetries < GATE_MAX_RETRIES) {
    const fix = await agent(buildFixPrompt(gateResult, gateRetries + 1), { agentType: 'operator', schema: GATE_SCHEMA })
    mergeState(fix, 'operator')
    gateRetries++
    gateResult = await runScoutGate(`${labelPrefix}-gate-r${gateRetries}`)
  }
  return gateResult // PASS, or still BLOCK after GATE_MAX_RETRIES — caller decides whether to escalate
}
```

State-passing (mirror `lib/pipeline-state.mjs`'s shape — can't `import` it, no fs/Node access in workflow scripts):

```javascript
let pipelineState = { task_id: null, current_mode: null, files_changed: [], test_status: null, last_error_message: null, inspector_findings: [], iteration_count: 0, repo_manifest: null, gate_status: null }
function mergeState(result, role) {
  if (!result) return
  if (result.mode && role !== 'scout') pipelineState.current_mode = result.mode
  if (Array.isArray(result.files_changed)) pipelineState.files_changed = Array.from(new Set([...pipelineState.files_changed, ...result.files_changed]))
  if (result.test_status) pipelineState.test_status = result.test_status
  if (role === 'inspector' && result.findings) pipelineState.inspector_findings = result.findings
  if (role === 'scout' && result.repo_manifest) pipelineState.repo_manifest = result.repo_manifest
  if (role === 'scout' && result.mode === 'GATE') pipelineState.gate_status = result.pipeline_gate
}
// After each agent() call: mergeState(result, 'operator' | 'inspector' | 'scout')
// Before the next call: append `\n\nPipeline state: ${JSON.stringify(pipelineState)}` to its prompt
```

After a run, `hooks/telemetry-writer.mjs` persists the returned
`token_telemetry`/`escalations` to `telemetry/runs/*.jsonl` automatically —
no extra code needed in the workflow script itself. Run
`node scripts/report.mjs` to see aggregate stats across all past runs.

See [SCHEMA.md](../subagents/SCHEMA.md) for the full agent frontmatter reference.

---

## Prompt minimality (audited)

Every `agent()` call across all six workflows passes only a high-level task
description (the caller's `task`/`bug`/`target`/`trigger`, plus retry
findings already extracted into `{severity, file, line, message}`, plus the
`repo_manifest`/`gate_status` `scout` already gathered — never raw text).
None inline a `git diff`, full file contents, or a raw tool-output blob into
the prompt string — `operator` and `inspector` are expected to `Grep`/`Read`
their own way to the relevant code (see "Context isolation" at the top of
each agent's `.md`); `scout`'s `raw_output` field is the one deliberate
exception, since pasting a failing command's real output verbatim is the
entire point of the GATE short-circuit. If you add a workflow, keep that
invariant: the prompt is the *what*, not the *where* — let the agent fetch
the *where* itself, so spawn-time context stays proportional to the task,
not the diff size.

## Model routing per call

Every workflow resolves `agent()`'s `model` override from a `TIER_MODELS`
constant (mirroring `config/model-tiers.json`: `frontier`→Opus,
`standard`→Sonnet, `economy`→Haiku) via each state's `ESCALATION_POLICY`
entry, not a hand-picked model string per call. This is the same routing
this harness always used, just made explicit and table-driven instead of an
ad-hoc per-call comment:

| State (most workflows) | `default_tier` | `escalation_tier` | Why |
|---|---|---|---|
| SCOUT (MANIFEST or GATE) | `economy` (fixed) | none — never escalated | Mechanical command-running only; there's no judgment call a bigger model would do better. |
| BUILD / FIX / REFACTOR | `standard` | `frontier` | Implementation needs real reasoning by default; escalate only on a complexity-flagged BLOCK. |
| INSPECT | `standard` | `frontier` | Same logic — most reviews don't need frontier reasoning, but an ambiguous BLOCK might. |
| SHIP | `economy` | `standard` | Pre-flight checks + PR/CHANGELOG formatting — no design or security judgment involved. |
| DOCS (docs-update only) | `economy` | `standard` | Formatting/changelog work, not design judgment. |
| AUDIT (release-prep only) | `frontier` (fixed) | `frontier` | The last gate before a release ships — the one spot always worth paying for frontier reasoning; `force_tier` cannot downgrade it. |

**Escalation logic** (`runWithEscalation` in each workflow): try `default_tier`
first; if the result is `pipeline_gate: BLOCK` and the `summary` text looks
complexity-related ("too many files", "ambiguous", "complex", "architect…"),
retry once at `escalation_tier` before treating it as a real block. A `PASS`
or `ESCALATE` never triggers escalation. Every escalation is logged to the
run's `escalations` array (and persisted by `hooks/telemetry-writer.mjs`).
`scout` calls never go through this ladder — they're always `economy`.

**`force_tier` override**: pass `args.tier` (`frontier`/`standard`/`economy`)
to pin every non-AUDIT, non-SCOUT stage in a run to one tier and skip the
escalation ladder entirely — for a critical task where first-attempt quality
matters more than cost, or a trivial one where economy is enough end to end.

`inspector`'s single-pass review (secrets + OWASP/STRIDE + deps + quality in
one spawn) deliberately is **not** split across models per dimension — see
below for the full rationale.

**Why `inspector` isn't split by dimension (quality vs. security) onto
different models:** `inspector` runs secrets, OWASP/STRIDE, dependency audit,
and code quality in **one pass, one spawn** — that consolidation (replacing 3
separate reviewers) is the entire point of the "Lean 2" roster and the
spawn-tax reduction it bought. Routing each dimension to a different model
would mean splitting that single pass back into multiple `agent()` calls,
which reintroduces the per-spawn overhead this harness was built to
eliminate. If a specific pipeline turns out to need frontier-level security
reasoning on every run (not just `release-prep`), override `model` on that
pipeline's `inspector` call — don't fragment the agent itself. `scout` is not
an exception to this: it doesn't do review work, so adding it doesn't
re-fragment `inspector`'s pass — see "Declined" below.

---

## Already true by construction (no code change needed)

A few generic multi-agent-harness optimization checklist items turn out to
already hold here, as a direct consequence of how the Workflow tool and this
repo's agent design work — not because anyone hand-implemented them:

- **Prompt caching ordering** (static content first, dynamic content last).
  Each agent's system prompt (`operator.md`/`inspector.md`/`scout.md`) is the
  stable, cacheable prefix; the `agent()` call's `prompt` argument — the task
  description — is the only dynamic part, and it's a separate string, not
  interleaved with the static prompt. There's no reordering to do.
- **Structured outputs over conversational text.** Every `agent()` call
  across all six workflows passes a `schema` option (`GATE_SCHEMA` or
  `SCOUT_SCHEMA`), which forces the subagent through the Workflow tool's
  `StructuredOutput` tool-call layer — this was already true before this
  round, just confirmed again here.
- **Lightweight supervisor / orchestration in code, not the model.** This
  *is* what `workflows/*.js` are — `phase()`/`agent()`/`parallel()` are
  deterministic JS; the LLM only executes the task handed to it for that
  node. There's no "heavy orchestrator model" to lighten. Every workflow now
  also declares its control flow as an explicit `STATES` enum and a
  `TRANSITIONS` map (`{state: {PASS: nextState, BLOCK: nextState, ...}}`) —
  the `if`/`while` logic reads `pipeline_gate` through that table instead of
  branching ad hoc, so "what can follow what" is a data structure you can
  read at a glance, not something you have to trace through control flow.
  `scout`'s GATE retry loop is the one exception kept as explicit code
  (`ensureGatePasses`) rather than the table, since it's a bounded sub-loop
  nested inside a single state, not a state transition itself.
- **Boundary schema validation between handoffs.** The `schema` option on
  `agent()` already validates structurally at the tool-call layer per the
  Workflow tool's own contract — hand-rolling a second validation pass in
  workflow JS would just duplicate what the harness already guarantees.
  `config/schemas/{operator,inspector,scout}-output.schema.json` now exist as
  the canonical, documented schemas — used by `lib/schema-validator.mjs` for
  the direct/manual invocation path (where there's no Workflow tool
  enforcing this), and as the source every workflow's inline
  `GATE_SCHEMA`/`SCOUT_SCHEMA` is a subset of.
- **Context isolation per agent / no leaked conversation history between
  stages.** Each `agent()` call spawns an independent subagent with no
  shared transcript — there's no "session" to `/clear` between stages,
  because there was never a continuous one to begin with. A manual
  `/clear`-equivalent would add an op with nothing to clean up.
- **State-passing instead of transcript-passing.** Every `agent()` call's
  prompt was already a `task`/`bug`/`target` description plus extracted
  `{severity, file, line, message}` findings — never raw response text or
  history (see "Prompt minimality" above). What's new is formalizing the
  carried-forward data as a `pipelineState` object (see "State-passing, not
  transcript-passing" in the root [README.md](../README.md)) instead of
  ad-hoc prose interpolation — now extended with `repo_manifest` and
  `gate_status` for the same reason.

## Declined

- **Splitting `inspector`'s single pass into per-dimension agents to enable
  parallel execution.** The brief that motivated the Scout stage initially
  suggested running secrets/OWASP/deps/quality checks as separate concurrent
  agents. Declined for the same reason as below — it reverses the Lean-2
  consolidation. `scout`'s MANIFEST/GATE calls are the actual DAG
  opportunity instead: they're mechanical, not judgment work, so running
  them concurrently doesn't fragment a review pass.
- **Vector search implemented via neural embeddings.** Vector retrieval
  itself is no longer declined — `lib/memory-store.mjs` provides it — but
  the *neural-embedding* version (local model or paid API) was declined in
  favor of plain TF-IDF, which needs zero API calls and no model download
  for the corpus size this repo actually has. See "Vector memory retrieval"
  in the root [README.md](../README.md).
- **Retrieval driven from `workflows/*.js` instead of from inside the
  agent.** Priority 3's plan called for the JS orchestrator to query the
  vector store and inject a `<long_term_memory>` block before each
  `agent()` call — impossible here, since workflow scripts have no
  filesystem/Node API access and can't import `lib/memory-store.mjs` or run
  any script. `operator`/`inspector` query it themselves via Bash instead
  (Step 0 / Context isolation section of each `.md`).
- **A dedicated `memory-manager` agent.** Raised as "optional but
  recommended" — declined because it directly reverses this repo's Lean-2
  consolidation (15 agents → 2, specifically to cut spawn-tax). See "Vector
  memory retrieval" in the root README for what covers the same need instead.
  `scout` (Lean-2 → 3 agents) is a deliberate, narrow exception to this
  rule: it adds zero judgment surface, only mechanical command-running, so
  it doesn't reintroduce the reviewer-sprawl this rule guards against.
- **Mid-loop context compaction for a single agent call (`lib/compactor.js`).**
  Needed the orchestrator to see a single `agent()` call's token usage
  *during* its run and reset its history mid-flight — not possible; each
  call is atomic from the orchestrator's side (no visibility until it
  returns). Claude Code's own `PreCompact` hook already covers this — see
  "State-passing, not transcript-passing" in the root README.
- **Dynamic MCP server enable/disable per workflow stage.** No such
  hook/API is exposed to project `settings.json` or workflow scripts. Tool
  (including MCP tool) access is already scoped per agent via the
  `tools:`/`disallowedTools:` YAML frontmatter in each agent's `.md` — that's
  the real, supported mechanism for this, already in place.
- **Hard, JS-enforced token budgets with forced mid-call termination.** No
  such primitive exists in `agent()` — no timeout/max-tokens parameter, no
  kill switch once a call is in flight. Each workflow's `MAX_TOKEN_BUDGET`
  constant is a **soft, checkpoint-based** guard instead — checked after each
  stage via `budget.spent()`, never mid-call. See "Token Telemetry" in the
  root [README.md](../README.md).
- **A JS-level "repo manifest" built directly in the workflow script** (the
  literal ask behind the Scout stage's Phase 2 origin). Workflow script
  bodies have no filesystem/Bash/Node API access at all — `git status`,
  `tree`, etc. can only run inside a spawned subagent. `scout` MANIFEST mode
  is the closest equivalent the Workflow tool's architecture allows: one
  cheap, dedicated agent call instead of JS-level shell access.
