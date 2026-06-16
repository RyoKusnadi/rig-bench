export const meta = {
  name: 'docs-update',
  description: 'Docs update pipeline: memory-load → docs-writer → git-assistant → memory-save',
  phases: [
    { title: 'Memory', detail: 'load context for docs change' },
    { title: 'Write', detail: 'docs-writer updates README, CLAUDE.md, docstrings' },
    { title: 'PR', detail: 'git-assistant creates draft PR' },
    { title: 'Memory', detail: 'save docs update outcome' },
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

// ── Stage 0: Memory load ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: loading context for docs update...')

const memBrief = await agent(
  `LOAD task="docs update: ${trigger}". Read .claude/memory/ and return a context brief of relevant architecture facts, prior docs-writer runs, and any known doc patterns for this project.`,
  { label: 'memory-manager:load', phase: 'Memory', agentType: 'memory-manager' }
)
log('memory loaded.')

// ── Stage 1: Write docs ───────────────────────────────────────────────────
phase('Write')
log('docs-writer: reading changes and updating documentation...')

const docs = await agent(
  `Trigger: ${trigger}${scope}\n\n${memBrief ? `Prior project memory:\n${memBrief}\n\n` : ''}Read what changed (git diff HEAD), then update all affected documentation: README sections, CLAUDE.md, inline docstrings. Verify every code example actually runs. Do NOT touch CHANGELOG.md.`,
  { label: 'docs-writer', phase: 'Write', schema: GATE_SCHEMA, agentType: 'docs-writer' }
)

if (!docs || docs.verdict === 'EXAMPLE_FAIL' || docs.pipeline_gate === 'BLOCK') {
  log(`docs-writer: EXAMPLE_FAIL or BLOCK — ${docs ? docs.summary : 'no response'}. Fix broken examples before continuing.`)
  return {
    outcome: 'BLOCKED',
    stage: 'docs-writer',
    reason: docs ? docs.summary : 'No response',
    findings: docs ? docs.findings : [],
  }
}
log(`docs-writer: ${docs.verdict} — ${docs.summary}`)

// ── Stage 2: PR ───────────────────────────────────────────────────────────
phase('PR')
log('git-assistant: creating draft PR...')

const pr = await agent(
  `Docs updated for: ${trigger}\n\nRun pre-flight checks, validate commits follow conventional commits (docs: ...), push the branch, and create a draft PR listing which files were updated and why.`,
  { label: 'git-assistant', phase: 'PR', schema: GATE_SCHEMA, agentType: 'git-assistant' }
)

if (!pr || pr.pipeline_gate === 'BLOCK') {
  log(`git-assistant: PREFLIGHT_FAIL — ${pr ? pr.summary : 'no response'}`)
  return { outcome: 'BLOCKED', stage: 'git-assistant', reason: pr ? pr.summary : 'No response' }
}

log(`git-assistant: ${pr ? pr.verdict : 'PR_CREATED'} — ${pr ? pr.summary : ''}`)

// ── Stage 3: Memory save ──────────────────────────────────────────────────
phase('Memory')
log('memory-manager: saving docs update outcome...')
await agent(
  `SAVE pipeline=docs-update outcome=COMPLETE task="docs update: ${trigger}" summary="${pr ? pr.summary : 'Docs updated, PR created'}". Record which files were updated and what triggered the change.`,
  { label: 'memory-manager:save', phase: 'Memory', agentType: 'memory-manager' }
)

return {
  outcome: 'COMPLETE',
  pipeline: 'docs-update',
  trigger,
  files_updated: docs ? docs.findings.map(f => f.file).filter(Boolean) : [],
  summary: pr ? pr.summary : 'Draft PR created. Docs updated.',
}
