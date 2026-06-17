export const meta = {
  name: 'new-feature',
  description: 'Full new feature pipeline: memory-load → secret-scanner → planner → developer → test-writer → code-reviewer → security-reviewer → verifier → git-assistant → memory-save',
  phases: [
    { title: 'Memory', detail: 'memory-manager loads prior context for this task' },
    { title: 'Pre-flight', detail: 'secret-scanner SEC-4 credential check' },
    { title: 'Plan', detail: 'planner produces file-level implementation plan' },
    { title: 'Implement', detail: 'developer implements with TDD cycle' },
    { title: 'Test', detail: 'test-writer writes and verifies tests' },
    { title: 'Review', detail: 'code-reviewer + security-reviewer in parallel' },
    { title: 'Verify', detail: 'verifier confirms spec compliance' },
    { title: 'PR', detail: 'git-assistant creates draft PR' },
    { title: 'Memory', detail: 'memory-manager saves lessons learned' },
  ],
}

// args.task    — required: what to implement (string)
// args.effort  — optional: code-reviewer effort mode (low|medium|high|maximum), default: medium
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

// ── Stage 0: Load memory ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: loading prior context...')

const memContext = await agent(
  `LOAD task="${task}". Read .claude/memory/ and return a context brief of relevant conventions, architecture facts, gotchas, and prior decisions that apply to this task.`,
  { label: 'memory-manager:load', phase: 'Memory', agentType: 'memory-manager' }
)

const memBrief = memContext || 'No prior memory. Starting fresh.'
log(`memory-manager: context loaded`)

// ── Stage 1: Secret scan ───────────────────────────────────────────────────
phase('Pre-flight')
log('secret-scanner: running SEC-4 credential check...')

const scan = await agent(
  `Task context: ${task}\n\nRun the 8 SEC-4 grep patterns against all changed files. Report CLEAN or ESCALATION.`,
  { label: 'secret-scanner', phase: 'Pre-flight', schema: GATE_SCHEMA, agentType: 'secret-scanner' }
)

if (!scan || scan.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found — pipeline blocked. Rotate the credential and rerun.')
  return {
    outcome: 'BLOCKED',
    stage: 'secret-scanner',
    reason: scan ? scan.summary : 'No response — treated as ESCALATE',
  }
}
log(`secret-scanner: ${scan.verdict} — ${scan.summary}`)

// ── Stage 2: Plan ─────────────────────────────────────────────────────────
phase('Plan')
log('planner: reading codebase and producing implementation plan...')

const plan = await agent(
  `Task: ${task}\n\nPrior project memory (treat as established context — do not re-derive):\n${memBrief}\n\nRead the codebase, identify affected files, ask clarifying questions if needed (max 2–3), then produce a phased file-level implementation plan.`,
  { label: 'planner', phase: 'Plan', schema: GATE_SCHEMA, agentType: 'planner' }
)

if (!plan || plan.pipeline_gate === 'BLOCK') {
  log('BLOCKED: planner requires a human decision before implementation can start.')
  return {
    outcome: 'BLOCKED',
    stage: 'planner',
    reason: plan ? plan.summary : 'No response from planner',
    findings: plan ? plan.findings : [],
  }
}
log(`planner: ${plan.verdict} — ${plan.summary}`)

// ── Stage 3: Implement ────────────────────────────────────────────────────
phase('Implement')
let devResult = null
let devRetries = 0

while (devRetries <= MAX_RETRIES) {
  const retryContext = devRetries > 0
    ? `\n\nRetry ${devRetries}/${MAX_RETRIES}. Fix ONLY these findings from the prior review:\n${formatFindings(criticalFindings(devResult))}\nDo not change unflagged code.`
    : ''

  log(devRetries === 0 ? 'developer: implementing feature...' : `developer: retry ${devRetries}/${MAX_RETRIES}...`)

  devResult = await agent(
    `Task: ${task}\n\nImplement the feature. Follow TDD: write failing test first, then implement, then clean up. Run full test suite and two-stage self-validation gate before reporting done.${retryContext}`,
    { label: `developer${devRetries > 0 ? `-r${devRetries}` : ''}`, phase: 'Implement', schema: GATE_SCHEMA, agentType: 'developer' }
  )

  if (!devResult || devResult.pipeline_gate === 'PASS') break
  devRetries++
}

