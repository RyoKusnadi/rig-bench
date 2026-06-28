// Tests for scripts/query-memory.mjs — queries the TF-IDF vector store for
// the top-K chunks relevant to a task description and prints them wrapped
// in <long_term_memory>/<memory_item> tags.
//
// DB_PATH is hardcoded relative to the script's own file location (no env
// var or CLI override — confirmed by reading the source), so tests build a
// small, deterministic db directly at the real .claude/memory-vectors.db
// path using lib/memory-store.mjs's openStore/ingestChunks (same helpers
// the real ingest script uses), run the script as a subprocess, then
// restore whatever was at that path beforehand.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openStore, ingestChunks, closeStore } from '../lib/memory-store.mjs';
import { withMemoryDbLock } from './helpers/memory-db-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'query-memory.mjs');
const DB_PATH = join(REPO_ROOT, '.claude', 'memory-vectors.db');

function runQuery(args) {
  return spawnSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

// Holds a cross-process lock for the duration since tests/ingest-memory.test.js
// and tests/prune-memory.test.js contend on this same hardcoded db path (see
// tests/helpers/memory-db-lock.mjs).
function withClearDb(fn) {
  return withMemoryDbLock(() => {
    const backupDir = mkdtempSync(join(tmpdir(), 'rigbench-db-backup-'));
    const suffixes = ['', '-wal', '-shm', '-journal'];
    const present = suffixes.filter((s) => existsSync(DB_PATH + s));
    for (const s of present) {
      renameSync(DB_PATH + s, join(backupDir, 'db' + s));
    }
    try {
      return fn();
    } finally {
      for (const s of suffixes) {
        const p = DB_PATH + s;
        if (existsSync(p)) rmSync(p, { force: true });
      }
      for (const s of present) {
        renameSync(join(backupDir, 'db' + s), DB_PATH + s);
      }
      rmSync(backupDir, { recursive: true, force: true });
    }
  });
}

function seedDb(chunks) {
  const db = openStore(DB_PATH);
  ingestChunks(db, chunks);
  closeStore(db);
}

test('usage error when query argument is missing', () => {
  withClearDb(() => {
    const result = runQuery([]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/query-memory\.mjs/);
  });
});

test('no db file: prints fallback "no vector store found" XML comment', () => {
  withClearDb(() => {
    const result = runQuery(['some query']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /<long_term_memory>/);
    assert.match(result.stdout, /No vector store found — run `npm run memory:ingest` first\./);
    assert.match(result.stdout, /<\/long_term_memory>/);
  });
});

test('db exists but no relevant chunk: prints "no sufficiently relevant memory" comment', () => {
  withClearDb(() => {
    seedDb([{ source: 'memory/foo.md', heading: 'Foo', content: 'apples bananas oranges grapes pineapples mangoes' }]);
    const result = runQuery(['quantum chromodynamics particle physics']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No sufficiently relevant memory found for this query\./);
  });
});

test('returns matching chunk wrapped in memory_item tag with source/heading/score attrs', () => {
  withClearDb(() => {
    seedDb([
      { source: 'memory/knowledge/agents/writing-agents.md', heading: 'Writing Agents', content: 'agents should validate structured output schemas before responding to callers' },
      { source: 'memory/knowledge/security/owasp-top10.md', heading: 'OWASP', content: 'injection attacks cross site scripting authentication failures access control' },
    ]);
    const result = runQuery(['how do agents validate structured output schemas']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /<long_term_memory>/);
    assert.match(result.stdout, /<memory_item source="memory\/knowledge\/agents\/writing-agents\.md" heading="Writing Agents" score="[\d.]+">/);
    assert.match(result.stdout, /validate structured output schemas/);
    assert.match(result.stdout, /<\/long_term_memory>/);
  });
});

test('topK argument limits the number of results returned', () => {
  withClearDb(() => {
    seedDb([
      { source: 'a.md', heading: 'A', content: 'machine learning neural networks deep learning training models' },
      { source: 'b.md', heading: 'B', content: 'machine learning gradient descent optimization training models' },
      { source: 'c.md', heading: 'C', content: 'machine learning supervised unsupervised training models data' },
    ]);
    const result = runQuery(['machine learning training models', '1']);
    assert.equal(result.status, 0);
    const matches = result.stdout.match(/<memory_item /g) || [];
    assert.equal(matches.length, 1, 'expected exactly one memory_item with topK=1');
  });
});
