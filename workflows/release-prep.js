export const meta = {
  name: 'release-prep',
  description: 'Release prep pipeline: scout(manifest) → inspector(audit) → operator(release PR with CHANGELOG)',
  phases: [
    { title: 'Scout', detail: 'scout gathers repo manifest so inspector skips re-discovery' },
    { title: 'Audit', detail: 'inspector runs secrets + CVE audit on the release branch' },
    { title: 'Release', detail: 'operator validates commits, updates CHANGELOG, creates release PR' },
  ],
}

// args.version  — required: version string (e.g. "1.2.0")
// args.branch   — optional: release branch name (default: main/master)
// args.notes    — optional: release notes or highlights to include in CHANGELOG
// args.tier     — optional: force_tier override (frontier|standard|economy) — has no effect on
//                 the Audit stage (always frontier, see below) but applies to Release

const version = args && args.version ? String(args.version) : 'next'
const branch = args && args.branch ? args.branch : 'main'
const notes = args && args.notes ? `\n\nRelease notes / highlights:\n${args.notes}` : ''

// ── State machine (deterministic control flow) ────────────────────────────
const STATES = { AUDIT: 'AUDIT', RELEASE: 'RELEASE', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.AUDIT]:   { PASS: STATES.RELEASE, BLOCK: STATES.FAILED, ESCALATE: STATES.FAILED },
  [STATES.RELEASE]: { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_TOKEN_BUDGET = 300_000

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
// Audit is the highest-stakes gate in the harness — always frontier, no
// escalation needed (it's already the top tier) and `force_tier` does not
// downgrade it, since a pre-release secret/CVE gate is exactly the case
// where you do NOT want to skip to a cheaper tier.
const ESCALATION_POLICY = {
  [STATES.AUDIT]:   { default_tier: 'frontier', escalation_tier: 'frontier' },
  [STATES.RELEASE]: { default_tier: 'standard', escalation_tier: 'frontier' },
}
const forceTier = args && args.tier && TIER_MODELS[args.tier] ? args.tier : null
const resolveModel = (state) => state === STATES.AUDIT ? TIER_MODELS.frontier : TIER_MODELS[forceTier || ESCALATION_POLICY[state].default_tier]

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

let currentState = STATES.AUDIT

// ── Stage 0: Scout (Phase 2 — repo manifest) ──────────────────────────────
// No GATE stage here — release-prep doesn't generate new code to gate;
// AUDIT itself is the highest-stakes deterministic+judgment check already.
phase('Scout')
log('scout: gathering repo manifest...')

const manifestResult = await trackedAgent(
  'Mode: MANIFEST\n\nGather the current repo shape — changed files, relevant directories, detected toolchain.',
  { label: 'scout:manifest', phase: 'Scout', schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
)
mergeState(manifestResult, 'scout')
log(`scout: manifest gathered (toolchain: ${manifestResult && manifestResult.repo_manifest ? manifestResult.repo_manifest.toolchain : 'unknown'}).`)

// ── Stage 1: Audit ─────────────────────────────────────────────────────────
phase('Audit')
log(`inspector (maximum): running pre-release secrets + CVE audit for v${version}...`)

const manifestContext = manifestResult && manifestResult.repo_manifest ? `\n\nRepo manifest (already gathered — skip your own discovery):\n${JSON.stringify(manifestResult.repo_manifest)}` : ''

const audit = await trackedAgent(
  `Pre-release audit for v${version}. Run effort=maximum: full SEC-4 secret scan against the entire diff from the release branch, then a full dependency/CVE audit across every manifest (npm, Go, Python, Rust, .NET, Ruby, Maven). Any secret or Critical CVE is a release blocker.${manifestContext}`,
  // This is the highest-stakes gate in the harness — the last check before
  // a release ships — so it's the one place worth paying for frontier
  // reasoning. Every other inspector call stays on the default model;
  // see workflows/README.md for why this isn't applied across the board.
  { label: 'inspector:audit', phase: 'Audit', schema: GATE_SCHEMA, agentType: 'inspector', model: resolveModel(STATES.AUDIT) }
)

if (tokenBudgetExceeded()) {
  log(`Token budget exceeded (${budget.spent()} > ${MAX_TOKEN_BUDGET}) — manual review required.`)
  return { outcome: 'FAILED', stage: STATES.FAILED, reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, escalations }
}

mergeState(audit, 'inspector')
currentState = audit ? (TRANSITIONS[STATES.AUDIT][audit.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (audit && audit.verdict === 'CRITICAL_CVE') currentState = STATES.FAILED

if (currentState === STATES.FAILED) {
  if (!audit || audit.pipeline_gate === 'ESCALATE') {
    log('ESCALATION: secret found — release blocked. Rotate credential, clean history, then rerun.')
    return { outcome: 'BLOCKED', stage: 'inspector:audit', reason: audit ? audit.summary : 'No response — treated as ESCALATE', token_telemetry: tokenLog, escalations }
  }
  log(`inspector: CRITICAL_CVE or BLOCK — release blocked. ${audit.summary}`)
  return {
    outcome: 'BLOCKED',
    stage: 'inspector:audit',
    reason: audit.summary,
    findings: audit.findings,
    action: 'Fix Critical CVEs listed above, then rerun release-prep.',
    token_telemetry: tokenLog,
    escalations,
  }
}

const hygiene = audit.verdict === 'HYGIENE_FLAGS' || audit.verdict === 'HIGH_CVE'
log(`inspector: ${audit.verdict}${hygiene ? ' — hygiene flags noted, not blocking' : ''}`)

// ── Stage 2: Release PR ───────────────────────────────────────────────────
phase('Release')
log(`operator: creating release PR for v${version}...`)

const ship = await trackedAgent(
  `Mode: SHIP\n\nCreate release PR for v${version} targeting ${branch}.\n\n1. Validate all commits since last tag follow Conventional Commits.\n2. Update CHANGELOG.md — rename [Unreleased] to [${version}] with today's date, add a fresh empty [Unreleased] above it.\n3. Push the branch and create a draft PR titled "Release v${version}".\n4. Include the dependency audit summary in the PR body, and save the release outcome to .claude/memory/.${notes}${stateContext()}`,
  { label: 'operator:release', phase: 'Release', schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.RELEASE) }
)
mergeState(ship, 'operator')

currentState = ship ? (TRANSITIONS[STATES.RELEASE][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
if (currentState === STATES.FAILED) {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:release', reason: ship ? ship.summary : 'No response', token_telemetry: tokenLog, escalations, pipeline_state: pipelineState }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

const newMemories = [...(audit.new_memories || []), ...(ship.new_memories || [])]

return {
  outcome: 'COMPLETE',
  pipeline: 'release-prep',
  version,
  dependency_verdict: audit.verdict,
  hygiene_flags: hygiene ? audit.findings : [],
  summary: ship.summary || `Release PR for v${version} created as draft.`,
  token_telemetry: tokenLog,
  escalations,
  pipeline_state: pipelineState,
  new_memories: newMemories,
}
