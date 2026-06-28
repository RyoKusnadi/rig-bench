export const meta = {
  name: 'pr-review',
  description: 'PR quality review: scout(manifest) → scout(gate, fail-fast) → inspector(full adversarial pass), plus optional spec compliance',
  phases: [
    { title: 'Scout', detail: 'scout gathers repo manifest and gate-checks the diff before inspector' },
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

// No `pipelineState`/`mergeState` here, unlike the other five workflows —
// this is a single read-only inspector pass with no second stage to hand
// state forward to, so there's nothing for state-passing to carry. `findings`
// already flows straight into the return value below.

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

// Scout's output is a different, mechanical-only shape — see
// config/schemas/scout-output.schema.json.
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

// ── Stage 0: Scout (Phase 1 + 2 — DAG + repo manifest, Phase 3 — fail fast
// before paying for inspector) ─────────────────────────────────────────────
// Manifest gathering and the diff's gate check have no data dependency on
// each other, so they run concurrently.
phase('Scout')
log(`scout: gathering repo manifest and gate-checking ${scope}, in parallel...`)

const [manifestResult, gateResult] = await parallel([
  () => trackedAgent('Mode: MANIFEST\n\nGather the current repo shape — changed files, relevant directories, detected toolchain.', { label: 'scout:manifest', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
  () => trackedAgent(`Mode: GATE\n\nRun the project's lint, typecheck/build, and test commands against ${scope} and report PASS/BLOCK with raw output.`, { label: 'scout:gate', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }),
])

if (gateResult && gateResult.pipeline_gate === 'BLOCK') {
  log(`scout: GATE BLOCK — ${scope} doesn't even compile/lint/test clean. Returning findings without spending an inspector call: ${gateResult.summary}`)
  return {
    outcome: 'REVIEW_FINDINGS',
    pipeline: 'pr-review',
    scope,
    overall_gate: 'BLOCK',
    blocking_findings: 1,
    recommendation: 'Fix the deterministic build/lint/test failure below before requesting review — never spent an inspector call on code that does not compile.',
    merged_findings: [{ severity: 'Critical', message: `scout GATE failed: ${gateResult.raw_output || gateResult.summary}` }],
    token_telemetry: tokenLog,
    escalations,
  }
}
log(`scout: GATE PASS — manifest gathered (toolchain: ${manifestResult && manifestResult.repo_manifest ? manifestResult.repo_manifest.toolchain : 'unknown'}). Proceeding to inspector.`)

// ── Stage 1: Inspect ──────────────────────────────────────────────────────
phase('Inspect')
log(`inspector (${effort}): running full adversarial review on ${scope}...`)

const manifestContext = manifestResult && manifestResult.repo_manifest ? `\n\nRepo manifest (already gathered — skip your own discovery):\n${JSON.stringify(manifestResult.repo_manifest)}` : ''
const specContext = spec ? `\n\nSpec / requirements to check for compliance:\n${spec}` : ''

const result = await runWithEscalation(
  STATES.INSPECT,
  `Review ${scope} with effort=${effort}. Run secrets detection (SEC-4) first, then OWASP A01–A10, STRIDE (if applicable), full dependency/CVE audit across all manifests, and the two-pass code-quality review.${manifestContext}${specContext}`,
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
  new_memories: result.new_memories || [],
}
