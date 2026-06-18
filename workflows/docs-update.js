export const meta = {
  name: 'docs-update',
  description: 'Docs update pipeline: operator(docs) → inspector(light review) → operator(ship)',
  phases: [
    { title: 'Write', detail: 'operator updates README, CLAUDE.md, docstrings, CHANGELOG' },
    { title: 'Inspect', detail: 'inspector runs a light review (examples verified, no secrets)' },
    { title: 'Ship', detail: 'operator pushes the branch and opens the draft PR' },
  ],
}

// args.trigger — required: what changed that needs docs updating
// args.scope   — optional: specific files or sections to update

const trigger = args && args.trigger ? args.trigger : 'recent code changes'
const scope = args && args.scope ? `\nScope: ${args.scope}` : ''

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

// ── Stage 1: Write docs ───────────────────────────────────────────────────
phase('Write')
log('operator: reading changes and updating documentation...')

const docs = await agent(
  `Mode: DOCS\n\nTrigger: ${trigger}${scope}\n\nRead what changed (git diff HEAD), then update all affected documentation: README sections, CLAUDE.md, inline docstrings, and CHANGELOG.md if user-facing. Verify every code example actually runs, then commit locally.`,
  { label: 'operator:docs', phase: 'Write', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!docs || docs.verdict === 'EXAMPLE_FAIL' || docs.pipeline_gate === 'BLOCK') {
  log(`operator: EXAMPLE_FAIL or BLOCK — ${docs ? docs.summary : 'no response'}. Fix broken examples before continuing.`)
  return { outcome: 'BLOCKED', stage: 'operator:docs', reason: docs ? docs.summary : 'No response', findings: docs ? docs.findings : [] }
}
log(`operator: ${docs.verdict} — ${docs.summary}`)

// ── Stage 2: Light inspect ────────────────────────────────────────────────
phase('Inspect')
log('inspector: light review of doc changes...')

const inspectResult = await agent(
  `Trigger: ${trigger}\n\nRun a light review (effort=low) of the documentation diff: secrets check, no accidental code changes mixed in, terminology matches the actual source.`,
  { label: 'inspector', phase: 'Inspect', schema: GATE_SCHEMA, agentType: 'inspector' }
)

if (inspectResult && inspectResult.pipeline_gate === 'ESCALATE') {
  log('ESCALATION: secret found in doc diff — pipeline blocked, zero retries.')
  return { outcome: 'BLOCKED', stage: 'inspector', reason: inspectResult.summary, findings: inspectResult.findings }
}
if (inspectResult && inspectResult.pipeline_gate === 'BLOCK') {
  log(`inspector: findings — ${inspectResult.summary}`)
  return { outcome: 'BLOCKED', stage: 'inspector', reason: inspectResult.summary, findings: inspectResult.findings }
}
log(`inspector: ${inspectResult ? inspectResult.verdict : 'CLEAN'}`)

// ── Stage 3: Ship ───────────────────────────────────────────────────────────
phase('Ship')
log('operator: pushing branch and creating draft PR...')

const ship = await agent(
  `Mode: SHIP\n\nDocs updated for: ${trigger}\n\nRun pre-flight checks, push the branch, and create a draft PR listing which files were updated and why.`,
  { label: 'operator:ship', phase: 'Ship', schema: GATE_SCHEMA, agentType: 'operator' }
)

if (!ship || ship.pipeline_gate === 'BLOCK') {
  log(`operator: PREFLIGHT_FAIL — ${ship ? ship.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'operator:ship', reason: ship ? ship.summary : 'No response' }
}
log(`operator: ${ship.verdict} — ${ship.summary}`)

return {
  outcome: 'COMPLETE',
  pipeline: 'docs-update',
  trigger,
  files_updated: docs && docs.findings ? docs.findings.map(f => f.file).filter(Boolean) : [],
  summary: ship.summary || 'Draft PR created. Docs updated.',
}
