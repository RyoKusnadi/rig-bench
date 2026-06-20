export const meta = {
  name: 'research',
  description: 'Questionnaire-driven research loop ("Ralph Loop"): repeatedly calls researcher(RESEARCH) until confidence_score clears validation_threshold or max_iterations is hit. Confidence is computed deterministically in this script, never self-reported by the agent.',
  phases: [
    { title: 'Research', detail: 'researcher searches, extracts, and verifies one round at a time' },
    { title: 'Synthesize', detail: 'researcher (frontier tier) synthesizes a report from verified facts only', model: 'frontier' },
  ],
}

// args.intake — required: the validated intake object from
//   research/{topic}/intake.json (produced by scripts/ask-questionnaire.mjs
//   and config/schemas/research-intake.schema.json). This script has no
//   filesystem access (same constraint as every workflows/*.js — see
//   "Declined" in workflows/README.md), so the caller reads the file and
//   passes its parsed contents in verbatim; this script never reads
//   research/{topic}/intake.json itself.
// args.tier   — optional: force_tier override (frontier|standard|economy) —
//   pins the researcher call to this tier for every iteration in this run

if (!args || !args.intake || !args.intake.topic) {
  return { outcome: 'FAILED', stage: 'INIT', reason: 'args.intake (with at least a topic) is required — pass the parsed research-intake.json, not a file path.' }
}

const intake = args.intake
const validationThreshold = typeof intake.validation_threshold === 'number' ? intake.validation_threshold : 0.85
const maxIterations = typeof intake.max_iterations === 'number' ? intake.max_iterations : 5

// Tier registry mirrored from config/model-tiers.json — workflow scripts
// have no filesystem access, so this can't be require()'d at runtime (same
// pattern as every other workflows/*.js file).
const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const forceTier = args.tier && TIER_MODELS[args.tier] ? args.tier : null
const researcherModel = TIER_MODELS[forceTier || 'standard']

const MAX_TOKEN_BUDGET = 200_000 // soft ceiling — same checkpoint-based posture as every other workflow, see root README "Token Telemetry"

const tokenLog = []
async function trackedAgent(prompt, opts) {
  const before = budget.spent()
  const result = await agent(prompt, opts)
  tokenLog.push({ label: opts.label, tokens: budget.spent() - before })
  return result
}

function tokenBudgetExceeded() {
  return budget.spent() > MAX_TOKEN_BUDGET
}

// Mirrors config/schemas/researcher-output.schema.json — forces the
// subagent through the Workflow tool's StructuredOutput layer, same as
// GATE_SCHEMA/SCOUT_SCHEMA in every other workflow.
const RESEARCHER_SCHEMA = {
  type: 'object',
  properties: {
    mode:               { type: 'string', enum: ['RESEARCH', 'SYNTHESIZE'] },
    pipeline_gate:      { type: 'string', enum: ['PASS', 'BLOCK'] },
    blocking:           { type: 'boolean' },
    current_hypothesis: { type: 'string' },
    validated_facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source_url:         { type: 'string' },
          extracted_fact:     { type: 'string' },
          validation_status:  { type: 'string', enum: ['verified', 'pending', 'debunked'] },
          validation_method:  { type: 'string' },
        },
        required: ['source_url', 'extracted_fact', 'validation_status'],
      },
    },
    next_search_query: { type: 'string' },
    // SYNTHESIZE-mode-only fields — see config/schemas/researcher-output.schema.json
    latest_implementation: { type: 'string' },
    latest_version: { type: 'string' },
    focus_areas_covered: { type: 'array', items: { type: 'string' } },
    validated_sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: { url: { type: 'string' }, fact: { type: 'string' } },
        required: ['url', 'fact'],
      },
    },
    debunked_claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, reason: { type: 'string' } },
        required: ['claim', 'reason'],
      },
    },
    body_markdown: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string' }, message: { type: 'string' } },
        required: ['severity', 'message'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['mode', 'pipeline_gate', 'blocking', 'findings', 'summary'],
}

// ── researchState — mirrors lib/research-state.mjs's shape and merge logic
// (can't import it, no fs/Node access in workflow scripts — same reason
// pipelineState/TIER_MODELS are mirrored everywhere else). ─────────────────
let state = {
  questionnaire: intake,
  current_hypothesis: '',
  validated_facts: [],
  next_search_query: intake.topic,
  confidence_score: 0,
  iteration_count: 0,
  loop_log: [],
  completed: false,
}

function factKey(fact) {
  return `${fact.source_url}::${fact.extracted_fact}`
}

function mergeResearcherOutput(result) {
  if (!result) return
  const incomingByKey = new Map((result.validated_facts || []).map((f) => [factKey(f), f]))
  const merged = state.validated_facts.map((f) => incomingByKey.get(factKey(f)) ?? f)
  const mergedKeys = new Set(merged.map(factKey))
  for (const f of result.validated_facts || []) {
    if (!mergedKeys.has(factKey(f))) {
      merged.push(f)
      mergedKeys.add(factKey(f))
    }
  }
  state = {
    ...state,
    current_hypothesis: result.current_hypothesis || state.current_hypothesis,
    validated_facts: merged,
    next_search_query: result.next_search_query || state.next_search_query,
    iteration_count: state.iteration_count + 1,
    loop_log: [...state.loop_log, result.summary],
  }
}

