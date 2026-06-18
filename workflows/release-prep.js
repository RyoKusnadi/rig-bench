export const meta = {
  name: 'release-prep',
  description: 'Release prep pipeline: inspector(audit) → operator(release PR with CHANGELOG)',
  phases: [
    { title: 'Audit', detail: 'inspector runs secrets + CVE audit on the release branch' },
    { title: 'Release', detail: 'operator validates commits, updates CHANGELOG, creates release PR' },
  ],
}

// args.version  — required: version string (e.g. "1.2.0")
// args.branch   — optional: release branch name (default: main/master)
// args.notes    — optional: release notes or highlights to include in CHANGELOG

const version = args && args.version ? String(args.version) : 'next'
const branch = args && args.branch ? args.branch : 'main'
const notes = args && args.notes ? `\n\nRelease notes / highlights:\n${args.notes}` : ''

// Per-stage token telemetry — budget.spent() is the only token signal a
// workflow script can read (no fs access here, so this can't write
// telemetry/token-usage.json; it rides along in the return value instead).
const tokenLog = []
async function trackedAgent(prompt, opts) {
  const before = budget.spent()
  const result = await agent(prompt, opts)
  tokenLog.push({ label: opts.label, tokens: budget.spent() - before })
  return result
}

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

// ── Stage 1: Audit ─────────────────────────────────────────────────────────
phase('Audit')
log(`inspector (maximum): running pre-release secrets + CVE audit for v${version}...`)

const audit = await trackedAgent(
  `Pre-release audit for v${version}. Run effort=maximum: full SEC-4 secret scan against the entire diff from the release branch, then a full dependency/CVE audit across every manifest (npm, Go, Python, Rust, .NET, Ruby, Maven). Any secret or Critical CVE is a release blocker.`,
  // This is the highest-stakes gate in the harness — the last check before
  // a release ships — so it's the one place worth paying for frontier
  // reasoning. Every other inspector call stays on the default model;
  // see workflows/README.md for why this isn't applied across the board.
  { label: 'inspector:audit', phase: 'Audit', schema: GATE_SCHEMA, agentType: 'inspector', model: 'claude-opus-4-8' }
)

if (!audit || audit.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found — release blocked. Rotate credential, clean history, then rerun.')
  return { outcome: 'BLOCKED', stage: 'inspector:audit', reason: audit ? audit.summary : 'No response — treated as ESCALATE', token_telemetry: tokenLog }
}

if (audit.verdict === 'CRITICAL_CVE' || audit.pipeline_gate === 'BLOCK') {
  log(`inspector: CRITICAL_CVE or BLOCK — release blocked. ${audit.summary}`)
  return {
    outcome: 'BLOCKED',
    stage: 'inspector:audit',
    reason: audit.summary,
    findings: audit.findings,
    action: 'Fix Critical CVEs listed above, then rerun release-prep.',
    token_telemetry: tokenLog,
  }
}

const hygiene = audit.verdict === 'HYGIENE_FLAGS' || audit.verdict === 'HIGH_CVE'
log(`inspector: ${audit.verdict}${hygiene ? ' — hygiene flags noted, not blocking' : ''}`)

// ── Stage 2: Release PR ───────────────────────────────────────────────────
phase('Release')
log(`operator: creating release PR for v${version}...`)

const ship = await trackedAgent(
  `Mode: SHIP\n\nCreate release PR for v${version} targeting ${branch}.\n\n1. Validate all commits since last tag follow Conventional Commits.\n2. Update CHANGELOG.md — rename [Unreleased] to [${version}] with today's date, add a fresh empty [Unreleased] above it.\n3. Push the branch and create a draft PR titled "Release v${version}".\n4. Include the dependency audit summary in the PR body, and save the release outcome to .claude/memory/.${notes}`,
  { label: 'operator:release', phase: 'Release', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!ship || ship.pipeline_gate === 'BLOCK') {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:release', reason: ship ? ship.summary : 'No response', token_telemetry: tokenLog }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

return {
  outcome: 'COMPLETE',
  pipeline: 'release-prep',
  version,
  dependency_verdict: audit.verdict,
  hygiene_flags: hygiene ? audit.findings : [],
  summary: ship.summary || `Release PR for v${version} created as draft.`,
  token_telemetry: tokenLog,
}
