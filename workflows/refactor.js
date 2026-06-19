export const meta = {
  name: 'refactor',
  description: 'Refactor pipeline: operator(refactor) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Refactor', detail: 'operator confirms test baseline, refactors smell-by-smell' },
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

// ── State machine (deterministic control flow — no agent decides what runs
// next; only TRANSITIONS reads each agent's pipeline_gate) ─────────────────
const STATES = { REFACTOR: 'REFACTOR', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.REFACTOR]: { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]:  { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]:  { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:     { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
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

let currentState = STATES.REFACTOR

// ── Stage 1: Refactor ─────────────────────────────────────────────────────
phase('Refactor')
log('operator: confirming test baseline and refactoring smell-by-smell...')

const refactor = await runWithEscalation(
  STATES.REFACTOR,
  `Mode: REFACTOR\n\nTarget: ${target}\nGoal: ${goal}\n\nLoad relevant .claude/memory/ context. Confirm a passing test baseline exists, identify code smells, then refactor one smell at a time — running tests after each change and committing each independently. Do not change external behavior or add features.`,
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

currentState = TRANSITIONS[STATES.REFACTOR][refactor.pipeline_gate] || STATES.FAILED
if (refactor.verdict === 'REGRESSION') currentState = STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: REGRESSION or BLOCK — ${refactor.summary}. Escalating.`)
  return failResult('operator:refactor', refactor.summary, refactor.findings)
}
log(`operator: ${refactor.verdict} — ${refactor.summary}`)

// ── Stage 2: Inspect (loop CORRECT ⇄ INSPECT, capped at MAX_RETRIES) ───────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'inspector: confirming behavior unchanged and quality improved...' : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await runWithEscalation(
    STATES.INSPECT,
    `Target refactored: ${target} (goal: ${goal})\n\nReview with effort=medium. Confirm: (1) external behavior unchanged — run all tests, check public API surface, (2) no new bugs introduced, (3) code quality improved vs before.`,
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
    `Mode: REFACTOR\n\nTarget: ${target}\n\nFix the following findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(inspectResult)}\n\nFix only the listed items, one at a time, re-running tests after each.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.REFACTOR) }
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
  `Mode: SHIP\n\nRefactoring complete: ${target} (goal: ${goal})\n\nRun pre-flight checks, push the branch, create a draft PR noting what smells were fixed and that tests are unchanged, and save the refactor outcome to .claude/memory/.`,
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
  pipeline: 'refactor',
  target,
  goal,
  summary: ship.summary || 'Draft PR created. Behavior unchanged.',
  token_telemetry: tokenLog,
  escalations,
}
