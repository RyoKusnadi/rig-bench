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

const target = args && args.target ? args.target : 'the specified module'
const goal = args && args.goal ? args.goal : 'readability'
const MAX_RETRIES = 1

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

// ── Stage 1: Refactor ─────────────────────────────────────────────────────
phase('Refactor')
log('operator: confirming test baseline and refactoring smell-by-smell...')

const refactor = await agent(
  `Mode: REFACTOR\n\nTarget: ${target}\nGoal: ${goal}\n\nLoad relevant .claude/memory/ context. Confirm a passing test baseline exists, identify code smells, then refactor one smell at a time — running tests after each change and committing each independently. Do not change external behavior or add features.`,
  { label: 'operator:refactor', phase: 'Refactor', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!refactor || refactor.verdict === 'NO_TESTS') {
  log('operator: NO_TESTS — no test baseline. Run in BUILD mode to add tests first.')
  return {
    outcome: 'BLOCKED',
    stage: 'operator:refactor',
    reason: 'No tests exist. Run the new-feature/bug-fix workflow (BUILD mode) to add tests before refactoring.',
  }
}

if (!refactor || refactor.verdict === 'REGRESSION' || refactor.pipeline_gate === 'BLOCK') {
  log(`operator: REGRESSION or BLOCK — ${refactor ? refactor.summary : 'no response'}. Escalating.`)
  return { outcome: 'BLOCKED', stage: 'operator:refactor', reason: refactor ? refactor.summary : 'No response', findings: refactor ? refactor.findings : [] }
}
log(`operator: ${refactor.verdict} — ${refactor.summary}`)

// ── Stage 2: Inspect (retry ≤ 1) ─────────────────────────────────────────────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'inspector: confirming behavior unchanged and quality improved...' : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await agent(
    `Target refactored: ${target} (goal: ${goal})\n\nReview with effort=medium. Confirm: (1) external behavior unchanged — run all tests, check public API surface, (2) no new bugs introduced, (3) code quality improved vs before.`,
    { label: `inspector${retries > 0 ? `-r${retries}` : ''}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
  )

  if (!inspectResult || inspectResult.pipeline_gate === 'ESCALATE') {
    log('ESCALATION: secret or critical issue found — pipeline blocked, zero retries.')
    return { outcome: 'BLOCKED', stage: 'inspector', reason: inspectResult ? inspectResult.summary : 'No response — treated as ESCALATE', findings: inspectResult ? inspectResult.findings : [] }
  }

  if (inspectResult.pipeline_gate !== 'BLOCK') break
  if (retries >= MAX_RETRIES) break

  log(`inspector: issues found — sending back to operator... (fix ${retries + 1}/${MAX_RETRIES})`)
  await agent(
    `Mode: REFACTOR\n\nTarget: ${target}\n\nFix the following findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(inspectResult)}\n\nFix only the listed items, one at a time, re-running tests after each.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator' }
  )
  retries++
}

if (inspectResult && inspectResult.pipeline_gate === 'BLOCK') {
  log(`inspector: exceeded ${MAX_RETRIES} retries — escalating.`)
  return { outcome: 'BLOCKED', stage: 'inspector', retries, findings: inspectResult.findings }
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'} — ${inspectResult ? inspectResult.summary : ''}`)

// ── Stage 3: Ship ────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await agent(
  `Mode: SHIP\n\nRefactoring complete: ${target} (goal: ${goal})\n\nRun pre-flight checks, push the branch, create a draft PR noting what smells were fixed and that tests are unchanged, and save the refactor outcome to .claude/memory/.`,
  // SHIP is pre-flight checks + PR formatting, no design/security judgment —
  // Haiku is plenty for it and costs a fraction of Sonnet.
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator', model: 'claude-haiku-4-5-20251001' }
)

if (!ship || ship.pipeline_gate === 'BLOCK') {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:ship', reason: ship ? ship.summary : 'No response' }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

return {
  outcome: 'COMPLETE',
  pipeline: 'refactor',
  target,
  goal,
  summary: ship.summary || 'Draft PR created. Behavior unchanged.',
}
