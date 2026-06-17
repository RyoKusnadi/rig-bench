export const meta = {
  name: 'bug-fix',
  description: 'Bug fix pipeline: memory-load → debugger (optional) → developer → test-writer → verifier → git-assistant → memory-save',
  phases: [
    { title: 'Memory', detail: 'memory-manager loads prior context for this area' },
    { title: 'Diagnose', detail: 'debugger root-cause analysis (skippable if cause is known)' },
    { title: 'Fix', detail: 'developer implements fix with regression test' },
    { title: 'Test', detail: 'test-writer adds regression and edge-case tests' },
    { title: 'Verify', detail: 'verifier confirms bug is resolved' },
    { title: 'PR', detail: 'git-assistant creates draft PR' },
    { title: 'Memory', detail: 'memory-manager saves root cause and fix to gotchas' },
  ],
}

// args.bug         — required: description of the bug or failing test
// args.known_cause — optional: set to true to skip the debugger stage
// args.stack_trace — optional: paste the stack trace for better debugger context

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

// ── Stage 0: Load memory ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: loading prior context for this bug area...')

const memContext = await agent(
  `LOAD task="debug: ${bug}". Search .claude/memory/ for prior gotchas, architecture facts, or lessons learned relevant to this bug. Return a context brief.`,
  { label: 'memory-manager:load', phase: 'Memory', agentType: 'memory-manager' }
)

const memBrief = memContext || 'No prior memory for this area.'
log('memory-manager: context loaded')

// ── Stage 1: Diagnose ─────────────────────────────────────────────────────
let rootCauseContext = ''

if (!knownCause) {
  phase('Diagnose')
  log('debugger: reproducing failure and forming hypotheses...')

  const diagnosis = await agent(
    `Bug report: ${bug}${stackTrace}\n\nPrior memory context:\n${memBrief}\n\nReproduce the failure, form 2–3 ranked hypotheses, test the cheapest ones first, and report the root cause with a suggested fix snippet. Do NOT apply the fix.`,
    { label: 'debugger', phase: 'Diagnose', schema: GATE_SCHEMA, agentType: 'debugger' }
  )

  if (!diagnosis || diagnosis.verdict === 'INCONCLUSIVE') {
    log(`debugger: INCONCLUSIVE — ${diagnosis ? diagnosis.summary : 'no response'}. Escalating to human.`)
    return {
      outcome: 'BLOCKED',
      stage: 'debugger',
      reason: diagnosis ? diagnosis.summary : 'Debugger returned no response',
      findings: diagnosis ? diagnosis.findings : [],
    }
  }

  rootCauseContext = `\n\nRoot cause identified by debugger:\n${formatFindings(diagnosis)}\n\nSummary: ${diagnosis.summary}`
  log(`debugger: ROOT_CAUSE_FOUND — ${diagnosis.summary}`)
} else {
  log('Skipping debugger — root cause provided by caller.')
  rootCauseContext = `\n\nRoot cause: ${bug}`
}

// ── Stage 2: Fix ──────────────────────────────────────────────────────────
phase('Fix')
let devResult = null
let devRetries = 0

while (devRetries <= MAX_RETRIES) {
  const retryContext = devRetries > 0
    ? `\n\nRetry ${devRetries}/${MAX_RETRIES}. Prior attempt did not fully resolve:\n${formatFindings(devResult)}`
    : ''

  log(devRetries === 0 ? 'developer: writing regression test then applying fix...' : `developer: retry ${devRetries}/${MAX_RETRIES}...`)

  devResult = await agent(
    `Bug: ${bug}${rootCauseContext}\n\nWrite a failing regression test FIRST (prove it catches the bug), then apply the minimal fix to make it pass. Run full test suite after.${retryContext}`,
    { label: `developer${devRetries > 0 ? `-r${devRetries}` : ''}`, phase: 'Fix', schema: GATE_SCHEMA, agentType: 'developer' }
  )

  if (!devResult || devResult.pipeline_gate === 'PASS') break
  devRetries++
}

