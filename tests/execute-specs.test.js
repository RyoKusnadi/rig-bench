// Tests for lib/spec-graph.mjs (parseSpecFrontmatter, topoLevels, validateDeps)
// and the consistency guard that execute-specs.js's inline constants haven't
// drifted from their canonical sources (mirrors tests/lib-workflow-sync.test.js).
//
// Run with: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { safeAgent } from '../lib/agent-wrapper.mjs'
import { parseSpecFrontmatter, topoLevels, validateDeps } from '../lib/spec-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ── parseSpecFrontmatter ─────────────────────────────────────────────────────

test('parseSpecFrontmatter: parses minimal frontmatter', () => {
  const md = `---
id: 0001
title: Add rate limit middleware
status: ready
depends_on: []
source: todo.md#rate-limiting
---

## Problem
...`
  const fm = parseSpecFrontmatter(md)
  assert.equal(fm.id, '0001')
  assert.equal(fm.title, 'Add rate limit middleware')
  assert.equal(fm.status, 'ready')
  assert.deepEqual(fm.depends_on, [])
  assert.equal(fm.source, 'todo.md#rate-limiting')
})

test('parseSpecFrontmatter: parses inline depends_on with IDs', () => {
  const md = `---
id: 0003
title: Ship integration
status: ready
depends_on: [0001, 0002]
source: todo.md#ship
---
`
  const fm = parseSpecFrontmatter(md)
  assert.deepEqual(fm.depends_on, ['0001', '0002'])
})

test('parseSpecFrontmatter: parses inline depends_on with quoted IDs', () => {
  const md = `---
id: 0004
title: Another spec
status: draft
depends_on: ['0001', '0002']
source: todo.md#foo
---
`
  const fm = parseSpecFrontmatter(md)
  assert.deepEqual(fm.depends_on, ['0001', '0002'])
})

test('parseSpecFrontmatter: handles missing depends_on field', () => {
  const md = `---
id: 0005
title: Solo spec
status: ready
source: todo.md#solo
---
`
  const fm = parseSpecFrontmatter(md)
  assert.deepEqual(fm.depends_on, [])
})

test('parseSpecFrontmatter: returns null when no frontmatter delimiter', () => {
  const fm = parseSpecFrontmatter('# Just a heading\n\nNo frontmatter here.')
  assert.equal(fm, null)
})

test('parseSpecFrontmatter: parses block-style depends_on list', () => {
  const md = `---
id: 0006
title: Block deps spec
status: ready
depends_on:
  - 0001
  - 0002
source: todo.md#block
---
`
  const fm = parseSpecFrontmatter(md)
  assert.deepEqual(fm.depends_on, ['0001', '0002'])
})

// ── topoLevels ───────────────────────────────────────────────────────────────

function spec(id, deps) { return { id, depends_on: deps || [] } }

test('topoLevels: single spec with no deps goes to level 0', () => {
  const { levels, blocked } = topoLevels([spec('0001')])
  assert.equal(levels.length, 1)
  assert.equal(levels[0].length, 1)
  assert.equal(levels[0][0].id, '0001')
  assert.equal(blocked.length, 0)
})

test('topoLevels: linear chain produces one spec per level', () => {
  const { levels, blocked } = topoLevels([
    spec('0001'),
    spec('0002', ['0001']),
    spec('0003', ['0002']),
  ])
  assert.equal(levels.length, 3)
  assert.equal(levels[0][0].id, '0001')
  assert.equal(levels[1][0].id, '0002')
  assert.equal(levels[2][0].id, '0003')
  assert.equal(blocked.length, 0)
})

test('topoLevels: two independent specs land in the same level', () => {
  const { levels, blocked } = topoLevels([spec('0001'), spec('0002')])
  assert.equal(levels.length, 1)
  assert.equal(levels[0].length, 2)
  assert.equal(blocked.length, 0)
})

test('topoLevels: branching DAG — two parallel then one convergent', () => {
  const { levels, blocked } = topoLevels([
    spec('0001'),
    spec('0002'),
    spec('0003', ['0001', '0002']),
  ])
  assert.equal(levels.length, 2)
  assert.equal(levels[0].length, 2)
  assert.equal(levels[1].length, 1)
  assert.equal(levels[1][0].id, '0003')
  assert.equal(blocked.length, 0)
})

