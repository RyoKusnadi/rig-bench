export const meta = {
  name: 'execute-specs',
  description: 'Execute selected specs with dependency ordering: independent specs run concurrently per level; dependent specs wait for their deps to complete first.',
  phases: [
    { title: 'Resolve', detail: 'BFS levelization — group specs by dependency depth for parallel execution' },
    { title: 'Execute', detail: 'Run each dependency level; specs within a level run concurrently' },
    { title: 'Report', detail: 'Summarize PASS/BLOCK outcomes per spec' },
  ],
}

// args.specs — required: array of { id, title, filePath, depends_on, content }
// args.effort — optional: inspector effort mode (low|medium|high|maximum), default: medium
// args.tier   — optional: force_tier override (frontier|standard|economy)

const specs = args && Array.isArray(args.specs) ? args.specs : []
const effort = args && args.effort ? args.effort : 'medium'

if (specs.length === 0) {
  log('No specs provided — nothing to execute.')
  return { outcome: 'NOOP', executed: [], blocked: [], skipped: [] }
}

// ── State machine (per-spec; each executeSpec() call tracks its own state) ──
const STATES = { BUILD: 'BUILD', INSPECT: 'INSPECT', CORRECT: 'CORRECT', SHIP: 'SHIP', DONE: 'DONE', FAILED: 'FAILED' }
const TRANSITIONS = {
  [STATES.BUILD]:   { PASS: STATES.INSPECT, BLOCK: STATES.FAILED },
  [STATES.INSPECT]: { PASS: STATES.SHIP, BLOCK: STATES.CORRECT, ESCALATE: STATES.FAILED },
  [STATES.CORRECT]: { PASS: STATES.INSPECT, BLOCK: STATES.INSPECT },
  [STATES.SHIP]:    { PASS: STATES.DONE, BLOCK: STATES.FAILED },
}
const MAX_RETRIES = 1
const GATE_MAX_RETRIES = 2
const AGENT_MAX_RETRIES = 2

// Tier registry mirrored from config/model-tiers.json — workflow scripts have
// no filesystem access, so this can't be require()'d at runtime. Keep both in
// sync if a tier's model ID changes (tests/lib-workflow-sync.test.js enforces this).
const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const ESCALATION_POLICY = {
  [STATES.BUILD]:   { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.INSPECT]: { default_tier: 'standard', escalation_tier: 'frontier' },
  [STATES.SHIP]:    { default_tier: 'economy', escalation_tier: 'standard' },
}
const forceTier = args && args.tier && TIER_MODELS[args.tier] ? args.tier : null
const resolveModel = (state) => TIER_MODELS[forceTier || ESCALATION_POLICY[state].default_tier]
const escalatedModel = (state) => TIER_MODELS[ESCALATION_POLICY[state].escalation_tier]
const isComplexityBlock = (result) => /too many files|ambiguous|complex|architectur/i.test((result && result.summary) || '')

// Accumulated telemetry across all spec executions (safe to share — each
// push is append-only and concurrent JS is single-threaded in the event loop).
const tokenLog = []
const escalations = []

// Mirrors lib/agent-wrapper.mjs's safeAgent — can't import, no fs/Node access.
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

