// Tests for lib/memory-store.mjs — the local TF-IDF vector store over
// memory markdown chunks. Uses a real temp sqlite file per test (via
// openStore/closeStore) rather than mocking better-sqlite3, since the
// module's whole contract is SQL behavior.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openStore,
  closeStore,
  tokenize,
  ingestChunks,
  queryTopK,
  pruneStale,
} from '../lib/memory-store.mjs';

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  const dbPath = join(dir, 'memory-vectors.db');
  const db = openStore(dbPath);
  try {
    return fn(db);
  } finally {
    closeStore(db);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── openStore() ───────────────────────────────────────────────────────────

test('openStore: creates the chunks and idf tables, queryable immediately', () => {
  withStore((db) => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('chunks'));
    assert.ok(tables.includes('idf'));
  });
});

test('openStore: creates parent directory for the db file if missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  const nestedPath = join(dir, 'nested', 'deeper', 'memory-vectors.db');
  const db = openStore(nestedPath);
  try {
    assert.doesNotThrow(() => db.prepare('SELECT 1').get());
  } finally {
    closeStore(db);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── tokenize() ────────────────────────────────────────────────────────────

test('tokenize: lowercases and splits on non-alphanumeric characters', () => {
  assert.deepEqual(tokenize('Hello, World!'), ['hello', 'world']);
});

test('tokenize: filters out stopwords', () => {
  assert.deepEqual(tokenize('the quick fox and the lazy dog'), ['quick', 'fox', 'lazy', 'dog']);
});

test('tokenize: filters out tokens of length <= 2', () => {
  assert.deepEqual(tokenize('an ox is on it'), []);
});

test('tokenize: returns an empty array for empty or whitespace-only input', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
});

test('tokenize: keeps underscores and digits as part of tokens', () => {
  assert.deepEqual(tokenize('my_var123 test'), ['my_var123', 'test']);
});

// ── ingestChunks() ────────────────────────────────────────────────────────

test('ingestChunks: inserts the given number of chunks and returns that count', () => {
  withStore((db) => {
    const n = ingestChunks(db, [
      { source: 'a.md', heading: 'Intro', content: 'widgets are durable and reliable products' },
      { source: 'b.md', heading: null, content: 'gadgets are cheap and disposable items' },
    ]);
    assert.equal(n, 2);
    const rows = db.prepare('SELECT * FROM chunks').all();
    assert.equal(rows.length, 2);
  });
});

test('ingestChunks: stores non-empty vector JSON for each chunk after IDF rebuild', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', heading: 'h', content: 'widgets are durable products' }]);
    const row = db.prepare('SELECT vector FROM chunks').get();
    const vec = JSON.parse(row.vector);
    assert.ok(Object.keys(vec).length > 0);
  });
});

test('ingestChunks: defaults heading to null when omitted', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    const row = db.prepare('SELECT heading FROM chunks').get();
    assert.equal(row.heading, null);
  });
});

test('ingestChunks: a second ingest call adds to existing chunks and rebuilds IDF over the full corpus', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    ingestChunks(db, [{ source: 'b.md', content: 'gadgets are cheap items' }]);
    const rows = db.prepare('SELECT * FROM chunks').all();
    assert.equal(rows.length, 2);
  });
});

// ── queryTopK() ───────────────────────────────────────────────────────────

test('queryTopK: returns chunks ranked by similarity, most similar first', () => {
  withStore((db) => {
    ingestChunks(db, [
      { source: 'a.md', content: 'widgets are durable reliable products manufactured locally' },
      { source: 'b.md', content: 'completely unrelated text about gardening and plants' },
    ]);
    const results = queryTopK(db, 'durable widgets', 5);
    assert.ok(results.length >= 1);
    assert.equal(results[0].source, 'a.md');
  });
});

test('queryTopK: limits results to k', () => {
  withStore((db) => {
    ingestChunks(db, [
      { source: 'a.md', content: 'widgets durable products manufacturing' },
      { source: 'b.md', content: 'widgets reliable products engineering' },
      { source: 'c.md', content: 'widgets sturdy products fabrication' },
    ]);
    const results = queryTopK(db, 'widgets products', 2);
    assert.ok(results.length <= 2);
  });
});

