// Tests for scripts/specs-graph.mjs — validates the depends_on graph across
// specs/*.md and specs/done/*.md (specs/README.md "Frontmatter"). Runs the
// script as a real subprocess against a temp dir, same fixture-copy approach
// as tests/code-map.test.js (the script resolves its own root from
// import.meta.url, not CLAUDE_PROJECT_DIR).
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_SRC = join(REPO_ROOT, 'scripts', 'specs-graph.mjs');

function buildFixture(tmp) {
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT_SRC, join(tmp, 'scripts', 'specs-graph.mjs'));
  return join(tmp, 'scripts', 'specs-graph.mjs');
}

function writeSpec(tmp, filename, { id, status, depends_on }) {
  mkdirSync(join(tmp, 'specs'), { recursive: true });
  const deps = depends_on === undefined ? '[]' : `[${depends_on.map((d) => `"${d}"`).join(', ')}]`;
  writeFileSync(
    join(tmp, 'specs', filename),
    `---\nid: ${id}\ntitle: Sample\nstatus: ${status}\ndepends_on: ${deps}\nsource: manual#sample\n---\n## Problem\n`
  );
}

function runScript(scriptPath) {
  return spawnSync('node', [scriptPath], { encoding: 'utf8' });
}

test('a valid graph with no cycles/dangling-refs/drift exits 0', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-specs-graph-'));
  try {
    const scriptPath = buildFixture(tmp);
    writeSpec(tmp, '0001-base.md', { id: '0001', status: 'done' });
    writeSpec(tmp, '0002-dependent.md', { id: '0002', status: 'in_progress', depends_on: ['0001'] });

    const result = runScript(scriptPath);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.cycles.length, 0);
    assert.equal(report.dangling.length, 0);
    assert.equal(report.drift.length, 0);
    assert.equal(report.specs.length, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detects a dangling depends_on reference and exits 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-specs-graph-'));
  try {
    const scriptPath = buildFixture(tmp);
    writeSpec(tmp, '0001-orphan.md', { id: '0001', status: 'draft', depends_on: ['9999'] });

    const result = runScript(scriptPath);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.dangling, [{ spec: '0001', missing: '9999' }]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detects a cycle and exits 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-specs-graph-'));
  try {
    const scriptPath = buildFixture(tmp);
    writeSpec(tmp, '0001-a.md', { id: '0001', status: 'draft', depends_on: ['0002'] });
    writeSpec(tmp, '0002-b.md', { id: '0002', status: 'draft', depends_on: ['0001'] });

    const result = runScript(scriptPath);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.cycles.length, 1);
    assert.deepEqual(new Set(report.cycles[0]), new Set(['0001', '0002']));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detects drift when a done spec depends on a still-draft spec', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-specs-graph-'));
  try {
    const scriptPath = buildFixture(tmp);
    writeSpec(tmp, '0001-draft-dep.md', { id: '0001', status: 'draft' });
    writeSpec(tmp, '0002-done.md', { id: '0002', status: 'done', depends_on: ['0001'] });

    const result = runScript(scriptPath);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.drift, [{ spec: '0002', depends_on: '0001', dep_status: 'draft' }]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty specs/ dir produces empty arrays, not a crash', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-specs-graph-'));
  try {
    const scriptPath = buildFixture(tmp);
    const result = runScript(scriptPath);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report, { specs: [], cycles: [], dangling: [], drift: [] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
