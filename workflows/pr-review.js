export const meta = {
  name: 'pr-review',
  description: 'PR quality review: single inspector pass covering secrets + security + dependencies + code quality, plus optional spec compliance',
  phases: [
    { title: 'Inspect', detail: 'inspector runs the full adversarial review in one pass' },
  ],
}

// args.pr        — optional: PR number (e.g. 42) — if omitted, reviews current HEAD diff
// args.effort    — optional: inspector effort mode (low|medium|high|maximum), default: medium
// args.spec      — optional: spec/requirements text — when provided, inspector also checks spec compliance
// args.tier      — optional: force_tier override (frontier|standard|economy) — skips the
//                  escalation ladder below and uses this tier for the inspect stage

const pr = args && args.pr ? String(args.pr) : null
const effort = args && args.effort ? args.effort : 'medium'
const spec = args && args.spec ? args.spec : ''
const scope = pr ? `PR #${pr}` : 'current HEAD diff'

// ── State machine (deterministic control flow) ────────────────────────────
const STATES = { INSPECT: 'INSPECT', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.INSPECT]: { PASS: STATES.DONE, BLOCK: STATES.DONE, ESCALATE: STATES.FAILED },
}
const MAX_TOKEN_BUDGET = 200_000

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = {
  [STATES.INSPECT]: { default_tier: effort === 'low' ? 'economy' : effort === 'maximum' ? 'frontier' : 'standard', escalation_tier: 'frontier' },
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

// Boundary validation: the agent() call below passes `schema: GATE_SCHEMA`,
// which forces validated structured output via the Workflow tool — malformed
// output never reaches this script (agent() returns null instead). See
// config/schemas/inspector-output.schema.json for the canonical schema used
// by direct/manual invocation + lib/schema-validator.mjs.
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

// ── Stage 1: Inspect ──────────────────────────────────────────────────────
phase('Inspect')
log(`inspector (${effort}): running full adversarial review on ${scope}...`)

const specContext = spec ? `\n\nSpec / requirements to check for compliance:\n${spec}` : ''

const result = await runWithEscalation(
  STATES.INSPECT,
  `Review ${scope} with effort=${effort}. Run secrets detection (SEC-4) first, then OWASP A01–A10, STRIDE (if applicable), full dependency/CVE audit across all manifests, and the two-pass code-quality review.${specContext}`,
  { label: 'inspector', phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
)

if (budget.spent() > MAX_TOKEN_BUDGET) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

const next = result ? (TRANSITIONS[STATES.INSPECT][result.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (next === STATES.FAILED) {
  log('ESCALATION: secret or critical CVE found — pipeline blocked, zero retries.')
  return {
    outcome: 'BLOCKED',
    stage: 'inspector',
    reason: result ? result.summary : 'No response — treated as ESCALATE',
    findings: result ? result.findings : [],
    token_telemetry: tokenLog,
    escalations,
  }
}

log(`inspector: ${result.verdict} — ${result.summary}`)

const blockingCount = (result.findings || []).filter(f => f.severity === 'Critical' || f.severity === 'High').length

return {
  outcome: result.pipeline_gate === 'PASS' ? 'COMPLETE' : 'REVIEW_FINDINGS',
  pipeline: 'pr-review',
  scope,
  overall_gate: result.pipeline_gate,
  blocking_findings: blockingCount,
  recommendation: result.pipeline_gate === 'PASS' ? 'Safe to merge.' : `${blockingCount} blocking findings — fix before merging.`,
  merged_findings: result.findings,
  token_telemetry: tokenLog,
  escalations,
}
