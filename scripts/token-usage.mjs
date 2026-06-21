#!/usr/bin/env node
// Reads Claude Code's own session transcript (~/.claude/projects/<slug>/*.jsonl)
// and prints real, API-reported token usage per assistant turn — no estimation,
// no LLM call. Each `type: "assistant"` line already carries `message.usage`
// (input/output/cache tokens) written by Claude Code itself.
//
// Usage:
//   node scripts/token-usage.mjs            # latest session in this project
//   node scripts/token-usage.mjs --all      # every session in this project
//   node scripts/token-usage.mjs <session-id>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function projectSlug(cwd) {
  return cwd.replace(/[/\\]/g, '-');
}

export function findSessionFiles(projectDir, { all, sessionId }) {
  let files;
  try {
    files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  if (sessionId) return files.filter((f) => f === `${sessionId}.jsonl`);
  if (all) return files;
  // latest by mtime
  const withStat = files.map((f) => ({ f, mtime: statSync(join(projectDir, f)).mtimeMs }));
  withStat.sort((a, b) => b.mtime - a.mtime);
  return withStat.slice(0, 1).map((x) => x.f);
}

export function loadUsageRows(projectDir, files) {
  const rows = [];
  for (const file of files) {
    const session = file.replace('.jsonl', '');
    const lines = readFileSync(join(projectDir, file), 'utf8').split('\n').filter(Boolean);
    let title = null;
    const sessionRows = [];
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'ai-title' && entry.aiTitle) {
        title = entry.aiTitle;
        continue;
      }
      const usage = entry?.message?.usage;
      if (entry.type !== 'assistant' || !usage) continue;
      sessionRows.push({
        session,
        timestamp: entry.timestamp,
        input: usage.input_tokens || 0,
        cacheCreate: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        output: usage.output_tokens || 0,
      });
    }
    for (const row of sessionRows) row.title = title;
    rows.push(...sessionRows);
  }
  return rows;
}

export function sumTotals(rows) {
  const totals = { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 };
  for (const r of rows) {
    totals.input += r.input;
    totals.cacheCreate += r.cacheCreate;
    totals.cacheRead += r.cacheRead;
    totals.output += r.output;
  }
  totals.grandTotal = totals.input + totals.cacheCreate + totals.cacheRead + totals.output;
  return totals;
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const sessionId = args.find((a) => !a.startsWith('--'));

  const projectDir = join(homedir(), '.claude', 'projects', projectSlug(process.cwd()));
  const files = findSessionFiles(projectDir, { all, sessionId });

  if (files.length === 0) {
    console.log(`No session transcripts found under ${projectDir}`);
    return;
  }

  const rows = loadUsageRows(projectDir, files);
  if (rows.length === 0) {
    console.log('No assistant turns with usage data found.');
    return;
  }

  console.log(`=== Token usage: ${files.length} session(s), ${rows.length} request(s) ===\n`);
  console.log('  #   total    input  cache_create  cache_read  output   timestamp');
  let lastSession = null;
  rows.forEach((r, i) => {
    if (r.session !== lastSession) {
      console.log(`  --- ${r.session} — ${r.title || '(untitled session)'} ---`);
      lastSession = r.session;
    }
    const total = r.input + r.cacheCreate + r.cacheRead + r.output;
    console.log(
      `  ${String(i + 1).padStart(3)}  ${String(total).padStart(6)}  ${String(r.input).padStart(6)}` +
      `  ${String(r.cacheCreate).padStart(11)}  ${String(r.cacheRead).padStart(10)}  ${String(r.output).padStart(6)}` +
      `   ${r.timestamp || ''}`
    );
  });

  const totals = sumTotals(rows);
  console.log('\n=== Totals ===');
  console.log(`  input:         ${totals.input}`);
  console.log(`  cache_create:  ${totals.cacheCreate}`);
  console.log(`  cache_read:    ${totals.cacheRead}`);
  console.log(`  output:        ${totals.output}`);
  console.log(`  grand total:   ${totals.grandTotal}`);
}

if (process.argv[1] && process.argv[1].endsWith('token-usage.mjs')) {
  main();
}
