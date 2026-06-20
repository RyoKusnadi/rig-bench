// Tests for scripts/prune-memory.mjs — marks vector-store chunks "archived"
// when last_accessed is older than maxAgeDays AND access_count is below
// minAccessCount, never deleting them outright.
//
// DB_PATH is hardcoded relative to the script's own file location (no env
// var or CLI override — confirmed by reading the source), so tests seed a
// small db directly at the real .claude/memory-vectors.db path via
// lib/memory-store.mjs, manipulating last_accessed/access_count directly
// with better-sqlite3 (ingestChunks always sets last_accessed to "now",
// access_count to 0 — there's no public API to backdate a chunk, so we
// reach into the table directly, same as a real chunk would look after
// time passes). The original db file (if any) is restored afterward.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { openStore, ingestChunks, closeStore } from '../lib/memory-store.mjs';
import { withMemoryDbLock } from './helpers/memory-db-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'prune-memory.mjs');
const DB_PATH = join(REPO_ROOT, '.claude', 'memory-vectors.db');

function runPrune(args) {
  return spawnSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

// Holds a cross-process lock for the duration since tests/ingest-memory.test.js
// and tests/query-memory.test.js contend on this same hardcoded db path (see
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

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedDb(chunks) {
  const db = openStore(DB_PATH);
  ingestChunks(db, chunks);
  closeStore(db);
}

function backdateChunk(source, { lastAccessed, accessCount }) {
  const db = new Database(DB_PATH);
  db.prepare('UPDATE chunks SET last_accessed = ?, access_count = ? WHERE source = ?').run(lastAccessed, accessCount, source);
  db.close();
}

test('no db file: prints "no vector store found" message', () => {
  withClearDb(() => {
    const result = runPrune([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No vector store found — run `npm run memory:ingest` first\./);
  });
});

test('no stale chunks: prints "no stale chunks found" with the cutoff/min-access used', () => {
  withClearDb(() => {
    seedDb([{ source: 'fresh.md', heading: 'Fresh', content: 'this chunk was just ingested and accessed recently by a query' }]);
    const result = runPrune([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No stale chunks found \(cutoff: 30 days, min access count: 2\)\./);
  });
});

test('archives a chunk older than maxAgeDays with access_count below minAccessCount', () => {
  withClearDb(() => {
    seedDb([{ source: 'stale.md', heading: 'Stale', content: 'this chunk has not been touched in a very long time at all' }]);
    backdateChunk('stale.md', { lastAccessed: daysAgoIso(60), accessCount: 0 });

    const result = runPrune([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Archived 1 stale chunk\(s\)/);
    assert.match(result.stdout, /stale\.md/);
    assert.match(result.stdout, /Stale/);

    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare('SELECT archived FROM chunks WHERE source = ?').get('stale.md');
    db.close();
    assert.equal(row.archived, 1);
  });
});

test('does not archive a chunk older than maxAgeDays if access_count meets minAccessCount', () => {
  withClearDb(() => {
    seedDb([{ source: 'popular.md', heading: 'Popular', content: 'this chunk is old but has been queried and accessed many times' }]);
    backdateChunk('popular.md', { lastAccessed: daysAgoIso(60), accessCount: 5 });

    const result = runPrune([]);
    assert.match(result.stdout, /No stale chunks found/);

    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare('SELECT archived FROM chunks WHERE source = ?').get('popular.md');
    db.close();
    assert.equal(row.archived, 0);
  });
});

test('does not archive a chunk with low access_count if last_accessed is recent', () => {
  withClearDb(() => {
    seedDb([{ source: 'recent.md', heading: 'Recent', content: 'this chunk was ingested moments ago and never queried yet' }]);
    // ingestChunks already sets last_accessed to "now" and access_count to 0.

    const result = runPrune([]);
    assert.match(result.stdout, /No stale chunks found/);

    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare('SELECT archived FROM chunks WHERE source = ?').get('recent.md');
    db.close();
    assert.equal(row.archived, 0);
  });
});

test('custom maxAgeDays/minAccessCount CLI args are respected', () => {
  withClearDb(() => {
    seedDb([{ source: 'medium.md', heading: 'Medium', content: 'this chunk is moderately old and has been accessed only once so far' }]);
    backdateChunk('medium.md', { lastAccessed: daysAgoIso(10), accessCount: 1 });

    // minAccessCount 0: access_count(1) is not < 0, so the chunk should NOT be archived
    // regardless of how lenient maxAgeDays is.
    const notArchivedByAccessCount = runPrune(['100', '0']);
    assert.match(notArchivedByAccessCount.stdout, /No stale chunks found \(cutoff: 100 days, min access count: 0\)\./);

    // maxAgeDays 5: a 10-day-old last_accessed IS older than a 5-day cutoff, so with
    // minAccessCount 2 (access_count 1 < 2) the chunk SHOULD be archived.
    const archived = runPrune(['5', '2']);
    assert.match(archived.stdout, /Archived 1 stale chunk\(s\) \(last_accessed > 5 days ago, access_count < 2\):/);
    assert.match(archived.stdout, /medium\.md/);
  });
});
