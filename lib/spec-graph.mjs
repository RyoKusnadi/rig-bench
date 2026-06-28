// Spec dependency graph utilities — shared by tests and mirrored inline
// in workflows/execute-specs.js (workflow scripts have no fs/Node API
// access and cannot import this file; see lib/agent-wrapper.mjs's comment
// on why the inline-mirror pattern exists across this codebase).

/**
 * Parse YAML frontmatter from a spec markdown file.
 * Handles the simple key: value pairs used in specs/README.md's template.
 * Does NOT use a full YAML parser — the spec frontmatter schema is minimal
 * and intentionally keeps depends_on as an inline array literal.
 */
export function parseSpecFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  const result = { id: null, title: null, status: null, depends_on: [], source: null }
  let inDependsOnBlock = false

  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trimEnd()

    // Multi-line block-style depends_on:
    //   depends_on:
    //     - 0001
    if (inDependsOnBlock) {
      const itemMatch = line.match(/^\s+-\s+(.+)/)
      if (itemMatch) {
        result.depends_on.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''))
        continue
      }
      inDependsOnBlock = false
    }

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()

    switch (key) {
      case 'id':
        result.id = val.replace(/^['"]|['"]$/g, '') || null
        break
      case 'title':
        result.title = val.replace(/^['"]|['"]$/g, '') || null
        break
      case 'status':
        result.status = val.replace(/^['"]|['"]$/g, '') || null
        break
      case 'source':
        result.source = val.replace(/^['"]|['"]$/g, '') || null
        break
      case 'depends_on': {
        // Inline array: [] or [0001, 0002] or ['0001', '0002']
        const arrMatch = val.match(/^\[(.*)\]$/)
        if (arrMatch) {
          const inner = arrMatch[1].trim()
          result.depends_on = inner
            ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
            : []
        } else if (val === '') {
          // Block-style: depends_on: (nothing on this line, items follow)
          inDependsOnBlock = true
        }
        break
      }
    }
  }

  return result
}

/**
 * BFS levelization — returns `{ levels, blocked }`.
 *
 * `levels` is an array of arrays; specs at `levels[i]` can execute concurrently
 * because all their deps appear in `levels[0..i-1]`. `blocked` contains any
 * specs that couldn't be placed in a level (circular dependency or a dep that
 * is neither in `specs` nor pre-resolved).
 *
 * `specs` — array of objects with at least `{ id, depends_on: string[] }`.
 * `preResolvedIds` — optional Set of IDs already satisfied (e.g. done specs).
 */
export function topoLevels(specs, preResolvedIds) {
  const resolved = new Set(preResolvedIds || [])
  const levels = []
  let remaining = [...specs]

  while (remaining.length > 0) {
    const ready = remaining.filter(s =>
      (s.depends_on || []).every(d => resolved.has(String(d)))
    )
    if (ready.length === 0) break

    levels.push(ready)
    ready.forEach(s => resolved.add(String(s.id)))
    const readyIds = new Set(ready.map(s => String(s.id)))
    remaining = remaining.filter(s => !readyIds.has(String(s.id)))
  }

  return { levels, blocked: remaining }
}

/**
 * Validate that every `depends_on` ID in `selectedSpecs` is either:
 *  - in `doneIds` (already done), or
 *  - also in `selectedSpecs` (will be run in this batch)
 *
 * Returns `{ ok: boolean, missing: Array<{ specId, depId }> }`.
 */
export function validateDeps(selectedSpecs, doneIds) {
  const satisfiedIds = new Set([
    ...selectedSpecs.map(s => String(s.id)),
    ...(doneIds || []).map(String),
  ])
  const missing = []

  for (const spec of selectedSpecs) {
    for (const dep of (spec.depends_on || [])) {
      if (!satisfiedIds.has(String(dep))) {
        missing.push({ specId: spec.id, depId: dep })
      }
    }
  }

  return { ok: missing.length === 0, missing }
}
