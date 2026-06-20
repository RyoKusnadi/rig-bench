export const meta = {
  name: 'autotune',
  description: 'Karpathy-autoresearch-style self-improvement loop for one agent .md file: inspector defines binary criteria, then each iteration operator mutates (one operator at a time) -> scout structurally validates -> inspector scores blind -> keep (commit) or discard (revert), stopping on a perfect-score streak or max_iterations.',
  phases: [
    { title: 'Setup', detail: 'inspector reads the target + objective, drafts binary criteria and test cases' },
    { title: 'Baseline', detail: 'inspector scores the unmodified target against those criteria' },
    { title: 'Tune', detail: 'mutate (operator) -> structural gate (scout) -> score (inspector) -> keep/discard (operator)' },
    { title: 'Debrief', detail: 'summarize what was kept, discarded, and the final score' },
  ],
}

// args.target        — required: path to the file being tuned. Hardcoded
//   allowlist below (v1 scope decision) — operator.md/inspector.md are
//   excluded because they ARE the mutator/evaluator in this very loop; a
//   mutation that corrupts one of those risks a corrupted agent judging
//   itself, with no independent check left to catch it.
// args.objective      — required: plain-language description of what
//   "better" means for this target
// args.max_iterations — optional, default 8
// args.stop_streak    — optional, default 3 (consecutive perfect scores to stop early)
// args.tier           — optional: force_tier override (frontier|standard|economy) for
//   operator/inspector calls — scout stays economy regardless, same as every other workflow

const ALLOWED_TARGETS = ['subagents/scout/scout.md', 'subagents/researcher/researcher.md']
const REQUIRED_FRONTMATTER = ['name', 'description', 'tools', 'model_tier', 'permission_mode', 'whenToUse']
const REQUIRED_MARKERS = ['## Hard rules', '## Output']
const MUTATION_OPERATORS = ['add_constraint', 'add_negative_example', 'restructure', 'tighten_language', 'remove_bloat', 'add_counterexample']

if (!args || !args.target || !ALLOWED_TARGETS.includes(args.target)) {
  return { outcome: 'FAILED', stage: 'INIT', reason: `args.target must be one of: ${ALLOWED_TARGETS.join(', ')}` }
}
if (!args.objective) {
  return { outcome: 'FAILED', stage: 'INIT', reason: 'args.objective is required — describe what "better" means for this target.' }
}

const target = args.target
const objective = args.objective
const maxIterations = typeof args.max_iterations === 'number' ? args.max_iterations : 8
const stopStreak = typeof args.stop_streak === 'number' ? args.stop_streak : 3

const TIER_MODELS = { frontier: 'claude-opus-4-8', standard: 'claude-sonnet-4-6', economy: 'claude-haiku-4-5' }
const forceTier = args.tier && TIER_MODELS[args.tier] ? args.tier : null
const operatorModel = TIER_MODELS[forceTier || 'standard']
const inspectorModel = TIER_MODELS[forceTier || 'standard']

const MAX_TOKEN_BUDGET = 300_000
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

// Schemas mirror config/schemas/{operator,inspector,scout}-output.schema.json's
// new TUNE/EVALUATE/VALIDATE_AGENT_FILE fields — forces the StructuredOutput
// layer, same as every other workflow's GATE_SCHEMA/SCOUT_SCHEMA.
const OPERATOR_TUNE_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string' },
    pipeline_gate: { type: 'string', enum: ['PASS', 'BLOCK'] },
    blocking: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, message: { type: 'string' } }, required: ['severity', 'message'] } },
    summary: { type: 'string' },
  },
  required: ['pipeline_gate', 'blocking', 'findings', 'summary'],
}
const SCOUT_VALIDATE_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['VALIDATE_AGENT_FILE'] },
    pipeline_gate: { type: 'string', enum: ['PASS', 'BLOCK'] },
    raw_output: { type: 'string' },
    checks_run: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['mode', 'pipeline_gate', 'summary'],
}
const INSPECTOR_EVALUATE_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['EVALUATE'] },
    action: { type: 'string', enum: ['DEFINE_CRITERIA', 'SCORE'] },
    pipeline_gate: { type: 'string', enum: ['PASS', 'BLOCK', 'ESCALATE'] },
    blocking: { type: 'boolean' },
    criteria: { type: 'array', items: { type: 'string' } },
    test_cases: { type: 'array', items: { type: 'string' } },
    criteria_results: {
      type: 'array',
      items: { type: 'object', properties: { criterion: { type: 'string' }, passed: { type: 'boolean' } }, required: ['criterion', 'passed'] },
    },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, message: { type: 'string' } }, required: ['severity', 'message'] } },
    summary: { type: 'string' },
  },
  required: ['mode', 'action', 'pipeline_gate', 'blocking', 'findings', 'summary'],
}