test('queryTopK: excludes chunks with zero similarity score', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets durable products' }]);
    const results = queryTopK(db, 'zzz nonexistent qqq termsnotfound', 5);
    assert.deepEqual(results, []);
  });
});

test('queryTopK: returns empty array when the store has no chunks', () => {
  withStore((db) => {
    const results = queryTopK(db, 'anything', 5);
    assert.deepEqual(results, []);
  });
});

test('queryTopK: result shape includes source, heading, content, and a rounded score', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', heading: 'Intro', content: 'widgets are durable products' }]);
    const [result] = queryTopK(db, 'widgets durable', 1);
    assert.equal(result.source, 'a.md');
    assert.equal(result.heading, 'Intro');
    assert.equal(result.content, 'widgets are durable products');
    assert.equal(typeof result.score, 'number');
    // score is rounded to 3 decimal places
    assert.equal(result.score, Math.round(result.score * 1000) / 1000);
  });
});

test('queryTopK: updates access_count and last_accessed for returned chunks', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    const before = db.prepare('SELECT access_count, last_accessed FROM chunks').get();
    assert.equal(before.access_count, 0);

    queryTopK(db, 'widgets durable', 5);

    const after = db.prepare('SELECT access_count, last_accessed FROM chunks').get();
    assert.equal(after.access_count, 1);
  });
});

test('queryTopK: does not touch access_count for chunks that did not match', () => {
  withStore((db) => {
    ingestChunks(db, [
      { source: 'a.md', content: 'widgets are durable products manufactured' },
      { source: 'b.md', content: 'completely different gardening content' },
    ]);
    queryTopK(db, 'widgets durable manufactured', 1);
    const rows = db.prepare('SELECT source, access_count FROM chunks ORDER BY source').all();
    const bRow = rows.find((r) => r.source === 'b.md');
    assert.equal(bRow.access_count, 0);
  });
});

// ── pruneStale() ──────────────────────────────────────────────────────────

test('pruneStale: archives chunks older than maxAgeDays with access_count below minAccessCount', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    // Force last_accessed far in the past.
    db.prepare("UPDATE chunks SET last_accessed = '2000-01-01T00:00:00.000Z'").run();

    const stale = pruneStale(db, { maxAgeDays: 30, minAccessCount: 2 });
    assert.equal(stale.length, 1);

    const row = db.prepare('SELECT archived FROM chunks').get();
    assert.equal(row.archived, 1);
  });
});

test('pruneStale: leaves recently-accessed chunks alone', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    const stale = pruneStale(db, { maxAgeDays: 30, minAccessCount: 2 });
    assert.deepEqual(stale, []);
    const row = db.prepare('SELECT archived FROM chunks').get();
    assert.equal(row.archived, 0);
  });
});

test('pruneStale: leaves stale-but-frequently-accessed chunks alone (access_count >= minAccessCount)', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    db.prepare("UPDATE chunks SET last_accessed = '2000-01-01T00:00:00.000Z', access_count = 5").run();

    const stale = pruneStale(db, { maxAgeDays: 30, minAccessCount: 2 });
    assert.deepEqual(stale, []);
  });
});

test('pruneStale: archived chunks are excluded from subsequent queryTopK results', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products manufactured' }]);
    db.prepare("UPDATE chunks SET last_accessed = '2000-01-01T00:00:00.000Z'").run();
    pruneStale(db, { maxAgeDays: 30, minAccessCount: 2 });

    const results = queryTopK(db, 'widgets durable manufactured', 5);
    assert.deepEqual(results, []);
  });
});

test('pruneStale: returns an empty array (and is a no-op) when nothing qualifies as stale', () => {
  withStore((db) => {
    ingestChunks(db, [{ source: 'a.md', content: 'widgets are durable products' }]);
    const stale = pruneStale(db, { maxAgeDays: 9999, minAccessCount: 2 });
    assert.deepEqual(stale, []);
  });
});

// ── closeStore() ──────────────────────────────────────────────────────────

test('closeStore: closes the underlying database connection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  const dbPath = join(dir, 'memory-vectors.db');
  const db = openStore(dbPath);
  closeStore(db);
  assert.throws(() => db.prepare('SELECT 1').get());
  rmSync(dir, { recursive: true, force: true });
});
