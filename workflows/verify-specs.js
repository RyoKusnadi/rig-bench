export const meta = {
  name: 'verify-specs',
  description: 'Verify specs in waiting_verification: run their Verification section, confirm acceptance criteria, then ship on success.',
  phases: [
    { title: 'Resolve', detail: 'BFS levelization — group specs by dependency depth for parallel verification' },
    { title: 'Verify', detail: 'Scout GATE + Operator VERIFY per spec (confirms acceptance criteria and Verification section steps)' },
    { title: 'Ship', detail: 'Operator SHIP — push branch, create draft PR, move spec to specs/done/' },
    { title: 'Report', detail: 'Summarize VERIFIED/FAILED outcomes per spec' },
  ],
}

// args.specs  — required: array of { id, title, filePath, depends_on, content }
// args.effort — optional: 'low'|'medium'|'high'|'maximum', default: medium

const specs = args && Array.isArray(args.specs) ? args.specs : []
const effort = args && args.effort ? args.effort : 'medium'

if (specs.length === 0) {
  log('No specs provided — nothing to verify.')
  return { outcome: 'NOOP', verified: [], failed: [], skipped: [] }
}

// ── State machine (per-spec) ────────────────────────────────────────────────
const STATES = { GATE: 'GATE', VERIFY: 'VERIFY', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.GATE]:   { PASS: STATES.VERIFY,  BLOCK: STATES.FAILED },
  [STATES.VERIFY]: { PASS: STATES.SHIP,    BLOCK: STATES.FAILED },
  [STATES.SHIP]:   { PASS: STATES.DONE,    BLOCK: STATES.FAILED },
}
const AGENT_MAX_RETRIES = 2

// Tier registry mirrored from config/model-tiers.json — workflow scripts have
// no filesystem access, so this can't be require()'d at runtime.
const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = {
  [STATES.VERIFY]: { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.SHIP]:   { default_tier: 'economy',  escalation_tier: 'standard' },
}
const forceTier = args && args.tier && TIER_MODELS[args.tier] ? args.tier : null
const resolveModel = (state) => TIER_MODELS[forceTier || ESCALATION_POLICY[state].default_tier]
const escalatedModel = (state) => TIER_MODELS[ESCALATION_POLICY[state].escalation_tier]
const isComplexityBlock = (result) => /too many files|ambiguous|complex|architectur/i.test((result && result.summary) || '')

const tokenLog = []
const escalations = []

async function trackedAgent(prompt, opts, attempt) {
  attempt = attempt || 0
  const before = budget.spent()
  const result = await agent(prompt, attempt === 0 ? opts : { ...opts, label: `${opts.label}-retry${attempt}` })
  tokenLog.push({ label: opts.label, tokens: budget.spent() - before })
  if (result === null && attempt < AGENT_MAX_RETRIES) {
    log(`${opts.label}: schema validation failed — retrying (${attempt + 1}/${AGENT_MAX_RETRIES})...`)
    const correction = `${prompt}\n\n[SYSTEM CORRECTION]: Your previous output failed schema validation. You must output a valid JSON object matching this exact schema:\n${JSON.stringify(opts.schema)}\nDo not include any markdown formatting outside the JSON.`
    return trackedAgent(correction, opts, attempt + 1)
  }
  return result
}

async function runWithEscalation(state, prompt, opts) {
  let result = await trackedAgent(prompt, { ...opts, model: resolveModel(state) })
  if (result && result.pipeline_gate === 'BLOCK' && isComplexityBlock(result) && !forceTier) {
    escalations.push({ state, from: ESCALATION_POLICY[state].default_tier, to: ESCALATION_POLICY[state].escalation_tier, reason: result.summary })
    log(`${opts.label}: complexity BLOCK — escalating to ${ESCALATION_POLICY[state].escalation_tier}...`)
    result = await trackedAgent(prompt, { ...opts, label: `${opts.label}-escalated`, model: escalatedModel(state) })
  }
  return result
}