function scoreOf(criteriaResults) {
  if (!criteriaResults || criteriaResults.length === 0) return { passed: 0, total: 0 }
  return { passed: criteriaResults.filter((r) => r.passed).length, total: criteriaResults.length }
}

async function evaluate(criteria, testCases, label) {
  return trackedAgent(
    `Mode: EVALUATE\nAction: SCORE\n\nTarget file: ${target}\nCriteria:\n${criteria.map((c) => `- ${c}`).join('\n')}\nTest cases:\n${testCases.map((t) => `- ${t}`).join('\n')}\n\nRead the target file fresh and score each criterion PASS/FAIL against its current content. Do not compute or report an aggregate score.`,
    { label, phase: 'Tune', schema: INSPECTOR_EVALUATE_SCHEMA, agentType: 'inspector', model: inspectorModel }
  )
}

// ── Setup ────────────────────────────────────────────────────────────────
phase('Setup')
log(`autotune: defining criteria for ${target} — objective: "${objective}"`)

const setupResult = await trackedAgent(
  `Mode: EVALUATE\nAction: DEFINE_CRITERIA\n\nTarget file: ${target}\nObjective: ${objective}\n\nGenerate 4-6 binary criteria and 2-4 test-case scenarios as described in your EVALUATE mode instructions.`,
  { label: 'inspector:define-criteria', phase: 'Setup', schema: INSPECTOR_EVALUATE_SCHEMA, agentType: 'inspector', model: inspectorModel }
)

if (!setupResult || setupResult.pipeline_gate !== 'PASS' || !setupResult.criteria || setupResult.criteria.length === 0) {
  return { outcome: 'FAILED', stage: 'SETUP', reason: setupResult ? setupResult.summary : 'No response from inspector while defining criteria.', token_telemetry: tokenLog }
}

const criteria = setupResult.criteria
const testCases = setupResult.test_cases || []
log(`autotune: ${criteria.length} criteria, ${testCases.length} test case(s) defined.`)

// ── Baseline ─────────────────────────────────────────────────────────────
phase('Baseline')
const baselineResult = await evaluate(criteria, testCases, 'inspector:baseline')
if (tokenBudgetExceeded()) {
  return { outcome: 'FAILED', stage: 'BASELINE', reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog }
}
if (!baselineResult || baselineResult.pipeline_gate !== 'PASS') {
  return { outcome: 'FAILED', stage: 'BASELINE', reason: baselineResult ? baselineResult.summary : 'No response from inspector while scoring baseline.', token_telemetry: tokenLog }
}

let currentResults = baselineResult.criteria_results || []
let currentScore = scoreOf(currentResults)
const baselineScore = { ...currentScore }
log(`autotune: baseline ${currentScore.passed}/${currentScore.total}.`)

// ── Tune loop ────────────────────────────────────────────────────────────
phase('Tune')
const tuningLog = []
let streak = 0
let iteration = 0

