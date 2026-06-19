export const meta = {
  name: 'bug-fix',
  description: 'Bug fix pipeline: operator(diagnose+fix) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Fix', detail: 'operator diagnoses root cause, writes regression test, applies fix' },
    { title: 'Inspect', detail: 'inspector confirms no regressions or security issues' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.bug         — required: description of the bug or failing test
// args.known_cause — optional: set to true if root cause is already known
// args.stack_trace — optional: paste the stack trace for better diagnosis context
// args.tier        — optional: force_tier override (frontier|standard|economy) — skips the
//                     escalation ladder below and uses this tier for every stage in this run

const bug = args && args.bug ? args.bug : 'fix the reported bug'
const knownCause = args && args.known_cause === true
const stackTrace = args && args.stack_trace ? `\n\nStack trace:\n${args.stack_trace}` : ''

// ── State machine (deterministic control flow — no agent decides what runs
// next; only TRANSITIONS reads each agent's pipeline_gate) ─────────────────
const STATES = { FIX: 'FIX', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.FIX]:      { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]:  { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]:  { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:     { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
const MAX_TOKEN_BUDGET = 400_000

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = {
  [STATES.FIX]:      { default_tier: 'standard', escalation_tier: 'frontier' },
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
function failResult(stage, reason, findings) {
  return { outcome: 'BLOCKED', stage, reason, findings: findings || [], token_telemetry: tokenLog, escalations }
}

// Boundary validation: every agent() call below passes `schema: GATE_SCHEMA`,
// which forces validated structured output via the Workflow tool — malformed
// output never reaches this script (agent() returns null instead). See
// config/schemas/{operator,inspector}-output.schema.json for the canonical
// schemas used by direct/manual invocation + lib/schema-validator.mjs.
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
  },
  required: ['verdict', 'pipeline_gate', 'summary', 'blocking', 'findings'],
}

function formatFindings(result) {
  if (!result || !result.findings || result.findings.length === 0) return 'No findings.'
  return result.findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

let currentState = STATES.FIX

// ── Stage 1: Fix ──────────────────────────────────────────────────────────
phase('Fix')
const causeNote = knownCause ? `\n\nRoot cause provided by caller — skip diagnosis: ${bug}` : ''
log(knownCause ? 'operator: applying known-cause fix...' : 'operator: diagnosing root cause and fixing...')

const fix = await runWithEscalation(
  STATES.FIX,
  `Mode: BUILD\n\nBug: ${bug}${stackTrace}${causeNote}\n\nLoad relevant .claude/memory/ context (gotchas, prior fixes in this area).${knownCause ? '' : ' Reproduce the failure, form ranked hypotheses, and identify the root cause before fixing.'} Write a failing regression test FIRST, then apply the minimal fix. Run the full suite and commit locally.`,
  { label: 'operator:fix', phase: 'Fix', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

currentState = fix ? (TRANSITIONS[STATES.FIX][fix.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: GATE_FAIL — ${fix ? fix.summary : 'no response'}`)
  return failResult('operator:fix', fix ? fix.summary : 'No response', fix ? fix.findings : [])
}
log(`operator: ${fix.verdict} — ${fix.summary}`)

// ── Stage 2: Inspect (loop CORRECT ⇄ INSPECT, capped at MAX_RETRIES) ───────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'inspector: confirming fix resolves the bug with no regressions...' : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await runWithEscalation(
    STATES.INSPECT,
    `Bug: ${bug}\n\nVerify: (1) the specific failure no longer reproduces, (2) the regression test passes, (3) no adjacent behavior was broken, (4) no security or dependency issues were introduced.`,
    { label: `inspector${retries > 0 ? `-r${retries}` : ''}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
  )

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
  log(`inspector: issues found — sending back to operator... (fix ${retries + 1}/${MAX_RETRIES})`)
  await trackedAgent(
    `Mode: BUILD\n\nBug: ${bug}\n\nFix the following findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(inspectResult)}\n\nFix only the listed items. Re-run tests and commit.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.FIX) }
  )
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
  `Mode: SHIP\n\nBug fixed: ${bug}\n\nRun pre-flight checks, push the branch, create a draft PR (include "Closes #<issue>" if an issue number is in the bug description), and save the root cause + fix approach to .claude/memory/gotchas.md and lessons-learned.md.`,
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
)

currentState = ship ? (TRANSITIONS[STATES.SHIP][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return failResult('operator:ship', ship ? ship.summary : 'No response', ship ? ship.findings : [])
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

return {
  outcome: 'COMPLETE',
  pipeline: 'bug-fix',
  bug,
  skipped_diagnosis: knownCause,
  summary: ship.summary || 'Draft PR created. Bug resolved.',
  token_telemetry: tokenLog,
  escalations,
}
