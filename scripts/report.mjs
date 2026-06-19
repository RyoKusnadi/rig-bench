#!/usr/bin/env node
// Reads every telemetry/runs/*.jsonl file (written by hooks/telemetry-writer.mjs)
// and prints aggregate stats: average cost per workflow, which stages consume
// the most tokens, model-tier usage vs escalation frequency, and run outcomes.
//
// Usage: node scripts/report.mjs
//
// Note on "validation failure rate per agent" (asked for in todo.md Phase 5):
// not tracked here. Workflow-driven agent() calls already get validated,
// structured output via the Workflow tool's `schema` option — a call either
// returns a validated object or `null` (treated as BLOCK/ESCALATE upstream),
// so there's no separate "validation failed but kept going" state to count.
// Use `outcome: FAILED`/`BLOCKED` counts below as the closest real signal.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = join(root, 'telemetry', 'runs');

function loadEntries() {
  let files = [];
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const entries = [];
  for (const file of files) {
    const lines = readFileSync(join(runsDir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines rather than crash the report
      }
    }
  }
  return entries;
}

function main() {
  const entries = loadEntries();
  if (entries.length === 0) {
    console.log('No telemetry found under telemetry/runs/ — run a workflow first.');
    return;
  }

  const runSummaries = entries.filter((e) => e.event === 'run_summary');
  const stageEntries = entries.filter((e) => e.label && e.output_tokens !== undefined);
  const escalationEntries = entries.filter((e) => e.event === 'escalation');

  // ── Average cost per workflow type ──────────────────────────────────────
  const byWorkflow = {};
  for (const r of runSummaries) {
    const w = r.workflow_name;
    byWorkflow[w] = byWorkflow[w] || { runs: 0, totalTokens: 0, outcomes: {} };
    byWorkflow[w].runs += 1;
    byWorkflow[w].totalTokens += r.total_output_tokens || 0;
    byWorkflow[w].outcomes[r.outcome] = (byWorkflow[w].outcomes[r.outcome] || 0) + 1;
  }

  console.log('=== Average output-token cost per workflow ===');
  for (const [name, stats] of Object.entries(byWorkflow)) {
    const avg = Math.round(stats.totalTokens / stats.runs);
    console.log(`  ${name}: ${stats.runs} run(s), avg ${avg} tokens, outcomes: ${JSON.stringify(stats.outcomes)}`);
  }

  // ── Which stages/labels consume the most tokens ────────────────────────
  const byLabel = {};
  for (const s of stageEntries) {
    byLabel[s.label] = (byLabel[s.label] || 0) + (s.output_tokens || 0);
  }
  const topLabels = Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log('\n=== Top stages by total output tokens ===');
  for (const [label, tokens] of topLabels) {
    console.log(`  ${label}: ${tokens}`);
  }

  // ── Escalation frequency (default tier vs escalation tier) ─────────────
  console.log('\n=== Escalation events ===');
  if (escalationEntries.length === 0) {
    console.log('  None recorded — every stage stayed on its default tier.');
  } else {
    const byState = {};
    for (const e of escalationEntries) {
      byState[e.state] = (byState[e.state] || 0) + 1;
    }
    for (const [state, count] of Object.entries(byState)) {
      console.log(`  ${state}: escalated ${count} time(s)`);
    }
  }

  // ── Run outcome breakdown ───────────────────────────────────────────────
  const outcomeCounts = {};
  for (const r of runSummaries) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
  }
  console.log('\n=== Outcome breakdown (all workflows) ===');
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    console.log(`  ${outcome}: ${count}`);
  }
}

main();
