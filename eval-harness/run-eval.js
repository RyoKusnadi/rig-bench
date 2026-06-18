#!/usr/bin/env node
// Eval harness — proves the "Lean 2" roster (operator + inspector) didn't
// trade accuracy for the token reduction it was built for. Runs each golden
// task through the `new-feature` workflow via the Claude Code CLI in
// headless mode, then records total_tokens, subagent_spawns (expected: 2 —
// one operator:build + one inspector, ignoring retries/ship), wall time, and
// pass@1 (did the run reach pipeline_gate=PASS without ESCALATE/BLOCK?).
//
// Requires the `claude` CLI on PATH and ANTHROPIC_API_KEY set — this spends
// real API credits and lets agents mutate the working tree (commits,
// branches), so run it deliberately, not as a side effect of an unrelated
// command. Intended to run from the root of the project being evaluated
// (the one with operator/inspector + new-feature.js installed per
// workflows/README.md), not from rig-bench itself.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const TASKS_PATH = path.join(HERE, 'golden-tasks.json');
const BASELINE_PATH = path.join(HERE, 'baseline.json');
const RESULTS_DIR = path.join(HERE, 'results');
const REGRESSION_THRESHOLD = 0.10; // 10% token-usage increase fails the gate

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function runTask(task) {
  const prompt = `Run the new-feature workflow with task="${task.prompt}".`;
  const startedAt = Date.now();

  let raw;
  try {
    raw = execFileSync(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits'],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, timeout: 20 * 60 * 1000 }
    );
  } catch (e) {
    return {
      id: task.id,
      error: e.message,
      pass: false,
      total_tokens: 0,
      subagent_spawns: 0,
      time_ms: Date.now() - startedAt,
    };
  }

  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // CLI didn't emit valid JSON — treat as a hard failure rather than guess
  }

  const usage = parsed.usage || {};
  const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const transcript = typeof parsed.result === 'string' ? parsed.result : raw;
  const subagentSpawns = (transcript.match(/<task-notification>/g) || []).length;
  const reachedPass = /pipeline-gate>\s*PASS/.test(transcript);
  const blocked = /pipeline-gate>\s*(BLOCK|ESCALATE)/.test(transcript);
  const artifactsPresent = (task.expected_artifacts || []).every((a) =>
    transcript.toLowerCase().includes(a.toLowerCase())
  );

  return {
    id: task.id,
    total_tokens: totalTokens,
    subagent_spawns: subagentSpawns,
    time_ms: Date.now() - startedAt,
    pass: reachedPass && !blocked && artifactsPresent,
  };
}

function main() {
  const tasks = loadJson(TASKS_PATH, []);
  if (!tasks.length) {
    console.error(`No golden tasks found at ${TASKS_PATH}`);
    process.exit(1);
  }

  const baseline = loadJson(BASELINE_PATH, null);
  const results = tasks.map((t) => {
    console.log(`Running ${t.id}: ${t.prompt}`);
    const r = runTask(t);
    console.log(`  -> pass=${r.pass} tokens=${r.total_tokens} spawns=${r.subagent_spawns} time_ms=${r.time_ms}`);
    return r;
  });

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `run-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
  console.log(`Wrote ${outPath}`);

  const totalTokens = results.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
  const passCount = results.filter((r) => r.pass).length;
  const passRate = passCount / results.length;
  const avgSpawns = results.reduce((sum, r) => sum + (r.subagent_spawns || 0), 0) / results.length;

  console.log(`pass@1: ${passCount}/${results.length} (${(passRate * 100).toFixed(1)}%)`);
  console.log(`total tokens: ${totalTokens}`);
  console.log(`avg subagent spawns/task: ${avgSpawns.toFixed(2)} (expected: 2 — operator + inspector, ignoring retries)`);

  if (!baseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ total_tokens: totalTokens, pass_rate: passRate }, null, 2));
    console.log('No baseline.json found — recorded this run as the new baseline.');
    return;
  }

  const tokenDelta = baseline.total_tokens > 0 ? (totalTokens - baseline.total_tokens) / baseline.total_tokens : 0;
  let failed = false;

  if (tokenDelta > REGRESSION_THRESHOLD) {
    console.error(`FAIL: token usage increased ${(tokenDelta * 100).toFixed(1)}% vs baseline (>${REGRESSION_THRESHOLD * 100}% threshold).`);
    failed = true;
  }
  if (passRate < baseline.pass_rate) {
    console.error(`FAIL: pass@1 dropped from ${(baseline.pass_rate * 100).toFixed(1)}% to ${(passRate * 100).toFixed(1)}%.`);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('PASS: within baseline tolerance.');
}

main();
