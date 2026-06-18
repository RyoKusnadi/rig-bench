export const meta = {
  name: 'pr-review',
  description: 'PR quality review: single inspector pass covering secrets + security + dependencies + code quality, plus optional spec compliance',
  phases: [
    { title: 'Inspect', detail: 'inspector runs the full adversarial review in one pass' },
  ],
}

// args.pr        — optional: PR number (e.g. 42) — if omitted, reviews current HEAD diff
// args.effort    — optional: inspector effort mode (low|medium|high|maximum), default: medium
// args.spec      — optional: spec/requirements text — when provided, inspector also checks spec compliance

const pr = args && args.pr ? String(args.pr) : null
const effort = args && args.effort ? args.effort : 'medium'
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

// ── Stage 1: Inspect ──────────────────────────────────────────────────────
phase('Inspect')
log(`inspector (${effort}): running full adversarial review on ${scope}...`)

const specContext = spec ? `\n\nSpec / requirements to check for compliance:\n${spec}` : ''

const result = await agent(
  `Review ${scope} with effort=${effort}. Run secrets detection (SEC-4) first, then OWASP A01–A10, STRIDE (if applicable), full dependency/CVE audit across all manifests, and the two-pass code-quality review.${specContext}`,
  { label: 'inspector', phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
)

if (!result || result.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret or critical CVE found — pipeline blocked, zero retries.')
  return {
    outcome: 'BLOCKED',
    stage: 'inspector',
    reason: result ? result.summary : 'No response — treated as ESCALATE',
    findings: result ? result.findings : [],
  }
}

log(`inspector: ${result.verdict} — ${result.summary}`)

const blockingCount = (result.findings || []).filter(f => f.severity === 'Critical' || f.severity === 'High').length

return {
  outcome: result.pipeline_gate === 'PASS' ? 'COMPLETE' : 'REVIEW_FINDINGS',
  pipeline: 'pr-review',
  scope,
  overall_gate: result.pipeline_gate,
  blocking_findings: blockingCount,
  recommendation: result.pipeline_gate === 'PASS' ? 'Safe to merge.' : `${blockingCount} blocking findings — fix before merging.`,
  merged_findings: result.findings,
}
