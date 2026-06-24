#!/usr/bin/env node
// Validates the depends_on graph across specs/*.md and specs/done/*.md
// (specs/README.md "Frontmatter") — the field is otherwise write-only today:
// nothing checks that an id exists, that the graph is acyclic, or that a
// done/in_progress spec isn't quietly depending on something still draft.
//
// Deliberately regex-based, not a YAML parser, matching scripts/code-map.mjs's
// approach to frontmatter (see that file's header for why: no build step or
// parser dependency in this repo, a missed edge case here is an incomplete
// report, not a wrong one).
//
// Usage: node scripts/specs-graph.mjs   (or `npm run specs:graph`)
// Output: JSON report on stdout. Exit 1 if any cycle/dangling-ref/drift found,
// 0 otherwise — usable as a CI/pre-commit gate without further plumbing.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SPEC_DIRS = ['specs', 'specs/done'];

const FRONTMATTER_RE = /^---\n([^]*?)\n---/;

function parseDependsOn(body) {
  const inline = body.match(/^depends_on:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const block = body.match(/^depends_on:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (block) {
    return [...block[1].matchAll(/-\s*(.+)/g)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  return [];
}

function scanSpec(file) {
  const text = readFileSync(file, 'utf8');
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return null;
  const body = fm[1];
  const field = (key) => (body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [, null])[1];

  const id = field('id');
  const status = field('status');
  const depends_on = parseDependsOn(body);

  return { id, status, depends_on };
}

function findCycles(specsById) {
  const cycles = [];
  const state = new Map(); // id -> 'visiting' | 'done'

  function visit(id, path) {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }
    state.set(id, 'visiting');
    const spec = specsById.get(id);
    if (spec) {
      for (const dep of spec.depends_on) visit(dep, [...path, id]);
    }
    state.set(id, 'done');
  }

  for (const id of specsById.keys()) visit(id, []);
  return cycles;
}

function main() {
  const specs = [];
  for (const dir of SPEC_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      if (extname(entry) !== '.md' || entry === 'README.md') continue;
      const file = join(full, entry);
      const parsed = scanSpec(file);
      if (!parsed || !parsed.id) continue;
      specs.push({ path: relative(root, file), ...parsed });
    }
  }

  const specsById = new Map(specs.map((s) => [s.id, s]));

  const dangling = [];
  for (const spec of specs) {
    for (const dep of spec.depends_on) {
      if (!specsById.has(dep)) dangling.push({ spec: spec.id, missing: dep });
    }
  }

  const cycles = findCycles(specsById);

  const drift = [];
  for (const spec of specs) {
    if (spec.status !== 'done' && spec.status !== 'in_progress') continue;
    for (const dep of spec.depends_on) {
      const depSpec = specsById.get(dep);
      if (depSpec && depSpec.status === 'draft') {
        drift.push({ spec: spec.id, depends_on: dep, dep_status: depSpec.status });
      }
    }
  }

  const report = { specs, cycles, dangling, drift };
  console.log(JSON.stringify(report, null, 2));

  if (cycles.length || dangling.length || drift.length) {
    process.exitCode = 1;
  }
}

main();
