// Tests for scripts/sync-obsidian.mjs — syncs a completed /research run
// into an external Obsidian vault (specs/0002-obsidian-vault-research-sync.md).
//
// Unlike ingest-memory.mjs/query-memory.mjs, this script's vault path is
// fully configurable via RIGBENCH_OBSIDIAN_VAULT_PATH, so tests point it at
// a fresh mkdtempSync() directory per test instead of backing up/restoring
// a shared repo-relative path.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  splitFrontmatter,
  parseFrontmatterField,
  buildWikiPage,
  upsertIndexLine,
} from '../scripts/sync-obsidian.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'sync-obsidian.mjs');

function freshVault() {
  return mkdtempSync(join(tmpdir(), 'rigbench-vault-'));
}

function runSync(vaultPath, args) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: vaultPath ? { ...process.env, RIGBENCH_OBSIDIAN_VAULT_PATH: vaultPath } : { ...process.env, RIGBENCH_OBSIDIAN_VAULT_PATH: '' },
  });
}

function writeTitleMd(dir, content) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'TITLE.MD');
  writeFileSync(p, content);
  return p;
}

const SAMPLE_TITLE_MD = `---
topic: widgets
target_outcome: implementation_guide
confidence_level: 0.82
validated_sources: ["https://example.com/a", "https://example.com/b"]
generated_at: 2026-01-01T00:00:00.000Z
---

## Summary

Widgets are great.
`;

// ── pure functions ──────────────────────────────────────────────────────

