export const meta = {
  name: 'operator',
  description: 'Execute-Verify-Merge pipeline: runs ready specs concurrently in git worktrees, verifies each against acceptance criteria, retries once on failure, opens draft PRs for passing specs',
  phases: [
    { title: 'Discover', detail: 'Read specs/ready/ and build dependency graph' },
    { title: 'Execute',  detail: 'Run specs concurrently — each in its own git worktree' },
    { title: 'Verify',   detail: 'Check acceptance criteria per spec; retry failed specs once' },
    { title: 'Retry',    detail: 'Re-execute and re-verify failed specs (capped at 1 attempt)' },
    { title: 'Merge',    detail: 'Open draft PR per verified spec' },
    { title: 'Report',   detail: 'Summarise outcomes' },
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
          id:         { type: 'string' },
          title:      { type: 'string' },
          filename:   { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'filename', 'depends_on'],
      },
    },
    finished_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['ready_specs', 'finished_ids'],
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

// ── Discover ──────────────────────────────────────────────────────────────────

phase('Discover')

const discovery = await agent(
  `List every spec file in specs/ready/ and collect finished spec IDs.

Run:
  ls specs/ready/ 2>/dev/null | grep '\\.md$'
  ls specs/finished/ 2>/dev/null | grep '\\.md$' | sed 's/-.*//'

For each file in specs/ready/, read its YAML frontmatter and extract:
  id         — zero-padded string, e.g. "0001"
  title      — short imperative title
  filename   — just the file name, e.g. "0001-my-feature.md"
  depends_on — array of spec ID strings; empty array if none

For specs/finished/, collect only the IDs (the prefix before the first "-").

Return all data as structured output.`,
  { phase: 'Discover', label: 'discover:specs', schema: DISCOVERY_SCHEMA },
)

if (!discovery || discovery.ready_specs.length === 0) {
  log('No ready specs found — add specs to specs/ready/ first.')
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

// ── Execute waves ─────────────────────────────────────────────────────────────

phase('Execute')

const allResults = []

for (let i = 0; i < waves.length; i++) {
  const wave = waves[i]
  log(`Wave ${i + 1}/${waves.length}: ${wave.length} spec(s) — [${wave.map(s => s.id).join(', ')}]`)

  const waveResults = await pipeline(
    wave,

    // ── Stage 1: Execute ──────────────────────────────────────────────────────
    spec => agent(
      `Implement spec ${spec.id}: "${spec.title}".

The spec file is: specs/ready/${spec.filename}

Follow your agent instructions:
1. Create feature branch: ${spec.id}-<kebab-slug-of-title>
2. Move spec: git mv specs/ready/${spec.filename} specs/in_progress/${spec.filename}
3. Commit the move
4. Read specs/in_progress/${spec.filename} in full
5. Implement all acceptance criteria
6. Commit the implementation (stage explicitly — never git add -A)
7. Move spec to waiting_verification/ and update status frontmatter
8. Commit the lifecycle move
9. Return structured result`,
      {
        label:     `exec:${spec.id}`,
        phase:     'Execute',
        isolation: 'worktree',
        agentType: 'operator',
        schema:    EXEC_SCHEMA,
      },
    ),

    // ── Stage 2: Verify (+ one retry) ────────────────────────────────────────
    async (execResult, spec) => {
      if (!execResult || execResult.status === 'failed') {
        return failVerify(spec.id, 'execute_failed')
      }

      const verifyOnce = async (branch, label) => agent(
        `Verify spec ${spec.id}: "${spec.title}".

Branch: ${branch}
Spec file on that branch: specs/waiting_verification/${spec.filename}

Follow your agent instructions:
1. git checkout ${branch}
2. Read specs/waiting_verification/${spec.filename}
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

      if (result && result.verdict === 'PASS') {
        return { ...result, branch: execResult.branch }
      }

      // First verify failed — retry the full execute once
      log(`Spec ${spec.id}: verification failed — retrying execution`)

      const retryExec = await agent(
        `Re-implement spec ${spec.id}: "${spec.title}" (retry after failed verification).

The spec is in specs/waiting_verification/${spec.filename} on the previous branch.
Start fresh: read the spec from specs/ready/ if it was moved back, or from waiting_verification/.

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
Spec file on that branch: specs/waiting_verification/${spec.filename}

Follow your agent instructions:
1. git checkout ${verifyResult.branch}
2. Read specs/waiting_verification/${spec.filename}
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