// Deterministic confidence: fraction of focus_areas covered by at least one
// verified fact (case-insensitive substring match); falls back to the
// fraction of all facts that are verified when no focus_areas are declared.
function calculateConfidence() {
  const verifiedFacts = state.validated_facts.filter((f) => f.validation_status === 'verified')
  const focusAreas = intake.focus_areas || []
  if (focusAreas.length === 0) {
    if (state.validated_facts.length === 0) return 0
    return verifiedFacts.length / state.validated_facts.length
  }
  const covered = focusAreas.filter((area) =>
    verifiedFacts.some((f) => f.extracted_fact.toLowerCase().includes(area.toLowerCase()))
  )
  return covered.length / focusAreas.length
}

function researchPrompt() {
  return `Mode: RESEARCH\n\nresearchState: ${JSON.stringify(state)}`
}

phase('Research')
log(`researcher: starting loop for "${intake.topic}" — threshold ${validationThreshold}, max ${maxIterations} iterations.`)

while (state.confidence_score < validationThreshold && state.iteration_count < maxIterations) {
  const iterationLabel = `researcher-i${state.iteration_count + 1}`
  log(`researcher: iteration ${state.iteration_count + 1}/${maxIterations} — query: "${state.next_search_query}"`)

  const result = await trackedAgent(researchPrompt(), {
    label: iterationLabel,
    phase: 'Research',
    schema: RESEARCHER_SCHEMA,
    agentType: 'researcher',
    model: researcherModel,
  })

  if (tokenBudgetExceeded()) {
    return { outcome: 'FAILED', stage: 'RESEARCH', reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, research_state: state }
  }

  if (!result) {
    return { outcome: 'FAILED', stage: 'RESEARCH', reason: 'researcher returned no validated response (schema mismatch or terminal error).', token_telemetry: tokenLog, research_state: state }
  }

  if (result.pipeline_gate === 'BLOCK') {
    return { outcome: 'BLOCKED', stage: 'RESEARCH', reason: result.summary, token_telemetry: tokenLog, research_state: state }
  }

  mergeResearcherOutput(result)
  state.confidence_score = calculateConfidence()
  log(`researcher: confidence ${state.confidence_score.toFixed(2)} after iteration ${state.iteration_count}/${maxIterations} — ${result.summary}`)
}

state.completed = state.confidence_score >= validationThreshold
if (!state.completed) {
  log(`researcher: stopped at max_iterations (${maxIterations}) without reaching threshold (${validationThreshold}) — confidence ${state.confidence_score.toFixed(2)}.`)
}

// ── Synthesize (Phase 5) — one final call, always at frontier tier (downgrade
// via force_tier only — there's no built-in "skip this stage" lever, the
// agent itself BLOCKs if it has nothing verified to synthesize from). Runs
// regardless of `state.completed`: a synthesized report from a partial,
// below-threshold researchState is still useful, as long as it says so up
// front — see researcher.md SYNTHESIZE mode step 7. ────────────────────────
phase('Synthesize')
log('researcher (frontier): synthesizing report from verified facts only...')

const synthResult = await trackedAgent(`Mode: SYNTHESIZE\n\nresearchState: ${JSON.stringify(state)}`, {
  label: 'researcher-synthesize',
  phase: 'Synthesize',
  schema: RESEARCHER_SCHEMA,
  agentType: 'researcher',
  model: TIER_MODELS[forceTier || 'frontier'],
})

if (tokenBudgetExceeded()) {
  return { outcome: 'FAILED', stage: 'SYNTHESIZE', reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, research_state: state }
}

let report = null
if (synthResult && synthResult.pipeline_gate === 'PASS') {
  report = {
    frontmatter: {
      topic: intake.topic,
      target_outcome: intake.target_outcome,
      confidence_level: state.confidence_score,
      focus_areas_covered: synthResult.focus_areas_covered || [],
      validated_sources: synthResult.validated_sources || [],
      debunked_claims: synthResult.debunked_claims || [],
      iterations_taken: state.iteration_count,
      latest_implementation: synthResult.latest_implementation || '',
      latest_version: synthResult.latest_version || '',
      // generated_at intentionally absent — this script cannot call
      // Date.now()/new Date() (see Workflow tool constraints). The caller
      // (which does have a real clock) stamps it when writing
      // research/{topic}/TITLE.MD.
    },
    body_markdown: synthResult.body_markdown || '',
  }
} else {
  log(`researcher: synthesis ${synthResult ? 'BLOCKED' : 'failed'} — ${synthResult ? synthResult.summary : 'no response'}. Returning research_state without a report.`)
}

return {
  outcome: state.completed ? 'COMPLETE' : 'INCOMPLETE',
  pipeline: 'research',
  topic: intake.topic,
  summary: state.completed
    ? `Confidence ${state.confidence_score.toFixed(2)} cleared threshold ${validationThreshold} after ${state.iteration_count} iteration(s).`
    : `Stopped after ${state.iteration_count} iteration(s) at confidence ${state.confidence_score.toFixed(2)}, below threshold ${validationThreshold}.`,
  token_telemetry: tokenLog,
  research_state: state,
  report,
}
