#!/usr/bin/env node
// Reads every markdown file under .claude/memory/ and memory/, plus every
// research/{topic}/TITLE.MD report (todo.md Phase 6), splits each into
// chunks by header (## / ###), and ingests them into the local TF-IDF
// vector store (lib/memory-store.mjs). Re-running re-ingests everything from
// scratch (chunk content is cheap to regenerate; the store is a derived
// artifact, not a source of truth — the markdown files are).
//
// "Tagging" a research chunk with type/topic/version (todo.md Phase 6) isn't
// a separate schema column — lib/memory-store.mjs's chunks table has no
// metadata columns to filter on, and queryTopK() only ever ranks by cosine
// similarity, never by a structured filter. Instead, TITLE.MD's own YAML
// frontmatter (topic/target_outcome/latest_version/...) is plain text that
// sits in the file's first chunk (chunkMarkdown() doesn't split inside it —
// the frontmatter precedes the first `#`/`##` header), so those terms are
// already part of that chunk's TF-IDF vector. Querying for a topic or
// version surfaces the right chunk through the same retrieval path as every
// other memory entry — consistent with this store's classical-bag-of-words
// design (see lib/memory-store.mjs's top comment), not a parallel mechanism.
//
// Usage: node scripts/ingest-memory.mjs   (or `npm run memory:ingest`)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, ingestChunks, closeStore } from '../lib/memory-store.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(root, '.claude', 'memory-vectors.db');
const SOURCE_DIRS = [join(root, '.claude', 'memory'), join(root, 'memory')];
const RESEARCH_DIR = join(root, 'research');

function walkMarkdownFiles(dir, matchesFile = (name) => name.endsWith('.md')) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkMarkdownFiles(full, matchesFile));
    else if (matchesFile(entry)) out.push(full);
  }
  return out;
}

function chunkMarkdown(text) {
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

function main() {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walkMarkdownFiles(dir)),
    ...walkMarkdownFiles(RESEARCH_DIR, (name) => name === 'TITLE.MD'),
  ];
  if (files.length === 0) {
    console.log('No markdown files found under .claude/memory/, memory/, or research/*/TITLE.MD — nothing to ingest.');
    return;
  }

  const allChunks = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    for (const chunk of chunkMarkdown(text)) {
      // Skip trivially short chunks (e.g. a lone "---" or empty section) —
      // they add noise to retrieval without carrying a real lesson.
      if (chunk.content.length < 40) continue;
      allChunks.push({ source: rel, heading: chunk.heading, content: chunk.content });
    }
  }

  if (allChunks.length === 0) {
    console.log('No chunks long enough to ingest (everything under 40 chars).');
    return;
  }

  const db = openStore(DB_PATH);
  // Re-ingesting from scratch: drop prior chunks so stale/deleted memory
  // entries don't linger in the store as ghosts after the source .md is edited.
  db.exec('DELETE FROM chunks; DELETE FROM idf;');
  const count = ingestChunks(db, allChunks);
  closeStore(db);

  console.log(`Ingested ${count} chunks from ${files.length} file(s) into ${DB_PATH}`);
}

main();