test('topoLevels: circular dependency surfaces as blocked', () => {
  const { levels, blocked } = topoLevels([
    spec('0001', ['0002']),
    spec('0002', ['0001']),
  ])
  assert.equal(levels.length, 0)
  assert.equal(blocked.length, 2)
})

test('topoLevels: dep satisfied by preResolvedIds', () => {
  const { levels, blocked } = topoLevels(
    [spec('0002', ['0001'])],
    new Set(['0001'])
  )
  assert.equal(levels.length, 1)
  assert.equal(levels[0][0].id, '0002')
  assert.equal(blocked.length, 0)
})

test('topoLevels: unresolvable dep (not in list, not pre-resolved) is blocked', () => {
  const { levels, blocked } = topoLevels([spec('0002', ['0001'])])
  assert.equal(levels.length, 0)
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].id, '0002')
})

// ── validateDeps ──────────────────────────────────────────────────────────────

test('validateDeps: all deps satisfied within the selection', () => {
  const selected = [spec('0001'), spec('0002', ['0001'])]
  const { ok, missing } = validateDeps(selected, [])
  assert.equal(ok, true)
  assert.equal(missing.length, 0)
})

test('validateDeps: dep satisfied by doneIds', () => {
  const selected = [spec('0002', ['0001'])]
  const { ok, missing } = validateDeps(selected, ['0001'])
  assert.equal(ok, true)
  assert.equal(missing.length, 0)
})

test('validateDeps: missing dep is reported', () => {
  const selected = [spec('0002', ['0001'])]
  const { ok, missing } = validateDeps(selected, [])
  assert.equal(ok, false)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].specId, '0002')
  assert.equal(missing[0].depId, '0001')
})

test('validateDeps: multiple missing deps are all reported', () => {
  const selected = [spec('0003', ['0001', '0002'])]
  const { ok, missing } = validateDeps(selected, [])
  assert.equal(ok, false)
  assert.equal(missing.length, 2)
})

test('validateDeps: spec with no deps always passes', () => {
  const { ok, missing } = validateDeps([spec('0001')], [])
  assert.equal(ok, true)
  assert.equal(missing.length, 0)
})

// ── execute-specs.js inline constant sync (mirrors lib-workflow-sync.test.js) ─

test('execute-specs.js AGENT_MAX_RETRIES matches lib/agent-wrapper.mjs safeAgent default', async () => {
  let calls = 0
  await safeAgent(async () => { calls += 1; return null }, 'probe', { schema: {}, label: 'probe' })
  const libMaxRetries = calls - 1

  const source = readFileSync(join(REPO_ROOT, 'workflows', 'execute-specs.js'), 'utf8')
  const match = source.match(/const AGENT_MAX_RETRIES\s*=\s*(\d+)/)
  assert.ok(match, 'execute-specs.js must define AGENT_MAX_RETRIES')
  assert.equal(Number(match[1]), libMaxRetries,
    `execute-specs.js AGENT_MAX_RETRIES (${match[1]}) has drifted from lib/agent-wrapper.mjs default (${libMaxRetries})`)
})

test('execute-specs.js TIER_MODELS matches config/model-tiers.json', () => {
  const tiers = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'model-tiers.json'), 'utf8'))
  const expected = Object.fromEntries(Object.entries(tiers).map(([tier, cfg]) => [tier, cfg.model]))

  const source = readFileSync(join(REPO_ROOT, 'workflows', 'execute-specs.js'), 'utf8')
  const match = source.match(/const TIER_MODELS\s*=\s*(\{[^}]*\})/)
  assert.ok(match, 'execute-specs.js must define TIER_MODELS')

  const pairs = [...match[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)]
  const actual = Object.fromEntries(pairs.map(([, k, v]) => [k, v]))
  assert.deepEqual(actual, expected,
    `execute-specs.js TIER_MODELS has drifted from config/model-tiers.json`)
})
