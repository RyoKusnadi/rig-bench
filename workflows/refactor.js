export const meta = {
  name: 'refactor',
  description: 'Refactor pipeline: memory-load → refactorer → code-reviewer → verifier → git-assistant → memory-save',
  phases: [
    { title: 'Memory', detail: 'load prior context for target module' },
    { title: 'Refactor', detail: 'refactorer cleans code smell by smell with test verification' },
    { title: 'Review', detail: 'code-reviewer confirms quality improvement' },
    { title: 'Verify', detail: 'verifier confirms behavior unchanged' },
    { title: 'PR', detail: 'git-assistant creates draft PR' },
    { title: 'Memory', detail: 'save lessons learned from refactor run' },
  ],
}

// args.target — required: which file/module/smell to refactor
// args.goal   — optional: readability | performance | extensibility (default: readability)

const target = args && args.target ? args.target : 'the specified module'
const goal = args && args.goal ? args.goal : 'readability'
const MAX_RETRIES = 2

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

// ── Stage 0: Memory load ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: loading prior context for target module...')

const memBrief = await agent(
  `LOAD task="refactor ${target} for ${goal}". Read .claude/memory/ and memory/knowledge/code-quality/ and return a context brief of relevant conventions, code smells already addressed, prior refactor outcomes, and gotchas for this module.`,
  { label: 'memory-manager:load', phase: 'Memory', agentType: 'memory-manager' }
)
log('memory loaded.')

// ── Stage 1: Refactor ─────────────────────────────────────────────────────
phase('Refactor')
log('refactorer: confirming test baseline and identifying smells...')

const refactor = await agent(
  `Target: ${target}\nGoal: ${goal}\n\n${memBrief ? `Prior project memory:\n${memBrief}\n\n` : ''}Confirm a passing test baseline exists, identify code smells, then refactor one smell at a time — running tests after each change. Do not change external behavior or add features.`,
  { label: 'refactorer', phase: 'Refactor', schema: GATE_SCHEMA, agentType: 'refactorer' }
)

if (!refactor || refactor.verdict === 'NO_TESTS') {
  log('refactorer: NO_TESTS — no test baseline. Run test-writer first.')
  return {
    outcome: 'BLOCKED',
    stage: 'refactorer',
    reason: 'No tests exist. Run test-writer before refactoring.',
    action: 'Run the test-writer agent first, then re-run this workflow.',
  }
}

if (!refactor || refactor.verdict === 'REGRESSION' || refactor.pipeline_gate === 'BLOCK') {
  log(`refactorer: REGRESSION or BLOCK — ${refactor ? refactor.summary : 'no response'}. Escalating.`)
  return {
    outcome: 'BLOCKED',
    stage: 'refactorer',
    reason: refactor ? refactor.summary : 'No response',
    findings: refactor ? refactor.findings : [],
  }
}
log(`refactorer: ${refactor.verdict} — ${refactor.summary}`)

// ── Stage 2: Code review ─────────────────────────────────────────────────
phase('Review')
let crResult = null
let crRetries = 0

while (crRetries <= MAX_RETRIES) {
  log(crRetries === 0 ? 'code-reviewer: confirming quality improved...' : `code-reviewer: retry ${crRetries}/${MAX_RETRIES}...`)

  crResult = await agent(
    `Target refactored: ${target}\n\nReview the refactoring with effort=medium. Confirm: (1) external behavior unchanged, (2) no new bugs introduced, (3) code quality improved vs before. Flag any Critical issues.`,
    { label: `code-reviewer${crRetries > 0 ? `-r${crRetries}` : ''}`, phase: 'Review', schema: GATE_SCHEMA, agentType: 'code-reviewer' }
  )

  if (!crResult || crResult.pipeline_gate !== 'BLOCK') break
  crRetries++
}

if (crRetries > MAX_RETRIES) {
  log(`code-reviewer: exceeded ${MAX_RETRIES} retries — escalating.`)
  return { outcome: 'BLOCKED', stage: 'code-reviewer', retries: crRetries, findings: crResult ? crResult.findings : [] }
}
log(`code-reviewer: ${crResult ? crResult.verdict : 'PASS'} — ${crResult ? crResult.summary : ''}`)

// ── Stage 3: Verify ───────────────────────────────────────────────────────
phase('Verify')
log('verifier: confirming behavior is unchanged...')

const vfResult = await agent(
  `Target refactored: ${target}\n\nVerify that external behavior is unchanged: run all tests, check public API surface is intact, confirm no integration points were broken. Return VERIFIED only if behavior is provably the same.`,
  { label: 'verifier', phase: 'Verify', schema: GATE_SCHEMA, agentType: 'verifier' }
)

if (!vfResult || vfResult.pipeline_gate === 'BLOCK') {
  log(`verifier: SPEC_VIOLATION — ${vfResult ? vfResult.summary : 'no response'}`)
  return {
    outcome: 'BLOCKED',
    stage: 'verifier',
    reason: vfResult ? vfResult.summary : 'No response',
    findings: vfResult ? vfResult.findings : [],
  }
}
log(`verifier: ${vfResult.verdict} — ${vfResult.summary}`)

// ── Stage 4: PR ───────────────────────────────────────────────────────────
phase('PR')
log('git-assistant: creating draft PR...')

const pr = await agent(
  `Refactoring complete: ${target} (goal: ${goal})\n\nRun pre-flight checks, validate commits follow conventional commits (refactor: ...), push the branch, and create a draft PR noting what smells were fixed and that tests are unchanged.`,
  { label: 'git-assistant', phase: 'PR', schema: GATE_SCHEMA, agentType: 'git-assistant' }
)

if (!pr || pr.pipeline_gate === 'BLOCK') {
  log(`git-assistant: PREFLIGHT_FAIL — ${pr ? pr.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'git-assistant', reason: pr ? pr.summary : 'No response' }
}

log(`git-assistant: ${pr ? pr.verdict : 'PR_CREATED'} — ${pr ? pr.summary : ''}`)

// ── Stage 5: Memory save ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: saving refactor outcomes...')
await agent(
  `SAVE pipeline=refactor outcome=COMPLETE task="refactor ${target} for ${goal}" summary="${pr ? pr.summary : 'Refactor complete, PR created'}". Record what smells were fixed, test baseline state, and any gotchas discovered during the refactor.`,
  { label: 'memory-manager:save', phase: 'Memory', agentType: 'memory-manager' }
)

return {
  outcome: 'COMPLETE',
  pipeline: 'refactor',
  target,
  goal,
  summary: pr ? pr.summary : 'Draft PR created. Behavior unchanged.',
}
