export const meta = {
  name: 'docs-update',
  description: 'Docs update pipeline: operator(docs) → inspector(light review) → operator(ship)',
  phases: [
    { title: 'Write', detail: 'operator updates README, CLAUDE.md, docstrings, CHANGELOG' },
    { title: 'Inspect', detail: 'inspector runs a light review (examples verified, no secrets)' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.trigger — required: what changed that needs docs updating
// args.scope   — optional: specific files or sections to update
// args.tier    — optional: force_tier override (frontier|standard|economy) — skips the
//                escalation ladder below and uses this tier for every stage in this run

const trigger = args && args.trigger ? args.trigger : 'recent code changes'
const scope = args && args.scope ? `\nScope: ${args.scope}` : ''

// ── State machine (deterministic control flow) ────────────────────────────
const STATES = { DOCS: 'DOCS', INSPECT: 'INSPECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.DOCS]:     { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]:  { PASS: STATES.SHIP, BLOCK: STATES.FAILED, ESCALATE: STATES.FAILED },
  [STATES.SHIP]:     { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_TOKEN_BUDGET = 200_000

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
// DOCS mode is formatting/changelog work, not design judgment — economy tier
// by default, same rationale SHIP already used.
const ESCALATION_POLICY = {
  [STATES.DOCS]:     { default_tier: 'economy', escalation_tier: 'standard' },
  [STATES.INSPECT]:  { default_tier: 'economy', escalation_tier: 'standard' },
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

let currentState = STATES.DOCS

// ── Stage 1: Write docs ───────────────────────────────────────────────────
phase('Write')
log('operator: reading changes and updating documentation...')

const docs = await runWithEscalation(
  STATES.DOCS,
  `Mode: DOCS\n\nTrigger: ${trigger}${scope}\n\nRead what changed (git diff HEAD), then update all affected documentation: README sections, CLAUDE.md, inline docstrings, and CHANGELOG.md if user-facing. Verify every code example actually runs, then commit locally.`,
  { label: 'operator:docs', phase: 'Write', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

mergeState(docs, 'operator')
currentState = docs ? (TRANSITIONS[STATES.DOCS][docs.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (docs && docs.verdict === 'EXAMPLE_FAIL') currentState = STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: EXAMPLE_FAIL or BLOCK — ${docs ? docs.summary : 'no response'}. Fix broken examples before continuing.`)
  return { outcome: 'BLOCKED', stage: 'operator:docs', reason: docs ? docs.summary : 'No response', findings: docs ? docs.findings : [], token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}
log(`operator: ${docs.verdict} — ${docs.summary}`)

// ── Stage 2: Light inspect ────────────────────────────────────────────────
phase('Inspect')
log('inspector: light review of doc changes...')

const inspectResult = await trackedAgent(
  `Trigger: ${trigger}\n\nRun a light review (effort=low) of the documentation diff: secrets check, no accidental code changes mixed in, terminology matches the actual source.${stateContext()}`,
  { label: 'inspector', phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector', model: resolveModel(STATES.INSPECT) }
)
mergeState(inspectResult, 'inspector')

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

currentState = inspectResult ? (TRANSITIONS[STATES.INSPECT][inspectResult.pipeline_gate] || STATES.FAILED) : STATES.SHIP
if (currentState === STATES.FAILED) {
  log(inspectResult.pipeline_gate === 'ESCALATE' ? 'ESCALATION: secret found in doc diff — pipeline blocked, zero retries.' : `inspector: findings — ${inspectResult.summary}`)
  return { outcome: 'BLOCKED', stage: 'inspector', reason: inspectResult.summary, findings: inspectResult.findings, token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'}`)

// ── Stage 3: Ship ───────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await trackedAgent(
  `Mode: SHIP\n\nDocs updated for: ${trigger}\n\nRun pre-flight checks, push the branch, and create a draft PR listing which files were updated and why.${stateContext()}`,
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
)
mergeState(ship, 'operator')

currentState = ship ? (TRANSITIONS[STATES.SHIP][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:ship', reason: ship ? ship.summary : 'No response', token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

const newMemories = [...(docs.new_memories || []), ...(inspectResult ? inspectResult.new_memories || [] : []), ...(ship.new_memories || [])]

return {
  outcome: 'COMPLETE',
  pipeline: 'docs-update',
  trigger,
  files_updated: pipelineState.files_changed.length ? pipelineState.files_changed : (docs && docs.findings ? docs.findings.map(f => f.file).filter(Boolean) : []),
  summary: ship.summary || 'Draft PR created. Docs updated.',
  token_telemetry: tokenLog,
  escalations,
  pipeline_state: pipelineState,
  new_memories: newMemories,
}
