#!/usr/bin/env node
// Queries the local TF-IDF vector store for the top-K chunks most relevant
// to a task description, and prints them wrapped in <long_term_memory> /
// <memory_item> tags — the explicit-XML-tag format Anthropic's context
// engineering guidance recommends for retrieved context, so the model's
// attention mechanism treats this block distinctly from the rest of the
// prompt. `operator`/`inspector` run this via Bash (they have no fs/Node
// access of their own beyond their declared tools, and workflows/*.js
// can't run it either — see lib/memory-store.mjs's top comment).
//
// Usage: node scripts/query-memory.mjs "<task description>" [topK]
//        npm run memory:query -- "<task description>" [topK]

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, queryTopK, closeStore } from '../lib/memory-store.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(root, '.claude', 'memory-vectors.db');

function main() {
  const query = process.argv[2];
  const topK = process.argv[3] ? parseInt(process.argv[3], 10) : 3;

  if (!query) {
    console.error('Usage: node scripts/query-memory.mjs "<task description>" [topK]');
    process.exit(1);
  }

  if (!existsSync(DB_PATH)) {
    console.log('<long_term_memory>\n  <!-- No vector store found — run `npm run memory:ingest` first. Falling back to no retrieved memory. -->\n</long_term_memory>');
    return;
  }

  const db = openStore(DB_PATH);
  const results = queryTopK(db, query, topK);
  closeStore(db);

  if (results.length === 0) {
    console.log('<long_term_memory>\n  <!-- No sufficiently relevant memory found for this query. -->\n</long_term_memory>');
    return;
  }

  const items = results.map((r) =>
    `  <memory_item source="${r.source}"${r.heading ? ` heading="${r.heading}"` : ''} score="${r.score}">\n    ${r.content.replace(/\n/g, '\n    ')}\n  </memory_item>`
  ).join('\n');

  console.log(`<long_term_memory>\n${items}\n</long_term_memory>`);
}

main();
