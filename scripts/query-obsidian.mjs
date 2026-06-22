#!/usr/bin/env node
// Queries an external Obsidian vault's wiki/ pages for the top-K chunks
// relevant to a question, the "Query" loop operation in Karpathy's LLM-wiki
// pattern (specs/0003-obsidian-vault-query.md): fast retrieval from
// already-compiled wiki pages, as opposed to the slow "Ingest" path
// (the full /research loop, specs/0002).
//
// Indexes into a vault-scoped TF-IDF store at
// ${RIGBENCH_OBSIDIAN_VAULT_PATH}/.vault-index.db — separate from the
// harness's own .claude/memory-vectors.db (lib/memory-store.mjs), so the
// user's personal vault corpus never mixes with rig-bench's self-memory.
// Rebuilt from scratch on every call, same as scripts/ingest-memory.mjs —
// vault sizes here don't yet warrant incremental indexing.
//
// Usage: node scripts/query-obsidian.mjs "<question>" [topK]
//        npm run wiki:query -- "<question>" [topK]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, ingestChunks, queryTopK, closeStore } from '../lib/memory-store.mjs';

/** Same header-based chunking shape as scripts/ingest-memory.mjs's chunkMarkdown. */
export function chunkMarkdown(text) {
  const lines = text.split('\n');
  const chunks = [];
  let currentHeading = null;
  let buffer = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content.length > 0) chunks.push({ heading: currentHeading, content });
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s+/, '').trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

function listWikiPages(vaultPath) {
  const wikiDir = join(vaultPath, 'wiki');
  if (!existsSync(wikiDir)) return [];
  return readdirSync(wikiDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(wikiDir, name))
    .filter((p) => statSync(p).isFile());
}

function buildVaultChunks(vaultPath) {
  const allChunks = [];
  for (const file of listWikiPages(vaultPath)) {
    const text = readFileSync(file, 'utf8');
    const source = `wiki/${file.slice(file.lastIndexOf('/') + 1)}`;
    for (const chunk of chunkMarkdown(text)) {
      if (chunk.content.length < 40) continue;
      allChunks.push({ source, heading: chunk.heading, content: chunk.content });
    }
  }
  return allChunks;
}

function formatXml(results) {
  if (results.length === 0) {
    return '<vault_memory>\n  <!-- No relevant vault content found for this query. -->\n</vault_memory>';
  }
  const items = results.map((r) =>
    `  <memory_item source="${r.source}"${r.heading ? ` heading="${r.heading}"` : ''} score="${r.score}">\n    ${r.content.replace(/\n/g, '\n    ')}\n  </memory_item>`
  ).join('\n');
  return `<vault_memory>\n${items}\n</vault_memory>`;
}

function main() {
  const vaultPath = process.env.RIGBENCH_OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    console.error('RIGBENCH_OBSIDIAN_VAULT_PATH is not set — nothing to query.');
    process.exit(1);
  }

  const query = process.argv[2];
  const topK = process.argv[3] ? parseInt(process.argv[3], 10) : 5;

  if (!query) {
    console.error('Usage: node scripts/query-obsidian.mjs "<question>" [topK]');
    process.exit(1);
  }

  const chunks = buildVaultChunks(vaultPath);
  if (chunks.length === 0) {
    console.log(formatXml([]));
    return;
  }

  const dbPath = join(vaultPath, '.vault-index.db');
  const db = openStore(dbPath);
  db.exec('DELETE FROM chunks; DELETE FROM idf;');
  ingestChunks(db, chunks);
  const results = queryTopK(db, query, topK);
  closeStore(db);

  console.log(formatXml(results));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
