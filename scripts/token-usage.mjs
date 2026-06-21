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

// A "request" is one human/command-typed turn (type:"user" with string
// content) plus every assistant turn that follows it, up to the next such
// user turn. type:"user" lines with array content are tool_result
// followups, not new input — they attach to the most recent turn instead
// of starting a new request.
export function buildSessionRequests(projectDir, file) {
  const session = file.replace('.jsonl', '');
  const lines = readFileSync(join(projectDir, file), 'utf8').split('\n').filter(Boolean);

  let title = null;
  const requests = [];
  let current = null;
  let lastTurn = null;

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

    if (entry.type === 'user') {
      if (typeof entry.message?.content === 'string') {
        current = { text: entry.message.content, timestamp: entry.timestamp, turns: [] };
        requests.push(current);
        lastTurn = null;
      } else if (Array.isArray(entry.message?.content) && lastTurn) {
        lastTurn.toolResult = entry.message.content;
      }
      continue;
    }

    const usage = entry?.message?.usage;
    if (entry.type !== 'assistant' || !usage || !current) continue;

    const turn = {
      timestamp: entry.timestamp,
      input: usage.input_tokens || 0,
      cacheCreate: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
      content: entry.message.content,
    };
    turn.total = turn.input + turn.cacheCreate + turn.cacheRead + turn.output;
    current.turns.push(turn);
    lastTurn = turn;
  }

  for (const req of requests) {
    req.input = req.turns.reduce((s, t) => s + t.input, 0);
    req.cacheCreate = req.turns.reduce((s, t) => s + t.cacheCreate, 0);
    req.cacheRead = req.turns.reduce((s, t) => s + t.cacheRead, 0);
    req.output = req.turns.reduce((s, t) => s + t.output, 0);
    req.total = req.input + req.cacheCreate + req.cacheRead + req.output;
  }

  return { session, title, requests: requests.filter((r) => r.turns.length > 0) };
}

export function loadSessionsSummary(projectDir, files) {
  const summaries = [];
  for (const file of files) {
    const { session, title, requests } = buildSessionRequests(projectDir, file);
    if (requests.length === 0) continue;
    const allTurns = requests.flatMap((r) => r.turns);
    const timestamps = allTurns.map((t) => t.timestamp).filter(Boolean).sort();
    summaries.push({
      session,
      title,
      requestCount: requests.length,
      totals: sumTotals(allTurns),
      startTime: timestamps[0] || null,
      endTime: timestamps[timestamps.length - 1] || null,
    });
  }
  return summaries;
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