function criticalFindings(result) {
  if (!result || !result.findings) return []
  return result.findings.filter(f => f.severity === 'Critical' || f.severity === 'High')
}
function formatFindings(findings) {
  if (!findings || findings.length === 0) return 'No blocking findings.'
  return findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

// ── Topological sort — mirrored from lib/spec-graph.mjs::topoLevels ─────────
// Workflow scripts have no filesystem access and cannot import lib/*.mjs.
// This is the same BFS levelization logic; keep both in sync when changing.
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

// ── Per-spec pipeline ─────────────────────────────────────────────────────────
// Each call runs completely independently with its own pipelineState.
// Safe to call concurrently from parallel() because JS is single-threaded and
// the only shared mutable state is tokenLog/escalations (append-only arrays).
async function executeSpec(spec, phaseLabel) {
  const specTag = `[spec:${spec.id}]`
  const specLabel = `${spec.id} — ${spec.title}`

  // Per-spec pipeline state (mirrors lib/pipeline-state.mjs::createPipelineState).
  let specState = {
    task_id: spec.id,
    current_mode: null,
    files_changed: [],
    test_status: null,
    last_error_message: null,
    inspector_findings: [],
    iteration_count: 0,
    repo_manifest: null,
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
    if (role === 'inspector' && result.findings) specState.inspector_findings = result.findings
    if (role === 'scout' && result.repo_manifest) specState.repo_manifest = result.repo_manifest
    if (role === 'scout' && result.mode === 'GATE') specState.gate_status = result.pipeline_gate
  }
  function ctx() {
    return `\n\nPipeline state for spec ${spec.id}:\n${JSON.stringify(specState)}`
  }
  function label(stage) { return `spec:${spec.id}:${stage}` }

  function blocked(stage, reason, findings) {
    return { spec_id: spec.id, pipeline_gate: 'BLOCK', verdict: stage + '_FAIL', summary: reason, files_changed: specState.files_changed, findings: findings || [], blocking_stage: stage }
  }

  // Stage 0: Scout MANIFEST
  log(`${specTag} scout: gathering repo manifest...`)
  const manifest = await trackedAgent(
    `Mode: MANIFEST\n\nGather the current repo shape — changed files, relevant directories, detected toolchain. This is for spec ${spec.id}: ${spec.title}.`,
    { label: label('scout:manifest'), phase: phaseLabel, schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
  )
  mergeSpecState(manifest, 'scout')

  // Stage 1: Operator BUILD
  log(`${specTag} operator: implementing spec...`)
  const buildPrompt = `Mode: BUILD

Spec to implement:
---
${spec.content}
---

Your tasks (in order):
1. Immediately mark this spec as in_progress: edit its frontmatter to set \`status: in_progress\` and move the file from specs/ready/ to specs/in_progress/ using: mv "${spec.filePath}" "$(echo "${spec.filePath}" | sed 's|/ready/|/in_progress/|')"
2. Load relevant .claude/memory/ context for this spec
3. Implement with TDD (Red/Green/Refactor) following the spec's Implementation Notes and Files/Interfaces Touched sections
4. Ensure every Acceptance Criterion is satisfied
5. Run self-verification per the spec's Verification section
6. Commit locally (do not push or open a PR yet)
${ctx()}`

  const build = await runWithEscalation(
    STATES.BUILD,
    buildPrompt,
    { label: label('operator:build'), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator' }
  )
  mergeSpecState(build, 'operator')

  let currentState = build ? (TRANSITIONS[STATES.BUILD][build.pipeline_gate] || STATES.FAILED) : STATES.FAILED
  if (currentState === STATES.FAILED) {
    log(`${specTag} operator: BUILD BLOCK — ${build ? build.summary : 'no response'}`)
    return blocked('GATE', build ? build.summary : 'No response from operator', build ? build.findings : [])
  }
  log(`${specTag} operator: ${build.verdict} — ${build.summary}`)

  // Stage 1.5: Gate loop
  log(`${specTag} scout: running GATE...`)
  async function runGate(gateLabel) {
    const g = await trackedAgent(
      `Mode: GATE\n\nRun the project's lint, typecheck/build, and test commands. This is the gate check for spec ${spec.id}.${ctx()}`,
      { label: label(gateLabel), phase: phaseLabel, schema: SCOUT_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
    )
    mergeSpecState(g, 'scout')
    return g
  }

  let gateResult = await runGate('scout:gate')
  let gateRetries = 0
  while (gateResult && gateResult.pipeline_gate === 'BLOCK' && gateRetries < GATE_MAX_RETRIES) {
    log(`${specTag} scout: GATE BLOCK — fixing (${gateRetries + 1}/${GATE_MAX_RETRIES})...`)
    const fix = await trackedAgent(
      `Mode: BUILD\n\nSpec: ${spec.id} — ${spec.title}\n\nscout's GATE failed (fix ${gateRetries + 1}/${GATE_MAX_RETRIES}):\n${gateResult.raw_output || gateResult.summary}${ctx()}\n\nFix only what is needed to make lint/typecheck/build/tests pass. Do not re-implement the spec from scratch.`,
      { label: label(`fix-r${gateRetries + 1}`), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.BUILD) }
    )
    mergeSpecState(fix, 'operator')
    gateRetries++
    gateResult = await runGate(`scout:gate-r${gateRetries}`)
  }

  if (!gateResult || gateResult.pipeline_gate !== 'PASS') {
    log(`${specTag} scout: GATE still BLOCK after ${GATE_MAX_RETRIES} fix attempt(s).`)
    return blocked('GATE', gateResult ? gateResult.summary : 'No response from scout', [])
  }
  log(`${specTag} scout: GATE PASS.`)

  // Stage 2: Inspector (CORRECT loop capped at MAX_RETRIES)
  log(`${specTag} inspector (${effort}): running adversarial review...`)
  let inspectResult = null
  let retries = 0

  while (retries <= MAX_RETRIES) {
    inspectResult = await runWithEscalation(
      STATES.INSPECT,
      `Spec: ${spec.id} — ${spec.title}\n\nReview the operator's local commit(s) for this spec with effort=${effort}. Run secrets detection (SEC-4), OWASP A01–A10, STRIDE (if applicable), dependency audit, and two-pass quality review. Also verify the implementation satisfies the spec's Acceptance Criteria.${ctx()}`,
      { label: label(`inspector${retries > 0 ? `-r${retries}` : ''}`), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'inspector' }
    )
    mergeSpecState(inspectResult, 'inspector')

    const gate = inspectResult ? inspectResult.pipeline_gate : 'ESCALATE'
    const next = TRANSITIONS[STATES.INSPECT][gate] || STATES.FAILED

    if (next === STATES.FAILED) {
      log(`${specTag} inspector: ESCALATE — secret or critical finding.`)
      return { spec_id: spec.id, pipeline_gate: 'BLOCK', verdict: 'ESCALATE', summary: inspectResult ? inspectResult.summary : 'Escalated', files_changed: specState.files_changed, findings: inspectResult ? inspectResult.findings : [], blocking_stage: 'inspector' }
    }

    if (next === STATES.SHIP) { currentState = STATES.SHIP; break }

    if (retries >= MAX_RETRIES) { currentState = STATES.FAILED; break }

    // CORRECT: send critical findings back to operator
    log(`${specTag} inspector: BLOCK — sending fixes back to operator (${retries + 1}/${MAX_RETRIES})...`)
    const correction = await trackedAgent(
      `Mode: BUILD\n\nSpec: ${spec.id} — ${spec.title}\n\nFix the following Critical findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(criticalFindings(inspectResult))}${ctx()}\n\nFix only the listed items. Re-run tests and commit.`,
      { label: label(`operator-fix-r${retries + 1}`), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.BUILD) }
    )
    mergeSpecState(correction, 'operator')

    // Re-gate before spending another inspector call
    const recheckGate = await runGate(`scout:gate-post-fix-r${retries + 1}`)
    if (!recheckGate || recheckGate.pipeline_gate !== 'PASS') {
      log(`${specTag} scout: GATE BLOCK after correction — escalating.`)
      return blocked('GATE', recheckGate ? recheckGate.summary : 'No response', [])
    }

    retries++
    currentState = STATES.INSPECT
  }

  if (currentState === STATES.FAILED) {
    log(`${specTag} inspector: exceeded ${MAX_RETRIES} fix cycle(s).`)
    return blocked('INSPECT', inspectResult ? inspectResult.summary : 'Exceeded retries', inspectResult ? inspectResult.findings : [])
  }
  log(`${specTag} inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'}.`)

  // Stage 3: Ship
  log(`${specTag} operator: shipping and updating spec status...`)
  const ship = await trackedAgent(
    `Mode: SHIP\n\nSpec: ${spec.id} — ${spec.title}\n\nAll pipeline gates passed. Your tasks:\n1. Run pre-flight checks\n2. Push the branch and create a draft PR referencing spec ${spec.id} in the title/body\n3. Update the spec file: set \`status: done\` in frontmatter and move from specs/in_progress/ to specs/done/ using Bash\n4. Save any lessons learned to .claude/memory/\n${ctx()}`,
    { label: label('operator:ship'), phase: phaseLabel, schema: GATE_SCHEMA, agentType: 'operator', model: resolveModel(STATES.SHIP) }
  )
  mergeSpecState(ship, 'operator')

  currentState = ship ? (TRANSITIONS[STATES.SHIP][ship.pipeline_gate] || STATES.FAILED) : STATES.FAILED
  if (currentState === STATES.FAILED) {
    log(`${specTag} operator: SHIP BLOCK — ${ship ? ship.summary : 'no response'}`)
    return blocked('SHIP', ship ? ship.summary : 'No response', ship ? ship.findings : [])
  }
  log(`${specTag} operator: SHIP — ${ship.summary}`)

  return {
    spec_id: spec.id,
    pipeline_gate: 'PASS',
    verdict: 'IMPLEMENTED',
    summary: ship.summary || `Spec ${spec.id} implemented and shipped.`,
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
log(`Execution plan: ${levels.length} level(s) — ${levels.map((l, i) => `level ${i + 1}: [${l.map(s => s.id).join(', ')}]`).join(' → ')}`)

// ── Phase 2: Execute level by level ─────────────────────────────────────────
const executed = []

for (let i = 0; i < levels.length; i++) {
  const level = levels[i]
  const phaseLabel = `Level ${i + 1} (${level.length} spec${level.length > 1 ? 's' : ''})`
  phase(phaseLabel)
  log(`Starting level ${i + 1}: ${level.map(s => `${s.id} — ${s.title}`).join(', ')}`)

  const levelResults = await parallel(
    level.map(spec => () => executeSpec(spec, phaseLabel))
  )

  const levelPass = levelResults.filter(Boolean).filter(r => r.pipeline_gate === 'PASS')
  const levelBlock = levelResults.filter(Boolean).filter(r => r.pipeline_gate === 'BLOCK')
  executed.push(...levelResults.filter(Boolean))

  log(`Level ${i + 1} complete: ${levelPass.length} PASS, ${levelBlock.length} BLOCK`)

  if (levelBlock.length > 0) {
    log(`Level ${i + 1} had blocked specs — subsequent levels that depend on blocked specs will be skipped.`)
  }
}

// ── Phase 3: Report ──────────────────────────────────────────────────────────
phase('Report')

const passed = executed.filter(r => r.pipeline_gate === 'PASS')
const blocked = executed.filter(r => r.pipeline_gate === 'BLOCK')
const skipped = unreachable.map(s => ({ spec_id: s.id, reason: 'Unresolvable dependency' }))

log(`\nExecution summary:`)
log(`  PASS (${passed.length}): ${passed.map(r => r.spec_id).join(', ') || 'none'}`)
log(`  BLOCK (${blocked.length}): ${blocked.map(r => `${r.spec_id} [${r.verdict}]`).join(', ') || 'none'}`)
log(`  SKIPPED (${skipped.length}): ${skipped.map(r => r.spec_id).join(', ') || 'none'}`)

return {
  outcome: blocked.length === 0 && skipped.length === 0 ? 'COMPLETE' : 'PARTIAL',
  executed: passed,
  blocked,
  skipped,
  token_telemetry: tokenLog,
  escalations,
}