if (devRetries > MAX_RETRIES) {
  log(`developer: exceeded ${MAX_RETRIES} retries — escalating.`)
  return { outcome: 'BLOCKED', stage: 'developer', retries: devRetries, findings: devResult ? devResult.findings : [] }
}
log(`developer: ${devResult ? devResult.verdict : 'PASS'} — ${devResult ? devResult.summary : ''}`)

// ── Stage 4: Tests ────────────────────────────────────────────────────────
phase('Test')
log('test-writer: generating and verifying tests...')

const tests = await agent(
  `Task: ${task}\n\nRead the newly implemented code, map all code paths, write comprehensive tests (AAA pattern), verify they all pass, and report coverage.`,
  { label: 'test-writer', phase: 'Test', schema: GATE_SCHEMA, agentType: 'test-writer' }
)

if (!tests || tests.pipeline_gate === 'BLOCK') {
  log(`test-writer: BLOCKED — ${tests ? tests.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'test-writer', reason: tests ? tests.summary : 'No response', findings: tests ? tests.findings : [] }
}
log(`test-writer: ${tests ? tests.verdict : 'PASS'} — ${tests ? tests.summary : ''}`)

// ── Stages 5+6: Code review + Security review (parallel) ─────────────────
phase('Review')
log(`code-reviewer (${effort}) + security-reviewer: running in parallel...`)

const [crInitial, sec] = await parallel([
  () => agent(
    `Task: ${task}\n\nReview the implementation with effort=${effort}. Run static analysis, check spec compliance (Pass A), then quality audit (Pass B).`,
    { label: 'code-reviewer', phase: 'Review', schema: GATE_SCHEMA, agentType: 'code-reviewer' }
  ),
  () => agent(
    `Task: ${task}\n\nRun the full security audit: secrets detection (SEC-4), OWASP A01–A10, STRIDE threat model, dependency audit. Cite file:line for every finding.`,
    { label: 'security-reviewer', phase: 'Review', schema: GATE_SCHEMA, agentType: 'security-reviewer' }
  ),
])

// Security result — hard stop, no retry
if (!sec || sec.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found in security review — pipeline blocked.')
  return { outcome: 'BLOCKED', stage: 'security-reviewer', reason: sec ? sec.summary : 'No response — treated as ESCALATE' }
}
if (sec.pipeline_gate === 'BLOCK') {
  log(`security-reviewer: CRITICAL/HIGH findings — escalating to human.`)
  return { outcome: 'BLOCKED', stage: 'security-reviewer', reason: sec.summary, findings: sec.findings }
}
log(`security-reviewer: ${sec.verdict} — ${sec.summary}`)

// Code review retry loop — re-runs only code-reviewer, security already passed
let crResult = crInitial
let crRetries = 0

while (crRetries < MAX_RETRIES && crResult && crResult.pipeline_gate === 'BLOCK') {
  log(`code-reviewer: Critical findings — sending back to developer... (fix ${crRetries + 1}/${MAX_RETRIES})`)
  devResult = await agent(
    `Task: ${task}\n\nFix the following Critical findings from code-reviewer (retry ${crRetries + 1}/${MAX_RETRIES}):\n${formatFindings(criticalFindings(crResult))}\n\nFix only the listed items. Do not change unflagged code. Re-run tests after each fix.`,
    { label: `developer-cr-fix-r${crRetries + 1}`, phase: 'Review', schema: GATE_SCHEMA, agentType: 'developer' }
  )
  crRetries++
  log(`code-reviewer: re-reviewing after fix ${crRetries}/${MAX_RETRIES}...`)
  crResult = await agent(
    `Task: ${task}\n\nRe-review with effort=${effort}. Verify these Critical findings are resolved:\n${formatFindings(criticalFindings(crResult))}`,
    { label: `code-reviewer-r${crRetries}`, phase: 'Review', schema: GATE_SCHEMA, agentType: 'code-reviewer' }
  )
}

if (crResult && crResult.pipeline_gate === 'BLOCK') {
  log(`code-reviewer: exceeded ${MAX_RETRIES} fix cycle(s) — escalating.`)
  return { outcome: 'BLOCKED', stage: 'code-reviewer', retries: crRetries, findings: crResult ? crResult.findings : [] }
}
log(`code-reviewer: ${crResult ? crResult.verdict : 'PASS'} — ${crResult ? crResult.summary : ''}`)

// ── Stage 7: Verify ───────────────────────────────────────────────────────
phase('Verify')
let vfResult = null
let vfRetries = 0

while (vfRetries <= MAX_RETRIES) {
  const retryContext = vfRetries > 0
    ? `\n\nRetry ${vfRetries}/${MAX_RETRIES}. These requirements were unmet last time:\n${formatFindings(vfResult ? vfResult.findings : [])}`
    : ''

  log(vfRetries === 0 ? 'verifier: checking spec compliance...' : `verifier: retry ${vfRetries}/${MAX_RETRIES}...`)

  vfResult = await agent(
    `Task: ${task}\n\nIndependently verify every stated requirement is met. Gather real execution evidence (run tests, grep for wiring, check endpoints). Return VERIFIED only if every requirement is fully MET.${retryContext}`,
    { label: `verifier${vfRetries > 0 ? `-r${vfRetries}` : ''}`, phase: 'Verify', schema: GATE_SCHEMA, agentType: 'verifier' }
  )

  if (!vfResult || vfResult.pipeline_gate === 'PASS') break

  // Fix spec violations before re-verifying
  log(`verifier: SPEC_VIOLATION — sending back to developer...`)
  await agent(
    `Task: ${task}\n\nFix spec violations identified by verifier (retry ${vfRetries + 1}/${MAX_RETRIES}):\n${formatFindings(vfResult ? vfResult.findings : [])}\n\nFix only the listed requirements. Do not change unflagged code.`,
    { label: `developer-vf-fix-r${vfRetries + 1}`, phase: 'Verify', schema: GATE_SCHEMA, agentType: 'developer' }
  )
  vfRetries++
}

if (vfRetries > MAX_RETRIES) {
  log(`verifier: exceeded ${MAX_RETRIES} retry cycles — escalating.`)
  return { outcome: 'BLOCKED', stage: 'verifier', retries: vfRetries, findings: vfResult ? vfResult.findings : [] }
}
log(`verifier: ${vfResult ? vfResult.verdict : 'VERIFIED'} — ${vfResult ? vfResult.summary : ''}`)

// ── Stage 8: PR ───────────────────────────────────────────────────────────
phase('PR')
log('git-assistant: creating draft PR...')

const pr = await agent(
  `Task: ${task}\n\nRun pre-flight checks (no uncommitted changes, conventional commits), push the branch, and create a draft PR with a structured body (What / How / Testing / Checklist).`,
  { label: 'git-assistant', phase: 'PR', schema: GATE_SCHEMA, agentType: 'git-assistant' }
)

if (!pr || pr.pipeline_gate === 'BLOCK') {
  log(`git-assistant: pre-flight failed — ${pr ? pr.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'git-assistant', reason: pr ? pr.summary : 'No response', findings: pr ? pr.findings : [] }
}

log(`git-assistant: ${pr ? pr.verdict : 'PR_CREATED'} — ${pr ? pr.summary : ''}`)

// ── Stage 9: Save memory ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: saving lessons learned...')

await agent(
  `SAVE pipeline=new-feature outcome=COMPLETE task="${task}" summary="${pr ? pr.summary : 'Draft PR created'}". Save any conventions, architecture facts, gotchas, or decisions surfaced during this pipeline run to .claude/memory/.`,
  { label: 'memory-manager:save', phase: 'Memory', agentType: 'memory-manager' }
)

return {
  outcome: 'COMPLETE',
  pipeline: 'new-feature',
  task,
  stages: ['memory-load', 'secret-scanner', 'planner', 'developer', 'test-writer', 'code-reviewer', 'security-reviewer', 'verifier', 'git-assistant', 'memory-save'],
  summary: pr ? pr.summary : 'Draft PR created. All gates passed.',
}
