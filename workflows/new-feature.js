export const meta = {
  name: 'new-feature',
  description: 'Full new feature pipeline: operator(build) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Build', detail: 'operator plans, implements with TDD, self-verifies, commits locally' },
    { title: 'Inspect', detail: 'inspector runs adversarial review (secrets/security/deps/quality)' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.task    — required: what to implement (string)
// args.effort  — optional: inspector effort mode (low|medium|high|maximum), default: medium
// args.branch  — optional: feature branch name hint
// args.tier    — optional: force_tier override (frontier|standard|economy) — skips the
//                escalation ladder below and uses this tier for every stage in this run

const task = args && args.task ? args.task : 'implement the feature as described'
const effort = args && args.effort ? args.effort : 'medium'

// ── State machine (deterministic control flow — no agent decides what runs
// next; only TRANSITIONS reads each agent's pipeline_gate) ─────────────────
const STATES = { BUILD: 'BUILD', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.BUILD]:   { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]: { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]: { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:    { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
const MAX_TOKEN_BUDGET = 400_000 // soft ceiling on cumulative output tokens for this pipeline run

// Tier registry mirrored from config/model-tiers.json — workflow scripts have
// no filesystem access, so this can't be require()'d at runtime. Keep both in
// sync if a tier's model ID changes.
const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
// Per-state escalation policy: try default_tier first; only escalate to
// escalation_tier when the BLOCK reason looks complexity-related, never on
// PASS/ESCALATE (a real PASS/ESCALATE result is conclusive either way).
const ESCALATION_POLICY = {
  [STATES.BUILD]:   { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.INSPECT]: { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.SHIP]:    { default_tier: 'economy', escalation_tier: 'standard' },
}
const forceTier = args && args.tier && TIER_MODELS[args.tier] ? args.tier : null
const resolveModel = (state) => TIER_MODELS[forceTier || ESCALATION_POLICY[state].default_tier]
const escalatedModel = (state) => TIER_MODELS[ESCALATION_POLICY[state].escalation_tier]
const isComplexityBlock = (result) => /too many files|ambiguous|complex|architectur/i.test((result && result.summary) || '')

// Per-stage token telemetry — budget.spent() is the only token signal a
// workflow script can read (no fs access here, so this can't write
// telemetry/token-usage.json; it rides along in the return value instead).
const tokenLog = []
const escalations = []
async function trackedAgent(prompt, opts) {
  const before = budget.spent()
  const result = await agent(prompt, opts)
  tokenLog.push({ label: opts.label, tokens: budget.spent() - before })
  return result
}

// Runs an agent at its state's default tier; if it BLOCKs for a
// complexity-related reason (and the caller hasn't forced a tier), retries
// once at the state's escalation tier before the workflow treats it as a
// real BLOCK. Logged to `escalations` for observability regardless of outcome.
async function runWithEscalation(state, prompt, opts) {
  let result = await trackedAgent(prompt, { ...opts, model: resolveModel(state) })
  if (result && result.pipeline_gate === 'BLOCK' && isComplexityBlock(result) && !forceTier) {
    escalations.push({ state, from: ESCALATION_POLICY[state].default_tier, to: ESCALATION_POLICY[state].escalation_tier, reason: result.summary })
    log(`${state}: complexity-related BLOCK — escalating to ${ESCALATION_POLICY[state].escalation_tier} tier and retrying...`)
    result = await trackedAgent(prompt, { ...opts, label: `${opts.label}-escalated`, model: escalatedModel(state) })
  }
  return result
}

function tokenBudgetExceeded() {
  return budget.spent() > MAX_TOKEN_BUDGET
}

// ── Pipeline state — state-passing, not transcript-passing (see
// lib/pipeline-state.mjs for the canonical documented shape; mirrored here
// since workflow scripts can't import it). Agents get the *result* of prior
// stages as structured JSON, never raw conversation history. ─────────────
let pipelineState = {
  task_id: args && args.task_id ? args.task_id : null,
  current_mode: null,
  files_changed: [],
  test_status: null,
  last_error_message: null,
  inspector_findings: [],
  iteration_count: 0,
}
function mergeState(result, role) {
  if (!result) return
  if (result.mode) pipelineState.current_mode = result.mode
  if (Array.isArray(result.files_changed)) {
    pipelineState.files_changed = Array.from(new Set([...pipelineState.files_changed, ...result.files_changed]))
  }
  if (result.test_status) pipelineState.test_status = result.test_status
  if (result.last_error_message !== undefined) pipelineState.last_error_message = result.last_error_message
  if (role === 'inspector' && result.findings) pipelineState.inspector_findings = result.findings
}
function stateContext() {
  return `\n\nPipeline state (structured source of truth for current task status — rely on this, do not guess):\n${JSON.stringify(pipelineState)}`
}

function failResult(stage, reason, findings) {
  return { outcome: 'BLOCKED', stage, reason, findings: findings || [], token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}

// Boundary validation note: every agent() call below passes `schema:
// GATE_SCHEMA`, which forces the subagent through the Workflow tool's
// StructuredOutput layer — malformed/incomplete output never reaches this
// script as a result at all (agent() returns null instead). This satisfies
// Phase 3's "no malformed output downstream" goal without re-implementing
// it; see config/schemas/{operator,inspector}-output.schema.json for the
// full canonical schemas (used by direct/manual invocation + lib/schema-validator.mjs).
const GATE_SCHEMA = {
  type: 'object',
  properties: {
    verdict:       { type: 'string' },
    pipeline_gate: { type: 'string', enum: ['PASS', 'BLOCK', 'ESCALATE'] },
    summary:       { type: 'string' },
    blocking:      { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          file:     { type: 'string' },
          line:     { type: 'number' },
          message:  { type: 'string' },
        },
        required: ['severity', 'message'],
      },
    },
    // Optional pipeline-state-patch fields (Priority 3 Phase 1/5) — merged
    // into `pipelineState` via mergeState() rather than re-parsed prose.
    mode:               { type: 'string' },
    files_changed:      { type: 'array', items: { type: 'string' } },
    test_status:        { type: 'string' },
    last_error_message: { type: 'string' },
    // Non-obvious lessons the agent surfaced this run — see
    // "new_memories" handling note near the Ship stage below.
    new_memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, content: { type: 'string' } },
        required: ['title', 'content'],
      },
    },
  },
  required: ['verdict', 'pipeline_gate', 'summary', 'blocking', 'findings'],
}

