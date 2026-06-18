export const meta = {
  name: 'new-feature',
  description: 'Full new feature pipeline: operator(build) → inspector(review, retry≤1) → operator(ship)',
  phases: [
    { title: 'Build', detail: 'operator plans, implements with TDD, self-verifies, commits locally' },
    { title: 'Inspect', detail: 'inspector runs adversarial review (secrets/security/deps/quality)' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.task    — required: what to implement (string)
// args.effort  — optional: inspector effort mode (low|medium|high|maximum), default: medium
// args.branch  — optional: feature branch name hint

const task = args && args.task ? args.task : 'implement the feature as described'
const effort = args && args.effort ? args.effort : 'medium'
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

function criticalFindings(result) {
  if (!result || !result.findings) return []
  return result.findings.filter(f => f.severity === 'Critical' || f.severity === 'High')
}

function formatFindings(findings) {
  if (!findings || findings.length === 0) return 'No blocking findings.'
  return findings.map(f => `  - [${f.severity}] ${f.file || '?'}:${f.line || 0} — ${f.message}`).join('\n')
}

// ── Stage 1: Build ─────────────────────────────────────────────────────────
phase('Build')
log('operator: loading memory, planning, implementing with TDD, self-verifying...')

let buildResult = await agent(
  `Mode: BUILD\n\nTask: ${task}\n\nLoad relevant .claude/memory/ context, plan if the change touches 3+ files, implement with TDD (Red/Green/Refactor), write tests mapping every code path, run both self-verification gates, and commit locally. Do not push or open a PR yet.`,
  { label: 'operator:build', phase: 'Build', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!buildResult || buildResult.pipeline_gate === 'BLOCK') {
  log(`operator: GATE_FAIL — ${buildResult ? buildResult.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:build', reason: buildResult ? buildResult.summary : 'No response', findings: buildResult ? buildResult.findings : [] }
}
log(`operator: ${buildResult.verdict} — ${buildResult.summary}`)

// ── Stage 2: Inspect (retry ≤ 1) ─────────────────────────────────────────────
phase('Inspect')
let inspectResult = null
let retries = 0

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? `inspector (${effort}): running adversarial review...` : `inspector: re-reviewing after fix ${retries}/${MAX_RETRIES}...`)

  inspectResult = await agent(
    `Task: ${task}\n\nReview the operator's local commit(s) with effort=${effort}. Run secrets detection (SEC-4), OWASP A01–A10, STRIDE (if applicable), dependency audit, and the two-pass quality review.`,
    { label: `inspector${retries > 0 ? `-r${retries}` : ''}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
  )

  if (!inspectResult || inspectResult.pipeline_gate === 'ESCALATE') {
    log('ESCALATION: secret or critical issue found — pipeline blocked, zero retries.')
    return { outcome: 'BLOCKED', stage: 'inspector', reason: inspectResult ? inspectResult.summary : 'No response — treated as ESCALATE', findings: inspectResult ? inspectResult.findings : [] }
  }

  if (inspectResult.pipeline_gate !== 'BLOCK') break

  if (retries >= MAX_RETRIES) break

  log(`inspector: Critical findings — sending back to operator... (fix ${retries + 1}/${MAX_RETRIES})`)
  await agent(
    `Mode: BUILD\n\nTask: ${task}\n\nFix the following Critical findings from inspector (retry ${retries + 1}/${MAX_RETRIES}):\n${formatFindings(criticalFindings(inspectResult))}\n\nFix only the listed items. Do not change unflagged code. Re-run tests and commit.`,
    { label: `operator-fix-r${retries + 1}`, phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'operator' }
  )
  retries++
}

if (inspectResult && inspectResult.pipeline_gate === 'BLOCK') {
  log(`inspector: exceeded ${MAX_RETRIES} fix cycle(s) — escalating.`)
  return { outcome: 'BLOCKED', stage: 'inspector', retries, findings: inspectResult.findings }
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'} — ${inspectResult ? inspectResult.summary : ''}`)

// ── Stage 3: Ship ────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await agent(
  `Mode: SHIP\n\nTask: ${task}\n\nRun pre-flight checks, push the branch, create a draft PR with a structured body (What / How / Testing / Checklist), and save lessons learned to .claude/memory/.`,
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!ship || ship.pipeline_gate === 'BLOCK') {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:ship', reason: ship ? ship.summary : 'No response', findings: ship ? ship.findings : [] }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

return {
  outcome: 'COMPLETE',
  pipeline: 'new-feature',
  task,
  stages: ['operator:build', 'inspector', 'operator:ship'],
  summary: ship.summary || 'Draft PR created. All gates passed.',
}
