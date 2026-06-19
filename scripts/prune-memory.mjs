#!/usr/bin/env node
// Marks vector-store chunks "archived" (last_accessed older than 30 days
// AND access_count < 2) instead of deleting them — same "archive, never
// delete outright" posture as /memory-prune for the markdown layer (see
// README.md "Memory System"). Archived chunks are excluded from future
// queries (queryTopK only scans archived = 0) but stay in the sqlite file
// so the decision is auditable/reversible.
//
// This operates on the *vector store* (derived from .claude/memory/ +
// memory/ via ingest-memory.mjs), not the markdown files themselves — the
// existing /memory-prune command already handles staleness review for the
// markdown source of truth. Re-running scripts/ingest-memory.mjs rebuilds
// the store from scratch and undoes any archiving here, since the store is
// a derived artifact, not a source of truth.
//
// Usage: node scripts/prune-memory.mjs [maxAgeDays] [minAccessCount]

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, pruneStale, closeStore } from '../lib/memory-store.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(root, '.claude', 'memory-vectors.db');

function main() {
  if (!existsSync(DB_PATH)) {
    console.log('No vector store found — run `npm run memory:ingest` first.');
    return;
  }

  const maxAgeDays = process.argv[2] ? parseInt(process.argv[2], 10) : 30;
  const minAccessCount = process.argv[3] ? parseInt(process.argv[3], 10) : 2;

  const db = openStore(DB_PATH);
  const archived = pruneStale(db, { maxAgeDays, minAccessCount });
  closeStore(db);

  if (archived.length === 0) {
    console.log(`No stale chunks found (cutoff: ${maxAgeDays} days, min access count: ${minAccessCount}).`);
    return;
  }

  console.log(`Archived ${archived.length} stale chunk(s) (last_accessed > ${maxAgeDays} days ago, access_count < ${minAccessCount}):`);
  for (const c of archived) {
    console.log(`  - [${c.source}] ${c.heading || '(no heading)'} — accessed ${c.access_count} time(s), last at ${c.last_accessed}`);
  }
}

main();