function criticalFindings(result) {
  if (!result || !result.findings) return []
  return result.findings.filter(f => f.severity === 'Critical' || f.severity === 'High')
}

function formatFindings(findings) {
  if (!findings || findings.length === 0) return 'No blocking findings.'
  return findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

let currentState = STATES.BUILD

// ── Stage 1: Build ─────────────────────────────────────────────────────────
phase('Build')
log('operator: loading memory, planning, implementing with TDD, self-verifying...')

let buildResult = await runWithEscalation(
  STATES.BUILD,
  `Mode: BUILD\n\nTask: ${task}\n\nLoad relevant .claude/memory/ context, plan if the change touches 3+ files, implement with TDD (Red/Green/Refactor), write tests mapping every code path, run both self-verification gates, and commit locally. Do not push or open a PR yet.`,
  { label: 'operator:build', phase: 'Build', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (tokenBudgetExceeded()) {
  currentState = STATES.FAILED
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: currentState, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

mergeState(buildResult, 'operator')
currentState = buildResult ? (TRANSITIONS[STATES.BUILD][buildResult.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: GATE_FAIL — ${buildResult ? buildResult.summary : 'no response'}`)
  return failResult('operator:build', buildResult ? buildResult.summary : 'No response', buildResult ? buildResult.findings : [])
}
log(`operator: ${buildResult.verdict} — ${buildResult.summary}`)

// ── Stage 2: Inspect (loop CORRECT ⇄ INSPECT, capped at MAX_RETRIES) ───────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? `inspector (${effort}): running adversarial review...` : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await runWithEscalation(
    STATES.INSPECT,
    `Task: ${task}\n\nReview the operator's local commit(s) with effort=${effort}. Run secrets detection (SEC-4), OWASP A01–A10, STRIDE (if applicable), dependency audit, and the two-pass quality review.`,
    { label: `inspector${retries > 0 ? `-r${retries}` : ''}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
  )

  mergeState(inspectResult, 'inspector')

  if (tokenBudgetExceeded()) {
    currentState = STATES.FAILED
    log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
    return { outcome: 'FAILED', stage: currentState, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
  }

  const gate = inspectResult ? inspectResult.pipeline_gate : 'ESCALATE'
  const next = TRANSITIONS[STATES.INSPECT][gate] || STATES.FAILED

  if (next === STATES.FAILED) {
    currentState = STATES.FAILED
    log('ESCALATION: secret or critical issue found — pipeline blocked, zero retries.')
    return failResult('inspector', inspectResult ? inspectResult.summary : 'No response — treated as ESCALATE', inspectResult ? inspectResult.findings : [])
  }

  if (next === STATES.SHIP) { currentState = STATES.SHIP; break }

  // next === STATES.CORRECT
  if (retries >= MAX_RETRIES) { currentState = STATES.FAILED; break }

  currentState = STATES.CORRECT
  pipelineState.iteration_count = retries + 1
  log(`inspector: Critical findings — sending back to operator... (fix ${retries + 1}/${MAX_RETRIES})`)
  const correction = await trackedAgent(
    `Mode: BUILD\n\nTask: ${task}\n\nFix the following Critical findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(criticalFindings(inspectResult))}${stateContext()}\n\nFix only the listed items. Do not change unflagged code. Re-run tests and commit.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.BUILD) }
  )
  mergeState(correction, 'operator')
  retries++
  currentState = STATES.INSPECT
}

if (currentState === STATES.FAILED) {
  log(`inspector: exceeded ${MAX_RETRIES} fix cycle(s) — escalating.`)
  return failResult('inspector', inspectResult ? inspectResult.summary : 'Exceeded retries', inspectResult ? inspectResult.findings : [])
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'} — ${inspectResult ? inspectResult.summary : ''}`)

// ── Stage 3: Ship ────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await trackedAgent(
  `Mode: SHIP\n\nTask: ${task}\n\nRun pre-flight checks, push the branch, create a draft PR with a structured body (What / How / Testing / Checklist), and save lessons learned to .claude/memory/.${stateContext()}`,
  // SHIP is pre-flight checks + PR formatting, no design/security judgment —
  // the economy tier is plenty for it and costs a fraction of standard.
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
)
mergeState(ship, 'operator')

currentState = ship ? (TRANSITIONS[STATES.SHIP][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return failResult('operator:ship', ship ? ship.summary : 'No response', ship ? ship.findings : [])
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

// `new_memories` (Priority 3 Phase 5): the agent still writes to
// .claude/memory/ itself via Bash in SHIP mode — todo.md's "let the
// orchestrator handle ingestion" instruction doesn't hold here, since this
// workflow script has no filesystem access either (same constraint as
// everywhere else in this file). Surfacing new_memories in the structured
// result is additive — it lets hooks/telemetry-writer.mjs log what got
// flagged as a lesson without duplicating or replacing the agent's own write.
const newMemories = [...(buildResult.new_memories || []), ...(inspectResult ? inspectResult.new_memories || [] : []), ...(ship.new_memories || [])]

return {
  outcome: 'COMPLETE',
  pipeline: 'new-feature',
  task,
  stages: ['operator:build', 'inspector', 'operator:ship'],
  summary: ship.summary || 'Draft PR created. All gates passed.',
  token_telemetry: tokenLog,
  escalations,
  pipeline_state: pipelineState,
  new_memories: newMemories,
}