// Shared schema shapes (subsets of canonical config/schemas/*.schema.json).
const GATE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'pipeline_gate', 'summary', 'blocking', 'findings'],
  properties: {
    verdict:            { type: 'string' },
    pipeline_gate:      { type: 'string', enum: ['PASS', 'BLOCK', 'ESCALATE'] },
    summary:            { type: 'string' },
    blocking:           { type: 'boolean' },
    findings:           { type: 'array', items: { type: 'object', required: ['severity', 'message'], properties: { severity: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, message: { type: 'string' } } } },
    mode:               { type: 'string' },
    files_changed:      { type: 'array', items: { type: 'string' } },
    test_status:        { type: 'string' },
    last_error_message: { type: 'string' },
    new_memories:       { type: 'array', items: { type: 'object', required: ['title', 'content'], properties: { title: { type: 'string' }, content: { type: 'string' } } } },
  },
}
const SCOUT_SCHEMA = {
  type: 'object',
  required: ['mode', 'pipeline_gate', 'summary'],
  properties: {
    mode:           { type: 'string', enum: ['MANIFEST', 'GATE'] },
    pipeline_gate:  { type: 'string', enum: ['PASS', 'BLOCK'] },
    repo_manifest:  { type: ['object', 'null'], properties: { changed_files: { type: 'array', items: { type: 'string' } }, dirs: { type: 'array', items: { type: 'string' } }, toolchain: { type: 'string' } } },
    raw_output:     { type: 'string' },
    checks_run:     { type: 'array', items: { type: 'string' } },
    checks_skipped: { type: 'array', items: { type: 'string' } },
    summary:        { type: 'string' },
  },
}

// ── Topological sort — mirrored from lib/spec-graph.mjs::topoLevels ─────────
function topoLevels(specList, preResolvedIds) {
  const resolved = new Set(preResolvedIds || [])
  const levels = []
  let remaining = [...specList]

  while (remaining.length > 0) {
    const ready = remaining.filter(s =>
      (s.depends_on || []).every(d => resolved.has(String(d)))
    )
    if (ready.length === 0) break
    levels.push(ready)
    ready.forEach(s => resolved.add(String(s.id)))
    const readyIds = new Set(ready.map(s => String(s.id)))
    remaining = remaining.filter(s => !readyIds.has(String(s.id)))
  }

  return { levels, blocked: remaining }
}

