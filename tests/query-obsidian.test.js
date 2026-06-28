// Tests for scripts/query-obsidian.mjs — chunks an external Obsidian
// vault's wiki/ pages, indexes them into a vault-scoped TF-IDF store, and
// returns the top-K chunks relevant to a question (specs/0003-obsidian-vault-query.md).
//
// RIGBENCH_OBSIDIAN_VAULT_PATH is fully configurable, so tests point it at
// a fresh mkdtempSync() directory per test rather than touching any shared
// repo-relative path.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chunkMarkdown } from '../scripts/query-obsidian.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'query-obsidian.mjs');

function freshVault(pages = {}) {
  const vault = mkdtempSync(join(tmpdir(), 'rigbench-vault-'));
  const wikiDir = join(vault, 'wiki');
  mkdirSync(wikiDir, { recursive: true });
  for (const [name, content] of Object.entries(pages)) {
    writeFileSync(join(wikiDir, name), content);
  }
  return vault;
}

function runQuery(vaultPath, args) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RIGBENCH_OBSIDIAN_VAULT_PATH: vaultPath ?? '' },
  });
}

test('chunkMarkdown: splits by header and skips empty sections', () => {
  const chunks = chunkMarkdown('## Heading One\n\nbody one\n## Heading Two\n\nbody two\n');
  assert.deepEqual(chunks, [
    { heading: 'Heading One', content: 'body one' },
    { heading: 'Heading Two', content: 'body two' },
  ]);
});

test('errors clearly when RIGBENCH_OBSIDIAN_VAULT_PATH is unset', () => {
  const result = runQuery(null, ['some question']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RIGBENCH_OBSIDIAN_VAULT_PATH is not set/);
});

test('usage error when the question argument is missing', () => {
  const vault = freshVault();
  try {
    const result = runQuery(vault, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/query-obsidian\.mjs/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('empty vault (no wiki pages): reports no relevant content', () => {
  const vault = freshVault();
  try {
    const result = runQuery(vault, ['anything']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<vault_memory>/);
    assert.match(result.stdout, /No relevant vault content found/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('no relevant chunk: reports no relevant content instead of low-relevance noise', () => {
  const vault = freshVault({
    'widgets.md': '## Summary\n\napples bananas oranges grapes pineapples mangoes coconuts\n',
  });
  try {
    const result = runQuery(vault, ['quantum chromodynamics particle physics']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No relevant vault content found/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('returns the matching chunk wrapped in memory_item with source/heading/score', () => {
  const vault = freshVault({
    'widgets.md': '## Pricing\n\nwidgets are priced per unit with volume discounts for bulk orders\n',
    'gadgets.md': '## Specs\n\ngadgets ship with a one year warranty and waterproof casing\n',
  });
  try {
    const result = runQuery(vault, ['how are widgets priced per unit']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<vault_memory>/);
    assert.match(result.stdout, /<memory_item source="wiki\/widgets\.md" heading="Pricing" score="[\d.]+">/);
    assert.match(result.stdout, /priced per unit/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('topK argument limits the number of results returned', () => {
  const vault = freshVault({
    'a.md': '## A\n\nmachine learning neural networks deep learning training models\n',
    'b.md': '## B\n\nmachine learning gradient descent optimization training models\n',
    'c.md': '## C\n\nmachine learning supervised unsupervised training models data\n',
  });
  try {
    const result = runQuery(vault, ['machine learning training models', '1']);
    assert.equal(result.status, 0, result.stderr);
    const matches = result.stdout.match(/<memory_item /g) || [];
    assert.equal(matches.length, 1, 'expected exactly one memory_item with topK=1');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('re-running rebuilds the index from scratch instead of accumulating duplicates', () => {
  const vault = freshVault({
    'widgets.md': '## Pricing\n\nwidgets are priced per unit with volume discounts for bulk orders\n',
  });
  try {
    runQuery(vault, ['widgets priced per unit']);
    const result = runQuery(vault, ['widgets priced per unit']);
    assert.equal(result.status, 0, result.stderr);
    const matches = result.stdout.match(/<memory_item /g) || [];
    assert.equal(matches.length, 1, 'expected exactly one match, not duplicated chunks across runs');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
