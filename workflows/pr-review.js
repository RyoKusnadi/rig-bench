export const meta = {
  name: 'pr-review',
  description: 'PR quality review: secret-scanner → code-reviewer + security-reviewer + dependency-auditor (parallel) → synthesize → optional verifier',
  phases: [
    { title: 'Pre-flight', detail: 'secret-scanner credential check' },
    { title: 'Review', detail: 'parallel: code-reviewer + security-reviewer + dependency-auditor' },
    { title: 'Synthesize', detail: 'orchestrator merges all findings' },
    { title: 'Verify', detail: 'optional spec-compliance check' },
  ],
}

// args.pr        — optional: PR number (e.g. 42) — if omitted, reviews current HEAD diff
// args.effort    — optional: code-reviewer effort mode (low|medium|high|maximum), default: medium
// args.verify    — optional: set to true to run verifier after review (default: false)
// args.spec      — optional: spec/requirements text for the verifier (required if verify=true)

const pr = args && args.pr ? String(args.pr) : null
const effort = args && args.effort ? args.effort : 'medium'
const runVerifier = args && args.verify === true
const spec = args && args.spec ? args.spec : ''
const scope = pr ? `PR #${pr}` : 'current HEAD diff'

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

const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    blocking_count:    { type: 'number' },
    critical_count:    { type: 'number' },
    high_count:        { type: 'number' },
    overall_gate:      { type: 'string', enum: ['PASS', 'BLOCK', 'ESCALATE'] },
    merged_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          source:   { type: 'string' },
          file:     { type: 'string' },
          line:     { type: 'number' },
          message:  { type: 'string' },
        },
        required: ['severity', 'source', 'message'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['blocking_count', 'overall_gate', 'merged_findings', 'recommendation'],
}

// ── Stage 1: Secret scan ───────────────────────────────────────────────────
phase('Pre-flight')
log('secret-scanner: checking for credentials...')

const scanPrompt = pr
  ? `Run the 8 SEC-4 patterns against the diff for PR #${pr}. Report CLEAN or ESCALATION.`
  : `Run the 8 SEC-4 patterns against the current HEAD diff. Report CLEAN or ESCALATION.`

const scan = await agent(scanPrompt, {
  label: 'secret-scanner',
  phase: 'Pre-flight',
  schema: GATE_SCHEMA,
  agentType: 'secret-scanner',
})

if (!scan || scan.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found — pipeline blocked. Rotate credential before continuing.')
  return {
    outcome: 'BLOCKED',
    stage: 'secret-scanner',
    reason: scan ? scan.summary : 'No response — treated as ESCALATE',
  }
}
log(`secret-scanner: ${scan.verdict}`)

// ── Stage 2: Parallel review ──────────────────────────────────────────────
phase('Review')
log(`Running code-reviewer (${effort}), security-reviewer, dependency-auditor in parallel...`)

const diffContext = pr ? `PR #${pr}` : 'current HEAD diff'

const [crResult, secResult, depResult] = await parallel([
  () => agent(
    `Review ${diffContext} with effort=${effort}. Run static analysis, Pass A (spec compliance), Pass B (quality audit across correctness, security, test coverage, performance).`,
    { label: 'code-reviewer', phase: 'Review', schema: GATE_SCHEMA, agentType: 'code-reviewer', isolation: 'worktree' }
  ),
  () => agent(
    `Security audit ${diffContext}. Run OWASP A01–A10, STRIDE, secrets detection, dependency check. Cite file:line for every finding.`,
    { label: 'security-reviewer', phase: 'Review', schema: GATE_SCHEMA, agentType: 'security-reviewer', isolation: 'worktree' }
  ),
  () => agent(
    `Audit all package manifests in the repository for CVEs, unpinned versions, abandoned packages, and license conflicts. Every finding must include the exact fix command.`,
    { label: 'dependency-auditor', phase: 'Review', schema: GATE_SCHEMA, agentType: 'dependency-auditor', isolation: 'worktree' }
  ),
])

// Check for secret escalation from security-reviewer
if (secResult && secResult.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found by security-reviewer — pipeline blocked.')
  return {
    outcome: 'BLOCKED',
    stage: 'security-reviewer',
    reason: secResult.summary,
    findings: secResult.findings,
  }
}

const allFindings = [
  ...(crResult ? crResult.findings.map(f => ({ ...f, source: 'code-reviewer' })) : []),
  ...(secResult ? secResult.findings.map(f => ({ ...f, source: 'security-reviewer' })) : []),
  ...(depResult ? depResult.findings.map(f => ({ ...f, source: 'dependency-auditor' })) : []),
]

log(`Parallel review done. code-reviewer: ${crResult ? crResult.verdict : 'N/A'} | security: ${secResult ? secResult.verdict : 'N/A'} | deps: ${depResult ? depResult.verdict : 'N/A'}`)

// ── Stage 3: Synthesize ───────────────────────────────────────────────────
phase('Synthesize')
log('Synthesizing findings across all review agents...')

const findingsList = allFindings
  .map(f => `- [${f.severity}] [${f.source}] ${f.file || '?'}:${f.line || 0} — ${f.message}`)
  .join('\n') || 'No findings.'

const synthesis = await agent(
  `Synthesize the following findings from a parallel review of ${diffContext}. Deduplicate (same issue reported by multiple agents = 1 entry), prioritize by severity, and produce a merged report with an overall gate recommendation.\n\nFindings:\n${findingsList}`,
  { label: 'synthesizer', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA }
)

const overallGate = synthesis ? synthesis.overall_gate : (allFindings.some(f => f.severity === 'Critical') ? 'BLOCK' : 'PASS')
const blockingCount = synthesis ? synthesis.blocking_count : allFindings.filter(f => f.severity === 'Critical').length

log(`Synthesis: ${overallGate} — ${blockingCount} blocking findings | ${synthesis ? synthesis.recommendation : ''}`)

// ── Stage 4: Verify (optional) ────────────────────────────────────────────
if (runVerifier && spec) {
  phase('Verify')
  log('verifier: checking spec compliance...')

  const vfResult = await agent(
    `Spec: ${spec}\n\nVerify ${diffContext} meets every stated requirement. Gather real execution evidence. Return VERIFIED or SPEC_VIOLATION.`,
    { label: 'verifier', phase: 'Verify', schema: GATE_SCHEMA, agentType: 'verifier' }
  )

  log(`verifier: ${vfResult ? vfResult.verdict : 'N/A'} — ${vfResult ? vfResult.summary : ''}`)
}

return {
  outcome: overallGate === 'PASS' ? 'COMPLETE' : 'REVIEW_FINDINGS',
  pipeline: 'pr-review',
  scope,
  overall_gate: overallGate,
  blocking_findings: blockingCount,
  finding_breakdown: {
    code_review: crResult ? crResult.verdict : 'N/A',
    security:    secResult ? secResult.verdict : 'N/A',
    dependencies: depResult ? depResult.verdict : 'N/A',
  },
  recommendation: synthesis ? synthesis.recommendation : (overallGate === 'PASS' ? 'Safe to merge.' : `${blockingCount} blocking findings — fix before merging.`),
  merged_findings: synthesis ? synthesis.merged_findings : allFindings,
}