if (devRetries > MAX_RETRIES) {
  log(`developer: exceeded ${MAX_RETRIES} retries — escalating.`)
  return { outcome: 'BLOCKED', stage: 'developer', retries: devRetries, findings: devResult ? devResult.findings : [] }
}
log(`developer: ${devResult ? devResult.verdict : 'IMPLEMENTED'} — ${devResult ? devResult.summary : ''}`)

// ── Stage 3: Test ─────────────────────────────────────────────────────────
phase('Test')
log('test-writer: adding regression and edge-case tests...')

const tests = await agent(
  `Bug fixed: ${bug}\n\nThe fix is implemented. Add any missing edge-case tests around the fixed code path. Ensure the regression test is present and passing. Report full test output.`,
  { label: 'test-writer', phase: 'Test', schema: GATE_SCHEMA, agentType: 'test-writer' }
)

if (!tests || tests.pipeline_gate === 'BLOCK') {
  log(`test-writer: BLOCKED — ${tests ? tests.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'test-writer', reason: tests ? tests.summary : 'No response', findings: tests ? tests.findings : [] }
}
log(`test-writer: ${tests ? tests.verdict : 'TESTS_PASS'} — ${tests ? tests.summary : ''}`)

// ── Stage 4: Verify ───────────────────────────────────────────────────────
phase('Verify')
let vfResult = null
let vfRetries = 0

while (vfRetries <= MAX_RETRIES) {
  log(vfRetries === 0 ? 'verifier: confirming bug is resolved...' : `verifier: retry ${vfRetries}/${MAX_RETRIES}...`)

  vfResult = await agent(
    `Bug: ${bug}\n\nVerify: (1) the specific failure no longer reproduces, (2) the regression test passes, (3) no adjacent behavior was broken. Gather real execution evidence.`,
    { label: `verifier${vfRetries > 0 ? `-r${vfRetries}` : ''}`, phase: 'Verify', schema: GATE_SCHEMA, agentType: 'verifier' }
  )

  if (!vfResult || vfResult.pipeline_gate === 'PASS') break
  vfRetries++
}

if (vfRetries > MAX_RETRIES) {
  log(`verifier: exceeded ${MAX_RETRIES} retries — escalating.`)
  return { outcome: 'BLOCKED', stage: 'verifier', retries: vfRetries, findings: vfResult ? vfResult.findings : [] }
}
log(`verifier: ${vfResult ? vfResult.verdict : 'VERIFIED'} — ${vfResult ? vfResult.summary : ''}`)

// ── Stage 5: PR ───────────────────────────────────────────────────────────
phase('PR')
log('git-assistant: creating draft PR...')

const pr = await agent(
  `Bug fixed: ${bug}\n\nRun pre-flight checks, validate commit messages follow conventional commits (fix: ...), push the branch, and create a draft PR. Include "Closes #<issue>" if an issue number is in the bug description.`,
  { label: 'git-assistant', phase: 'PR', schema: GATE_SCHEMA, agentType: 'git-assistant' }
)

if (!pr || pr.pipeline_gate === 'BLOCK') {
  log(`git-assistant: pre-flight failed — ${pr ? pr.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'git-assistant', reason: pr ? pr.summary : 'No response' }
}

log(`git-assistant: ${pr ? pr.verdict : 'PR_CREATED'} — ${pr ? pr.summary : ''}`)

// ── Stage 6: Save memory ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: recording root cause and fix to gotchas...')

await agent(
  `SAVE pipeline=bug-fix outcome=COMPLETE task="${bug}" summary="${pr ? pr.summary : 'Bug fixed'}". Record the root cause, the fix approach, and any gotchas discovered during this pipeline to .claude/memory/gotchas.md and lessons-learned.md.`,
  { label: 'memory-manager:save', phase: 'Memory', agentType: 'memory-manager' }
)

return {
  outcome: 'COMPLETE',
  pipeline: 'bug-fix',
  bug,
  skipped_debugger: knownCause,
  summary: pr ? pr.summary : 'Draft PR created. Bug resolved.',
}
