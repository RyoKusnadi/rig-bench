// Tests for scripts/ingest-memory.mjs — walks .claude/memory/, memory/, and
// research/*/TITLE.MD, chunks each markdown file by header, and rebuilds
// the TF-IDF vector store at .claude/memory-vectors.db from scratch.
//
// The script hardcodes DB_PATH/SOURCE_DIRS/RESEARCH_DIR relative to its own
// file location (no env var or CLI flag to redirect them — confirmed by
// reading the source), so there is no way to point it at a temp directory.
// Tests run it as a real subprocess against the repo's actual
// .claude/memory/ + memory/ content (read-only as far as ingest is
// concerned) and the real .claude/memory-vectors.db path (gitignored, see
// .gitignore), backing up/restoring any pre-existing db file around each
// test so real local state is never lost.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { withMemoryDbLock, withResearchDirLock } from './helpers/memory-db-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'ingest-memory.mjs');
const DB_PATH = join(REPO_ROOT, '.claude', 'memory-vectors.db');
const RESEARCH_DIR = join(REPO_ROOT, 'research');

function runIngest() {
  return spawnSync('node', [SCRIPT_PATH], { encoding: 'utf8' });
}

// Move aside any real DB_PATH (and its WAL/SHM siblings) before the test,
// remove whatever the test creates, then restore the original. Holds a
// cross-process lock for the duration since tests/query-memory.test.js and
// tests/prune-memory.test.js contend on this same hardcoded path (see
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

// tests/ask-questionnaire.test.js also creates/removes directories under
// research/ — hold the shared lock for the duration so the two files don't
// race on whether the parent research/ dir pre-existed.
function withResearchFixture(topicDir, titleMdContent, fn) {
  return withResearchDirLock(() => {
    const researchDirPreexisted = existsSync(RESEARCH_DIR);
    const dir = join(RESEARCH_DIR, topicDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'TITLE.MD'), titleMdContent);
    try {
      return fn();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      // Clean up the parent research/ dir too if this fixture created it.
      if (!researchDirPreexisted && existsSync(RESEARCH_DIR) && readdirSync(RESEARCH_DIR).length === 0) {
        rmSync(RESEARCH_DIR, { recursive: true, force: true });
      }
    }
  });
}

test('ingests real .claude/memory/ + memory/ markdown into a fresh db, prints a count', () => {
  withClearDb(() => {
    const result = runIngest();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ingested \d+ chunks from \d+ file\(s\) into/);
    assert.ok(existsSync(DB_PATH), 'expected memory-vectors.db to be created');

    const db = new Database(DB_PATH, { readonly: true });
    const count = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    assert.ok(count > 0, 'expected at least one chunk to be ingested');
    db.close();
  });
});

test('re-ingesting drops prior chunks instead of accumulating duplicates', () => {
  withClearDb(() => {
    runIngest();
    const db1 = new Database(DB_PATH, { readonly: true });
    const firstCount = db1.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    db1.close();

    runIngest();
    const db2 = new Database(DB_PATH, { readonly: true });
    const secondCount = db2.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    db2.close();

    assert.equal(secondCount, firstCount, 'chunk count should be identical, not doubled, after re-ingesting');
  });
});

test('only picks up TITLE.MD (not other .md files) under research/{topic}/', () => {
  withClearDb(() => {
    const topicDir = `__test-topic-${Date.now()}`;
    withResearchFixture(
      topicDir,
      '## Heading One\n\nThis is a sufficiently long chunk of content for ingestion testing purposes here.\n',
      () => {
        const dir = join(RESEARCH_DIR, topicDir);
        writeFileSync(
          join(dir, 'notes.md'),
          '## Should Not Be Ingested\n\nThis file is not named TITLE.MD so chunkMarkdown should never see it at all.\n'
        );

        const result = runIngest();
        assert.equal(result.status, 0, result.stderr);

        const db = new Database(DB_PATH, { readonly: true });
        const rows = db.prepare("SELECT source FROM chunks WHERE source LIKE ?").all(`%${topicDir}%`);
        db.close();

        assert.ok(rows.some((r) => r.source.endsWith('TITLE.MD')), 'expected TITLE.MD chunk to be ingested');
        assert.ok(!rows.some((r) => r.source.endsWith('notes.md')), 'expected notes.md to be skipped');
      }
    );
  });
});

test('skips chunks shorter than 40 characters', () => {
  withClearDb(() => {
    const topicDir = `__test-short-${Date.now()}`;
    withResearchFixture(topicDir, '## Tiny\n\nshort\n', () => {
      const result = runIngest();
      assert.equal(result.status, 0, result.stderr);

      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare('SELECT source FROM chunks WHERE source LIKE ?').all(`%${topicDir}%`);
      db.close();
      assert.equal(rows.length, 0, 'expected the short chunk to be skipped (under 40 chars)');
    });
  });
});
