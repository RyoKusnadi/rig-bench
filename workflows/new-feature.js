export const meta = {
  name: 'new-feature',
  description: 'Full new feature pipeline: scout(manifest+baseline, parallel) → operator(build) → scout(gate) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Scout', detail: 'scout gathers repo manifest and checks baseline health, concurrently' },
    { title: 'Build', detail: 'operator plans, implements with TDD, self-verifies, commits locally' },
    { title: 'Gate', detail: 'scout runs lint/typecheck/test deterministically before paying for inspector' },
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
// next; only TRANSITIONS reads each agent's pipeline_gate). SCOUT/GATE are
// handled by dedicated helpers below rather than this table — scout never
// escalates and isn't part of the operator/inspector retry ladder. ────────
const STATES = { BUILD: 'BUILD', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.BUILD]:   { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]: { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]: { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:    { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
const GATE_MAX_RETRIES = 2 // compiler/lint-fix retries are cheap (economy-tier scout + operator) — a separate, more generous budget from the inspector-driven MAX_RETRIES above
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
// Mirrors lib/agent-wrapper.mjs's safeAgent — can't import it, no fs/Node
// access in workflow scripts, same reason pipelineState/TIER_MODELS are
// mirrored everywhere else. agent() returns null on a schema-validation
// failure (malformed JSON from the subagent); rather than treat that as an
// immediate terminal BLOCK and discard every token already spent on this
// run, retry up to AGENT_MAX_RETRIES times with a correction prompt before
// giving up and returning null (same contract as a bare agent() call).
const AGENT_MAX_RETRIES = 2
async function trackedAgent(prompt, opts, attempt = 0) {
  const before = budget.spent()
  const result = await agent(prompt, attempt === 0 ? opts : { ...opts, label: `${opts.label}-retry${attempt}` })
  tokenLog.push({ label: opts.label, tokens: budget.spent() - before })
  if (result === null && attempt < AGENT_MAX_RETRIES) {
    log(`${opts.label}: schema validation failed — retrying with correction (${attempt + 1}/${AGENT_MAX_RETRIES})...`)
    const correctionPrompt = `${prompt}\n\n[SYSTEM CORRECTION]: Your previous output failed schema validation. You must output a valid JSON object matching this exact schema:\n${JSON.stringify(opts.schema)}\nDo not include any markdown formatting outside the JSON.`
    return trackedAgent(correctionPrompt, opts, attempt + 1)
  }
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
  repo_manifest: null,
  gate_status: null,
}
function mergeState(result, role) {
  if (!result) return
  if (result.mode && role !== 'scout') pipelineState.current_mode = result.mode
  if (Array.isArray(result.files_changed)) {
    pipelineState.files_changed = Array.from(new Set([...pipelineState.files_changed, ...result.files_changed]))
  }
  if (result.test_status) pipelineState.test_status = result.test_status
  if (result.last_error_message !== undefined) pipelineState.last_error_message = result.last_error_message
  if (role === 'inspector' && result.findings) pipelineState.inspector_findings = result.findings
  if (role === 'scout' && result.repo_manifest) pipelineState.repo_manifest = result.repo_manifest
  if (role === 'scout' && result.mode === 'GATE') pipelineState.gate_status = result.pipeline_gate
}
function stateContext() {
  return `\n\nPipeline state (structured source of truth for current task status — rely on this, do not guess):\n${JSON.stringify(pipelineState)}`
}

function failResult(stage, reason, findings) {
  return { outcome: 'BLOCKED', stage, reason, findings: findings || [], token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}

// Boundary validation note: every agent() call below passes `schema:
// GATE_SCHEMA`/`SCOUT_SCHEMA`, which forces the subagent through the
// Workflow tool's StructuredOutput layer — malformed/incomplete output never
// reaches this script as a result at all (agent() returns null instead).
// See config/schemas/{operator,inspector,scout}-output.schema.json for the
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

// Scout's output is deliberately a different shape from GATE_SCHEMA — it
// never carries `findings`/`verdict`, just a mechanical pass/fail and raw
// command output. See config/schemas/scout-output.schema.json.
const SCOUT_SCHEMA = {
  type: 'object',
  properties: {
    mode:           { type: 'string', enum: ['MANIFEST', 'GATE'] },
    pipeline_gate:  { type: 'string', enum: ['PASS', 'BLOCK'] },
    repo_manifest: {
      type: ['object', 'null'],
      properties: {
        changed_files: { type: 'array', items: { type: 'string' } },
        dirs:          { type: 'array', items: { type: 'string' } },
        toolchain:     { type: 'string' },
      },
    },
    raw_output:     { type: 'string' },
    checks_run:     { type: 'array', items: { type: 'string' } },
    checks_skipped: { type: 'array', items: { type: 'string' } },
    summary:        { type: 'string' },
  },
  required: ['mode', 'pipeline_gate', 'summary'],
}

function criticalFindings(result) {
  if (!result || !result.findings) return []
  return result.findings.filter(f => f.severity === 'Critical' || f.severity === 'High')
}

function formatFindings(findings) {
  if (!findings || findings.length === 0) return 'No blocking findings.'
  return findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

// Always economy tier — scout does mechanical command-running only, never
// judgment work, so there's nothing for an escalation ladder to improve.
async function runScoutGate(label) {
  const result = await trackedAgent(
    `Mode: GATE\n\nRun the project's lint, typecheck/build, and test commands against the current working tree and report PASS/BLOCK with raw output.${stateContext()}`,
    { label, phase: 'Gate', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
  )
  mergeState(result, 'scout')
  return result
}

// Loops scout(GATE) ⇄ operator-fix, capped at GATE_MAX_RETRIES, so a
// compiler/lint/test failure never reaches the (expensive) inspector call —
// this is the Phase 3 "fail-fast deterministic gate" short-circuit.
// `buildFixPrompt(gateResult, attempt)` builds the fix prompt for each retry.
async function ensureGatePasses(labelPrefix, buildFixPrompt) {
  let gateRetries = 0
  let gateResult = await runScoutGate(`${labelPrefix}-gate`)
  while (gateResult && gateResult.pipeline_gate === 'BLOCK' && gateRetries < GATE_MAX_RETRIES) {
    log(`scout: GATE BLOCK — ${gateResult.summary} — sending back to operator (fix ${gateRetries + 1}/${GATE_MAX_RETRIES})...`)
    const fix = await trackedAgent(
      buildFixPrompt(gateResult, gateRetries + 1),
      { label: `${labelPrefix}-fix-r${gateRetries + 1}`, phase: 'Gate', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.BUILD) }
    )
    mergeState(fix, 'operator')
    gateRetries++
    gateResult = await runScoutGate(`${labelPrefix}-gate-r${gateRetries}`)
  }
  return gateResult
}

let currentState = STATES.BUILD

// ── Stage 0: Scout (Phase 1 + 2 — DAG + repo manifest) ─────────────────────
// Manifest gathering and baseline health have no data dependency on each
// other, so they run concurrently instead of as two sequential agent calls.
phase('Scout')
log('scout: gathering repo manifest and checking baseline health, in parallel...')

const [manifestResult, baselineGate] = await parallel([
  () => trackedAgent('Mode: MANIFEST\n\nGather the current repo shape — changed files, relevant directories, detected toolchain.', { label: 'scout:manifest', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
  () => trackedAgent('Mode: GATE\n\nRun the project\'s lint, typecheck/build, and test commands against the current baseline (before any change) and report PASS/BLOCK with raw output.', { label: 'scout:baseline-gate', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
])
mergeState(manifestResult, 'scout')
mergeState(baselineGate, 'scout')

const baselineBroken = baselineGate && baselineGate.pipeline_gate === 'BLOCK'
if (baselineBroken) {
  log(`scout: baseline already BLOCK before any change — ${baselineGate.summary}. Operator will fix this first.`)
}
log(`scout: manifest gathered (toolchain: ${manifestResult && manifestResult.repo_manifest ? manifestResult.repo_manifest.toolchain : 'unknown'}).`)

// ── Stage 1: Build ─────────────────────────────────────────────────────────
phase('Build')
log('operator: loading memory, planning, implementing with TDD, self-verifying...')

const baselineNote = baselineBroken
  ? `\n\nNote: the baseline (before your change) already fails scout's deterministic gate:\n${baselineGate.raw_output || baselineGate.summary}\nFix this pre-existing break as part of your work, don't build on top of it.`
  : ''

let buildResult = await runWithEscalation(
  STATES.BUILD,
  `Mode: BUILD\n\nTask: ${task}\n\nLoad relevant .claude/memory/ context, plan if the change touches 3+ files, implement with TDD (Red/Green/Refactor), write tests mapping every code path, run both self-verification gates, and commit locally. Do not push or open a PR yet.${baselineNote}${stateContext()}`,
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

// ── Stage 1.5: Gate (Phase 3 — fail fast, never pay for inspector on code
// that doesn't compile) ─────────────────────────────────────────────────────
phase('Gate')
const postBuildGate = await ensureGatePasses(
  'operator:build',
  (gateResult, attempt) => `Mode: BUILD\n\nTask: ${task}\n\nscout's deterministic GATE check failed (fix attempt ${attempt}/${GATE_MAX_RETRIES}):\n${gateResult.raw_output || gateResult.summary}${stateContext()}\n\nFix only what's needed to make lint/typecheck/build/tests pass again. Do not change unrelated code or re-run the full TDD cycle.`
)

if (tokenBudgetExceeded()) {
  currentState = STATES.FAILED
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: currentState, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

if (!postBuildGate || postBuildGate.pipeline_gate !== 'PASS') {
  log(`scout: GATE still BLOCK after ${GATE_MAX_RETRIES} fix attempt(s) — escalating without spending an inspector call.`)
  return failResult('scout:gate', postBuildGate ? postBuildGate.summary : 'No response', [])
}
log('scout: GATE PASS — proceeding to inspector.')

// ── Stage 2: Inspect (loop CORRECT ⇄ INSPECT, capped at MAX_RETRIES) ───────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? `inspector (${effort}): running adversarial review...` : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await runWithEscalation(
    STATES.INSPECT,
    `Task: ${task}\n\nReview the operator's local commit(s) with effort=${effort}. Run secrets detection (SEC-4), OWASP A01–A10, STRIDE (if applicable), dependency audit, and the two-pass quality review.${stateContext()}`,
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

  // Re-confirm the fix still compiles/lints/tests clean before spending
  // another inspector call on it — same short-circuit as the post-build gate.
  const recheckGate = await ensureGatePasses(
    `operator-fix-r${retries + 1}`,
    (gateResult, attempt) => `Mode: BUILD\n\nTask: ${task}\n\nscout's deterministic GATE check failed after applying inspector's fix (attempt ${attempt}/${GATE_MAX_RETRIES}):\n${gateResult.raw_output || gateResult.summary}${stateContext()}\n\nFix only what's needed to make lint/typecheck/build/tests pass again.`
  )
  if (!recheckGate || recheckGate.pipeline_gate !== 'PASS') {
    currentState = STATES.FAILED
    log(`scout: GATE still BLOCK after the correction — escalating without re-invoking inspector.`)
    return failResult('scout:gate', recheckGate ? recheckGate.summary : 'No response', [])
  }

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

// `new_memories`: the agent still writes to
// .claude/memory/ itself via Bash in SHIP mode — the orchestrator can't
// handle ingestion itself, since this workflow script has no filesystem
// access either (same constraint as
// everywhere else in this file). Surfacing new_memories in the structured
// result is additive — it lets hooks/telemetry-writer.mjs log what got
// flagged as a lesson without duplicating or replacing the agent's own write.
const newMemories = [...(buildResult.new_memories || []), ...(inspectResult ? inspectResult.new_memories || [] : []), ...(ship.new_memories || [])]

return {
  outcome: 'COMPLETE',
  pipeline: 'new-feature',
  task,
  stages: ['scout:manifest+baseline', 'operator:build', 'scout:gate', 'inspector', 'operator:ship'],
  summary: ship.summary || 'Draft PR created. All gates passed.',
  token_telemetry: tokenLog,
  escalations,
  pipeline_state: pipelineState,
  new_memories: newMemories,
}
