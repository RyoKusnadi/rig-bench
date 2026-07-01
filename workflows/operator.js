// TODO: this workflow doesn't yet have a mechanism for the harness to pass in which
// project it's running against (the Workflow tool's scriptPath invocation, e.g. from
// execute.md's `{ "scriptPath": "workflows/operator.js" }`, doesn't currently carry
// parameters). Hardcoded to 'template' — the only project that exists today — until
// that's wired up. See .claude/commands/execute.md Step 0 for the project-resolution
// logic this should eventually delegate to.
const PROJECT = 'template'

export const meta = {
  name: 'operator',
  description: 'Execute-Verify-Merge pipeline: runs ready specs concurrently in git worktrees, verifies each against acceptance criteria, retries once on failure, opens draft PRs for passing specs',
  phases: [
    { title: 'Discover',  detail: `Read specs/${PROJECT}/ready/ and build dependency graph` },
    { title: 'PreFlight', detail: 'Refresh the structural index so agents navigate a current map' },
    { title: 'Execute',   detail: 'Run specs concurrently — each in its own git worktree' },
    { title: 'Verify',    detail: 'Check acceptance criteria per spec; retry failed specs once' },
    { title: 'Retry',     detail: 'Re-execute and re-verify failed specs (capped at 1 attempt)' },
    { title: 'Merge',     detail: 'Open draft PR per verified spec' },
    { title: 'Report',    detail: 'Summarise outcomes' },
  ],
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    ready_specs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:                   { type: 'string' },
          title:                { type: 'string' },
          filename:             { type: 'string' },
          depends_on:           { type: 'array', items: { type: 'string' } },
          complexity:           { type: ['string', 'null'] },
          files_to_modify_count: { type: ['number', 'null'] },
        },
        required: ['id', 'title', 'filename', 'depends_on', 'complexity', 'files_to_modify_count'],
      },
    },
    finished_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['ready_specs', 'finished_ids'],
}

const MEMORY_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    rules_content:        { type: 'string' },
    architecture_content: { type: 'string' },
  },
  required: ['rules_content', 'architecture_content'],
}

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    spec_id: { type: 'string' },
    status:  { type: 'string', enum: ['completed', 'failed'] },
    branch:  { type: 'string' },
    summary: { type: 'string' },
    errors:  { type: 'array', items: { type: 'string' } },
  },
  required: ['spec_id', 'status', 'branch', 'summary', 'errors'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    spec_id:             { type: 'string' },
    verdict:             { type: 'string', enum: ['PASS', 'FAIL'] },
    criteria_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          result:    { type: 'string', enum: ['PASS', 'FAIL'] },
          reason:    { type: 'string' },
        },
        required: ['criterion', 'result', 'reason'],
      },
    },
    verification_result: { type: 'string', enum: ['PASS', 'FAIL', 'SKIPPED'] },
    summary:             { type: 'string' },
    failures:            { type: 'array', items: { type: 'string' } },
  },
  required: ['spec_id', 'verdict', 'criteria_results', 'verification_result', 'summary', 'failures'],
}

