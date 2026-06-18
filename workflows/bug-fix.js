export const meta = {
  name: 'bug-fix',
  description: 'Bug fix pipeline: operator(diagnose+fix) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Fix', detail: 'operator diagnoses root cause, writes regression test, applies fix' },
    { title: 'Inspect', detail: 'inspector confirms no regressions or security issues' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.bug         — required: description of the bug or failing test
// args.known_cause — optional: set to true if root cause is already known
// args.stack_trace — optional: paste the stack trace for better diagnosis context

const bug = args && args.bug ? args.bug : 'fix the reported bug'
const knownCause = args && args.known_cause === true
const stackTrace = args && args.stack_trace ? `\n\nStack trace:\n${args.stack_trace}` : ''
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

// ── Stage 1: Fix ──────────────────────────────────────────────────────────
phase('Fix')
const causeNote = knownCause ? `\n\nRoot cause provided by caller — skip diagnosis: ${bug}` : ''
log(knownCause ? 'operator: applying known-cause fix...' : 'operator: diagnosing root cause and fixing...')

const fix = await agent(
  `Mode: BUILD\n\nBug: ${bug}${stackTrace}${causeNote}\n\nLoad relevant .claude/memory/ context (gotchas, prior fixes in this area).${knownCause ? '' : ' Reproduce the failure, form ranked hypotheses, and identify the root cause before fixing.'} Write a failing regression test FIRST, then apply the minimal fix. Run the full suite and commit locally.`,
  { label: 'operator:fix', phase: 'Fix', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!fix || fix.pipeline_gate === 'BLOCK') {
  log(`operator: GATE_FAIL — ${fix ? fix.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:fix', reason: fix ? fix.summary : 'No response', findings: fix ? fix.findings : [] }
}
log(`operator: ${fix.verdict} — ${fix.summary}`)

// ── Stage 2: Inspect (retry ≤ 1) ─────────────────────────────────────────────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'inspector: confirming fix resolves the bug with no regressions...' : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await agent(
    `Bug: ${bug}\n\nVerify: (1) the specific failure no longer reproduces, (2) the regression test passes, (3) no adjacent behavior was broken, (4) no security or dependency issues were introduced.`,
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
    `Mode: BUILD\n\nBug: ${bug}\n\nFix the following findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(inspectResult)}\n\nFix only the listed items. Re-run tests and commit.`,
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
  `Mode: SHIP\n\nBug fixed: ${bug}\n\nRun pre-flight checks, push the branch, create a draft PR (include "Closes #<issue>" if an issue number is in the bug description), and save the root cause + fix approach to .claude/memory/gotchas.md and lessons-learned.md.`,
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
  pipeline: 'bug-fix',
  bug,
  skipped_diagnosis: knownCause,
  summary: ship.summary || 'Draft PR created. Bug resolved.',
}