while (iteration < maxIterations && streak < stopStreak) {
  const mutationOp = MUTATION_OPERATORS[iteration % MUTATION_OPERATORS.length]
  const failing = currentResults.filter((r) => !r.passed).map((r) => r.criterion)
  log(`autotune: iteration ${iteration + 1}/${maxIterations} — mutation "${mutationOp}", ${failing.length} failing criteria.`)

  const mutateResult = await trackedAgent(
    `Mode: TUNE\nAction: MUTATE\n\nTarget file: ${target}\nObjective: ${objective}\nMutation operator to apply (exactly one): ${mutationOp}\nCriteria currently failing: ${failing.length > 0 ? failing.join('; ') : 'none — first iteration, mutate toward the objective generally'}`,
    { label: `operator:mutate-i${iteration + 1}`, phase: 'Tune', schema: OPERATOR_TUNE_SCHEMA, agentType: 'operator', model: operatorModel }
  )

  if (tokenBudgetExceeded()) {
    return { outcome: 'FAILED', stage: 'TUNE', reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, tuning_log: tuningLog }
  }
  if (!mutateResult || mutateResult.pipeline_gate !== 'PASS') {
    log(`autotune: mutation ${iteration + 1} BLOCKed by operator (${mutateResult ? mutateResult.summary : 'no response'}) — nothing to revert, skipping to next iteration.`)
    tuningLog.push({ iteration: iteration + 1, mutation_operator: mutationOp, kept: false, reason: 'mutate_blocked' })
    streak = 0
    iteration++
    continue
  }

  const validateResult = await trackedAgent(
    `Mode: VALIDATE_AGENT_FILE\n\nFile: ${target}\nRequired frontmatter: ${REQUIRED_FRONTMATTER.join(', ')}\nRequired markers: ${REQUIRED_MARKERS.join(' | ')}`,
    { label: `scout:validate-i${iteration + 1}`, phase: 'Tune', schema: SCOUT_VALIDATE_SCHEMA, agentType: 'scout', model: TIER_MODELS.economy }
  )

  if (!validateResult || validateResult.pipeline_gate !== 'PASS') {
    log(`autotune: iteration ${iteration + 1} failed structural validation (${validateResult ? validateResult.summary : 'no response'}) — reverting without spending an eval call.`)
    await trackedAgent(
      `Mode: TUNE\nAction: REVERT\n\nTarget file: ${target}\n\nThe mutation failed scout's structural validation: ${validateResult ? validateResult.summary : 'no response'}. Discard it.`,
      { label: `operator:revert-i${iteration + 1}`, phase: 'Tune', schema: OPERATOR_TUNE_SCHEMA, agentType: 'operator', model: operatorModel }
    )
    tuningLog.push({ iteration: iteration + 1, mutation_operator: mutationOp, kept: false, reason: 'structural_invalid' })
    streak = 0
    iteration++
    continue
  }

  const newResult = await evaluate(criteria, testCases, `inspector:score-i${iteration + 1}`)
  if (tokenBudgetExceeded()) {
    return { outcome: 'FAILED', stage: 'TUNE', reason: 'Token budget exceeded. Manual review required.', token_telemetry: tokenLog, tuning_log: tuningLog }
  }
  if (!newResult || newResult.pipeline_gate !== 'PASS') {
    log(`autotune: iteration ${iteration + 1} could not be scored (${newResult ? newResult.summary : 'no response'}) — reverting.`)
    await trackedAgent(
      `Mode: TUNE\nAction: REVERT\n\nTarget file: ${target}\n\nEvaluation failed: ${newResult ? newResult.summary : 'no response'}. Discard the mutation.`,
      { label: `operator:revert-i${iteration + 1}`, phase: 'Tune', schema: OPERATOR_TUNE_SCHEMA, agentType: 'operator', model: operatorModel }
    )
    tuningLog.push({ iteration: iteration + 1, mutation_operator: mutationOp, kept: false, reason: 'eval_failed' })
    streak = 0
    iteration++
    continue
  }

  const newScore = scoreOf(newResult.criteria_results)
  const improvedOrEqual = newScore.passed >= currentScore.passed

  if (improvedOrEqual) {
    await trackedAgent(
      `Mode: TUNE\nAction: COMMIT\n\nTarget file: ${target}\n\nStage and commit only this file with message: "tune(${target.split('/').pop()}): ${mutationOp} -- score ${newScore.passed}/${newScore.total} (iteration ${iteration + 1})"`,
      { label: `operator:commit-i${iteration + 1}`, phase: 'Tune', schema: OPERATOR_TUNE_SCHEMA, agentType: 'operator', model: operatorModel }
    )
    currentResults = newResult.criteria_results
    currentScore = newScore
    streak = newScore.total > 0 && newScore.passed === newScore.total ? streak + 1 : 0
    tuningLog.push({ iteration: iteration + 1, mutation_operator: mutationOp, kept: true, score: `${newScore.passed}/${newScore.total}` })
    log(`autotune: iteration ${iteration + 1} KEPT — ${newScore.passed}/${newScore.total} (streak ${streak}).`)
  } else {
    await trackedAgent(
      `Mode: TUNE\nAction: REVERT\n\nTarget file: ${target}\n\nThis mutation scored ${newScore.passed}/${newScore.total}, below the current best ${currentScore.passed}/${currentScore.total}. Discard it.`,
      { label: `operator:revert-i${iteration + 1}`, phase: 'Tune', schema: OPERATOR_TUNE_SCHEMA, agentType: 'operator', model: operatorModel }
    )
    streak = 0
    tuningLog.push({ iteration: iteration + 1, mutation_operator: mutationOp, kept: false, reason: 'regressed', score: `${newScore.passed}/${newScore.total}` })
    log(`autotune: iteration ${iteration + 1} DISCARDED — ${newScore.passed}/${newScore.total} did not improve on ${currentScore.passed}/${currentScore.total}.`)
  }

  iteration++
}

// ── Debrief ──────────────────────────────────────────────────────────────
phase('Debrief')
const stopReason = streak >= stopStreak ? 'perfect_score_streak' : 'max_iterations'
const keptCount = tuningLog.filter((t) => t.kept).length

return {
  outcome: 'COMPLETE',
  pipeline: 'autotune',
  target,
  objective,
  criteria,
  test_cases: testCases,
  baseline_score: `${baselineScore.passed}/${baselineScore.total}`,
  final_score: `${currentScore.passed}/${currentScore.total}`,
  iterations_run: iteration,
  kept_count: keptCount,
  discarded_count: tuningLog.length - keptCount,
  stop_reason: stopReason,
  tuning_log: tuningLog,
  summary: `${target}: ${baselineScore.passed}/${baselineScore.total} -> ${currentScore.passed}/${currentScore.total} over ${iteration} iteration(s) (${keptCount} kept, stopped on ${stopReason}). Each kept mutation is a local commit -- nothing pushed.`,
  token_telemetry: tokenLog,
}
