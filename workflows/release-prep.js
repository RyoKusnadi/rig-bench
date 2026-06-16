export const meta = {
  name: 'release-prep',
  description: 'Release prep pipeline: memory-load → secret-scanner → dependency-auditor → git-assistant (release mode) → memory-save',
  phases: [
    { title: 'Memory', detail: 'load prior release context and known CVE history' },
    { title: 'Pre-flight', detail: 'secret-scanner credential check on full branch' },
    { title: 'Dependencies', detail: 'dependency-auditor CVE and hygiene scan' },
    { title: 'Release', detail: 'git-assistant creates release PR with CHANGELOG' },
    { title: 'Memory', detail: 'save release outcome and CVE findings' },
  ],
}

// args.version  — required: version string (e.g. "1.2.0")
// args.branch   — optional: release branch name (default: main/master)
// args.notes    — optional: release notes or highlights to include in CHANGELOG

const version = args && args.version ? String(args.version) : 'next'
const branch = args && args.branch ? args.branch : 'main'
const notes = args && args.notes ? `\n\nRelease notes / highlights:\n${args.notes}` : ''

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

// ── Stage 0: Memory load ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: loading prior release context...')

const memBrief = await agent(
  `LOAD task="release prep v${version}". Read .claude/memory/ and return a context brief of prior release blockers, known CVE history, dependency audit outcomes, and any release gotchas.`,
  { label: 'memory-manager:load', phase: 'Memory', agentType: 'memory-manager' }
)
log('memory loaded.')

// ── Stage 1: Secret scan ───────────────────────────────────────────────────
phase('Pre-flight')
log('secret-scanner: full branch credential check before release...')

const scan = await agent(
  `Pre-release SEC-4 scan for v${version}. Run all 8 patterns against the full diff from the release branch. Any match blocks the release.`,
  { label: 'secret-scanner', phase: 'Pre-flight', schema: GATE_SCHEMA, agentType: 'secret-scanner' }
)

if (!scan || scan.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found — release blocked. Rotate credential, clean history, then rerun.')
  return {
    outcome: 'BLOCKED',
    stage: 'secret-scanner',
    reason: scan ? scan.summary : 'No response — treated as ESCALATE',
  }
}
log(`secret-scanner: ${scan.verdict} — branch is clean`)

// ── Stage 2: Dependency audit ──────────────────────────────────────────────
phase('Dependencies')
log('dependency-auditor: scanning all manifests for release blockers...')

const deps = await agent(
  `Pre-release dependency audit for v${version}. Scan all manifests (npm, Go, Python, Rust, .NET, Ruby, Maven) for CVEs, unpinned versions, abandoned packages, and license conflicts. Every Critical CVE is a release blocker.`,
  { label: 'dependency-auditor', phase: 'Dependencies', schema: GATE_SCHEMA, agentType: 'dependency-auditor' }
)

if (!deps || deps.verdict === 'CRITICAL_CVE' || deps.pipeline_gate === 'BLOCK') {
  log(`dependency-auditor: CRITICAL_CVE or BLOCK — release blocked. ${deps ? deps.summary : 'No response.'}`)
  return {
    outcome: 'BLOCKED',
    stage: 'dependency-auditor',
    reason: deps ? deps.summary : 'No response',
    findings: deps ? deps.findings : [],
    action: 'Fix Critical CVEs listed above, then rerun release-prep.',
  }
}

const hygiene = deps && deps.verdict === 'HYGIENE_FLAGS'
log(`dependency-auditor: ${deps ? deps.verdict : 'CLEAN'}${hygiene ? ' — hygiene flags noted, not blocking' : ''}`)

// ── Stage 3: Release PR ───────────────────────────────────────────────────
phase('Release')
log(`git-assistant: creating release PR for v${version}...`)

const pr = await agent(
  `Create release PR for v${version} targeting ${branch}.\n\n1. Validate all commits since last tag follow conventional commits.\n2. Update CHANGELOG.md — move [Unreleased] entries under [${version}].\n3. Push the branch and create a draft PR titled "Release v${version}".\n4. Include dependency audit summary in the PR body.${notes}`,
  { label: 'git-assistant', phase: 'Release', schema: GATE_SCHEMA, agentType: 'git-assistant' }
)

if (!pr || pr.pipeline_gate === 'BLOCK') {
  log(`git-assistant: PREFLIGHT_FAIL — ${pr ? pr.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'git-assistant', reason: pr ? pr.summary : 'No response' }
}

log(`git-assistant: ${pr ? pr.verdict : 'PR_CREATED'} — ${pr ? pr.summary : ''}`)

// ── Stage 4: Memory save ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: saving release prep outcome...')
await agent(
  `SAVE pipeline=release-prep outcome=COMPLETE task="release v${version}" summary="${pr ? pr.summary : `Release PR for v${version} created`}". Record dependency audit verdict (${deps ? deps.verdict : 'CLEAN'}), any hygiene flags, and the release PR reference.`,
  { label: 'memory-manager:save', phase: 'Memory', agentType: 'memory-manager' }
)

return {
  outcome: 'COMPLETE',
  pipeline: 'release-prep',
  version,
  dependency_verdict: deps ? deps.verdict : 'CLEAN',
  hygiene_flags: hygiene ? (deps ? deps.findings : []) : [],
  summary: pr ? pr.summary : `Release PR for v${version} created as draft.`,
}
