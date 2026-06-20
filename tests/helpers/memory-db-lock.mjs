// Shared helper for test files that contend on real, hardcoded repo paths
// that the scripts under test give no env var/CLI override for (confirmed by
// reading each script's source):
//   - tests/ingest-memory.test.js, tests/query-memory.test.js, and
//     tests/prune-memory.test.js all hardcode their sqlite path to
//     <repoRoot>/.claude/memory-vectors.db.
//   - tests/ingest-memory.test.js and tests/ask-questionnaire.test.js both
//     create/remove directories under <repoRoot>/research/.
// `node --test tests/` runs separate test *files* concurrently by default,
// which causes cross-file races on these shared paths (one file's
// create/backup/restore stomps on another's). This module provides a
// simple cross-process file-lock mutex so only one contending test file
// touches a given shared path at a time.

import { existsSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_DIR = join(__dirname, '..', '..', '.claude', 'hook-cache');

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy-wait; Atomics.wait would be cleaner but requires a SharedArrayBuffer
  }
}

function withLock(lockPath, fn) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 30_000;
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx'); // exclusive create; fails if it already exists
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for test lock: ${lockPath}`);
      sleepSync(25);
    }
  }
  try {
    closeSync(fd);
    return fn();
  } finally {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

/** Run `fn` (sync) while holding an exclusive cross-process lock on the shared memory-vectors.db path. */
export function withMemoryDbLock(fn) {
  return withLock(join(LOCK_DIR, 'memory-db-test.lock'), fn);
}

/** Run `fn` (sync) while holding an exclusive cross-process lock on the shared research/ directory. */
export function withResearchDirLock(fn) {
  return withLock(join(LOCK_DIR, 'research-dir-test.lock'), fn);
}
