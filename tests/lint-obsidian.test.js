// Tests for scripts/lint-obsidian.mjs — broken-wikilink, orphan-page, and
// stale-page checks against an external Obsidian vault (specs/0004-obsidian-vault-lint.md).
//
// RIGBENCH_OBSIDIAN_VAULT_PATH is fully configurable, so tests point it at
// a fresh mkdtempSync() directory per test.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extractWikilinks, latestUpdateDate, lintVault } from '../scripts/lint-obsidian.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'lint-obsidian.mjs');

function freshVault(pages = {}, indexContent = '# Research Index\n') {
  const vault = mkdtempSync(join(tmpdir(), 'rigbench-vault-'));
  const wikiDir = join(vault, 'wiki');
  mkdirSync(wikiDir, { recursive: true });
  for (const [name, content] of Object.entries(pages)) {
    writeFileSync(join(wikiDir, name), content);
  }
  writeFileSync(join(vault, 'index.md'), indexContent);
  return vault;
}

function runLint(vaultPath, args = []) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RIGBENCH_OBSIDIAN_VAULT_PATH: vaultPath ?? '' },
  });
}

// ── pure functions ──────────────────────────────────────────────────────

test('extractWikilinks: accepts both [[wiki/slug]] and [[slug]] forms', () => {
  const links = extractWikilinks('See [[wiki/widgets]] and also [[gadgets]].');
  assert.deepEqual(links, [
    { slug: 'widgets', line: 1 },
    { slug: 'gadgets', line: 1 },
  ]);
});

test('extractWikilinks: reports the correct line number per match', () => {
  const links = extractWikilinks('line one\n[[wiki/widgets]]\nline three\n[[gadgets]]\n');
  assert.deepEqual(links, [
    { slug: 'widgets', line: 2 },
    { slug: 'gadgets', line: 4 },
  ]);
});

test('latestUpdateDate: returns null when there is no Update section', () => {
  assert.equal(latestUpdateDate('---\ntopic: widgets\n---\n\n## Summary\n\nbody\n'), null);
});

test('latestUpdateDate: returns the most recent of multiple Update sections', () => {
  const content = '## Update 2026-01-01T00:00:00.000Z\n\nfirst\n\n## Update 2026-03-01T00:00:00.000Z\n\nlatest\n';
  assert.equal(latestUpdateDate(content), '2026-03-01T00:00:00.000Z');
});

test('lintVault: flags a broken link to a non-existent page', () => {
  const result = lintVault({
    slugs: ['widgets'],
    sources: [
      { file: 'wiki/widgets.md', content: '[[gadgets]]', mtimeMs: Date.now() },
    ],
    staleDays: 90,
  });
  assert.equal(result.brokenLinks.length, 1);
  assert.equal(result.brokenLinks[0].slug, 'gadgets');
});

test('lintVault: a page with no inbound links anywhere is an orphan', () => {
  const result = lintVault({
    slugs: ['widgets', 'gadgets'],
    sources: [
      { file: 'wiki/widgets.md', content: 'no links here', mtimeMs: Date.now() },
      { file: 'wiki/gadgets.md', content: 'no links here either', mtimeMs: Date.now() },
      { file: 'index.md', content: '[[wiki/widgets]]', mtimeMs: Date.now() },
    ],
    staleDays: 90,
  });
  assert.deepEqual(result.orphanPages, ['gadgets']);
});

test('lintVault: a page linked only from index.md is not an orphan', () => {
  const result = lintVault({
    slugs: ['widgets'],
    sources: [
      { file: 'wiki/widgets.md', content: 'no links here', mtimeMs: Date.now() },
      { file: 'index.md', content: '[[wiki/widgets]]', mtimeMs: Date.now() },
    ],
    staleDays: 90,
  });
  assert.deepEqual(result.orphanPages, []);
});

test('lintVault: stale page detected via an old Update section', () => {
  const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const result = lintVault({
    slugs: ['widgets'],
    sources: [
      { file: 'wiki/widgets.md', content: `## Update ${old}\n\nbody`, mtimeMs: Date.now() },
    ],
    staleDays: 90,
  });
  assert.equal(result.stalePages.length, 1);
  assert.equal(result.stalePages[0].slug, 'widgets');
});

test('lintVault: fresh page (no Update section, recent mtime) is not stale', () => {
  const result = lintVault({
    slugs: ['widgets'],
    sources: [
      { file: 'wiki/widgets.md', content: 'no update section', mtimeMs: Date.now() },
    ],
    staleDays: 90,
  });
  assert.deepEqual(result.stalePages, []);
});

// ── CLI / end-to-end ─────────────────────────────────────────────────────

test('errors clearly when RIGBENCH_OBSIDIAN_VAULT_PATH is unset', () => {
  const result = runLint(null);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RIGBENCH_OBSIDIAN_VAULT_PATH is not set/);
});

test('clean vault: prints "vault is clean" and exits 0', () => {
  const vault = freshVault(
    { 'widgets.md': '## Summary\n\nbody\n' },
    '# Research Index\n- [[wiki/widgets]] — Widgets\n'
  );
  try {
    const result = runLint(vault);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /vault is clean/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('broken link: reports it and exits non-zero', () => {
  const vault = freshVault(
    { 'widgets.md': '## Summary\n\nsee [[gadgets]] for more\n' },
    '# Research Index\n- [[wiki/widgets]] — Widgets\n'
  );
  try {
    const result = runLint(vault);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Broken Links:/);
    assert.match(result.stdout, /wiki\/widgets\.md:\d+ → \[\[gadgets\]\] \(no such page\)/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('orphan page: reported but does not fail the run', () => {
  const vault = freshVault(
    {
      'widgets.md': '## Summary\n\nbody\n',
      'gadgets.md': '## Summary\n\nbody, never linked from anywhere\n',
    },
    '# Research Index\n- [[wiki/widgets]] — Widgets\n'
  );
  try {
    const result = runLint(vault);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Orphan Pages:/);
    assert.match(result.stdout, /wiki\/gadgets\.md/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('stale page: reported but does not fail the run, respects --stale-days', () => {
  const vault = freshVault(
    { 'widgets.md': '## Summary\n\nbody\n' },
    '# Research Index\n- [[wiki/widgets]] — Widgets\n'
  );
  try {
    const oldMtime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(join(vault, 'wiki', 'widgets.md'), oldMtime, oldMtime);

    const defaultResult = runLint(vault);
    assert.equal(defaultResult.status, 0, defaultResult.stderr);
    assert.match(defaultResult.stdout, /vault is clean/);

    const strictResult = runLint(vault, ['--stale-days', '5']);
    assert.equal(strictResult.status, 0, strictResult.stderr);
    assert.match(strictResult.stdout, /Stale Pages:/);
    assert.match(strictResult.stdout, /wiki\/widgets\.md/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
