export const meta = {
  name: 'refactor',
  description: 'Refactor pipeline: scout(manifest+baseline, parallel) → operator(refactor) → scout(gate) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Scout', detail: 'scout gathers repo manifest and checks baseline health, concurrently' },
    { title: 'Refactor', detail: 'operator confirms test baseline, refactors smell-by-smell' },
    { title: 'Gate', detail: 'scout runs lint/typecheck/test deterministically before paying for inspector' },
    { title: 'Inspect', detail: 'inspector confirms behavior unchanged and quality improved' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.target — required: which file/module/smell to refactor
// args.goal   — optional: readability | performance | extensibility (default: readability)
// args.tier   — optional: force_tier override (frontier|standard|economy) — skips the
//               escalation ladder below and uses this tier for every stage in this run

const target = args && args.target ? args.target : 'the specified module'
const goal = args && args.goal ? args.goal : 'readability'

// ── State machine (deterministic control flow). SCOUT/GATE are handled by
// dedicated helpers below rather than this table. ─────────────────────────
const STATES = { REFACTOR: 'REFACTOR', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.REFACTOR]: { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]:  { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]:  { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:     { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
const GATE_MAX_RETRIES = 2
const MAX_TOKEN_BUDGET = 400_000

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = {
  [STATES.REFACTOR]: { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.INSPECT]:  { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.SHIP]:     { default_tier: 'economy', escalation_tier: 'standard' },
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

async function runWithEscalation(state, prompt, opts) {
  let result = await trackedAgent(prompt, { ...opts, model: resolveModel(state) })
  if (result && result.pipeline_gate === 'BLOCK' && isComplexityBlock(result) && !forceTier) {
    escalations.push({ state, from: ESCALATION_POLICY[state].default_tier, to: ESCALATION_POLICY[state].escalation_tier, reason: result.summary })
    log(`${state}: complexity-related BLOCK — escalating to ${ESCALATION_POLICY[state].escalation_tier} tier and retrying...`)
    result = await trackedAgent(prompt, { ...opts, label: `${opts.label}-escalated`, model: escalatedModel(state) })
  }
  return result
}

function tokenBudgetExceeded() { return budget.spent() > MAX_TOKEN_BUDGET }

// ── Pipeline state — state-passing, not transcript-passing (see
// lib/pipeline-state.mjs for the canonical documented shape; mirrored here
// since workflow scripts can't import it). ─────────────────────────────────
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

// Boundary validation: every agent() call below passes `schema:
// GATE_SCHEMA`/`SCOUT_SCHEMA`, which forces validated structured output via
// the Workflow tool — malformed output never reaches this script (agent()
// returns null instead). See config/schemas/{operator,inspector,scout}-output.schema.json
// for the canonical schemas used by direct/manual invocation + lib/schema-validator.mjs.
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
    mode:               { type: 'string' },
    files_changed:      { type: 'array', items: { type: 'string' } },
    test_status:        { type: 'string' },
    last_error_message: { type: 'string' },
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

function formatFindings(result) {
  if (!result || !result.findings || result.findings.length === 0) return 'No findings.'
  return result.findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

async function runScoutGate(label) {
  const result = await trackedAgent(
    `Mode: GATE\n\nRun the project's lint, typecheck/build, and test commands against the current working tree and report PASS/BLOCK with raw output.${stateContext()}`,
    { label, phase: 'Gate', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
  )
  mergeState(result, 'scout')
  return result
}

// Loops scout(GATE) ⇄ operator-fix, capped at GATE_MAX_RETRIES — a
// regression/compile failure never reaches the (expensive) inspector call.
async function ensureGatePasses(labelPrefix, buildFixPrompt) {
  let gateRetries = 0
  let gateResult = await runScoutGate(`${labelPrefix}-gate`)
  while (gateResult && gateResult.pipeline_gate === 'BLOCK' && gateRetries < GATE_MAX_RETRIES) {
    log(`scout: GATE BLOCK — ${gateResult.summary} — sending back to operator (fix ${gateRetries + 1}/${GATE_MAX_RETRIES})...`)
    const fix = await trackedAgent(
      buildFixPrompt(gateResult, gateRetries + 1),
      { label: `${labelPrefix}-fix-r${gateRetries + 1}`, phase: 'Gate', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.REFACTOR) }
    )
    mergeState(fix, 'operator')
    gateRetries++
    gateResult = await runScoutGate(`${labelPrefix}-gate-r${gateRetries}`)
  }
  return gateResult
}

let currentState = STATES.REFACTOR

// ── Stage 0: Scout (Phase 1 + 2 — DAG + repo manifest) ─────────────────────
phase('Scout')
log('scout: gathering repo manifest and checking baseline health, in parallel...')

const [manifestResult, baselineGate] = await parallel([
  () => trackedAgent('Mode: MANIFEST\n\nGather the current repo shape — changed files, relevant directories, detected toolchain.', { label: 'scout:manifest', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
  () => trackedAgent('Mode: GATE\n\nRun the project\'s lint, typecheck/build, and test commands against the current baseline (before any change) and report PASS/BLOCK with raw output.', { label: 'scout:baseline-gate', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
])
mergeState(manifestResult, 'scout')
mergeState(baselineGate, 'scout')

const baselineBroken = baselineGate && baselineGate.pipeline_gate === 'BLOCK'
log(baselineBroken
  ? `scout: baseline already BLOCK before refactoring — ${baselineGate.summary}. Refactoring requires a passing baseline; operator's NO_TESTS/baseline check will catch this.`
  : `scout: manifest gathered (toolchain: ${manifestResult && manifestResult.repo_manifest ? manifestResult.repo_manifest.toolchain : 'unknown'}).`)

// ── Stage 1: Refactor ─────────────────────────────────────────────────────
phase('Refactor')
log('operator: confirming test baseline and refactoring smell-by-smell...')

const refactor = await runWithEscalation(
  STATES.REFACTOR,
  `Mode: REFACTOR\n\nTarget: ${target}\nGoal: ${goal}\n\nLoad relevant .claude/memory/ context. Confirm a passing test baseline exists, identify code smells, then refactor one smell at a time — running tests after each change and committing each independently. Do not change external behavior or add features.${stateContext()}`,
  { label: 'operator:refactor', phase: 'Refactor', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

if (!refactor || refactor.verdict === 'NO_TESTS') {
  log('operator: NO_TESTS — no test baseline. Run in BUILD mode to add tests first.')
  return {
    outcome: 'BLOCKED',
    stage: 'operator:refactor',
    reason: 'No tests exist. Run the new-feature/bug-fix workflow (BUILD mode) to add tests before refactoring.',
    token_telemetry: tokenLog,
    escalations,
  }
}

mergeState(refactor, 'operator')
currentState = TRANSITIONS[STATES.REFACTOR][refactor.pipeline_gate] || STATES.FAILED
if (refactor.verdict === 'REGRESSION') currentState = STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: REGRESSION or BLOCK — ${refactor.summary}. Escalating.`)
  return failResult('operator:refactor', refactor.summary, refactor.findings)
}
log(`operator: ${refactor.verdict} — ${refactor.summary}`)

// ── Stage 1.5: Gate (Phase 3 — fail fast before paying for inspector) ─────
phase('Gate')
const postRefactorGate = await ensureGatePasses(
  'operator:refactor',
  (gateResult, attempt) => `Mode: REFACTOR\n\nTarget: ${target}\n\nscout's deterministic GATE check failed (fix attempt ${attempt}/${GATE_MAX_RETRIES}):\n${gateResult.raw_output || gateResult.summary}${stateContext()}\n\nFix only what's needed to make lint/typecheck/build/tests pass again — revert the offending smell-fix if you can't recover green quickly.`
)

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

if (!postRefactorGate || postRefactorGate.pipeline_gate !== 'PASS') {
  log(`scout: GATE still BLOCK after ${GATE_MAX_RETRIES} fix attempt(s) — escalating without spending an inspector call.`)
  return failResult('scout:gate', postRefactorGate ? postRefactorGate.summary : 'No response', [])
}
log('scout: GATE PASS — proceeding to inspector.')

// ── Stage 2: Inspect (loop CORRECT ⇄ INSPECT, capped at MAX_RETRIES) ───────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'inspector: confirming behavior unchanged and quality improved...' : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await runWithEscalation(
    STATES.INSPECT,
    `Target refactored: ${target} (goal: ${goal})\n\nReview with effort=medium. Confirm: (1) external behavior unchanged — run all tests, check public API surface, (2) no new bugs introduced, (3) code quality improved vs before.${stateContext()}`,
    { label: `inspector${retries > 0 ? `-r${retries}` : ''}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
  )

  mergeState(inspectResult, 'inspector')

  if (tokenBudgetExceeded()) {
    log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
    return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
  }

  const gate = inspectResult ? inspectResult.pipeline_gate : 'ESCALATE'
  const next = TRANSITIONS[STATES.INSPECT][gate] || STATES.FAILED

  if (next === STATES.FAILED) {
    currentState = STATES.FAILED
    log('ESCALATION: secret or critical issue found — pipeline blocked, zero retries.')
    return failResult('inspector', inspectResult ? inspectResult.summary : 'No response — treated as ESCALATE', inspectResult ? inspectResult.findings : [])
  }

  if (next === STATES.SHIP) { currentState = STATES.SHIP; break }

  if (retries >= MAX_RETRIES) { currentState = STATES.FAILED; break }

  currentState = STATES.CORRECT
  pipelineState.iteration_count = retries + 1
  log(`inspector: issues found — sending back to operator... (fix ${retries + 1}/${MAX_RETRIES})`)
  const correction = await trackedAgent(
    `Mode: REFACTOR\n\nTarget: ${target}\n\nFix the following findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(inspectResult)}${stateContext()}\n\nFix only the listed items, one at a time, re-running tests after each.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.REFACTOR) }
  )
  mergeState(correction, 'operator')

  const recheckGate = await ensureGatePasses(
    `operator-fix-r${retries + 1}`,
    (gateResult, attempt) => `Mode: REFACTOR\n\nTarget: ${target}\n\nscout's deterministic GATE check failed after applying inspector's fix (attempt ${attempt}/${GATE_MAX_RETRIES}):\n${gateResult.raw_output || gateResult.summary}${stateContext()}\n\nFix only what's needed to make lint/typecheck/build/tests pass again.`
  )
  if (!recheckGate || recheckGate.pipeline_gate !== 'PASS') {
    currentState = STATES.FAILED
    log('scout: GATE still BLOCK after the correction — escalating without re-invoking inspector.')
    return failResult('scout:gate', recheckGate ? recheckGate.summary : 'No response', [])
  }

  retries++
  currentState = STATES.INSPECT
}

if (currentState === STATES.FAILED) {
  log(`inspector: exceeded ${MAX_RETRIES} retries — escalating.`)
  return failResult('inspector', inspectResult ? inspectResult.summary : 'Exceeded retries', inspectResult ? inspectResult.findings : [])
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'} — ${inspectResult ? inspectResult.summary : ''}`)

// ── Stage 3: Ship ────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await trackedAgent(
  `Mode: SHIP\n\nRefactoring complete: ${target} (goal: ${goal})\n\nRun pre-flight checks, push the branch, create a draft PR noting what smells were fixed and that tests are unchanged, and save the refactor outcome to .claude/memory/.${stateContext()}`,
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
)
mergeState(ship, 'operator')

currentState = ship ? (TRANSITIONS[STATES.SHIP][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return failResult('operator:ship', ship ? ship.summary : 'No response', ship ? ship.findings : [])
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

const newMemories = [...(refactor.new_memories || []), ...(inspectResult ? inspectResult.new_memories || [] : []), ...(ship.new_memories || [])]

return {
  outcome: 'COMPLETE',
  pipeline: 'refactor',
  target,
  goal,
  summary: ship.summary || 'Draft PR created. Behavior unchanged.',
  token_telemetry: tokenLog,
  escalations,
  pipeline_state: pipelineState,
  new_memories: newMemories,
}
