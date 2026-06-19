// Local, zero-API vector store for .claude/memory/ + memory/ markdown chunks.
//
// "Vector" here means classical TF-IDF over a bag-of-words, not a neural
// embedding — chosen deliberately (see workflows/README.md "Memory & Context
// Management") to avoid adding a model-download dependency or a paid
// embedding API for a corpus that's currently a few dozen markdown files.
// Cosine similarity over TF-IDF vectors is computed in pure JS at query
// time (brute-force over all chunks) — fine at this corpus size; revisit
// (an actual ANN index) only if the corpus grows large enough that a full
// scan becomes slow.
//
// Storage: better-sqlite3, single file at .claude/memory-vectors.db
// (gitignored — local, regenerable from .claude/memory/ + memory/ via
// `npm run memory:ingest`).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','of','to','in','on','for','with',
  'is','are','was','were','be','been','being','this','that','these','those','it','its',
  'as','at','by','from','not','no','do','does','did','has','have','had','will','would',
  'can','could','should','may','might','must','shall','so','than','too','very','just',
  'into','about','also','use','used','using','when','while','which','who','what','where',
  'how','why','because','such','only','own','same','some','each','all','any','more','most',
]);

export function openStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      heading TEXT,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_accessed TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS idf (
      term TEXT PRIMARY KEY,
      value REAL NOT NULL
    );
  `);
  return db;
}

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) || [])
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;
  for (const t of Object.keys(tf)) tf[t] /= total;
  return tf;
}

/** Recompute IDF for every term across all non-archived chunks. Call after ingesting. */
function rebuildIdf(db) {
  const rows = db.prepare('SELECT content FROM chunks WHERE archived = 0').all();
  const docCount = rows.length || 1;
  const docFreq = {};
  for (const row of rows) {
    const seen = new Set(tokenize(row.content));
    for (const term of seen) docFreq[term] = (docFreq[term] || 0) + 1;
  }
  const insert = db.prepare('INSERT INTO idf (term, value) VALUES (?, ?) ON CONFLICT(term) DO UPDATE SET value = excluded.value');
  const tx = db.transaction((entries) => {
    db.prepare('DELETE FROM idf').run();
    for (const [term, df] of entries) insert.run(term, Math.log((docCount + 1) / (df + 1)) + 1);
  });
  tx(Object.entries(docFreq));
}

function tfidfVector(tf, idfMap) {
  const vec = {};
  for (const [term, freq] of Object.entries(tf)) {
    vec[term] = freq * (idfMap[term] ?? 1);
  }
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const term of Object.keys(a)) {
    normA += a[term] * a[term];
    if (term in b) dot += a[term] * b[term];
  }
  for (const term of Object.keys(b)) normB += b[term] * b[term];
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Insert chunks `[{source, heading, content}]`, then rebuild IDF across the whole corpus. */
export function ingestChunks(db, chunks) {
  const now = new Date().toISOString();
  // First pass: insert with a placeholder vector, rebuild IDF, second pass: fill in real vectors.
  const insert = db.prepare(`
    INSERT INTO chunks (source, heading, content, vector, created_at, last_accessed, access_count)
    VALUES (?, ?, ?, '{}', ?, ?, 0)
  `);
  const tx = db.transaction((rows) => {
    for (const c of rows) insert.run(c.source, c.heading || null, c.content, now, now);
  });
  tx(chunks);

  rebuildIdf(db);

  const idfRows = db.prepare('SELECT term, value FROM idf').all();
  const idfMap = {};
  for (const r of idfRows) idfMap[r.term] = r.value;

  const update = db.prepare('UPDATE chunks SET vector = ? WHERE id = ?');
  const all = db.prepare('SELECT id, content FROM chunks WHERE archived = 0').all();
  const tx2 = db.transaction((rows) => {
    for (const row of rows) {
      const vec = tfidfVector(termFrequency(tokenize(row.content)), idfMap);
      update.run(JSON.stringify(vec), row.id);
    }
  });
  tx2(all);

  return chunks.length;
}

/** Query the top-K most similar chunks to `queryText`. Updates last_accessed/access_count on returned rows. */
export function queryTopK(db, queryText, k = 3) {
  const idfRows = db.prepare('SELECT term, value FROM idf').all();
  const idfMap = {};
  for (const r of idfRows) idfMap[r.term] = r.value;

  const queryVec = tfidfVector(termFrequency(tokenize(queryText)), idfMap);
  const rows = db.prepare('SELECT id, source, heading, content, vector FROM chunks WHERE archived = 0').all();

  const scored = rows
    .map((row) => ({ row, score: cosineSimilarity(queryVec, JSON.parse(row.vector)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (scored.length > 0) {
    const now = new Date().toISOString();
    const touch = db.prepare('UPDATE chunks SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?');
    const tx = db.transaction((ids) => { for (const id of ids) touch.run(now, id); });
    tx(scored.map((s) => s.row.id));
  }

  return scored.map((s) => ({
    source: s.row.source,
    heading: s.row.heading,
    content: s.row.content,
    score: Math.round(s.score * 1000) / 1000,
  }));
}

/** Mark chunks stale (last_accessed older than maxAgeDays AND access_count < minAccessCount) as archived. Returns the archived rows. */
export function pruneStale(db, { maxAgeDays = 30, minAccessCount = 2 } = {}) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const stale = db.prepare(
    'SELECT * FROM chunks WHERE archived = 0 AND last_accessed < ? AND access_count < ?'
  ).all(cutoff, minAccessCount);

  if (stale.length > 0) {
    const archive = db.prepare('UPDATE chunks SET archived = 1 WHERE id = ?');
    const tx = db.transaction((rows) => { for (const r of rows) archive.run(r.id); });
    tx(stale);
    rebuildIdf(db);
  }

  return stale;
}

export function closeStore(db) {
  db.close();
}