// ── Per-spec verify pipeline ─────────────────────────────────────────────────
async function verifySpec(spec, phaseLabel) {
  const specTag = `[spec:${spec.id}]`

  let specState = {
    task_id: spec.id,
    current_mode: null,
    files_changed: [],
    test_status: null,
    last_error_message: null,
    gate_status: null,
  }
  function mergeSpecState(result, role) {
    if (!result) return
    if (result.mode && role !== 'scout') specState.current_mode = result.mode
    if (Array.isArray(result.files_changed)) {
      specState.files_changed = Array.from(new Set([...specState.files_changed, ...result.files_changed]))
    }
    if (result.test_status) specState.test_status = result.test_status
    if (result.last_error_message !== undefined) specState.last_error_message = result.last_error_message
    if (role === 'scout' && result.mode === 'GATE') specState.gate_status = result.pipeline_gate
  }
  function ctx() {
    return `\n\nPipeline state for spec ${spec.id}:\n${JSON.stringify(specState)}`
  }
  function label(stage) { return `spec:${spec.id}:${stage}` }

  function blocked(stage, reason, findings) {
    return { spec_id: spec.id, pipeline_gate: 'BLOCK', verdict: stage + '_FAIL', summary: reason, files_changed: specState.files_changed, findings: findings || [], blocking_stage: stage }
  }

  // Stage 1: Scout GATE
  log(`${specTag} scout: running GATE...`)
  const gate = await trackedAgent(
    `Mode: GATE\n\nRun the project's lint, typecheck/build, and test commands. This is the verification gate for spec ${spec.id}: ${spec.title}.${ctx()}`,
    { label: label('scout:gate'), phase: phaseLabel, schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
  )
  mergeSpecState(gate, 'scout')

  if (!gate || gate.pipeline_gate !== 'PASS') {
    log(`${specTag} scout: GATE BLOCK — ${gate ? gate.summary : 'no response'}`)
    return blocked('GATE', gate ? gate.summary : 'No response from scout', [])
  }
  log(`${specTag} scout: GATE PASS.`)

  // Stage 2: Operator VERIFY
  log(`${specTag} operator: running Verification section steps...`)
  const verify = await runWithEscalation(
    STATES.VERIFY,
    `Mode: BUILD\n\nSpec to verify:\n---\n${spec.content}\n---\n\nYour tasks:\n1. Read the spec's ## Verification section and run every step exactly as written\n2. Confirm that every Acceptance Criterion in ## Acceptance Criteria is satisfied by the current implementation\n3. If all steps pass and all criteria are met, return pipeline_gate: PASS\n4. If any step fails or any criterion is unmet, return pipeline_gate: BLOCK with a clear summary of what failed\n\nDo not modify any code. This is a confirmation step only.${ctx()}`,
    { label: label('operator:verify'), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator' }
  )
  mergeSpecState(verify, 'operator')

  const verifyGate = verify ? verify.pipeline_gate : 'BLOCK'
  if (verifyGate !== 'PASS') {
    log(`${specTag} operator: VERIFY BLOCK — ${verify ? verify.summary : 'no response'}`)
    return blocked('VERIFY', verify ? verify.summary : 'No response from operator', verify ? verify.findings : [])
  }
  log(`${specTag} operator: VERIFY PASS — ${verify.summary}`)

  // Stage 3: Ship
  log(`${specTag} operator: shipping...`)
  const specFilename = spec.filePath.split('/').pop()
  const ship = await trackedAgent(
    `Mode: SHIP\n\nSpec: ${spec.id} — ${spec.title}\n\nVerification passed. Your tasks:\n1. Run pre-flight checks\n2. Push the branch and create a draft PR referencing spec ${spec.id} in the title/body\n3. Update the spec file: set \`status: done\` in frontmatter and move from specs/waiting_verification/ to specs/done/ using Bash: mv "specs/waiting_verification/${specFilename}" "specs/done/${specFilename}"\n4. Save any lessons learned to .claude/memory/\n${ctx()}`,
    { label: label('operator:ship'), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
  )
  mergeSpecState(ship, 'operator')

  if (!ship || ship.pipeline_gate !== 'PASS') {
    log(`${specTag} operator: SHIP BLOCK — ${ship ? ship.summary : 'no response'}`)
    return blocked('SHIP', ship ? ship.summary : 'No response from operator', ship ? ship.findings : [])
  }
  log(`${specTag} operator: SHIP — ${ship.summary}`)

  return {
    spec_id: spec.id,
    pipeline_gate: 'PASS',
    verdict: 'VERIFIED',
    summary: ship.summary || `Spec ${spec.id} verified and shipped.`,
    files_changed: specState.files_changed,
    findings: [],
  }
}

// ── Phase 1: Resolve dependency levels ───────────────────────────────────────
phase('Resolve')
log(`Resolving dependency order for ${specs.length} spec(s)...`)

const { levels, blocked: unreachable } = topoLevels(specs)

if (unreachable.length > 0) {
  log(`WARNING: ${unreachable.length} spec(s) could not be placed in any execution level (circular dependency or unresolved deps): ${unreachable.map(s => s.id).join(', ')}`)
}
log(`Verification plan: ${levels.length} level(s) — ${levels.map((l, i) => `level ${i + 1}: [${l.map(s => s.id).join(', ')}]`).join(' → ')}`)

// ── Phase 2: Verify level by level ──────────────────────────────────────────
const results = []

for (let i = 0; i < levels.length; i++) {
  const level = levels[i]
  const phaseLabel = `Level ${i + 1} (${level.length} spec${level.length > 1 ? 's' : ''})`
  phase(phaseLabel)
  log(`Starting level ${i + 1}: ${level.map(s => `${s.id} — ${s.title}`).join(', ')}`)

  const levelResults = await parallel(
    level.map(spec => () => verifySpec(spec, phaseLabel))
  )

  const levelPass = levelResults.filter(Boolean).filter(r => r.pipeline_gate === 'PASS')
  const levelFail = levelResults.filter(Boolean).filter(r => r.pipeline_gate === 'BLOCK')
  results.push(...levelResults.filter(Boolean))

  log(`Level ${i + 1} complete: ${levelPass.length} PASS, ${levelFail.length} BLOCK`)
}

// ── Phase 3: Report ──────────────────────────────────────────────────────────
phase('Report')

const verified = results.filter(r => r.pipeline_gate === 'PASS')
const failed = results.filter(r => r.pipeline_gate === 'BLOCK')
const skipped = unreachable.map(s => ({ spec_id: s.id, reason: 'Unresolvable dependency' }))

log(`\nVerification summary:`)
log(`  VERIFIED (${verified.length}): ${verified.map(r => r.spec_id).join(', ') || 'none'}`)
log(`  FAILED   (${failed.length}): ${failed.map(r => `${r.spec_id} [${r.verdict}]`).join(', ') || 'none'}`)
log(`  SKIPPED  (${skipped.length}): ${skipped.map(r => r.spec_id).join(', ') || 'none'}`)

return {
  outcome: failed.length === 0 && skipped.length === 0 ? 'COMPLETE' : 'PARTIAL',
  verified,
  failed,
  skipped,
  token_telemetry: tokenLog,
  escalations,
}