const SHIP_SCHEMA = {
  type: 'object',
  properties: {
    spec_id: { type: 'string' },
    status:  { type: 'string', enum: ['shipped', 'failed'] },
    pr_url:  { type: 'string' },
    branch:  { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['spec_id', 'status', 'pr_url', 'branch', 'summary'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWaves(specs, preFinished) {
  const done = new Set(preFinished)
  const todo = [...specs]
  const waves = []

  while (todo.length > 0) {
    const ready = todo.filter(s => s.depends_on.every(d => done.has(d)))
    if (ready.length === 0) break

    waves.push(ready)
    ready.forEach(s => done.add(s.id))
    const readyIds = new Set(ready.map(s => s.id))
    todo.splice(0, todo.length, ...todo.filter(s => !readyIds.has(s.id)))
  }

  return { waves, stuck: todo }
}

function failVerify(spec_id, reason) {
  return {
    spec_id,
    verdict: 'FAIL',
    criteria_results: [],
    verification_result: 'SKIPPED',
    summary: reason,
    failures: [reason],
    branch: null,
  }
}

// Classifies a spec as 'simple' or 'complex' from its frontmatter fields
// (as returned by the Discover stage: `complexity` and
// `files_to_modify_count`).
//
// Rules (per spec 0014):
//   - complexity: "low"  -> simple
//   - complexity: "high" -> complex
//   - no complexity field, files_to_modify has < 3 entries -> simple
//   - no complexity field, files_to_modify has >= 3 entries -> complex
//   - neither field present -> complex (conservative default: load full context)
function classifySpec({ complexity, files_to_modify_count } = {}) {
  const normalisedComplexity = typeof complexity === 'string' ? complexity.toLowerCase() : null
  const count = typeof files_to_modify_count === 'number' ? files_to_modify_count : null

  if (normalisedComplexity === 'low') return 'simple'
  if (normalisedComplexity === 'high') return 'complex'

  if (normalisedComplexity === null && count !== null) {
    return count >= 3 ? 'complex' : 'simple'
  }

  // Neither field present (or unrecognised complexity value) -> conservative default
  return 'complex'
}

// ── Discover ──────────────────────────────────────────────────────────────────

phase('Discover')

const discovery = await agent(
  `List every spec file in specs/${PROJECT}/ready/ and collect finished spec IDs.

Run:
  ls specs/${PROJECT}/ready/ 2>/dev/null | grep '\\.md$'
  ls specs/${PROJECT}/finished/ 2>/dev/null | grep '\\.md$' | sed 's/-.*//'

For each file in specs/${PROJECT}/ready/, read its YAML frontmatter and extract:
  id                     — zero-padded string, e.g. "0001"
  title                  — short imperative title
  filename               — just the file name, e.g. "0001-my-feature.md"
  depends_on             — array of spec ID strings; empty array if none
  complexity             — the frontmatter "complexity" field value ("low", "medium", or "high"), or null if absent
  files_to_modify_count  — the number of entries in the frontmatter "files_to_modify" array field (count lines starting with "-" under that key), or null if the field is absent

For specs/${PROJECT}/finished/, collect only the IDs (the prefix before the first "-").

Return all data as structured output.`,
  { phase: 'Discover', label: 'discover:specs', schema: DISCOVERY_SCHEMA },
)

if (!discovery || discovery.ready_specs.length === 0) {
  log(`No ready specs found — add specs to specs/${PROJECT}/ready/ first.`)
  return { status: 'no_specs', results: [], waves: [], stuck: [] }
}

log(`Discovered ${discovery.ready_specs.length} ready spec(s), ${discovery.finished_ids.length} already finished`)

// ── Build dependency waves ────────────────────────────────────────────────────

const { waves, stuck } = buildWaves(discovery.ready_specs, discovery.finished_ids)

if (stuck.length > 0) {
  log(`WARNING: ${stuck.length} spec(s) skipped — unresolvable dependencies: [${stuck.map(s => s.id).join(', ')}]`)
}

if (waves.length === 0) {
  log('No specs can run — all have unresolvable dependencies.')
  return { status: 'blocked', results: [], waves: [], stuck: stuck.map(s => s.id) }
}

// ── Pre-flight: refresh structural index ─────────────────────────────────────

phase('PreFlight')
log('Refreshing structural index...')

let preflightResult
try {
  preflightResult = await agent(
    'Run the structural index script: bash scripts/build-structure-index.sh\nReport success or the error output.',
    { label: 'preflight:structure-index', phase: 'PreFlight' },
  )
} catch (err) {
  preflightResult = `error: ${err?.message || err}`
}

log('Pre-flight complete: ' + (preflightResult || 'done'))

// ── Execute waves ─────────────────────────────────────────────────────────────

phase('Execute')

const allResults = []

for (let i = 0; i < waves.length; i++) {
  const wave = waves[i]
  log(`Wave ${i + 1}/${waves.length}: ${wave.length} spec(s) — [${wave.map(s => s.id).join(', ')}]`)

  const waveResults = await pipeline(
    wave,

    // ── Stage 1: Execute ──────────────────────────────────────────────────────
    async spec => {
      const complexity = classifySpec(spec)
      log(`Spec ${spec.id}: complexity=${complexity}`)

      let memoryContextBlock = ''

      if (complexity === 'complex') {
        const memoryContext = await agent(
          `Read the contents of memory/RULES.md and memory/ARCHITECTURE.md if they exist in the repo root.

For each file:
  - If it doesn't exist, or exists but is empty (no non-whitespace content), return an empty string for it.
  - Otherwise return its full raw text content.

Return structured output with rules_content and architecture_content.`,
          {
            label:     `memory-context:${spec.id}`,
            phase:     'Execute',
            isolation: 'worktree',
            schema:    MEMORY_CONTEXT_SCHEMA,
          },
        )

        const rulesContent = memoryContext?.rules_content?.trim() || ''
        const architectureContent = memoryContext?.architecture_content?.trim() || ''

        if (rulesContent || architectureContent) {
          const sections = []
          if (rulesContent) sections.push(`### memory/RULES.md\n\n${rulesContent}`)
          if (architectureContent) sections.push(`### memory/ARCHITECTURE.md\n\n${architectureContent}`)
          memoryContextBlock = `\n\n## Memory Context\n\n${sections.join('\n\n')}`
        }
      }

      let execResult = await agent(
        `Implement spec ${spec.id}: "${spec.title}".

The spec file is: specs/${PROJECT}/ready/${spec.filename}

Follow your agent instructions:
1. Create feature branch: ${spec.id}-<kebab-slug-of-title>
2. Move spec: git mv specs/${PROJECT}/ready/${spec.filename} specs/${PROJECT}/in_progress/${spec.filename}
3. Commit the move
4. Read specs/${PROJECT}/in_progress/${spec.filename} in full
5. Implement all acceptance criteria
6. Commit the implementation (stage explicitly — never git add -A)
7. Move spec to specs/${PROJECT}/waiting_verification/ and update status frontmatter
8. Commit the lifecycle move
9. Return structured result${memoryContextBlock}`,
        {
          label:     `exec:${spec.id}`,
          phase:     'Execute',
          isolation: 'worktree',
          agentType: 'operator',
          schema:    EXEC_SCHEMA,
        },
      )

      // ── Checkpoint detection + resume ───────────────────────────────────────
      // If the operator agent ran low on context, it writes PROGRESS.md and
      // returns status: 'completed' even though the spec isn't actually
      // finished. Detect that on the returned branch and spawn a fresh
      // operator agent to continue, capped at 3 resume attempts.
      if (execResult && execResult.status === 'completed') {
        let resumeCount = 0
        while (resumeCount < 3) {
          const progressCheck = await agent(
            `On branch ${execResult.branch}, does PROGRESS.md exist in the worktree root? Run: git show ${execResult.branch}:PROGRESS.md 2>/dev/null && echo EXISTS || echo ABSENT`,
            { label: `checkpoint-check:${spec.id}`, phase: 'Execute' },
          )
          if (!progressCheck || !progressCheck.includes('EXISTS')) break

          log(`Spec ${spec.id}: checkpoint detected — resuming (attempt ${resumeCount + 1}/3)`)

          const progress = await agent(
            `Read PROGRESS.md from branch ${execResult.branch}`,
            { label: `read-checkpoint:${spec.id}`, phase: 'Execute' },
          )

          execResult = await agent(
            `You are resuming a task from a checkpoint. Here is the progress so far:\n${progress}\n\nContinue from the ## Next section. Branch: ${execResult.branch}`,
            {
              label:     `resume:${spec.id}`,
              phase:     'Execute',
              isolation: 'worktree',
              agentType: 'operator',
              schema:    EXEC_SCHEMA,
            },
          )

          resumeCount++
        }

        if (resumeCount >= 3) {
          execResult = { ...execResult, status: 'failed', errors: [...(execResult.errors || []), 'checkpoint_resume_limit'] }
        }
      }

      return execResult
    },

    // ── Stage 2: Verify (+ one retry) ────────────────────────────────────────
    async (execResult, spec) => {
      if (!execResult || execResult.status === 'failed') {
        return failVerify(spec.id, 'execute_failed')
      }

      const verifyOnce = async (branch, label) => agent(
        `Verify spec ${spec.id}: "${spec.title}".

Branch: ${branch}
Spec file on that branch: specs/${PROJECT}/waiting_verification/${spec.filename}

Follow your agent instructions:
1. git checkout ${branch}
2. Read specs/${PROJECT}/waiting_verification/${spec.filename}
3. Check each acceptance criterion against the implementation
4. Run the Verification step from the spec
5. Return PASS or FAIL with per-criterion detail`,
        {
          label,
          phase:     'Verify',
          isolation: 'worktree',
          agentType: 'inspector',
          schema:    VERIFY_SCHEMA,
        },
      )

      let result = await verifyOnce(execResult.branch, `verify:${spec.id}`)

      // Check for drift warning
      const verifyOutput = result?.summary || ''
      const driftMatch = verifyOutput.match(/MEMORY_DRIFT_WARNING:\s*(.+)/)
      if (driftMatch) {
        const warning = driftMatch[1].trim()
        log(`DRIFT DETECTED in spec ${spec.id} — spawning maintenance agent`)
        // Append to PENDING_UPDATES.md via agent
        await agent(
          `Append this drift warning to memory/PENDING_UPDATES.md:
## [<current timestamp>] Spec ${spec.id}: ${warning}

Then read memory/ARCHITECTURE.md and memory/RULES.md, analyze the warning, rewrite the outdated section to reflect the new architecture described in the warning. Finally, remove the entry you just added from memory/PENDING_UPDATES.md.`,
          { label: 'maintenance:drift', phase: 'Verify', model: 'claude-haiku-4-5-20251001' }
        )
      }

      if (result && result.verdict === 'PASS') {
        return { ...result, branch: execResult.branch }
      }

      // First verify failed — retry the full execute once
      log(`Spec ${spec.id}: verification failed — retrying execution`)

      const retryExec = await agent(
        `Re-implement spec ${spec.id}: "${spec.title}" (retry after failed verification).

The spec is in specs/${PROJECT}/waiting_verification/${spec.filename} on the previous branch.
Start fresh: read the spec from specs/${PROJECT}/ready/ if it was moved back, or from specs/${PROJECT}/waiting_verification/.

Follow your agent instructions. Use branch name: ${spec.id}-retry`,
        {
          label:     `retry:${spec.id}`,
          phase:     'Retry',
          isolation: 'worktree',
          agentType: 'operator',
          schema:    EXEC_SCHEMA,
        },
      )

      if (!retryExec || retryExec.status === 'failed') {
        return failVerify(spec.id, 'retry_execute_failed')
      }

      result = await verifyOnce(retryExec.branch, `reverify:${spec.id}`)

      return result
        ? { ...result, branch: retryExec.branch, retried: true }
        : failVerify(spec.id, 'reverify_returned_null')
    },

    // ── Stage 3: Ship (draft PR) ──────────────────────────────────────────────
    async (verifyResult, spec) => {
      if (!verifyResult || verifyResult.verdict !== 'PASS') {
        return {
          spec_id: spec.id,
          status:  'blocked',
          pr_url:  '',
          branch:  verifyResult?.branch || '',
          summary: verifyResult?.summary || 'verification failed',
        }
      }

      return agent(
        `Open a draft PR for spec ${spec.id}: "${spec.title}".

Branch: ${verifyResult.branch}
Spec file on that branch: specs/${PROJECT}/waiting_verification/${spec.filename}

Follow your agent instructions:
1. git checkout ${verifyResult.branch}
2. Read specs/${PROJECT}/waiting_verification/${spec.filename}
3. git push origin ${verifyResult.branch}
4. gh pr create --draft with the spec title and acceptance criteria in the body
5. Return the PR URL`,
        {
          label:     `ship:${spec.id}`,
          phase:     'Merge',
          isolation: 'worktree',
          agentType: 'shipper',
          schema:    SHIP_SCHEMA,
        },
      )
    },
  )

  allResults.push(...waveResults.filter(Boolean))

  const waveShipped  = waveResults.filter(r => r && r.status === 'shipped').length
  const waveBlocked  = waveResults.filter(r => r && r.status === 'blocked').length
  const waveFailed   = waveResults.filter(r => r && r.status === 'failed').length
  log(`Wave ${i + 1} done — ${waveShipped} shipped, ${waveBlocked} blocked, ${waveFailed} failed`)
}

// ── Report ─────────────────────────────────────────────────────────────────────

phase('Report')

const shipped = allResults.filter(r => r.status === 'shipped')
const blocked = allResults.filter(r => r.status === 'blocked')
const failed  = allResults.filter(r => r.status === 'failed')

log(`Final: ${shipped.length} shipped (draft PRs open), ${blocked.length} blocked (verify failed), ${failed.length} failed`)

return {
  status:  blocked.length === 0 && failed.length === 0 && stuck.length === 0 ? 'success' : 'partial',
  shipped: shipped.map(r => ({ spec_id: r.spec_id, pr_url: r.pr_url, branch: r.branch })),
  blocked: blocked.map(r => ({ spec_id: r.spec_id, summary: r.summary })),
  failed:  failed.map(r => ({ spec_id: r.spec_id, summary: r.summary })),
  stuck:   stuck.map(s => s.id),
  waves:   waves.map(w => w.map(s => s.id)),
}