test('splitFrontmatter: separates the YAML block from the body', () => {
  const { frontmatterText, body } = splitFrontmatter(SAMPLE_TITLE_MD);
  assert.match(frontmatterText, /^topic: widgets/);
  assert.match(body, /## Summary/);
  assert.match(body, /Widgets are great\./);
});

test('splitFrontmatter: returns empty frontmatter when there is no --- block', () => {
  const { frontmatterText, body } = splitFrontmatter('# Just a body\n');
  assert.equal(frontmatterText, '');
  assert.equal(body, '# Just a body\n');
});

test('parseFrontmatterField: reads a scalar field', () => {
  const { frontmatterText } = splitFrontmatter(SAMPLE_TITLE_MD);
  assert.equal(parseFrontmatterField(frontmatterText, 'topic'), 'widgets');
  assert.equal(parseFrontmatterField(frontmatterText, 'confidence_level'), '0.82');
});

test('parseFrontmatterField: reads a flow-array field', () => {
  const { frontmatterText } = splitFrontmatter(SAMPLE_TITLE_MD);
  assert.deepEqual(parseFrontmatterField(frontmatterText, 'validated_sources'), [
    'https://example.com/a',
    'https://example.com/b',
  ]);
});

test('parseFrontmatterField: returns undefined for a missing field', () => {
  const { frontmatterText } = splitFrontmatter(SAMPLE_TITLE_MD);
  assert.equal(parseFrontmatterField(frontmatterText, 'nope'), undefined);
});

test('buildWikiPage: writes a fresh frontmatter+body page when no prior content exists', () => {
  const page = buildWikiPage({
    existingContent: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    frontmatterFields: { topic: 'widgets', confidence_level: '0.82' },
    body: '## Summary\n\nWidgets are great.',
  });
  assert.match(page, /^---\ntopic: widgets\nconfidence_level: 0\.82\n---\n\n## Summary/);
});

test('buildWikiPage: appends an "## Update" section on re-runs instead of overwriting', () => {
  const first = buildWikiPage({
    existingContent: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    frontmatterFields: { topic: 'widgets' },
    body: '## Summary\n\nFirst run.',
  });
  const second = buildWikiPage({
    existingContent: first,
    generatedAt: '2026-02-01T00:00:00.000Z',
    frontmatterFields: { topic: 'widgets' },
    body: '## Summary\n\nSecond run.',
  });
  assert.match(second, /First run\./);
  assert.match(second, /## Update 2026-02-01T00:00:00\.000Z/);
  assert.match(second, /Second run\./);
});

test('upsertIndexLine: appends a new line for a topic not yet in the index', () => {
  const result = upsertIndexLine({ existingContent: '# Research Index\n', topicSlug: 'widgets', topic: 'Widgets' });
  assert.match(result, /- \[\[wiki\/widgets\]\] — Widgets/);
});

test('upsertIndexLine: replaces the existing line in place rather than duplicating it', () => {
  const withOne = upsertIndexLine({ existingContent: '# Research Index\n', topicSlug: 'widgets', topic: 'Widgets' });
  const updated = upsertIndexLine({ existingContent: withOne, topicSlug: 'widgets', topic: 'Widgets v2' });
  const matches = updated.match(/\[\[wiki\/widgets\]\]/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one index entry for the topic');
  assert.match(updated, /Widgets v2/);
});

// ── CLI / end-to-end ─────────────────────────────────────────────────────

test('skips silently when RIGBENCH_OBSIDIAN_VAULT_PATH is unset', () => {
  const result = runSync(null, ['widgets', '2026-01-01T00:00:00.000Z', 'COMPLETE']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipping Obsidian vault sync/);
});

test('usage error when required args are missing', () => {
  const vault = freshVault();
  try {
    const result = runSync(vault, ['widgets']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/sync-obsidian\.mjs/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('bootstraps wiki/, raw/, index.md, and log.md on first use', () => {
  const vault = freshVault();
  try {
    const result = runSync(vault, ['widgets', '2026-01-01T00:00:00.000Z', 'COMPLETE']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(vault, 'wiki')));
    assert.ok(existsSync(join(vault, 'raw')));
    assert.ok(existsSync(join(vault, 'index.md')));
    assert.ok(existsSync(join(vault, 'log.md')));
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('non-COMPLETE outcome with no titleMdPath logs the run but writes no wiki page', () => {
  const vault = freshVault();
  try {
    const result = runSync(vault, ['widgets', '2026-01-01T00:00:00.000Z', 'FAILED']);
    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(join(vault, 'log.md'), 'utf8');
    assert.match(log, /2026-01-01T00:00:00\.000Z \| widgets \| FAILED/);
    assert.ok(!existsSync(join(vault, 'wiki', 'widgets.md')));
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('full run with a TITLE.MD writes the wiki page and updates index.md', () => {
  const vault = freshVault();
  const srcDir = mkdtempSync(join(tmpdir(), 'rigbench-research-'));
  try {
    const titleMdPath = writeTitleMd(srcDir, SAMPLE_TITLE_MD);
    const result = runSync(vault, ['widgets', '2026-01-01T00:00:00.000Z', 'COMPLETE', titleMdPath]);
    assert.equal(result.status, 0, result.stderr);

    const page = readFileSync(join(vault, 'wiki', 'widgets.md'), 'utf8');
    assert.match(page, /^---\ntopic: widgets/);
    assert.match(page, /## Summary/);
    assert.match(page, /Widgets are great\./);

    const index = readFileSync(join(vault, 'index.md'), 'utf8');
    assert.match(index, /\[\[wiki\/widgets\]\] — widgets/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  }
});

test('re-running on the same topic appends an Update section instead of overwriting', () => {
  const vault = freshVault();
  const srcDir = mkdtempSync(join(tmpdir(), 'rigbench-research-'));
  try {
    const titleMdPath = writeTitleMd(srcDir, SAMPLE_TITLE_MD);
    runSync(vault, ['widgets', '2026-01-01T00:00:00.000Z', 'COMPLETE', titleMdPath]);
    const secondTitleMd = SAMPLE_TITLE_MD.replace('Widgets are great.', 'Widgets are even better now.');
    writeFileSync(titleMdPath, secondTitleMd);
    const result = runSync(vault, ['widgets', '2026-02-01T00:00:00.000Z', 'COMPLETE', titleMdPath]);
    assert.equal(result.status, 0, result.stderr);

    const page = readFileSync(join(vault, 'wiki', 'widgets.md'), 'utf8');
    assert.match(page, /Widgets are great\./);
    assert.match(page, /## Update 2026-02-01T00:00:00\.000Z/);
    assert.match(page, /Widgets are even better now\./);

    const indexMatches = readFileSync(join(vault, 'index.md'), 'utf8').match(/\[\[wiki\/widgets\]\]/g) || [];
    assert.equal(indexMatches.length, 1, 'expected exactly one index entry, not a duplicate');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  }
});

test('copies intake.json to raw/{slug}-intake.json when intakeJsonPath is given', () => {
  const vault = freshVault();
  const srcDir = mkdtempSync(join(tmpdir(), 'rigbench-research-'));
  try {
    const titleMdPath = writeTitleMd(srcDir, SAMPLE_TITLE_MD);
    const intakePath = join(srcDir, 'intake.json');
    writeFileSync(intakePath, JSON.stringify({ topic: 'widgets', focus_areas: ['pricing'] }));

    const result = runSync(vault, ['widgets', '2026-01-01T00:00:00.000Z', 'COMPLETE', titleMdPath, intakePath]);
    assert.equal(result.status, 0, result.stderr);

    const rawCopy = JSON.parse(readFileSync(join(vault, 'raw', 'widgets-intake.json'), 'utf8'));
    assert.equal(rawCopy.topic, 'widgets');
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  }
});
